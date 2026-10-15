// proxy-meter: 定时（cron）每小时运行一次。
//   - 限速策略有新事件（档位变化、配置损坏 / 数据缺失导致清除等）时立即推送；已推送到哪条事件记在 $persistentStore。
//   - 每天到 report_hour 后的第一次运行推送日报（当天已推送过就跳过）；超过阈值或预计周期末超过阈值时标题改为提醒。
// 手动查询（插件里的 generic 入口，参数为字符串 "mode=manual"）：立即推送完整日报，不改任何已推送状态。
//   还没有定时运行过（没有存下查询节点）时只提示，不发请求。
// 网站排行里认不出的 IP 显示为"IP（AS号 运营商名称）"，用 Loon 自带的 $utils.ipasn / ipaso，服务器端不做 ASN 查询。
//   Loon 的 $script 没有触发类型字段，所以用参数区分；generic 的字符串参数不能带插件的 ${node}，
//   查询节点和阈值用最近一次定时运行存下的值（KEY_ARGS）。
// 通知只放摘要（总量 + 预计周期末 + 本周期按人前 5 + 限速档位）；完整明细、限速策略和每人前 5 网站写到脚本日志（Loon 里脚本 → 日志）。
// 作为插件使用时（proxy-meter.plugin），节点和阈值来自插件参数，请求经 node 指定的节点发出；
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
      "实际剩余 " + fmt(o.remaining) + "（低于 " + fmt(o.floor_remaining) + " 进入保底）",
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

const request = { url: URL, timeout: 10000 };
if (NODE) request.node = NODE;

const now = new Date();
const today = day(now);
const reportDue = !MANUAL && now.getHours() >= REPORT_HOUR && $persistentStore.read(KEY_REPORT) !== today;

function dailyReport(s) {
  const t = s.total;
  const d = s.detail || {};

  let title = "VPS 流量";
  if (t.percent >= ALERT) title = "⚠️ VPS 流量已超过 " + ALERT + "%";
  else if (t.projected && t.projected.bytes > t.quota * FORECAST / 100) title = "⚠️ 预计本周期将超过 " + FORECAST + "%";
  else if (t.percent >= WARN) title = "⚠️ VPS 流量已超过 " + WARN + "%";
  if (MANUAL) title += "（手动查询）";

  const body = ["↓ " + fmt(t.rx) + "  ↑ " + fmt(t.tx)];
  if (t.projected) {
    body.push("预计周期末 " + fmt(t.projected.bytes) + "（" + pct(t.projected.bytes / t.quota) + "，" + METHOD[t.projected.method || "cycle"] + "）");
  }
  if (d.users && d.users.length) {
    body.push("本周期按人：" + d.users.slice(0, TOP).map((r) => r.name + " " + fmt(r.total)).join(" · "));
  }
  const ps = policySummary(s.policy);
  if (ps) body.push(ps);
  body.push(s.cycle.reset + " 重置");

  $notification.post(title, "已用 " + fmt(t.used) + " / " + fmt(t.quota) + "（" + t.percent + "%）", body.join("\n"));
  console.log("\n" + report(s));
}

if (MANUAL && !NODE) {
  // 部署后还没有过定时运行，不知道该经哪个节点查询；不发请求，以免走错节点
  $notification.post("VPS 流量（手动查询）", "", "尚未获取到查询节点，请等待下一次定时运行（整点）后再试");
  console.log("手动查询：$persistentStore 里没有查询节点（" + KEY_ARGS + "），未发起请求");
  $done();
} else $httpClient.get(request, (error, response, data) => {
  try {
    if (error) throw new Error(String(error));
    if (response.status !== 200) throw new Error("HTTP " + response.status + " " + data);
    const s = JSON.parse(data);
    if (MANUAL) {
      // 手动查询：推送完整日报，不改日报 / 事件 / 失败的已推送状态
      dailyReport(s);
      console.log("手动查询（节点：" + (NODE || "按分流规则") + "），未更新任何已推送状态");
    } else {
      notifyEvents(s.policy);
      if (reportDue) {
        dailyReport(s);
        $persistentStore.write(today, KEY_REPORT);
      } else {
        console.log("已检查限速事件；日报 " + ($persistentStore.read(KEY_REPORT) === today ? "今天已推送" : REPORT_HOUR + " 点后推送"));
      }
    }
  } catch (e) {
    const msg = String(e.message || e);
    console.log("VPS 流量查询失败（节点：" + (NODE || "按分流规则") + "）：" + msg);
    // 手动查询失败总是提醒；定时运行只在该推日报时提醒，每天最多一次，日报会在之后每小时重试
    if (MANUAL) {
      $notification.post("VPS 流量查询失败（手动查询）", "", msg);
    } else if (reportDue && $persistentStore.read(KEY_FAIL) !== today) {
      $notification.post("VPS 流量查询失败", "", msg);
      $persistentStore.write(today, KEY_FAIL);
    }
  }
  $done();
});
