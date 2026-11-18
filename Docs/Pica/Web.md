# 哔咔 Pica 网页版去广告

安装地址：[Web.plugin](https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/Pica/Web.plugin)。适用于 `manhuapica.com`，与 [App 插件](App.md) 分开启停，可同时启用。Pica 插件分类见 [索引](README.md)。

需要主配置有 `US` 策略组，并开启 MitM、安装和信任 Loon 证书。精确 MitM 主机为 `pica-ad-api.diwodiwo.xyz`、`picaapi.go2778.com`、`picaapi.acbbb.com` 和 `manhuapica.com`。

## 处理范围

| 资源 | 修改 | 保留的边界 |
| --- | --- | --- |
| 广告主机 `/get-ad-zones`，可带查询参数 | `data.zones` 设为 `[]`，覆盖横幅和穿插广告配置 | 仅 GET、HTTP 200、数值 code 200、非空数组 |
| 两个网页 API 主机 `/announcements`，可带查询参数 | 第一页 `docs` 清空，`total`、`pages` 归零 | 仅 GET、HTTP 200、数值 code 200、响应页码为 1；其他页和详情不改 |
| 入口 `/assets/js/index-<hash>.js` 和注册模块 `/assets/js/virtual_pwa-register-<hash>.js` | 关闭已识别的更新通知回调；注册模块同时注入首页广告轮播容器的隐藏样式 | 仅 GET、HTTP 200、JavaScript MIME；已知代码必须恰好匹配一次，否则放行 |
| `/sw.js`、注册模块及漫画模块的请求 | 移除条件缓存请求头，要求返回可改写的完整脚本 | 仅上述精确资源的 GET，保留 Cookie、鉴权及其他头 |
| `/sw.js` 响应 | 更新预缓存清单中注册模块和漫画模块的 revision，触发一次重新下载 | 仅 GET、HTTP 200、JavaScript MIME、已知 Workbox 结构、两类模块各恰好一条目标记录 |

JSON 改写保留其他字段和跨域头，移除失效的长度、压缩和缓存校验头，设为 `Cache-Control: no-store`。不清空漫画、推荐、收藏或图片存储接口，不改鉴权错误。各响应规则的匹配资源互不重叠；缓存脚本分别处理请求和响应阶段。

公告接口也供应公告列表，故第一页的普通站务公告会随推广公告一起隐藏。本次并未额外移除首页的公告栏目标题或手动入口。

## 网页更新提示的含义

截图中的「检测到新版本，是否立即更新？」是网页自己的 PWA 更新确认，不是下载原生 App 的提示。公开入口脚本通过 `virtual_pwa-register` 注册 Service Worker，在 `onNeedRefresh` 中弹出该确认；点击「好」会调用更新函数并刷新网页。这与 [Vite PWA 官方的更新确认机制](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html) 一致。

本插件关闭入口脚本的确认回调，并在注册模块内关闭 waiting / external-installed 两条路径共用的通知调用，保留注册、后台检查与资源下载，以及其他确认框。不会主动刷新正在阅读的页面，也不会注销 Service Worker。新 worker 通常在旧页面全部关闭后激活，生命周期见 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers#updating_your_service_worker)。网站后续改变回调代码时，补丁会放行原模块，需重新核对。

### 为什么每次刷新都可能重复提示

当前代码有两条通知路径：`Workbox waiting → onNeedRefresh → confirm`，以及 `installed 事件被标为 isExternal，且 isUpdate 未定义 → 同一回调`。用户确认后才会调用 `messageSkipWaiting`。网站的注册模块对每次 `waiting` 都调用提示，没有区分 `wasWaitingBeforeRegister`；所用 Workbox 模块在发现已有 waiting worker 时，也会立即再次派发这个事件。[Workbox 官方文档](https://developer.chrome.com/docs/workbox/modules/workbox-window#the_waiting_event) 明确说明，普通刷新未必会激活等待的新 worker，刷新后同一个 waiting 状态会再次通知。

新抓包中的四次 `/sw.js` 都是 HTTP 304，ETag 与 Last-Modified 一致；本次公开读取的同一脚本仍返回相同校验值，Last-Modified 为 2026-09-04。没有依据认为每次进入都有新版本发布。

用户进一步澄清：点击「好」后，同一会话再次刷新不提示；关闭 Safari 后重新进入，大概率又提示。这将排查范围收窄到冷启动阶段的 worker 状态识别、外部安装分支或重复更新通知，不能简单归因为用户一直取消或同一个等待版本始终没有切换。HAR 看不到手机中的 active / waiting worker 状态，尚未确定唯一根因。后续用户反馈「好」和「取消」看起来都只关闭弹窗；首页外观相同并不能证明 worker 是否完成切换。新版在成功激活后，通过两条路径共用的通知调用消除确认，不依赖猜测 Safari 的具体故障。

用户提供的 `/?vflush=2024920` 仍加载同一个入口模块；注册代码使用固定的 `/sw.js` 和 `/` scope，没有把这个查询参数作为 worker 版本号。修改参数或普通刷新都不能保证完成 worker 切换。新版不改网站发布版本，改的是下文所述的单个模块预缓存 revision。

## 已缓存脚本的迁移与首页占位

后续 99 条记录的抓包中，6 条广告配置和 2 条公告响应已命中改写；但没有入口 JS / PWA 注册模块的网络响应，更新提示规则也没有命中。三次 SW 请求为 304，均没有正文。旧版只匹配入口 JS，没有覆盖这一缓存迁移过程，不能把源码测试通过等同于手机已执行补丁。

网站实际 precache 清单包含入口和注册模块，且使用 cache-first。新版采用以下过程：

1. 对 SW 和注册模块的网络 GET 移除 If-None-Match / If-Modified-Since，避免只收到无法修改的 304。
2. 在 SW 预缓存清单中，仅把注册模块和漫画模块的 null revision 改成“原文件 hash + 固定补丁版本 20261116d”。其余预缓存项目不变，URL 也不变。
3. 新 SW 安装时，Workbox 为这两个新缓存键重新下载注册模块与漫画模块；网络响应中的共享通知调用被关闭。固定 revision 不会随刷新或时间变化，避免制造无限更新。
4. 注册模块在页面执行时，用一个有固定 id 的 style 隐藏 `.logged-in-home-container .slideshow-section` 与 `.chapter-navigation__ad`。这个元素是源码确认的首页广告轮播外层；因此加载动画、卡片高度和间距一并收起。原页面是 React 动态渲染，返回 1px 图片无法保证折叠容器。

这是缓存版本迁移，不是清空站点数据。不注销 SW、不调用全站 caches.delete、不清除 Cookie / localStorage / IndexedDB，也不强制 skipWaiting。其他漫画、阅读进度、推荐和手动公告入口继续使用原逻辑。正常网站更新仍可下载；补丁注册模块不弹阻塞确认，新 worker 可在旧页面关闭后激活。

Workbox 的缓存键和 revision 行为见 [官方说明](https://developer.chrome.com/docs/workbox/modules/workbox-precaching)。固定补丁版本必须与注册模块改写同步维护，后续修改该模块补丁时，需要同时递增此版本和插件 script-path 查询参数。未知网站构建会放行，不猜测代码结构。

## 安装后验证

1. 在 Loon 更新网页插件。本版两个 PWA 脚本地址带 `?v=20261116d`，使 Loon 重新获取脚本；插件地址本身不变。
2. 关闭旧网页后重新进入。检查 SW 是否命中「哔咔网页版更新缓存请求处理」与「哔咔网页版更新缓存修复」，状态应为 200；随后注册模块应命中「哔咔网页版更新提示清理」。
3. 由于当前正在执行的旧脚本无法被网络规则追溯修改，迁移时可能最后弹一次确认。等新 SW 和注册模块下载完成后，点一次「好」完成切换，或关闭该站所有标签页及主屏幕 Web App 后重开。
4. 激活后再测试关闭 Safari 后台、重开网址：应不再反复弹更新确认，首页顶部的广告加载框应消失。不能仅凭新规则已命中就宣称这一设备行为已通过。
5. 若仍反复弹，核对 SW 是否仍为 304、清单是否已带固定 revision、注册模块是否实际被改写，以及 Loon 是否使用了带版本号的新脚本。先定位这三个步骤，不默认要求清除网站数据或重新登录。

广告配置及横幅仍可能有约 600 / 900 秒的前端缓存，公告约 300 秒。旧页面的公告不会被接口改写追溯关闭。不要导出账号 Token 到公开仓库。

## 依据与验证

- 首份网页 HAR 有 93 条记录，3 条配置中的广告位数量为 3、8、3。首版 8 项测试通过，回放修改 3 条目标配置，其他 90 条放行。用户反馈广告明显减少。
- 新 HAR 有 126 条记录；7 条广告配置已经被原插件清空，3 条公告响应的第一条标题与截图一致。新增规则回放清空这 3 条公告，其他 123 条不变。该抓包没有可供改写的入口 JS 正文，不能据此宣称更新提示已在设备上消失。
- 同日核对公开前端：公告数组非空才会自动打开公告板；空广告数组作为成功结果处理。当前公开入口 `index-ea_4Germ.js` 的 PWA 补丁只改变目标回调，其他字节保留，完整模块语法检查通过。
- 前一版 App 12 项与网页 17 项合成测试共 29 项通过，覆盖方法、状态、URL、异常结构、其他页、CORS、未知模块放行和回调执行。原始 HAR、前端下载缓存和账号信息不入 Git。用户后续已确认公告隐藏；更新提示仍出现，促成本次缓存迁移修复。

```sh
node --check Scripts/pica-web/response.js
node --check Scripts/pica-web/announcements.js
node --check Scripts/pica-web/pwa-update.js
node --check Scripts/pica-web/pwa-cache.js
node --check Scripts/pica-web/content.js
node --test Scripts/pica/test.cjs Scripts/pica-web/*.cjs
```

本次缓存迁移验证：新增 7 项测试，总计 36 项通过。实际 Workbox 7.4.0 的受控缓存测试中，旧清单迁移到新清单只下载注册模块，fetch cache 模式为 reload；再次使用相同清单时零下载。公开 SW 与注册模块改写后的完整源码均通过语法检查。手机冷启动行为和首页布局仍待用户复测。

章末补充：截图中的「此区域加载失败 / 暂无广告数据」来自 SupportUs 的 onlyAds 组件，外层为 `chapter-navigation__ad`。固定样式只收起这个广告子容器，不隐藏章节导航、上一章 / 下一章按钮、页码和漫画图片错误提示；此前仅处理章末容器，本轮增加穿插广告及页码模型处理，见下文。本项同时移植到 QX，待实机复测。

## 阅读穿插与收藏列表广告（20261116d）

新增 `content.js` 匹配漫画功能模块 `feature-comics-<hash>.js`，取消收藏 / 列表 / 网格里的广告卡片，以及单页、双页、瀑布流中的合成广告页。瀑布流的 item 数量、可见范围、跳页索引同步改为真实图片索引；只隐藏广告 DOM 会留下虚拟页或破坏虚拟列表测量，因此这里改插入逻辑。图片错误提示和章节导航保留。

本次只改已识别的 9 处代码，必须全部唯一匹配后才修改；未知构建整份放行。没有统一隐藏 error-state，没有使用 1px 图片。取消广告页后总页数按真实图片计数；旧会话中的虚拟位置不会热迁移，需完整重开页面，已有历史记录不删除。

固定缓存版本升到 20261116d，SW 清单共 90 项中只改变注册模块、漫画模块两项 revision。实际 Workbox 验证只重取这两项，再次使用同清单零下载；页面、入口 JS 和其他素材复用。两端改写后的完整模块字节一致并通过语法检查。

Loon 共 43 项测试通过，覆盖 20/21、40/41 等广告边界、完整及部分加载的双页图片顺序、列表卡片顺序、瀑布流跳页与总数一致性。新功能尚待手机验证。更新插件后关闭该站所有旧标签页及已打开的 Web App，再重新进入；只刷新旧页面不保证已切换到新模块。

## 主屏幕 Web App 顶部模糊（20261117a）

用户实测上一版 20261116e 的加高导航方案仍有模糊，而且挡住正文；该方案已撤回。本版完全移除对 mobile-header / mobile-header-container 高度的覆盖，原站导航 CSS、位置、搜索/菜单事件及滚动显隐恢复原样，不添加正文 padding、额外顶部留白或其他位置补偿。

公开 HTML 设置了 apple-mobile-web-app-status-bar-style=black-translucent。WebKit 维护回复指出该模式已弃用并建议移除：[WebKit 317153 comment 2](https://bugs.webkit.org/show_bug.cgi?id=317153#c2)。另有主屏幕 App 顶部系统区域异常的报告，但不能仅凭截图断定用户设备与某条 bug 有同一根因。先前只按 CSS 高度推断不完整，当前采用移除旧模式的针对性兼容修复。

新增 document.js 只处理本域根页面和 index.html 的 GET / 200 HTML，并要求 PicaWeb、manifest 和独立模式标记。只有唯一、已识别的 black-translucent meta 会被移除；其他样式/脚本、viewport-fit、manifest、独立运行及广告逻辑逐字节保留。移除该 meta 后由系统采用默认状态栏；不会用 CSS 隐藏系统磨砂层，也不修改 Safari 设置。

静态页面会被 SW 预缓存，因而不能只改实时首页。HTML 缓存 revision 加入固定 20261117a 前缀，注册模块也升级到 20261117a 以撤回上一版 CSS，漫画模块继续保持 20261116d。使用真实公开 SW 的 90 条清单（74 个唯一 URL）与 Workbox 7.4.0 做受控验证：从 e 升级只重取 HTML 与注册模块，再次安装零请求；没有清空缓存、账号数据或强制刷新阅读页。未知/重复的 HTML 清单条目整份放行。

公开 HTML 改写前后只相差一个被移除的 meta；完整注册模块和 SW 语法检查通过，Loon / QX 交付浏览器的字节一致。共 52 项 Loon、35 项 QX 测试通过，包含广告及翻页回归、HTML 方法/状态/域名保护、两端传输语义、幂等及迁移范围。设备显示仍待实测，不能由这些检查保证不再出现系统模糊。

更新插件或重写后，关闭该站所有旧标签页和已打开的 Web App，再从 Safari 首页进入，确保新缓存完成接替。旧主屏幕图标可能保留安装时的显示状态；如果重开后仍模糊，从已改写的 Safari 首页新增一个主屏幕入口对照，先保留旧入口和数据。检查搜索/标题清晰度、正文顶部是否被遮挡、原导航高度与滚动显隐。没有新增 iOS 系统状态栏之外的导航补偿空间。
