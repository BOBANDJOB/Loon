# 拷贝漫画增强：Loon / iOS Web App 测试版

基于 [Byaidu/copymanga-helper](https://github.com/Byaidu/copymanga-helper) 12.4 直接适配，保留原版阅读器及数据解析方式，不使用转换器。用户已验证基础阅读、目录调整及返回详情/上一话；本轮页码布局和返回缓存调整仍待 iPhone 实测。

## 安装与验证

在 Loon 中通过 URL 添加插件：

```text
https://raw.githubusercontent.com/BOBANDJOB/Loon/main/Plugins/CopyMangaHelper.lpx
```

插件及其两个脚本必须先提交并推送到对应路径；本地写好文件并不代表上面的地址已可访问。

1. 启用插件、脚本和 MitM，并确保 Loon CA 证书已经安装、信任。
2. 在手机 Safari 关闭该站点原有的油猴脚本，避免重复运行。桌面浏览器请求由本插件透传，Mac 保留 Tampermonkey 阅读增强。
3. 打开实际使用的首页 `https://www.mangacopy.com/h5/index`，进入一本漫画的章节。主页、搜索、登录、详情仍使用原站，阅读章节才重建为原版增强阅读器。
4. 确认图片、左侧边缘目录、上一章 / 下一章可用；点击右下角页码展开阅读设置。点击漫画立即收起设置或目录，这一次点击不触发翻页；菜单关闭后再次点击漫画正常翻页。
5. 再从 Safari 添加首页到主屏幕，开启「作为网页 App 打开 / Open as Web App」，从新入口验证同样的操作。该开关是否提供取决于 iOS 版本。

优先记录：实际网址路径、页面是否跳回 Safari、图片是否加载、目录和上下章是否正常、页面上的错误文字。切换插件后重新加载页面；如果旧页面仍留在后台，退出该 Web App 再打开。若登录状态未继承，在 Web App 内重新登录即可。

关闭插件后重新加载，恢复原网页。已加载的阅读器不会因为关闭 Loon 自动从内存里消失。每次导航或读取章节数据仍依赖 Loon 及该插件生效。

## 保留与适配

- 保留 HTML 中的 AES 图片 / 目录解析，以及原有 API 备用取图方式；保留大图、单双页、横纵滚动、空白页、夜间模式、键盘操作和章节评论。
- 批量下载和原版一样默认关闭（`enableDownload = 0`），下载代码保留，未验证下载行为。
- 把移动端 `GM_xmlhttpRequest` 改成同源 `fetch` → Loon `$httpClient` 桥接。桥接只允许同站章节源页面 / JavaScript，以及原脚本使用的两个固定 API 主机和指定路径；不会成为任意 URL 代理。
- 同站源页面请求使用桌面 UA、保留 `dnts`；Cookie 只回传给当前同一主机，评论的 Authorization 只转发到原版评论 API。不会在日志里打印 Token。
- 源 HTML 由 `$httpClient` 读取并作为 JSON 字符串返回，不会再次进入网页注入流程。每次上游重定向都重新检查目标范围。
- 用单独捕获的 Vue / jQuery / axios 等对象运行阅读器，加载后恢复原站全局变量。依赖版本保持原脚本版本，来自 unpkg；明确加载失败时尝试 jsDelivr，超时则显示重试提示。
- 左侧边缘支持触摸打开目录，不显示常驻目录按钮；右下角页码开关设置菜单，点击漫画或菜单外立即关闭，取消原版慢速淡出动画。目录和设置互斥打开，支持安全区域样式。移动端目录、上下章沿用 `/h5/` 路径。原站 SPA 跳入阅读页时进行同源整页导航，清除旧阅读器脚本环境。
- 目录使用固定在左侧的独立侧栏，宽度 `clamp(132px, 36vw, 184px)`，不再使用触摸设备最小 70% 屏宽的 Element Drawer。只有章节列表上下滚动，禁止横向滚动和滚动链 / 边缘回弹；长标题自动换行、条目按内容撑高，连续英文 / 数字也可断行，不省略章节名，也不撑宽目录。
- 增加 Cookie API 兼容、章节首尾判断和错误提示；桥接的数据 GET 与评论 POST 均不自动重试，图片自动重试最多三次。
- 只对指定网站的首页、`/comic/` 和 `/h5/` HTML 处理 CSP / 页面缓存。阅读章节返回干净的 HTML 外壳，其余页面保留原内容。API、图片及其他网站不注入。

本版不会改善原站本身的网络可用性，也不保证不同域名、站外链接和原站登录流程都留在同一个 Web App 窗口。首次加载需要下载依赖，实际速度取决于设备网络。

## 公告归属与 Web App 导航（2026-11-17）

- 首页公告规则由 `Plugins/my-plugin.plugin` 归入 `Plugins/CopyMangaHelper.lpx`，同时迁移 `api.copy4000.com` 的 MitM。保留精确 URL `/api/v3/system/config/2020/1`、GET、HTTP 200 和 `results.code` 置空语义；原 my-plugin 不再重复处理。更新时同步刷新这两个插件。
- QX 当前只有 `Rewrites/Complement.conf` 中的一处公告入口，没有网页阅读增强。保留该唯一共享入口，避免影响仍订阅 Complement 的配置；脚本增加精确 URL 保护和独立回归测试。不将 Loon 的 `$httpClient` 网页桥接直接作为 QX 脚本使用。
- 公开移动首页未声明 manifest，也没有独立模式 meta。原适配只在详情/阅读页调用 installHead，首页可能缺少安装元数据。现于 HTML head 的原站脚本之前添加独立模式 meta 和同源 manifest。清单由 `request.js` 返回，`start_url=/h5/index`、`scope=/`、`display=standalone`，ID 固定，不注册额外 Service Worker。
- 主屏幕 Web App 的范围外链接可进入系统 Safari View Controller，其分享、刷新和 Safari 按钮属于系统 UI，不能用网页 CSS 删除。新清单意在让同源首页、详情及章节处于同一范围，不能跨主域名或子域名保证留在 App。说明见 [Apple WWDC23](https://developer.apple.com/videos/play/wwdc2023/10120/)。旧主屏幕入口是否自动更新范围尚未确认；建议在插件生效后，从同一域名首页新增一个主屏幕入口对照，先保留旧入口。
- 触摸设备上的右下角页码/设置按 `100svh` 的稳定底边定位，菜单向上展开并限制可滚动高度。它会在系统工具栏收起后保留底部空间，以减少位置跳动；支持范围和解释见 [WebKit viewport units](https://webkit.org/blog/12445/new-webkit-features-in-safari-15-4/)。桌面及不支持 svh 的浏览器保留原定位。
- 返回导航改为在原站 Vue Router 进入章节前中止 SPA 路由，再进行同源文档导航，避免先改写详情页历史再重载。普通链接同样提前处理；新窗口、下载、组合键、站外链接与非阅读路由继续原行为。未知 SPA 仍有整页转换兜底，只在其已污染的页面从 BFCache 恢复时修复当前返回条目，不劫持正常后退，不增加拦截后退的历史项。

该轮曾通过 18 项 Node 测试、三组既有 jsdom 阅读器模拟（桌面、移动、备用 API）；使用实际 Vue Router 3.5.2 和 Vue 2.7.14 验证了章节跳转中止前后的 URL、路由、历史长度及恢复行为。受控环境不能模拟完整 iOS 原生容器和边缘返回手势，仍需设备测试。

实机重点：原目录/图片/菜单可用；正常返回详情页不再跳回章节；向上/下滚动时页码位置稳定；新主屏幕入口同源导航时是否还出现系统工具栏。不要把模拟测试通过视为这些设备行为已确认。

## 页码布局与返回缓存（2026-11-17）

- 收起的页码框不再沿用设置菜单的 120px 宽度，改为最小 64px、按数字长度扩展；去掉外层多余 padding，用 Flex 垂直/水平居中。触摸设备保留最小 44px 高度，展开设置仍使用原菜单宽度。
- 之前适配对注入 HTML 一律设置 `Cache-Control: no-store`。[WebKit 的前进/后退缓存判断](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/history/BackForwardCache.cpp)明确排除带该指令的 HTTPS 主文档，因此返回已读章节也不能恢复整页快照。
- 阅读外壳改用 `private, no-cache`，允许私有存储、普通网络访问仍需校验，让浏览器可以保存 DOM、脚本和滚动位置的 BFCache 快照。非阅读页若上游明确声明 `no-store` 则保留，否则同样采用私有校验缓存。桥接 JSON 的 `no-store` 不变。
- 章节切换仍是独立文档导航，19 话 → 20 话 → 后退到 19 话的顺序不变；没有新增拦截后退或强制刷新。移除缓存障碍不能保证每次都恢复快照，页面尚在加载、内存回收、原站明确禁存的详情页等仍可能重新加载。
- 更新插件后，重新打开详情页和阅读页一次，让旧页面使用新响应策略；再测试连续读两话后返回上一话及详情页，观察滚动位置是否恢复、有无重新加载。

本轮 20 项 Node 测试和三组既有 jsdom 阅读器模拟通过，覆盖缓存策略、标题/图片、目录和设置操作。布局与 iOS BFCache 实际恢复效果仍需实机验证。

## 页码背景溢出修复与目录收窄（2026-11-17）

用户实测发现页码仍落在背景外。实际问题为样式顺序：`loadCSS()` 在 head 设置稳定的 `top`、`bottom:auto` 和 `padding:0`，但 body 中遗留的同名规则又覆盖为 `bottom:2%`、`padding:5px`。触摸条件生效后，父容器同时受到 top/bottom 约束而被压矮；页码 44px 的最小高度仍在，导致子元素越过灰色背景。之前的 jsdom 检查只确认页码自身居中，未实际计算媒体条件下父容器的几何。

本机真实 macOS WebKit 在 375×812、模拟 top/bottom safe area 62/34px 的夹具中复现：父容器约 27.8px，页码 44px，页码底部超出背景。现删除 body 里的旧 bottom/right/padding，让定位只由 `loadCSS()` 管理，不再叠加补偿像素。页码与父容器均完整包住文字。目录从 46vw 收窄为 36vw，最小 132px、最大 184px，保持左对齐和完整长标题换行。

22 项 Node 测试、三组既有 jsdom 阅读器模拟通过。新增无 npm 依赖的 macOS WebKit 布局回归，覆盖 320/375/430px 竖屏、812px 横屏、桌面、菜单展开/收起和目录宽度，检查文字位于页码内、页码位于背景内、垂直中心偏差不超过 1px；测试只使用本地夹具和非持久 WebView，不访问实际站点。它验证真实 WebKit 布局，不等同于 iPhone 系统容器或实机触摸验证。

更新插件后重新加载当前章节即可应用，不需要重新添加主屏幕入口。前一节的返回缓存改动保持不变。

## 原站首页顶栏的 Web App 模糊测试修复（2026-11-17）

用户确认最近重新添加的拷贝漫画入口仍模糊，而同一首页在 Safari 标签页清晰。使用 iPhone UA 核对公开首页 HTML：只有 viewport 等原始 meta，没有 Pica 原站的 `black-translucent` 状态栏声明；原站移动 bundle 也未发现该声明。因此不能将此处直接归因于 Pica 的旧安装状态问题。

原站 `#indexV2 > .indexTitle` 和 `#discover > .indexTitle` 是普通文档流顶行。仅在 `display-mode: standalone` 下添加 `position:sticky;top:0;z-index:20;background-color:#fff`，让 WebKit 能将这条不透明的小顶栏作为边缘颜色采样候选。实现依据为 [WebKit 的 fixed/sticky 边缘颜色采样](https://github.com/WebKit/WebKit/commit/8b209a7da992cc5728c936b41afc2ae5dbafd2e5)；这是针对已知差异的试修，不能据此断言 iPhone 的系统模糊已消失。

没有新增高度、padding、safe area 占位或 transform，不修改 viewport、manifest ID、阅读器或原站按钮。Safari 标签页不匹配该媒体条件。23 项 Node 测试、三组阅读器模拟、六组阅读器 WebKit 布局回归通过；新增首页/发现页 × 375/430/812px 的六组真实 macOS WebKit 对照，每组比较原始、Safari 和模拟 standalone CSS，确认顶行、内部控件及下方标签的矩形尺寸/位置不变。此处模拟媒体条件不等价于 iOS 独立容器的原生覆盖效果，仍需 iOS 27.2.1 实测。

更新插件并重新加载首页即可取得样式；本轮没有安装期声明变化，不要求反复重建主屏幕入口。若仍模糊，优先用 Mac Safari 的 Web Inspector 连接实机检查当前 DOM/样式/viewport，而不是继续凭截图叠加导航补偿。

同一浏览器页面只运行一个完整拷贝漫画阅读脚本：两者均会重建章节 HTML、创建 Vue 阅读器及绑定事件。手机启用 Loon 版时应停用该站点 Tampermonkey 脚本；本版的桌面 UA 透传后，Mac 则保留 Tampermonkey。具体错误只有在取得错误文字后才能单独归因。

## 搜索/登录顶栏、桌面透传和错误 210（2026-11-17）

用户已确认首页顶栏清晰，搜索页和账号密码登录页仍有顶部模糊。将同一 standalone sticky 样式扩展到原站 `.seekPopup > form` 与 `.login > .van-sticky`；保留表单和原 Header 的尺寸/约束，不读取或改写输入值，也不触碰 `POST /api/v3/login`。12 组 macOS WebKit 对照覆盖四类顶栏 × 三种宽度，确认 Safari 不变，standalone CSS 下顶行、控件及内容不位移；iPhone 效果仍待验证。

本版明确分工为手机使用 Loon 阅读增强，Mac 使用 Tampermonkey。请求/响应脚本在入站 User-Agent 含 Macintosh、Windows NT、X11、CrOS 且不含 iPhone、iPad、iPod、Android、Mobile 时直接透传；不改变原站 HTML/CSP/缓存，不返回合成 manifest，也不执行阅读桥接。公告仍用原生 Rewrite，在精确 URL、GET 和 HTTP 200 之外加入同样 UA 条件。26 项 Node 测试覆盖桌面透传、移动阅读、桥接及原生公告条件的一致性。

此判断依据请求标识，不是绝对物理设备识别：iPad 的纯桌面模式且无 Mobile 时也会透传，未知/缺失 UA 保留旧处理。阅读器向上游取源网页使用的桌面 UA 与浏览器入站 UA 是两回事，不会据此前者禁用手机阅读。透传保护不关闭客户端的 MitM 或代理分流。

QX 仍只有 Complement 中的公告实现，没有 Loon 阅读器；其桌面请求同样透传。因此 Mac 关闭 Tampermonkey 后显示原站阅读器是当前配置的正常结果，不能据此判断阅读器代码只支持 iOS。

用户报告点击登录收到系统错误 210：停用单个插件仍出现，关闭整个 Loon 后能登录。原站前端将接口 `data.code` / `data.message` 用于此弹窗；它不是 iOS 的越狱判定，也不能证明安装过修改版 App。

失败抓包确认 3 次 `POST https://api.copy4000.com/api/v3/login` 的 HTTP 状态与 JSON code 都为 210，`modifiedRequest=false`、`modifiedResponse=false`，rewrite/script 均为空；请求经 FINAL 规则走美国代理。OPTIONS 预检为 200，普通首页 API 也为 200。登录请求版本头及表单版本均为原站当前 `2026.10.16`。这将问题定位到服务端对登录请求的拒绝，排除本插件直接把该响应改成 210。

随后用户关闭本插件、切换为新加坡节点后登录成功。成功抓包中同一接口 HTTP/JSON 均为 200，原站 UA、版本、platform、source 相同，登录仍未被改写，且 `mitmHost` 仍是 `api.copy4000.com`。结合此前单独停用插件仍失败，更支持原美国出口相关的服务端限制；MitM 本身并不是必然失败条件。尚无服务端规则证明具体是该 IP 的信誉、地区/ASN 或其他出口条件，更不能将“之前去广告导致 IP 被记录”当作已证实原因。插件开启且使用新出口的组合仍需用户验证。

曾在个人配置加入 API DIRECT 作最小对照，但用户已先完成换出口验证，因此已撤掉该测试规则；保留用户当前节点、模式及插件启停状态。未向共享插件强加直连。原脚本备用取图 API 的固定旧版本头也不足以解释本次登录；未盲改版本、伪造成功或自动调用登录接口。原始 HAR、账号、密码和 Token 不写入仓库。

## 请求行为审计与修改范围（2026-11-17）

用户补充：新出口登录后切回原美国出口仍可阅读。此结果支持当前观察到的限制集中于登录入口，不能说整个 IP 的所有请求均被封；尚未获得该出口对应的服务端判定规则。

重新下载用户指定的 [Greasy Fork 421371 源码](https://greasyfork.org/scripts/421371/code)，除平台追加的 downloadURL/updateURL 注释外，与最初固定的 GitHub 12.4 完全相同。原版也默认先解析章节网页，失败后调用 `api.2025copy.com` 的 App 章节接口，发送固定 `version=2025.08.08` / `platform=1`，并单独处理 210。因此旧 API、旧版本头与移动端 Windows UA 均是继承行为，不能说只有 Loon 版会遇到此类限制。

迁移中真实存在的差异：原版移动请求由 GM_xmlhttpRequest 发出，没有显式 timeout，也不经过原版 PC Axios 的重试拦截器。此前 Loon 版设了 8 秒上游超时，并将 GET 最多重试两次；20261117h 已取消该自动重试。Loon 桥接受脚本执行期限约束，改为整个请求及重定向链共用 24 秒预算（浏览器等待 28 秒、脚本 30 秒）；超时、断网、HTTP 错误或 JSON code 210 结束本次加载，不切换旧 API。网页请求成功但解析失败时，仍保留上游旧 API 回退。此处停止失败回退是用户选择的保守策略，并非上游逐字实现。

请求地址、动态 dnts、请求顺序及原版 API 参数保持不变。桥接仍由 $httpClient 发起，使用原移动脚本的桌面 UA、显式 Referer、仅同主机 Cookie 回传；底层 HTTP/TLS 和 Cookie 管理与 Tampermonkey 不完全相同。未改写登录，也不能据此保证解除 210。

用户将移动适配范围明确为左侧目录、右下角设置、后退导航、返回不重复刷新与 Web App 顶部模糊，其余行为尽量与原版一致。因此保留原版网页取图和旧 API 回退，不在缺少阅读抓包证据时改变接口、伪装版本或尝试解除服务端限制。现有两份登录 HAR 不含此前的阅读桥接请求，无法证明该回退在 IP 受限前实际执行过。

联网核对原脚本的 [Greasy Fork 反馈](https://greasyfork.org/zh-CN/scripts/421371-%E6%8B%B7%E8%B4%9D%E6%BC%AB%E7%94%BB%E5%A2%9E%E5%BC%BA/feedback)：2025-12 已有 Tampermonkey 用户报告使用脚本后出现 210 和等待一小时，并非 Loon 独有。[316452 帖](https://greasyfork.org/zh-CN/scripts/421371-%E6%8B%B7%E8%B4%9D%E6%BC%AB%E7%94%BB%E5%A2%9E%E5%BC%BA/discussions/316452)中作者建议更新，发帖人随后确认解决；[316485 帖](https://greasyfork.org/zh-CN/scripts/421371-%E6%8B%B7%E8%B4%9D%E6%BC%AB%E7%94%BB%E5%A2%9E%E5%BC%BA/discussions/316485)没有后续确认结果。当前移植起点已经是同一份 12.4，不能简单把再更新一次当作本机的已验证解法。[Venera 的相关讨论](https://github.com/venera-app/venera-configs/issues/232)中，更换 UA、取消 WebP 修改后仍有复现，参与者没有给出可保证有效的统一解法。这些是其他用户的报告，不是本机触发条件的证明，也不构成照搬某组请求头的依据。

进一步核对 [12.3 → 12.4 的原始提交](https://github.com/Byaidu/copymanga-helper/commit/18ef59351a567c318d152305579fb31aedb67d77)：除版本号外，修改集中在 `apiChapters`。旧版并行读取漫画网页与章节列表，目录请求头写死 `dnts: '2'`；新版先取 `/comic/{comic}` 页面及 AES 数据，从页面 `#dnt` 的 value 取出 `dnts`，随后请求 `/comicdetail/{comic}/chapters`，并调整解密结果索引。此次提交没有修改 UA 或登录接口；当时的用户反馈支持接口适配有效，但没有公开服务端风控规则。

当前 Loon 版已采用该顺序和动态页面参数，jsdom 阅读模拟也验证章节请求携带页面夹具中的 dnts。可借鉴的是按原站页面提供的参数请求，不能凭旧版修复推断本机今天仍写死了 dnts，也不能证明 210 的触发原因。若后续取得阅读抓包，优先比较页面参数、请求 Cookie 延续与实际出口等上下文；暂不在证据不足时变更桥接或伪造新版本头。

## 触摸设备双页的第一轮修复（20261117f，后续调整见下文）

原版 `.page #matrix` 使用 `flex-wrap:wrap`，图片适配屏幕高度后按实际宽度排列，没有限制每行两张；特别长的条漫会变成窄图，一行容纳多张。现有适配也沿用了该规则。使用实际模板 CSS 和本地长条 SVG 在 WebKit 中复现：375px 宽度下六张长图排在同一行。

仅在触摸设备的纵向双页模式（`.page:not(.scroll)`）将容器固定为两个等宽 Grid 列；保留原图片高度适配、object-fit、从右向左的阅读顺序和添加/移除空页。单页和横向滚动继续原规则，不修改 API、版本头或桥接逻辑。长条漫画在适配屏幕高度时本就会缩小，单页仍更适合阅读这类内容。

新增 `pair-layout-test.cjs`，12 组真实 macOS WebKit 几何验证覆盖竖屏/横屏、长图/普通图/混合图、空页、单页与横向滚动；确认双页每行最多两张、图片框不重叠、顺序和原有模式保留。对修改前源码运行同一检查会因六张长图挤在一行而失败。26 项 Node 检查、三组既有 jsdom 阅读器模拟、六组页码/目录 WebKit 回归仍通过。以上不是 iPhone 实机验证。

## 域名范围

沿用上游明确列出的根域名及其子域名：

```text
copymanga.com / .org / .net / .info / .site / .tv
mangacopy.com
copy20.com
2025copy.com
```

其中 `mangacopy.com` 与 `*.mangacopy.com` 同时配置，覆盖 `www.mangacopy.com`、`m.mangacopy.com` 等。通配符只覆盖这个根域名下面的子域名，不能覆盖未来另换的主域名。若换主域名，需要同步维护插件 URL 规则 / MitM、`request.js`、`response.js`，再验证新站的数据格式；不使用泛化的 `*copy*` MitM。

## ComicRead 参考与自适应排版（2026-11-17，脚本 20261117g）

感谢 [hymbz / ComicReadScript](https://github.com/hymbz/ComicReadScript) 的图片类型与分页设计。参考来源为 ComicRead 12.15.0 的图片宽高分类、图片加载后更新布局及章节导航状态管理思路；本版独立编写局部实现，没有合入其多站点阅读器或接口代码。插件说明与头部同时感谢原版作者 Byaidu、JirachiZhang 和参考作者 hymbz。

用户截图中，固定两列后仍有大量空黑和条漫缩成窄条。原因是图片框保持 `100vh/100dvh` 高度，而 `object-fit:contain` 将内容缩入这个一屏高的框。触摸设备的纵向双页现改为按宽度布局、高度随原图比例展开：普通页占半行，宽高比达到 1.2 的跨页图、宽高比不超过 0.4 的条漫占整行。阈值为本版的启发式规则，不是内容识别；接近阈值或特殊封面可能仍需人工选择单页。

分类由实际图片的 load 事件使用 naturalWidth/naturalHeight 更新，没有新增图片请求；同一元素换图时重新分类，未知尺寸暂不判断。保留从右向左的普通页顺序、单页与横向模式，CSS 自然响应旋转。合成空页不按长图/跨页处理；原有空页选项及计数语义保留；跨页前若只剩半行则保留配对空位，不强行挤入普通页。图片自带的白边保留，不做裁切、像素分析或拉伸。移除双页容器原先按视口高度限制的最大宽度，让触摸屏按实际可用宽度显示。

检查了 ComicRead 的 popstate、章节退出清理和慢请求序号机制。本插件使用独立文档切章，已有重复导航保护、原站路由进入章节前的中止逻辑及 BFCache 恢复处理；本轮没有把另一套 SPA 状态机叠加进来。取图、动态 dnts、Cookie 桥接及 API 备用路径保持不变，登录 210 不作为本次排版修改已解决的问题。

27 项 Node 检查通过，包含图片分类、重复加载和换图、合成空页不参与分类；14 组 WebKit 排版检查覆盖普通/跨页/条漫混排、空页、竖横屏、单页/横向模式，逐张检查图片框符合天然比例，避免一屏高框中的留黑。六组页码/目录 WebKit 回归、三组 jsdom 阅读模拟（含 Vue 图片 load 事件）也通过。图片首次加载确认类型时可能发生重排，阅读位置稳定性与实机效果仍待用户验证。

## 文件与本地验证

| 文件 | 用途 |
| --- | --- |
| `../../Plugins/CopyMangaHelper.lpx` | 手机安装入口 |
| `request.js` | 请求桥接、文档条件缓存处理 |
| `response.js` | 文档注入、依赖加载和改编后的完整阅读器，无构建步骤 |
| `test.cjs` | 无第三方依赖的 Node 边界 / 桥接验证 |
| `pair-layout-test.cjs` | macOS WebKit 双页/单页/横向滚动排版回归，仅使用本地图片夹具 |
| `layout-test.cjs` / `tests/layout-webkit.m` | 可选的 macOS WebKit 几何回归，使用现有 Apple CLT |
| `native-header-test.cjs` | 原站顶部行在浏览器/standalone CSS 下的尺寸与位置对照 |
| `LICENSE` | GPL v3 许可证正文 |

```sh
node --check Scripts/copymanga/request.js
node --check Scripts/copymanga/response.js
node --test Scripts/copymanga/test.cjs
git diff --check
# macOS，可选；受限沙盒需允许 WebKit 子进程启动
node Scripts/copymanga/layout-test.cjs
node Scripts/copymanga/native-header-test.cjs
node Scripts/copymanga/pair-layout-test.cjs
```

早期适配曾在临时目录用 jsdom 27.2.0 加载了原版八个固定版本依赖，使用加密数据 fixtures 和模拟 Loon 桥接验证了桌面 / 移动路由的图片、章节、触摸菜单、Cookie 兼容、评论编码、全局变量恢复，以及备用 API 取图。没有向真实网站发送评论。该验证不等价于 Safari / iOS 渲染、触摸手势或实机网络验证。

## 来源与许可

- 原作者：Byaidu。
- 原版 12.4 的维护贡献：JirachiZhang；图片分类与分页设计参考：hymbz（ComicRead），来源和独立实现范围见上文。感谢三位作者。
- 上游版本：12.4，commit [`18ef59351a567c318d152305579fb31aedb67d77`](https://github.com/Byaidu/copymanga-helper/commit/18ef59351a567c318d152305579fb31aedb67d77)。
- 上游原始文件 SHA-256：`ea6fad0ad4a123247e91e39a2d6438ca6fbe82acd90de95a039ac1b053efdcde`。
- Loon 适配：BOBANDJOB，2026-11-16。改动见上文，改编源码位于 `response.js` 的 `reader()`。
- 原脚本及本适配代码按 **GPL-3.0-or-later** 提供，许可证正文见 [LICENSE](LICENSE)。运行时加载的第三方库保留其各自许可证，版本与地址记录在源码中。

### 20261117h 验证范围

取消额外请求重试；网络错误停止旧 API 回退，成功响应的解析失败仍可回退。桌面 UA 继续透传给 Tampermonkey，iPhone/iPad 移动 UA 使用注入阅读器。本轮不修改布局、图片重载、QX 或个人分流配置。离线请求及阅读器测试不等同于 iPhone 实机和服务端风控验证。
