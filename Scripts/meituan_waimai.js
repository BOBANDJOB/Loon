// 2026-10-24 美团外卖 loadInfo：关闭 Shark 长连接开关、清空开屏配置
// 封掉 Shark 隧道后 App 仍按开关走隧道，结算页会报 H-152##NUTCBH 无法下单，
// 这里把 shark_switch_x 置 0，让 App 主动改走 HTTP

if (!$response.body) $done({});
let obj = JSON.parse($response.body);

if (obj?.data) {
  obj.data.shark_switch_x = 0;
  obj.data.startpicture = [];
}

$done({ body: JSON.stringify(obj) });
