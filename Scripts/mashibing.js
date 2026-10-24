// 2026-10-24 19:55
// 马士兵教育：课程试看、分享与 VIP 课程观看权限
// 来源：BOBANDJOB/PrivateQX Scripts/msb.js

if (!$response || !$response.body) $done({});
let body = $response.body;

// 试用状态
body = body.replace(/"isTrial":\s*false/g, '"isTrial":true');

// 分享状态
body = body.replace(/"shareState":\s*0/g, '"shareState":1');

body = body.replace(/"accredit":\s*false/g, '"accredit":true');

// 控制 VIP 课程观看权限；edu-course/app/systemCourse/course 接口改了会提示更新、无法观看课程资料
body = body.replace(/"plateId":\s*\d+/g, '"plateId":0');

$done({ body });
