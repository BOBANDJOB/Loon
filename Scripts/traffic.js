// proxy-meter: 定时（cron）每小时运行一次。
//   - 限速策略有新事件（档位变化、配置损坏 / 数据缺失导致清除等）时立即推送；已推送到哪条事件记在 $persistentStore。
//   - 每天到 report_hour 后的第一次运行推送日报（当天已推送过就跳过）；超过阈值或预计周期末超过阈值时标题改为提醒。
//   通知只放摘要；日志依次显示概览、每日趋势、策略变化、按人 / 网站总量，完整计算和上下行放在末尾诊断。
//   和额度比较的数字（已用、百分比、预计周期末、预警）一律用校准后的值（offset + scale × vnstat）；
//   vnstat 原始读数只出现在【诊断】。
// 手动查询（插件里的 generic 入口，参数为字符串 "mode=manual"；Loon 的 $script 没有触发类型字段，只能用参数区分）：
//   - 查询节点：长按节点运行时只用 $environment.params 的 node（没有时用 policyGroup），失败直接报失败；
//     从脚本列表运行时只用存储的查询节点（最近一次定时运行存下的 KEY_ARGS，generic 的字符串参数不能带 ${node}）。
//     两种入口互不回退；没有存储的节点时只提示，不发请求。
//   - 快速失败：请求超时 3 秒，另有 5 秒兜底计时器；按错误类型（连接被拒 / 超时 / 非 200 / 响应格式异常）给出提示。
// 每次查询都在脚本日志里记录耗时（ms），便于评估超时阈值。
//   - 结果用 $done({title, content}) 返回（不超过 10 行），从节点入口运行时只弹窗，不推送通知；
//     从脚本列表运行时同时推送通知（内容相同）。明细只写脚本日志；verbose=true 展开完整诊断。
//     不改任何已推送状态。
// 网站排行里认不出的 IP 显示为"IP（AS号 运营商名称）"，用 Loon 自带的 $utils.ipasn / ipaso，服务器端不做 ASN 查询。
// 不带参数运行时，走 Loon 的分流规则，需要 DOMAIN,stats.noble.internal,<Noble 的节点>。

const URL = "http://stats.noble.internal/stats";
const KEY_ARGS = "proxy-meter.args";       // 定时运行时的插件参数，供手动查询使用

// $argument：插件定时运行时是对象；手动入口是字符串 "mode=manual"（Loon 不解析，按查询字符串自己解析）
function parseArgs(a) {
  if (typeof a === "object" && a !== null) return a;
  const out = {};
  if (typeof a === "string") {
    for (const kv of a.split("&")) {
      const i = kv.indexOf("=");
      if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
  }
  return out;
}

const RAW = parseArgs(typeof $argument === "undefined" ? null : $argument);
const MANUAL = RAW.mode === "manual";
let saved = {};
try {
  saved = JSON.parse($persistentStore.read(KEY_ARGS) || "{}");
} catch (e) {
  saved = {};
}
const ARG = MANUAL ? Object.assign({}, saved, RAW) : RAW;
if (!MANUAL && Object.keys(RAW).length) $persistentStore.write(JSON.stringify(RAW), KEY_ARGS);
const NODE = ARG.node || "";
const WARN = Number(ARG.warn) || 70;
const ALERT = Number(ARG.alert) || 90;
const FORECAST = Number(ARG.forecast) || 90; // 预计周期末用量占额度的提醒阈值（%）
const REPORT_HOUR = ARG.report_hour === undefined || ARG.report_hour === "" || isNaN(Number(ARG.report_hour)) ? 9 : Number(ARG.report_hour);
const TOP = 5;
const VERBOSE = ARG.verbose === true || ARG.verbose === "true";
const SHOW_EVENTS = 5; // 日报里显示的最近事件条数
const API_EVENTS = 20; // /stats 返回的最近事件条数（policy.py 的 SHOW_EVENTS）
const KEY_EVENT = "proxy-meter.lastEvent";   // 已推送的最新一条事件的时间
const KEY_REPORT = "proxy-meter.reportDate"; // 已推送日报的日期
const KEY_FAIL = "proxy-meter.failDate";     // 已推送查询失败的日期，避免每小时重复提醒
const KEY_OVER = "proxy-meter.overCycle";    // 处于"已超额"状态时记下周期开始日；回到额度以下时清除
const OVER_NOTE = "DMIT 已限速（unmetered 4 Mbps）";
const TIER = { none: "不限速", light: "轻度", medium: "中度", floor: "保底", critical: "紧急" };
const MAX_LINES = 10; // 手动查询弹窗 content 的最大行数

// 手动查询的入口参数：长按节点 / 策略组运行时才有
const ENV = typeof $environment === "object" && $environment !== null && $environment.params ? $environment.params : null;
const ENTRY = ENV ? String(ENV.node || ENV.policyGroup || "") : "";
const ENTRY_FROM = ENV ? (ENV.node ? "node" : ENV.policyGroup ? "policyGroup" : "") : "";
const TIMEOUT_MS = MANUAL ? 3000 : 10000; // 手动查询要快速失败；定时运行保持原来的 10 秒
const GUARD_MS = 5000;                    // 手动查询兜底：回调迟迟不返回时强制结束
const MAX_STR = 200;                      // 显示前把响应里的每个字符串截断到这么长

function fmt(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return bytes.toFixed(i >= 3 ? 2 : 0) + " " + units[i];
}

function rankLines(list, n) {
  return list.slice(0, n).map((r, i) =>
    (i + 1) + ". " + r.name + "  " + fmt(r.total) + "（↓ " + fmt(r.down) + " ↑ " + fmt(r.up) + "）"
  );
}

// 网站排行里认不出的 IP：用 Loon 本地的 ASN 库补上"IP（AS号 运营商名称）"，查不到就只显示 IP
function ipLabel(name) {
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(name) || (name.indexOf(":") >= 0 && /^[0-9a-f:.]+$/i.test(name));
  if (!isIp || typeof $utils === "undefined") return name;
  try {
    const asn = String($utils.ipasn(name) || "").replace(/^AS/i, "");
    const org = String($utils.ipaso(name) || "");
    if (!asn && !org) return name;
    return name + "（" + [asn ? "AS" + asn : "", org].filter(Boolean).join(" ") + "）";
  } catch (e) {
    return name;
  }
}

function pct(r) {
  return (r * 100).toFixed(1) + "%";
}

const METHOD = { cycle: "按周期平均速度", recent: "按最近 3 天速度" };

// 外推方式的名称；近期窗口天数来自 policy.json 的 recent_days（旧版 stats-api 没有时按 3 天）
function methodLabel(m, o) {
  if (m !== "recent") return METHOD.cycle;
  return "按最近 " + ((o && o.recent_days) || 3) + " 天速度" + (o && o.recent_basis === "day" ? "（按日数据）" : "");
}

function day(d) {
  const p = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function when(iso) {
  return iso.slice(5, 16).replace("T", " ");
}

function tierName(p, t) {
  return TIER[t] + (t !== "none" && p.rate_mbps[t] ? " " + p.rate_mbps[t] + " Mbps" : "");
}

function eventLines(events) {
  return events.map((e) => when(e.time) + " " + e.message);
}

const GB = (b) => Number((b / 1024 ** 3).toFixed(2)) + " GB";
const signedPt = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(1) + " 个百分点";

// 和额度比较的数字（已用、百分比、剩余、预计周期末、预警）一律用校准后的值：offset + scale × vnstat，来自限速策略。
// 策略不可用时（stats-api 刚启动、配置无效等）退回 vnstat 原始读数，calibrated 为 false。
function cal(s) {
  const p = s.policy;
  if (p && p.status === "ok" && p.overall) {
    const o = p.overall;
    return {
      used: o.used, quota: o.quota, remaining: o.remaining, percent: o.used * 100 / o.quota,
      projPct: o.projected_pct, projBytes: o.projected_pct * o.quota / 100, method: o.projected_method || "cycle",
      calibrated: true, o: o,
    };
  }
  const t = s.total;
  const pr = t.projected;
  return {
    used: t.used, quota: t.quota, remaining: t.quota - t.used, percent: t.percent,
    projPct: pr ? pr.bytes * 100 / t.quota : null, projBytes: pr ? pr.bytes : null, method: (pr && pr.method) || "cycle",
    calibrated: false, o: null,
  };
}

const pct2 = (x) => x.toFixed(2) + "%";
const METHOD_SHORT = { cycle: "按周期平均", recent: "按近期速度" };

// 新规则执行前，今日额度只是预览
function previewTag(p) {
  return p && p.v2_active === false ? "（预览，" + String(p.v2_from || "").slice(5) + " 起执行）" : "";
}

// 超额：已用 ≥ 额度（校准后）
function isOver(c) {
  return c.used >= c.quota;
}

function overText(c) {
  return "已超额 " + fmt(c.used - c.quota) + "，" + OVER_NOTE;
}

function usedLine(c, showPercent) {
  return "已用 " + fmt(c.used) + " / " + fmt(c.quota) + (showPercent === false ? "" : "（" + pct2(c.percent) + "）") +
    (c.calibrated ? "" : "（未校准：vnstat 原始读数）");
}

function projectedShort(c) {
  return c.projPct === null ? "预计周期末：数据不足" :
    "预计周期末 " + fmt(c.projBytes) + "（" + pct2(c.projPct) + "，" + methodLabel(c.method, c.o) + "）";
}

function bar(value, max, width) {
  const filled = max > 0 ? Math.max(0, Math.min(width, Math.round(value / max * width))) : 0;
  return "■".repeat(filled) + "□".repeat(width - filled);
}

function progressLine(c) {
  return "用量 " + bar(c.used, c.quota, 20) + " " + c.percent.toFixed(1) + "%";
}

function forecastLine(c) {
  if (!c.o || c.o.target_percent === undefined || c.projPct === null) return projectedShort(c);
  return "周期末预计 " + fmt(c.projBytes) + "（" + c.projPct.toFixed(1) + "%） · 目标 " + c.o.target_percent + "%";
}

function budgetLine(s, c) {
  if (isOver(c) || !c.o || c.o.target_percent === undefined) return null;
  const o = c.o;
  return "今日 " + fmt(o.today_used) + " / " + fmt(o.daily_quota) +
    (o.today_used > o.daily_quota ? "，超出 " + fmt(o.today_used - o.daily_quota) : "，还可用 " + fmt(o.daily_quota - o.today_used)) + previewTag(s.policy);
}

// 只在数据完整且策略已成熟时给出目标内判断；校准、执行和 dry_run 异常始终出现在摘要。
function statusLine(s, c) {
  const p = s.policy;
  const notes = [];
  if (!p) notes.push("⚠️ 策略尚未计算，用量未校准");
  else if (p.status !== "ok") notes.push("⚠️ 策略异常：" + p.error);
  else {
    if (p.overall.uncalibrated) notes.push("⚠️ 周期数据不全且 offset 未填写，统计偏低");
    else if (!isOver(c) && p.overall.mature && c.projPct !== null && c.projPct <= p.overall.target_percent) notes.push("当前预计在目标内");
    if (p.overall.offset_stale) notes.push("旧周期 offset 已忽略");
  }
  if (p && p.dry_run) notes.push("dry_run：策略只计算不执行");
  if (p && (!p.shaper || !p.shaper.initialized)) notes.push("⚠️ 实际限速未确认");
  if (p && p.shaper && p.shaper.error) notes.push("⚠️ 执行异常：" + p.shaper.error);
  if (p && p.status === "ok" && Object.keys(p.users).some((n) => executionDiffers(p, n))) notes.push("⚠️ 策略与实际限速不同，见日志");
  return notes.join("；");
}

function executionDiffers(p, name) {
  const sh = p.shaper;
  return sh && sh.initialized && sh.applied && Object.prototype.hasOwnProperty.call(sh.applied, name) &&
    (sh.applied[name] || 0) !== (p.users[name].tier === "none" ? 0 : p.rate_mbps[p.users[name].tier]);
}

// daily 是网卡原始日数据，只乘 scale；offset 是周期补差，不分摊到每天。
function trendData(s, c) {
  if (!Array.isArray(s.daily) || !s.daily.length || !c.calibrated) return null;
  const scale = c.o.scale === undefined ? 1 : c.o.scale;
  if (typeof scale !== "number" || !isFinite(scale) || scale <= 0) return null;
  return s.daily.slice(-7).map((r) => ({ date: r.date,
    used: typeof r.used === "number" && isFinite(r.used) && r.used >= 0 ? r.used * scale : null }));
}

function trendShort(s, c) {
  const rows = trendData(s, c);
  if (!rows || !rows.some((r) => r.used !== null)) return null;
  const max = Math.max(...rows.map((r) => r.used || 0));
  const spark = rows.map((r) => r.used === null ? "?" : max === 0 ? "▁" : "▁▂▃▄▅▆▇█"[Math.max(0, Math.ceil(r.used / max * 8) - 1)]).join("");
  return "近7完整日 " + spark + " · 峰值 " + fmt(max) + (rows.some((r) => r.used === null) ? "（? 缺失）" : "");
}

function trendLines(s, c) {
  const rows = trendData(s, c);
  if (!rows) return ["暂无趋势（需每日数据和有效校准）"];
  const max = Math.max(...rows.map((r) => r.used || 0));
  return [rows[0].date + " → " + rows[rows.length - 1].date + "（校准估算，不含今天，可跨周期）"]
    .concat(rows.map((r) => r.date.slice(5) + " " + (r.used === null ? "? 数据缺失或当日采集不完整" : bar(r.used, max, 12) + " " + fmt(r.used))));
}

// 目标相关：周期末预计达成率、目标轨迹、今日额度（旧版 stats-api 没有这些字段时不显示）
function targetLines(o) {
  if (o.target_percent === undefined) return [];
  return [
    (METHOD_SHORT[o.projected_method] || "") + "预计达成 " + o.projected_pct + "%（目标 " + o.target_percent + "%，" + signedPt(o.projected_vs_target) + "）",
    "目标进度 " + fmt(o.trajectory) + "，实际 " + fmt(o.used) + "（比目标进度" + (o.trajectory_deviation >= 0 ? "多用 " : "少用 ") +
      fmt(Math.abs(o.trajectory_deviation)) + "）",
    o.remaining <= 0 ? "今日额度：已超额，无今日额度（剩余 " + o.days_left + " 天，含今天），今日已用 " + fmt(o.today_used)
      : "今日额度 " + fmt(o.daily_quota) + "（剩余 " + o.days_left + " 天，含今天），今日已用 " + fmt(o.today_used) +
        (o.daily_over ? "，已超出 " + fmt(o.today_used - o.daily_quota) : "，还剩 " + fmt(o.daily_quota - o.today_used)),
  ];
}

function policySummary(p) {
  if (!p) return null;
  const tag = p.dry_run ? "（dry_run）" : "";
  const sh = p.shaper;
  if (sh && sh.initialized && sh.applied) {
    return "实际限速" + tag + "：" + Object.keys(sh.applied).sort()
      .map((n) => n + " " + (sh.applied[n] ? sh.applied[n] + " Mbps" : "不限速")).join(" · ");
  }
  if (p.status !== "ok") return "限速：全部不限速" + tag + "，" + p.error;
  const names = Object.keys(p.users);
  if (!names.length) return null;
  return "策略档位" + tag + "：" + names.map((n) => n + " " + tierName(p, p.users[n].tier)).join(" · ");
}

// ---- 日志报告：【概览】【限速策略】【本周期按人】【每人前 5 网站】【诊断】 ----

function section(title, lines) {
  return ["", "【" + title + "】"].concat(lines);
}

function overviewLines(s, c) {
  const ps = policySummary(s.policy);
  const lines = [progressLine(c), usedLine(c, false),
    (isOver(c) ? overText(c) : "剩余 " + fmt(c.remaining)) + " · " + s.cycle.reset + " 重置"];
  if (!isOver(c)) lines.push(forecastLine(c));
  const budget = budgetLine(s, c);
  if (budget) lines.push(budget);
  if (ps) lines.push(ps);
  const status = statusLine(s, c);
  if (status) lines.push(status);
  return lines;
}

function policyLines(s) {
  const p = s.policy;
  if (!p) return ["stats-api 刚启动，尚未计算"];
  const lines = [when(p.evaluated) + " 计算"];
  if (p.status !== "ok") return lines.concat([p.error + "；完整执行情况见诊断"]);
  if (p.v2_active === false) lines.push("每日额度 / 动态保底 / 紧急档：" + p.v2_from + " 起执行，当前仅预览");
  const o = p.overall;
  if (o.target_percent !== undefined) lines.push("比目标进度" + (o.trajectory_deviation >= 0 ? "多用 " : "少用 ") + fmt(Math.abs(o.trajectory_deviation)));
  for (const name of Object.keys(p.users)) {
    const m = p.users[name];
    lines.push(name + "：节奏 " + m.pace.toFixed(2) + " · 份额已用 " + fmt(m.nic_equiv) + " / " + fmt(m.budget));
    if (m.why.length) lines.push("  " + tierName(p, m.tier) + "：" + m.why.join("；"));
    if (m.pending) lines.push("  待降档 → " + tierName(p, m.pending.to) + "，" + when(m.pending.at) + " 满 " + p.hold_hours + " 小时");
    if (m.preview && m.preview.tier !== m.tier) lines.push("  新规则预览 → " + tierName(p, m.preview.tier) + "：" + m.preview.why.join("；"));
    if (executionDiffers(p, name)) {
      lines.push("  ⚠️ 策略 " + tierName(p, m.tier) + " 与实际执行不同，见诊断");
    }
  }
  return lines;
}

function policyDiagLines(s) {
  const p = s.policy;
  if (!p) return ["stats-api 刚启动，尚未计算"];
  const lines = [when(p.evaluated) + " 计算" + (p.dry_run ? "；dry_run，只计算不执行" : "")];
  if (p.v2_active === false) lines.push("新规则（每日额度、动态保底、紧急档）自 " + p.v2_from + " 起执行，此前只显示预览");
  if (p.status !== "ok") {
    lines.push(p.error + "，当前不限速");
  } else {
    const o = p.overall;
    lines.push(
      (o.remaining < 0 ? "已超额 " + fmt(-o.remaining) : "实际剩余 " + fmt(o.remaining)) + "（" + (o.floor_line === undefined ? "保底线 " + GB(o.floor_remaining)
        : p.v2_active === false ? "保底线 " + GB(o.floor_remaining) + "；新规则：保底线 " + GB(o.floor_line) + "、紧急线 " + GB(o.critical_line)
        : "保底线 " + GB(o.floor_line) + "、紧急线 " + GB(o.critical_line)) + "）",
      "整体预计 " + o.projected_pct + "%（" + methodLabel(o.projected_method, o) + "；warn " + o.warn + "% / alert " + o.alert + "%）" +
        (o.mature ? "" : "，周期刚开始，暂只看熔断和保底"),
      "  " + METHOD.cycle + " " + (o.projected_cycle_pct !== undefined ? o.projected_cycle_pct : o.projected_pct) + "% · " + methodLabel("recent", o) + " " +
        (o.projected_recent_pct === null || o.projected_recent_pct === undefined ? "数据不足 72 小时" : o.projected_recent_pct + "%"),
    );
    lines.push(...targetLines(o));
    if (o.offset_stale) lines.push("offset 属于旧周期（" + o.offset_cycle + " 起），已忽略");
    if (o.uncalibrated) lines.push("⚠️ 本周期 offset 未填写，vnstat 没覆盖整个周期，已用和预计偏低");
    lines.push("个人节奏自 " + o.personal_since + " 起算（已过周期 " + pct(o.personal_frac) + "）" +
      (o.personal_since > s.cycle.start ? "，本周期此前没有按人数据" : "") + "；ratio " + o.ratio +
      (o.ratio_fallback ? "（实测 " + o.ratio_raw + " 缺失或异常，用默认值）" : "（实测）"));
    for (const name of Object.keys(p.users)) {
      const m = p.users[name];
      lines.push(name + "：" + tierName(p, m.tier) + (m.fuse_active ? "（熔断）" : m.daily_active ? "（今日超额）" : ""),
        "  网卡等效 " + fmt(m.nic_equiv) + " / 份额 " + fmt(m.budget) + "，节奏 " + m.pace.toFixed(2) +
        "，今日代理层 " + fmt(m.today) + "（熔断线 " + p.daily_fuse_gb + " GB）");
      if (m.why.length) lines.push("  " + (m.why_at ? "触发原因（" + when(m.why_at) + "）：" : "原因：") + m.why.join("；"));
      if (m.tier !== "none" && m.since) lines.push("  自 " + when(m.since) + " 起");
      if (m.pending) lines.push("  待降档：→ " + tierName(p, m.pending.to) + "，" + when(m.pending.at) + " 满 " + p.hold_hours + " 小时");
      if (m.preview) lines.push("  新规则预览：" + tierName(p, m.preview.tier) + (m.preview.why.length ? "（" + m.preview.why.join("；") + "）" : ""));
    }
    // 永不限速的人也显示网卡等效（本周期代理层 × ratio × scale），≥ 1 GB 才显示
    const proxy = {};
    for (const r of (s.detail && s.detail.users) || []) proxy[r.name] = r.total;
    lines.push("永不限速：" + p.exempt.map((u) => {
      const eq = (proxy[u] || 0) * o.ratio * (o.scale || 1);
      return eq >= 1024 ** 3 ? u + "（网卡等效 " + fmt(eq) + "）" : u;
    }).join("、"));
  }
  const sh = p.shaper;
  if (!sh) lines.push("实际执行：pm-shaper 未安装");
  else if (!sh.initialized) lines.push("实际执行：pm-shaper 未初始化，全部不限速");
  else {
    lines.push("实际执行（pm-shaper " + when(sh.updated) + "）：" + Object.keys(sh.applied).sort()
      .map((u) => u + " " + (sh.applied[u] ? sh.applied[u] + " Mbps" : "不限速")).join(" · "));
    if (sh.error) lines.push("  " + sh.error + "，已清除所有限速");
  }
  return lines;
}

function peopleLines(d) {
  if (!d.since) return ["暂无数据（v2ray_api 未开启或尚未采集）"];
  const compact = (list) => list.slice(0, TOP).map((r, i) => (i + 1) + ". " + r.name + "  " + fmt(r.total));
  const lines = ["本周期（" + d.since + " 起，代理层）：", ...compact(d.users)];
  if (d.users_7d_ready) lines.push("近 7 天（含今天）：", ...compact(d.users_7d));
  else lines.push("近 7 天：数据不足 7 天（明细自 " + d.first + " 起）");
  return lines;
}

function siteLines(s, d) {
  const sites = s.sites || {};
  const people = (d.users || []).map((r) => r.name).filter((n) => sites[n] && sites[n].length);
  if (!people.length) return null;
  const cov = s.sites_coverage;
  const lines = ["网站统计自 " + String(s.sites_since).slice(0, 16).replace("T", " ") + " 起，ⓐ 为多个域名合并"];
  for (const name of people) {
    const c = cov && cov.users[name];
    const head = name + (c ? "（覆盖率 " + pct(c.ratio) + "）" : "") + "：";
    const list = sites[name].map((r) => Object.assign({}, r, { name: ipLabel(r.name) }));
    // 极小用量的完整记录仍放在诊断中。
    if (!VERBOSE && list.reduce((sum, r) => sum + r.total, 0) < 1024 ** 2) continue;
    lines.push(head, ...list.slice(0, VERBOSE ? TOP : 3).map((r, i) => "  " + (i + 1) + ". " + r.name + "  " + fmt(r.total)));
  }
  return lines;
}

// vnstat 原始读数只出现在这里
function diagLines(s, d) {
  const t = s.total;
  const lines = ["周期 " + s.cycle.start + " → " + s.cycle.reset + "（" + s.interface + "）",
    "vnstat 原始读数 " + fmt(t.used) + "（实时，↓ " + fmt(t.rx) + " ↑ " + fmt(t.tx) + "）"];
  const o = s.policy && s.policy.status === "ok" ? s.policy.overall : null;
  if (o) {
    lines.push("校准：已用 " + fmt(o.used) + " = " + (o.offset ? "offset " + fmt(Math.abs(o.offset)) + (o.offset > 0 ? " + " : " − ") : "") +
      (o.scale !== undefined ? o.scale : 1) + " × vnstat " + fmt(o.nic_used) + "（" + when(s.policy.evaluated) + " 计算时）");
    lines.push("趋势口径：每日网卡 rx + tx × scale，不分摊周期 offset；字符高度按这 7 天的最大值缩放，? 表示缺失");
  }
  const pr = t.projected;
  if (pr) {
    const cy = pr.cycle || pr; // 兼容旧版 stats-api
    let line = "vnstat 原始外推（未校准）：" + METHOD.cycle + " " + fmt(cy.bytes);
    if (cy.partial) line += "（vnstat 自 " + cy.basis.slice(0, 10) + " 起计数，此前按同样速度估算）";
    line += " · 按最近 72 小时速度 " + (pr.recent ? fmt(pr.recent.bytes) + "（" + when(pr.recent.since) + " 起）" : "数据不足 72 小时");
    lines.push(line);
  }
  const c = s.detail_check;
  if (c && c.ratio) {
    lines.push("核对：" + c.since + " 起（明细第一个完整日）网卡 " + fmt(c.nic) + " ÷ 明细 " + fmt(c.detail) + " = " + c.ratio + "（正常在 2 出头）");
  }
  if (VERBOSE) lines.push("", "策略计算明细：", ...policyDiagLines(s));
  if (VERBOSE && d.since) {
    lines.push("", "本周期按人上下行（代理层）：", ...rankLines(d.users, TOP));
    if (d.users_7d_ready) lines.push("近 7 天按人上下行（含今天）：", ...rankLines(d.users_7d, TOP));
    lines.push("本周期按协议（代理层）：", ...rankLines(d.inbounds, TOP));
  }
  if (!VERBOSE && d.since) lines.push("本周期按协议（代理层）：", ...rankLines(d.inbounds, TOP));
  const cov = VERBOSE && s.sites_coverage;
  if (cov) {
    lines.push("", "网站覆盖率核对（" + cov.since + " 起完整日）：");
    for (const name of Object.keys(cov.users)) {
      const u = cov.users[name];
      lines.push(name + "：" + fmt(u.sites) + " / " + fmt(u.user) + " = " + pct(u.ratio));
    }
  }
  for (const name of Object.keys(VERBOSE ? (s.sites || {}) : {})) {
    lines.push(name + " 网站上下行：", ...rankLines(s.sites[name].map((r) => Object.assign({}, r, {name: ipLabel(r.name)})), TOP));
  }
  const p = s.policy;
  if (p) {
    const ev = p.events.slice(-SHOW_EVENTS).reverse();
    lines.push("最近事件" + (ev.length ? "（新的在前）：" : "：无"), ...eventLines(ev).map((l) => "  " + l));
  }
  lines.push("更新于 " + s.updated);
  if (!VERBOSE) lines.push("完整计算 / 上下行：插件开启“详细诊断”，等下一次定时运行保存后再手动查询");
  return lines;
}

// 只推送上次之后的新事件；第一次运行只记基线，不补推历史事件
function notifyEvents(p) {
  if (!p || !p.events.length) return;
  const newest = p.events[p.events.length - 1].time;
  const last = $persistentStore.read(KEY_EVENT);
  if (!last) {
    $persistentStore.write(newest, KEY_EVENT);
    console.log("限速事件：首次运行，基线设为 " + newest);
    return;
  }
  const fresh = p.events.filter((e) => e.time > last);
  if (!fresh.length) return;
  const body = eventLines(fresh);
  if (p.events.length >= API_EVENTS && p.events[0].time > last) body.unshift("（此前还有未推送的事件超出最近 " + p.events.length + " 条，见 /stats）");
  $notification.post("VPS 限速策略" + (fresh.some((e) => e.dry_run) ? "（dry_run）" : ""), fresh.length + " 条变化", body.join("\n"));
  console.log("限速事件：\n" + body.join("\n"));
  $persistentStore.write(newest, KEY_EVENT);
}

function report(s) {
  const d = s.detail || {};
  const c = cal(s);
  const lines = ["【概览】"].concat(overviewLines(s, c));
  lines.push(...section("每日用量 · 最近7个完整日", trendLines(s, c)));
  lines.push(...section("限速策略", policyLines(s)));
  lines.push(...section("本周期按人", peopleLines(d)));
  const sl = siteLines(s, d);
  if (sl) lines.push(...section("每人前 " + (VERBOSE ? TOP : 3) + " 网站", sl));
  lines.push(...section("诊断", diagLines(s, d)));
  return lines.join("\n");
}

const now = new Date();
const today = day(now);
const reportDue = !MANUAL && now.getHours() >= REPORT_HOUR && $persistentStore.read(KEY_REPORT) !== today;

// 把响应里的每个字符串截断到 MAX_STR 字以内（防止异常数据撑爆通知和日志）
function clip(v) {
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) + "…" : v;
  if (Array.isArray(v)) return v.map(clip);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = clip(v[k]);
    return o;
  }
  return v;
}

// 最基本的格式校验：关键字段存在且类型正确；返回缺失或类型不对的字段列表
function badFields(s) {
  const bad = [];
  const num = (o, k, name) => { if (!o || typeof o[k] !== "number" || !isFinite(o[k])) bad.push(name); };
  const str = (o, k, name) => { if (!o || typeof o[k] !== "string") bad.push(name); };
  if (!s || typeof s !== "object") return ["(根)"];
  if (!s.total || typeof s.total !== "object") bad.push("total");
  else for (const k of ["rx", "tx", "used", "quota", "percent"]) num(s.total, k, "total." + k);
  if (!s.cycle || typeof s.cycle !== "object") bad.push("cycle");
  else for (const k of ["start", "reset"]) str(s.cycle, k, "cycle." + k);
  str(s, "updated", "updated");
  return bad;
}

// 经指定节点请求 /stats；node 为空时走 Loon 的分流规则。每次都在日志里记录耗时。
// 失败时回调 {kind, message}：kind 为 timeout（超时）、conn（连接被拒绝 / 断开）、http（非 200）、
// format（响应格式异常）、other
function query(node, cb) {
  const req = { url: URL, timeout: TIMEOUT_MS };
  if (node) req.node = node;
  const t0 = Date.now();
  const log = (result) => console.log("查询耗时 " + (Date.now() - t0) + " ms（" + (MANUAL ? "手动" : "定时") + "，节点 " +
    (node || "按分流规则") + "，超时设置 " + TIMEOUT_MS + " ms，结果 " + result + "）");
  $httpClient.get(req, (error, response, data) => {
    if (error) {
      const m = String(error).slice(0, MAX_STR);
      let kind = "other";
      if (/timed? ?out|超时/i.test(m)) kind = "timeout";
      else if (/refused|reset|closed|lost|abort|broken|eof|hang up|not connect|拒绝|断开|中断/i.test(m)) kind = "conn";
      log(kind);
      return cb({ kind: kind, message: m });
    }
    if (response.status !== 200) {
      log("http " + response.status);
      return cb({ kind: "http", message: "HTTP " + response.status + "：" + String(data || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) });
    }
    let s;
    try {
      s = clip(JSON.parse(data));
    } catch (e) {
      log("format");
      return cb({ kind: "format", message: "响应格式异常（不是 JSON）" });
    }
    const bad = badFields(s);
    if (bad.length) {
      log("format");
      return cb({ kind: "format", message: "响应格式异常（缺少或类型不对：" + bad.slice(0, 5).join("、") + "）" });
    }
    log("ok");
    cb(null, s);
  });
}

// 预警用校准后的数字
function reportTitle(c) {
  if (isOver(c)) return "VPS 流量（已超额）"; // 一次性的超额预警另外推送，见 notifyOver
  if (c.percent >= ALERT) return "⚠️ VPS 流量已超过 " + ALERT + "%";
  if (c.projPct !== null && c.projPct > FORECAST) return "⚠️ 预计本周期将超过 " + FORECAST + "%";
  if (c.percent >= WARN) return "VPS 用量提醒：已用 " + c.percent.toFixed(1) + "%";
  return "VPS 流量";
}

function dailyReport(s) {
  const c = cal(s);
  const body = overviewLines(s, c).filter((_, i) => i !== 1);
  const trend = trendShort(s, c);
  if (trend) body.push(trend);
  $notification.post(reportTitle(c), usedLine(c, false), body.join("\n"));
  console.log("\n" + report(s));
}

// ---- 定时运行 ----

// 超额预警按状态推送：进入"已超额"时推送一次并记下周期；加购等原因让校准后已用回到额度以下时清除，
// 同一周期再次超额会重新推送；新周期旧记录自然失效
function notifyOver(s) {
  const c = cal(s);
  const flagged = $persistentStore.read(KEY_OVER) === s.cycle.start;
  if (!isOver(c)) {
    if (flagged) {
      $persistentStore.write(null, KEY_OVER);
      console.log("已用回到额度以下（" + fmt(c.used) + " / " + fmt(c.quota) + "），清除超额状态");
    }
    return;
  }
  if (flagged) return;
  const ps = policySummary(s.policy);
  $notification.post("⛔ VPS 流量已超额", usedLine(c), [overText(c), ps, s.cycle.reset + " 重置"].filter(Boolean).join("\n"));
  console.log("超额预警已推送，记为已超额（回到额度以下前不再推送）");
  $persistentStore.write(s.cycle.start, KEY_OVER);
}

function scheduled() {
  query(NODE, (err, s) => {
    if (err) {
      console.log("VPS 流量查询失败（节点：" + (NODE || "按分流规则") + "）：" + err.message);
      // 只在该推日报时提醒，每天最多一次；日报会在之后每小时重试
      if (reportDue && $persistentStore.read(KEY_FAIL) !== today) {
        $notification.post("VPS 流量查询失败", "", err.message);
        $persistentStore.write(today, KEY_FAIL);
      }
    } else {
      notifyEvents(s.policy);
      notifyOver(s);
      if (reportDue) {
        dailyReport(s);
        $persistentStore.write(today, KEY_REPORT);
      } else {
        console.log("已检查限速事件；日报 " + ($persistentStore.read(KEY_REPORT) === today ? "今天已推送" : REPORT_HOUR + " 点后推送"));
      }
    }
    $done();
  });
}

// ---- 手动查询 ----

// 弹窗优先显示用量、预算、实际限速及异常；按人明细移到日志，最多 10 行。
function manualContent(s, via) {
  const c = cal(s);
  const lines = overviewLines(s, c);
  const trend = trendShort(s, c);
  if (trend && lines.length < MAX_LINES - 2) lines.push(trend);
  lines.push("经 " + via + " 查询");
  return lines;
}

function failMessage(err, via) {
  if (err.kind === "timeout") return "经 " + via + " 查询超时（" + TIMEOUT_MS / 1000 + " 秒），节点可能不可用";
  if (err.kind === "conn") return "节点 " + via + " 无法访问统计接口（仅 noble 节点可查询）";
  if (err.kind === "http") return "统计接口返回 " + err.message;
  if (err.kind === "format") return "经 " + via + " 查询：" + err.message;
  return "经 " + via + " 查询失败：" + err.message;
}

let finished = false;
const STARTED = Date.now();

// 返回结果（只生效一次）：从节点入口运行只弹窗；从脚本列表运行同时推送通知。不写任何存储
// ok：查询成功时在最后加一行"完整报告：Loon 脚本日志"。从节点入口运行只弹窗；从脚本列表运行同时推送通知（内容相同）
function finish(title, lines, ok) {
  if (finished) return;
  finished = true;
  const content = lines.slice(0, ok ? MAX_LINES - 1 : MAX_LINES).concat(ok ? ["完整报告：Loon 脚本日志"] : []).join("\n");
  if (!ENTRY) $notification.post(title + "（手动查询）", "", content);
  console.log("手动查询结果：" + title + "\n" + content);
  $done({ title: title, content: content });
}

function manual() {
  // 两种入口互不回退：长按入口只用长按的节点，脚本列表只用存储的查询节点
  const via = ENTRY || NODE;
  // 只记节点名，不记 nodeInfo（地址、端口等）
  console.log("手动查询：" + (ENTRY ? "长按入口 " + ENTRY_FROM + "=" + ENTRY : "脚本列表入口") + "；存储的查询节点 " + (NODE || "(无)") + "；经由 " + (via || "(无)"));
  if (!via) return finish("VPS 流量", ["尚未获取到查询节点，请等待下一次定时运行（整点）后再试"]);
  // 兜底：回调 5 秒还没返回（$httpClient 的 timeout 没生效等）就强制结束
  setTimeout(() => {
    if (!finished) console.log("手动查询：" + GUARD_MS / 1000 + " 秒内没有返回，强制结束（已等待 " + (Date.now() - STARTED) + " ms）");
    finish("VPS 流量查询失败", ["经 " + via + " 查询 " + GUARD_MS / 1000 + " 秒内没有返回，节点可能不可用"]);
  }, GUARD_MS);
  query(via, (err, s) => {
    if (finished) return console.log("手动查询：兜底计时器已结束，忽略迟到的回调");
    if (err) {
      console.log("手动查询失败（" + err.kind + "）：" + err.message);
      return finish("VPS 流量查询失败", [failMessage(err, via)]);
    }
    console.log("\n" + report(s));
    finish(reportTitle(cal(s)), manualContent(s, via), true);
  });
}

if (MANUAL) manual();
else scheduled();
