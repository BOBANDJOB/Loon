# 哔咔 Pica 独立插件

此页为 App 规则说明。网页版广告配置使用独立的 [PicaWeb 插件](Web.md)，两者可分别启停。

安装地址：

```text
https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/Pica/App.plugin
```

先通过 URL 添加并启用本插件，再更新 `my-plugin.plugin`，避免更新期间哔咔规则暂时缺失。业务分流沿用现有的 `US` 策略组，需确保主配置中有该策略组；广告 Rewrite 需要 MitM 和已信任的 Loon 证书。

## 从 my-plugin 迁移的内容

| 类型 | 内容 |
| --- | --- |
| 广告 Rewrite | `https://manhuapica.com/ad/?cat=` 返回空 JSON 对象，保留原有正则 |
| 广告域名拦截 | `ad-channel.wikawika.xyz`、`ad-channel.diwodiwo.xyz`、`ad-display.diwodiwo.xyz`，沿用 `REJECT` |
| 精确域名分流 | `manhuapica.com`、`pica-web.wakamoment.tk`、`api.tipatipa.xyz`，沿用 `US` |
| 后缀分流 | `diwodiwo.xyz`、`picacomic.com`，沿用 `US` |
| 原有 MitM | `manhuapica.com`，用于上述广告 Rewrite |

这些规则已经从 `my-plugin.plugin` 移出。三个广告域名保留在业务后缀规则前面，防止被 `diwodiwo.xyz → US` 提前匹配。

## 首页两类弹窗

### 横幅接口的错误提示

2026-11-16 的启动 HAR 显示：`GET https://api.tipatipa.xyz/banners` 经 HTTP/2 返回 HTTP 500，JSON 中为 `code: 500` 和 `error: "Unexpected token < in JSON at position 0"`；同一记录里的 `/init`、`/sources` 均返回 200，`/init` 的 `notification` 为 `null`。这些响应没有命中现有 Rewrite / Script。截图中的通用错误弹窗与该横幅失败相关的可能性较高，但仅凭抓包不能证明唯一触发原因。

`Scripts/pica/banners.js` 只在 **GET、精确 URL、HTTP 500、JSON code 为数值 500、error 与上述字符串完全一致** 时，返回 HTTP 200 和 `{"code":200,"message":"success","data":{"banners":[]}}`，尝试通过空横幅结果避免触发错误提示。它保留正常横幅响应，以及其他状态、错误类型、登录、初始化、漫画等接口的原始行为。为此新增精确 MitM 主机 `api.tipatipa.xyz`。

QUIC 拒绝记录与后续 HTTP/2 响应同时存在；本次不调整 QUIC、节点或分流设置。脚本不直接控制 App 原生弹窗，也不修复服务端横幅内容。空横幅响应在当前官方 iOS App 上是否足以消除弹窗，仍需实机验证。

### 公告接口的推广弹窗

第二份启动 HAR 已记录 `哔咔首页横幅错误兜底` 命中，`/banners` 的返回值为 HTTP 200、`data.banners: []`。随后出现的推广弹窗来自另一条正常响应：`GET https://api.tipatipa.xyz/announcements?page=1` 返回 5 条公告，第一条标题与截图一致，为「火影：新世界」。这说明旧脚本已执行，但原先仅处理横幅错误，未覆盖后续公告。

`Scripts/pica/announcements.js` 仅在 **GET、上述精确 URL、HTTP 200、JSON code 为数值 200、公告页码为 1 且 docs 为非空数组** 时，清空 `data.announcements.docs` 并将 `total`、`pages` 归零，保留 `page`、`limit` 及其他响应字段。它不直接拒绝接口，避免把推广弹窗变成网络错误提示。

同一接口也提供公告列表，故第一页公告会一起隐藏，包含其中的普通站务公告。仅通过本接口的响应改写，无法区分原生 App 的弹窗入口与列表入口。其他页码、公告详情、漫画和收藏等请求保持原行为。

更新插件和两个脚本后，彻底退出哔咔再打开，检查两类弹窗是否消失，并确认首页、分类和阅读仍正常。若仍有弹窗，需依据新抓包确认具体入口。

本地检查：`node --check Scripts/pica/banners.js`、`node --check Scripts/pica/announcements.js`、`node --test Scripts/pica/test.cjs`。测试使用无账号信息的响应 fixture，不保存 HAR、请求头或 Token 到仓库。

## 底部空白广告诊断（历史记录）

此诊断已结束，底部广告容器最终通过本地 IPA 补丁处理并由用户验证。诊断插件移到 `Plugins/Pica/Diagnostics/AdsCapture.plugin`，保留用于历史排查，平时不要启用。下文为当时的诊断步骤。

2026-11-16 的漫画详情页抓包中，漫画详情、章节、推荐三个接口的 JSON 在两份 HAR 中一致，推荐接口返回 10 条结果。用户确认点击叉号后，空白层与叉号一起消失，推荐能正常显示。随后请求记录截图显示，`ad-channel.wikawika.xyz` 命中 `DNS-REJECT`，其中 13:06:51.337 的拒绝记录发生在漫画详情加载期间。这能解释为何 HAR 没有该域名的 HTTP 路径和响应，但还不能证明这个域名的具体响应如何影响广告容器，也不能确定叉号是网页还是原生控件。

临时诊断插件：

```text
https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/Pica/Diagnostics/AdsCapture.plugin
```

它基于正式版，仅将 `ad-channel.wikawika.xyz` 从 `REJECT` 改走 `US`，并将其加入 MitM。其余 Rewrite、Script 和分流与正式版一致；不新增日志脚本、不修改推荐接口、不自动发送抓包。诊断期间可能显示广告，它不是空白广告修复版。

1. 在 Loon 中停用正式版「哔咔 Pica」，添加并启用「哔咔 Pica 广告诊断（临时）」，确保 MitM 和证书信任已开启。
2. 彻底退出哔咔后重新打开，进入同一漫画详情页，等底部广告出现，再点击叉号关闭。
3. 在 HTTP/S 记录中查找 `ad-channel.wikawika.xyz`，导出这次记录用于本地分析。若仍显示 DNS-REJECT，先核对正式版是否停用、是否另有本地规则拦截同域名，不要反复导出只有漫画接口的 HAR。
4. 导出后停用诊断版、重新启用正式版。HAR 可能含账号认证信息，仅在本地分析，不提交仓库。

当时的排查方向是根据广告入口的实际返回结构判断是否存在“无广告”的有效响应，或网页与 App 之间的关闭逻辑；在此之前不猜测 JSON 开关，也不对漫画详情、章节或推荐数据作清空处理。诊断版只在 Loon 提供，尚未向 QX 正式规则迁移。

## 项目内其他相关内容

- 原 `Rules/Supplement.list` 的「哔咔」段包含 5 条历史规则：1 条 `REJECT-DROP` 和 4 条 `SS_HK` 分流，域名均已被独立插件覆盖。核对当前 Loon 配置未引用旧列表、并经用户确认后，已删除整份旧文件；历史内容保留在 Git 中。本次只清理 Loon 仓库的旧文件。
- `Rules/cloudflare_top100m_cn_domains.list` 中有 `picacgp.com`、`picacgy.com` 等名称相近的域名。它们属于大型域名数据列表，仅凭名称无法确认与当前哔咔 App 的关系，本次不作为哔咔功能规则迁移。
- 迁移前未发现专用的哔咔 JavaScript 或原有独立插件。

历史去广告规则来自原配置迁移，新增错误兜底已完成离线检查；当前哔咔版本上的整体效果仍以实机验证为准。


目录迁移与安装入口见 [Pica 插件索引](README.md)。用户已验证启动弹窗清理有效；底部广告层的移除由本地 IPA 补丁实现，不属于 Loon 脚本能力。
