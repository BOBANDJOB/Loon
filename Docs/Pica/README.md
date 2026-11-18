# Pica 插件

插件按 App、网页、临时诊断分开，说明统一放在本目录。全部插件见 [仓库插件索引](../Plugins.md)。

| 用途 | 订阅文件 | 说明 |
| --- | --- | --- |
| 原生 App | [App.plugin](https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/Pica/App.plugin) | [启动公告、横幅错误兜底和业务分流](App.md) |
| 网页版 | [Web.plugin](https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/Pica/Web.plugin) | [广告配置、首页、阅读和列表广告、公告板和 PWA 缓存迁移](Web.md) |
| 临时诊断 | [Diagnostics/AdsCapture.plugin](../../Plugins/Pica/Diagnostics/AdsCapture.plugin) | 历史底部广告抓包用；平时停用，与 App 正式版互斥，可能显示广告 |

两个正式插件可独立启停。脚本仍在 `Scripts/pica/`、`Scripts/pica-web/`，App 图标使用 `Icons/app/pica.jpg`，网页版使用 `Icons/app/pica-web-round.png`。原生广告容器的 IPA 补丁由本地 IPA 项目维护，不发布到此公开仓库。

2026-11-16 目录迁移：

| 旧地址 | 新地址 |
| --- | --- |
| `Plugins/Pica.plugin` | `Plugins/Pica/App.plugin` |
| `Plugins/PicaWeb.plugin` | `Plugins/Pica/Web.plugin` |
| `Plugins/Pica-Diagnostic.plugin` | `Plugins/Pica/Diagnostics/AdsCapture.plugin` |
| `Plugins/Pica.md` | `Docs/Pica/App.md` |
| `Plugins/PicaWeb.md` | `Docs/Pica/Web.md` |

旧路径已移除，无重定向。更新订阅地址，避免同时保留新旧条目；本次同步维护的本地 Loon 配置只替换两条 Pica 地址，保持启用状态和先后顺序。其他插件的原订阅路径保持不变。
