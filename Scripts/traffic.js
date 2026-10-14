// proxy-meter: 每天推送一次 VPS 当月流量；超过阈值时标题改为提醒。
// 通知只放摘要（总量 + 预计周期末 + 本周期按人前 5）；完整明细和每人前 5 网站写到脚本日志（Loon 里脚本 → 日志）。
// 作为插件使用时（proxy-meter.plugin），节点和阈值来自插件参数，请求经 node 指定的节点发出；
// 不带参数运行时，走 Loon 的分流规则，需要 DOMAIN,stats.noble.internal,<Noble 的节点>。

const URL = "http://stats.noble.internal/stats";
const ARG = typeof $argument === "object" && $argument !== null ? $argument : {};
const NODE = ARG.node || "";
const WARN = Number(ARG.warn) || 70;
const ALERT = Number(ARG.alert) || 90;
const TOP = 5;

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

function pct(r) {
  return (r * 100).toFixed(1) + "%";
}

function projectedLine(p, quota) {
  if (!p) return [];
  let line = "预计周期末 " + fmt(p.bytes) + "（" + pct(p.bytes / quota) + "，线性外推";
  if (p.partial) line += "，vnstat 自 " + p.basis.slice(0, 10) + " 起计数，此前按同样速度估算";
  return [line + "）"];
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
      lines.push(head, ...rankLines(sites[name], TOP).map((l) => "  " + l));
    }
  }
  lines.push("", "更新于 " + s.updated);
  return lines.join("\n");
}

const request = { url: URL, timeout: 10000 };
if (NODE) request.node = NODE;

$httpClient.get(request, (error, response, data) => {
  try {
    if (error) throw new Error(String(error));
    if (response.status !== 200) throw new Error("HTTP " + response.status + " " + data);
    const s = JSON.parse(data);
    const t = s.total;
    const d = s.detail || {};

    let title = "VPS 流量";
    if (t.percent >= ALERT) title = "⚠️ VPS 流量已超过 " + ALERT + "%";
    else if (t.percent >= WARN) title = "⚠️ VPS 流量已超过 " + WARN + "%";

    const body = ["↓ " + fmt(t.rx) + "  ↑ " + fmt(t.tx)];
    if (t.projected) body.push("预计周期末 " + fmt(t.projected.bytes) + "（" + pct(t.projected.bytes / t.quota) + "）");
    if (d.users && d.users.length) {
      body.push("本周期按人：" + d.users.slice(0, TOP).map((r) => r.name + " " + fmt(r.total)).join(" · "));
    }
    body.push(s.cycle.reset + " 重置");

    $notification.post(title, "已用 " + fmt(t.used) + " / " + fmt(t.quota) + "（" + t.percent + "%）", body.join("\n"));
    console.log("\n" + report(s));
  } catch (e) {
    const msg = String(e.message || e);
    $notification.post("VPS 流量查询失败", "", msg);
    console.log("VPS 流量查询失败（节点：" + (NODE || "按分流规则") + "）：" + msg);
  }
  $done();
});
