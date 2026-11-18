// 2026-10-24 19:55
// AdBlock Pro 10.7.5 解锁
// 来源：Yu9191/Rewrite adblockpro.js（原脚本为 jsjiami 混淆，此处为等价的明文实现）

if (!$response || !$response.body) $done({});
let obj = JSON.parse($response.body);

for (const key of ["p", "s", "l", "t", "e", "m", "f"]) {
  obj[key] = 1;
}

$done({ body: JSON.stringify(obj) });
