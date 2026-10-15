// proxy-meter: 定时（cron）每小时运行一次。
//   - 限速策略有新事件（档位变化、配置损坏 / 数据缺失导致清除等）时立即推送；已推送到哪条事件记在 $persistentStore。
//   - 每天到 report_hour 后的第一次运行推送日报（当天已推送过就跳过）；超过阈值或预计周期末超过阈值时标题改为提醒。
//   通知只放摘要；完整明细、限速策略和每人前 5 网站写到脚本日志（Loon 里脚本 → 日志）。
// 手动查询（插件里的 generic 入口，参数为字符串 "mode=manual"；Loon 的 $script 没有触发类型字段，只能用参数区分）：
//   - 查询节点：长按节点运行时只用 $environment.params 的 node（没有时用 policyGroup），失败直接报失败；
//     从脚本列表运行时只用存储的查询节点（最近一次定时运行存下的 KEY_ARGS，generic 的字符串参数不能带 ${node}）。
//     两种入口互不回退；没有存储的节点时只提示，不发请求。
//   - 快速失败：请求超时 3 秒，另有 5 秒兜底计时器；按错误类型（连接被拒 / 超时 / 非 200 / 响应格式异常）给出提示。
// 每次查询都在脚本日志里记录耗时（ms），便于评估超时阈值。
//   - 结果用 $done({title, content}) 返回（不超过 10 行），从节点入口运行时只弹窗，不推送通知；
//     从脚本列表运行时同时推送通知（内容相同）。完整报告只写脚本日志（Loon 没有打开脚本日志的 URL Scheme）。
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
const SHOW_EVENTS = 5; // 日报里显示的最近事件条数
const API_EVENTS = 20; // /stats 返回的最近事件条数（policy.py 的 SHOW_EVENTS）
const KEY_EVENT = "proxy-meter.lastEvent";   // 已推送的最新一条事件的时间
const KEY_REPORT = "proxy-meter.reportDate"; // 已推送日报的日期
const KEY_FAIL = "proxy-meter.failDate";     // 已推送查询失败的日期，避免每小时重复提醒
const TIER = { none: "不限速", light: "轻度", medium: "中度", floor: "保底" };
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

function projectedLine(p, quota) {
  if (!p) return [];
  const c = p.cycle || p; // 兼容旧版 stats-api
  const lines = ["预计周期末 " + fmt(p.bytes) + "（" + pct(p.bytes / quota) + "，取两种外推的较大者：" + METHOD[p.method || "cycle"] + "）"];
  let line = "  " + METHOD.cycle + "：" + fmt(c.bytes) + "（" + pct(c.bytes / quota) + "）";
  if (c.partial) line += "，vnstat 自 " + c.basis.slice(0, 10) + " 起计数，此前按同样速度估算";
  lines.push(line);
  if (p.recent) lines.push("  " + METHOD.recent + "：" + fmt(p.recent.bytes) + "（" + pct(p.recent.bytes / quota) + "，" + when(p.recent.since) + " 起 72 小时）");
  else lines.push("  " + METHOD.recent + "：vnstat 数据不足 72 小时，未计算");
  return lines;
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

function policyLines(s) {
  const p = s.policy;
  if (!p) return ["", "限速策略：stats-api 刚启动，尚未计算"];
  const lines = ["", "限速策略（" + (p.dry_run ? "dry_run，只计算不执行；" : "") + when(p.evaluated) + " 计算）："];
  if (p.status !== "ok") {
    lines.push(p.error + "，当前不限速");
  } else {
    const o = p.overall;
    lines.push(
      "校准后已用 " + fmt(o.used) + "（vnstat " + fmt(o.nic_used) + (o.offset ? (o.offset > 0 ? " + " : " − ") + "offset " + fmt(Math.abs(o.offset)) : "") + "）",
      "实际剩余 " + fmt(o.remaining) + "（保底线 " + Number((o.floor_remaining / 1024 ** 3).toFixed(2)) + " GB）",
      "整体预计 " + o.projected_pct + "%（" + METHOD[o.projected_method || "cycle"] + "；warn " + o.warn + "% / alert " + o.alert + "%）" +
        (o.mature ? "" : "，周期刚开始，暂只看熔断和保底"),
      "  " + METHOD.cycle + " " + (o.projected_cycle_pct !== undefined ? o.projected_cycle_pct : o.projected_pct) + "% · " + METHOD.recent + " " +
        (o.projected_recent_pct === null || o.projected_recent_pct === undefined ? "数据不足 72 小时" : o.projected_recent_pct + "%"),
    );
    if (o.offset_stale) lines.push("offset 属于旧周期（" + o.offset_cycle + " 起），已忽略");
    if (o.uncalibrated) lines.push("⚠️ 本周期 offset 未填写，vnstat 没覆盖整个周期，已用和预计偏低");
    lines.push("ratio " + o.ratio + (o.ratio_fallback ? "（实测 " + o.ratio_raw + " 缺失或异常，用默认值）" : "（实测）"));
    lines.push("个人节奏自 " + o.personal_since + " 起算（已过周期 " + pct(o.personal_frac) + "）" +
      (o.personal_since > s.cycle.start ? "，本周期此前没有按人数据" : ""));
    for (const name of Object.keys(p.users)) {
      const m = p.users[name];
      lines.push(name + "：" + tierName(p, m.tier) + (m.fuse_active ? "（熔断）" : ""),
        "  网卡等效 " + fmt(m.nic_equiv) + " / 份额 " + fmt(m.budget) + "，节奏 " + m.pace.toFixed(2) +
        "，今日代理层 " + fmt(m.today) + "（熔断线 " + p.daily_fuse_gb + " GB）");
      if (m.why.length) lines.push("  原因：" + m.why.join("；"));
      if (m.tier !== "none") lines.push("  自 " + when(m.since) + " 起");
      if (m.pending) lines.push("  待降档：→ " + tierName(p, m.pending.to) + "，" + when(m.pending.at) + " 满 " + p.hold_hours + " 小时");
    }
    lines.push("永不限速：" + p.exempt.join("、"));
  }
  const sh = p.shaper;
  if (!sh) lines.push("实际执行：pm-shaper 未安装");
  else if (!sh.initialized) lines.push("实际执行：pm-shaper 未初始化，全部不限速");
  else {
    lines.push("实际执行（pm-shaper " + when(sh.updated) + "）：" + Object.keys(sh.applied).sort()
      .map((u) => u + " " + (sh.applied[u] ? sh.applied[u] + " Mbps" : "不限速")).join(" · "));
    if (sh.error) lines.push("  " + sh.error + "，已清除所有限速");
  }
  const ev = p.events.slice(-SHOW_EVENTS).reverse();
  lines.push("最近事件" + (ev.length ? "（新的在前）：" : "：无"), ...eventLines(ev).map((l) => "  " + l));
  return lines;
}

function policySummary(p) {
  if (!p) return null;
  const tag = p.dry_run ? "（dry_run）" : "";
  if (p.status !== "ok") return "限速：全部不限速" + tag + "，" + p.error;
  const names = Object.keys(p.users);
  if (!names.length) return null;
  return "限速" + tag + "：" + names.map((n) => n + " " + TIER[p.users[n].tier]).join(" · ");
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
  const t = s.total;
  const d = s.detail || {};
  const lines = [
    "周期 " + s.cycle.start + " → " + s.cycle.reset + "（" + s.interface + "）",
    "网卡总量 " + fmt(t.used) + " / " + fmt(t.quota) + "（" + t.percent + "%）",
    "  ↓ " + fmt(t.rx) + "  ↑ " + fmt(t.tx),
    ...projectedLine(t.projected, t.quota),
  ];
  if (!d.since) {
    lines.push("按人 / 按协议明细：暂无数据（v2ray_api 未开启或尚未采集）");
  } else {
    lines.push("", "本周期按人（明细自 " + d.since + " 起）：", ...rankLines(d.users, TOP));
    if (d.users_7d_ready) lines.push("", "近 7 天按人：", ...rankLines(d.users_7d, TOP));
    else lines.push("", "近 7 天按人：数据不足 7 天（明细自 " + d.first + " 起）");
    lines.push("", "本周期按协议：", ...rankLines(d.inbounds, TOP));
    const c = s.detail_check;
    if (c && c.ratio) {
      lines.push("", "核对：" + c.since + " 起（明细第一个完整日）网卡 " + fmt(c.nic) + " ÷ 明细 " + fmt(c.detail) +
        " = " + c.ratio + "（正常在 2 出头）");
    } else {
      lines.push("", "注：明细是代理层数据，网卡总量 ≈ 明细合计 × 2 + 额外开销");
    }
  }
  const sites = s.sites || {};
  const people = (d.users || []).map((r) => r.name).filter((n) => sites[n] && sites[n].length);
  if (people.length) {
    const cov = s.sites_coverage;
    lines.push("", "本周期每人前 " + TOP + " 网站（网站统计自 " + String(s.sites_since).slice(0, 16).replace("T", " ") +
      " 起，ⓐ 为多个域名合并）：");
    for (const name of people) {
      const c = cov && cov.users[name];
      const head = c ? name + "：网站覆盖率 " + pct(c.ratio) + "（" + cov.since + " 起 " + fmt(c.sites) + " / " + fmt(c.user) + "）" : name + "：";
      const list = sites[name].map((r) => Object.assign({}, r, { name: ipLabel(r.name) }));
      lines.push(head, ...rankLines(list, TOP).map((l) => "  " + l));
    }
  }
  lines.push(...policyLines(s));
  lines.push("", "更新于 " + s.updated);
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

function reportTitle(t) {
  if (t.percent >= ALERT) return "⚠️ VPS 流量已超过 " + ALERT + "%";
  if (t.projected && t.projected.bytes > t.quota * FORECAST / 100) return "⚠️ 预计本周期将超过 " + FORECAST + "%";
  if (t.percent >= WARN) return "⚠️ VPS 流量已超过 " + WARN + "%";
  return "VPS 流量";
}

function projectedShort(p, quota) {
  return "预计周期末 " + fmt(p.bytes) + "（" + pct(p.bytes / quota) + "，" + METHOD[p.method || "cycle"] + "）";
}

function dailyReport(s) {
  const t = s.total;
  const d = s.detail || {};
  const body = ["↓ " + fmt(t.rx) + "  ↑ " + fmt(t.tx)];
  if (t.projected) body.push(projectedShort(t.projected, t.quota));
  if (d.users && d.users.length) {
    body.push("本周期按人：" + d.users.slice(0, TOP).map((r) => r.name + " " + fmt(r.total)).join(" · "));
  }
  const ps = policySummary(s.policy);
  if (ps) body.push(ps);
  body.push(s.cycle.reset + " 重置");
  $notification.post(reportTitle(t), "已用 " + fmt(t.used) + " / " + fmt(t.quota) + "（" + t.percent + "%）", body.join("\n"));
  console.log("\n" + report(s));
}

// ---- 定时运行 ----

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

// 弹窗内容：已用 / 额度、预计周期末、按人前 3、限速档位、查询所经节点
function manualContent(s, via) {
  const t = s.total;
  const d = s.detail || {};
  const lines = ["已用 " + fmt(t.used) + " / " + fmt(t.quota) + "（" + t.percent + "%）"];
  if (t.projected) lines.push(projectedShort(t.projected, t.quota));
  if (d.users && d.users.length) lines.push("按人前 3：" + d.users.slice(0, 3).map((r) => r.name + " " + fmt(r.total)).join(" · "));
  const ps = policySummary(s.policy);
  if (ps) lines.push(ps);
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
    finish(reportTitle(s.total), manualContent(s, via), true);
  });
}

if (MANUAL) manual();
else scheduled();
