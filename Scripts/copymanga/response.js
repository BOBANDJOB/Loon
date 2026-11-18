// SPDX-License-Identifier: GPL-3.0-or-later
// Based on Byaidu/copymanga-helper v12.4 (GPL-3.0-or-later).
// Upstream: https://github.com/Byaidu/copymanga-helper
// Loon adaptation: BOBANDJOB, 2026-11-16. See README.md for provenance and changes.
(function () {
    const site = /^https:\/\/(?:[a-z0-9-]+\.)*(?:copymanga\.(?:com|org|net|info|site|tv)|mangacopy\.com|copy20\.com|2025copy\.com)(\/[^#]*)?$/i.exec($request.url);
    const path = site ? (site[1] || '/').split('?')[0] : '';
    const headers = Object.assign({}, $response.headers || {});
    const contentType = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    const status = Number($response.status || $response.statusCode);
    if (!site || /^https:\/\/api\./i.test($request.url) || $request.method !== 'GET' || status !== 200 ||
        !contentType || !/text\/html/i.test(headers[contentType]) || typeof $response.body !== 'string' ||
        !(path === '/' || /^\/(?:comic|h5)(?:\/|$)/.test(path))) return $done({});
    const requestHeaders = $request.headers || {};
    const uaKey = Object.keys(requestHeaders).find(k => k.toLowerCase() === 'user-agent');
    const userAgent = uaKey ? String(requestHeaders[uaKey]) : '';
    // Desktop browsers keep the original document for Tampermonkey. "Mac OS X"
    // alone is not a desktop token: iPhone user agents contain that phrase too.
    if (/\b(?:Macintosh|Windows NT|X11|CrOS)\b/i.test(userAgent) &&
        !/\b(?:iPhone|iPad|iPod|Android|Mobile)\b/i.test(userAgent)) return $done({});
    let html = $response.body;
    if (html.includes('id="loon-copymanga-bootstrap"')) return $done({});
    const isReader = /^\/comic\/[^/]+\/chapter\/[^/]+\/?$/.test(path) || /^\/h5\/comicContent\/[^/]+\/[^/]+\/?$/.test(path);
    const cacheKey = Object.keys(headers).find(k => k.toLowerCase() === 'cache-control');
    const upstreamCache = cacheKey ? String(headers[cacheKey]) : '';
    // These are document-only changes. API responses and bridge-fetched HTML never enter this branch.
    Object.keys(headers).forEach(k => {
        if (['content-security-policy', 'content-security-policy-report-only', 'etag', 'last-modified', 'expires', 'cache-control'].includes(k.toLowerCase())) delete headers[k];
    });
    // WebKit rejects HTTPS main documents with no-store from its back/forward
    // cache. A private, revalidated response permits an in-memory page snapshot.
    // Retain an explicit native-page no-store policy; the clean reader shell
    // contains no server account HTML and uses our own cache policy.
    headers['Cache-Control'] = !isReader && /(?:^|,)\s*no-store\b/i.test(upstreamCache) ?
        upstreamCache : 'private, no-cache';
    html = html.replace(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*["']?content-security-policy(?:["'\s>]))[^>]*>/gi, '');
    // Install Web App metadata before native scripts, including on /h5/index.
    const appHead = '<meta name="apple-mobile-web-app-capable" content="yes">' +
        '<meta name="apple-mobile-web-app-title" content="拷贝漫画">' +
        '<link rel="manifest" href="/__loon_copymanga__/manifest.webmanifest">';
    const script = '<script id="loon-copymanga-bootstrap">(' + bootstrap.toString() + ')(' + reader.toString() + ',' + browserNavigation.toString() + ');</script>';
    if (isReader) {
        // Do not execute the original reader's redirects/scripts before rebuilding its document.
        html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
            appHead + '<meta name="theme-color" content="#212121">' +
            '<title>拷贝漫画</title></head><body style="background:#212121;color:#eee">' +
            '<p id="loon-copy-loading" style="padding:24px;font:16px system-ui">正在加载阅读器…</p>' + script + '</body></html>';
    } else {
        // Native H5 header is in normal flow. Give WebKit a small, opaque
        // sticky edge to sample in standalone mode, without adding any inset
        // or changing its height. Reader documents and Safari tabs keep theirs.
        const appChrome = '<style id="loon-copy-native-app-chrome">' +
            '@media (display-mode:standalone){#indexV2>.indexTitle,#discover>.indexTitle,.seekPopup>form,.login>.van-sticky{' +
            'position:sticky;top:0;z-index:20;background-color:#fff}}</style>';
        html = html.replace(/<link\b(?=[^>]*\brel\s*=\s*["']?manifest(?:["'\s>]))[^>]*>/gi, '')
            .replace(/<meta\b(?=[^>]*\bname\s*=\s*["']?apple-mobile-web-app-(?:capable|title)(?:["'\s>]))[^>]*>/gi, '');
        html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, match => match + appHead + appChrome) : appHead + appChrome + html;
        html = /<\/body\s*>/i.test(html) ? html.replace(/<\/body\s*>/i, () => script + '</body>') : html + script;
    }
    $done({ headers, body: html });

    function bootstrap(startReader, installNavigation) {
        if (window.__loonCopymangaStarted) return;
        window.__loonCopymangaStarted = true;
        const navigation = installNavigation();
        const BRIDGE = '/__loon_copymanga__/fetch';
        const versions = [
            ['Vue', 'vue@2.7.14/dist/vue.min.js'],
            ['ELEMENT', 'element-ui@2.15.13/lib/index.js'],
            ['axios', 'axios@1.3.6/dist/axios.min.js'],
            ['store', 'store.js@1.0.4/store.js'],
            ['jQuery', 'jquery@3.6.4/dist/jquery.min.js'],
            ['JSZip', 'jszip@3.1.5/dist/jszip.min.js'],
            ['saveAs', 'file-saver@2.0.5/dist/FileSaver.min.js'],
            ['CryptoJS', 'crypto-js@4.1.1/crypto-js.js']
        ];
        const oldGlobals = {};
        versions.forEach(([name]) => { oldGlobals[name] = window[name]; });
        oldGlobals.$ = window.$;
        let restored = false;
        function restoreGlobals() {
            restored = true;
            Object.keys(oldGlobals).forEach(name => { window[name] = oldGlobals[name]; });
        }
        function showError(message) {
            let box = document.getElementById('loon-copy-error');
            if (!box) {
                box = document.createElement('div');
                box.id = 'loon-copy-error';
                box.style.cssText = 'position:fixed;left:16px;right:16px;top:calc(env(safe-area-inset-top) + 16px);padding:16px;background:#333;color:white;font:15px system-ui;z-index:2147483647;border-radius:8px';
                document.body.appendChild(box);
            }
            box.textContent = message;
            const retry = document.createElement('button');
            retry.textContent = '重新加载';
            retry.style.cssText = 'margin:12px;padding:8px';
            retry.onclick = () => location.reload();
            box.appendChild(retry);
        }
        function loadScript(path, name, fallback) {
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = (fallback ? 'https://cdn.jsdelivr.net/npm/' : 'https://unpkg.com/') + path;
                script.async = false;
                let completed = false;
                const timer = setTimeout(() => complete(new Error(name + ' 加载超时')), 15000);
                function complete(error) {
                    if (completed) {
                        // A removed, timed-out script may still execute later in WebKit.
                        if (restored) restoreGlobals();
                        script.onload = script.onerror = null;
                        return;
                    }
                    completed = true;
                    clearTimeout(timer);
                    if (!error || !/超时/.test(error.message)) script.onload = script.onerror = null;
                    if (error) {
                        script.remove();
                        // An errored resource may try another CDN. A timed-out script can still execute later;
                        // abort on timeout to avoid racing two copies of Vue/jQuery.
                        if (!fallback && !/超时/.test(error.message)) loadScript(path, name, true).then(resolve, reject);
                        else reject(error);
                    } else resolve();
                }
                script.onload = () => complete(window[name] ? null : new Error(name + ' 未正确加载'));
                script.onerror = () => complete(new Error(name + ' 加载失败'));
                document.head.appendChild(script);
            });
        }
        function addStyle(css) {
            const style = document.createElement('style');
            style.textContent = css;
            document.head.appendChild(style);
        }
        function installHead() {
            const metas = { viewport: 'width=device-width,initial-scale=1,viewport-fit=cover',
                'apple-mobile-web-app-capable': 'yes', 'theme-color': '#212121' };
            Object.keys(metas).forEach(name => {
                let meta = document.querySelector('meta[name="' + name + '"]');
                if (!meta) { meta = document.createElement('meta'); meta.name = name; document.head.appendChild(meta); }
                meta.content = metas[name];
            });
            if (!document.querySelector('link[rel="manifest"]')) {
                const manifest = document.createElement('link');
                manifest.rel = 'manifest'; manifest.href = '/__loon_copymanga__/manifest.webmanifest';
                document.head.appendChild(manifest);
            }
            ['element-ui@2.15.13/lib/theme-chalk/index.css'].forEach(path => {
                if (document.querySelector('link[data-loon-css="' + path + '"]')) return;
                const link = document.createElement('link');
                link.rel = 'stylesheet'; link.href = 'https://unpkg.com/' + path;
                link.setAttribute('data-loon-css', path);
                link.onerror = () => { link.onerror = null; link.href = 'https://cdn.jsdelivr.net/npm/' + path; };
                document.head.appendChild(link);
            });
        }
        // cookieStore is absent on some supported Safari versions; never print login tokens.
        const cookies = { get: async name => {
            const prefix = encodeURIComponent(name) + '=';
            const entry = document.cookie.split(';').map(v => v.trim()).find(v => v.startsWith(prefix));
            if (!entry) return undefined;
            const raw = entry.slice(prefix.length);
            try { return { name, value: decodeURIComponent(raw) }; } catch (_) { return { name, value: raw }; }
        } };
        async function main() {
            const libs = {};
            for (const [name, path] of versions) { await loadScript(path, name); libs[name] = window[name]; }
            // Keep the original page's Vue/jQuery/axios globals intact; the reader uses isolated references.
            libs.$ = libs.jQuery;
            const nativeAxios = libs.axios;
            const axios = nativeAxios.create();
            const defaultAdapter = nativeAxios.defaults.adapter;
            axios.defaults.adapter = async config => {
                const url = new URL(nativeAxios.getUri(config), location.href);
                const apiHost = ['api.mangacopy.com', 'api.2025copy.com'].includes(url.hostname);
                if (url.protocol !== 'https:' || !(url.origin === location.origin || apiHost)) {
                    return nativeAxios(Object.assign({}, config, { adapter: defaultAdapter }));
                }
                const controller = new AbortController();
                const abort = () => controller.abort();
                if (config.signal) {
                    if (config.signal.aborted) abort();
                    else config.signal.addEventListener('abort', abort, { once: true });
                }
                const timer = setTimeout(abort, config.timeout || 28000);
                try {
                    const response = await fetch(BRIDGE, { method: 'POST', credentials: 'same-origin', signal: controller.signal,
                        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                            url: url.href, method: (config.method || 'GET').toUpperCase(),
                            headers: config.headers && typeof config.headers.toJSON === 'function' ? config.headers.toJSON() : config.headers,
                            data: config.data
                        }) });
                    const transport = await response.json();
                    if (!response.ok || transport.error) {
                        throw new nativeAxios.AxiosError(transport.error || '请求桥接不可用', 'ERR_BAD_RESPONSE', config, null,
                            { status: response.status, data: transport });
                    }
                    const result = { data: transport.data, status: transport.status, statusText: '',
                        headers: { 'content-type': transport.contentType }, config, request: null };
                    if (result.status === 210 || (config.validateStatus && !config.validateStatus(result.status))) {
                        throw new nativeAxios.AxiosError('上游返回 HTTP ' + result.status, 'ERR_BAD_RESPONSE', config, null, result);
                    }
                    return result;
                } catch (error) {
                    // A transport failure must not trigger another request through the old API.
                    error.stopFallback = true;
                    if (!error.config) error.config = config;
                    throw error;
                } finally {
                    clearTimeout(timer);
                    if (config.signal) config.signal.removeEventListener('abort', abort);
                }
            };
            libs.axios = axios;
            restoreGlobals();
            startReader(libs, { addStyle, installHead, cookies, showError, navigation });
        }
        main().catch(error => { restoreGlobals(); showError('阅读器启动失败：' + error.message); });
    }

    function browserNavigation() {
        const isReader = path => /^\/comic\/[^/]+\/chapter\/[^/]+\/?$/.test(path) ||
            /^\/h5\/comicContent\/[^/]+\/[^/]+\/?$/.test(path);
        const nativeDocument = !isReader(location.pathname);
        let lastNativeURL = nativeDocument ? location.href : null;
        let dirtySPA = false, navigating = false;
        function readerURL(value) {
            try {
                const url = new URL(value, location.href);
                return url.origin === location.origin && isReader(url.pathname) ? url : null;
            } catch (_) { return null; }
        }
        function remember() { if (!isReader(location.pathname)) lastNativeURL = location.href; }
        function enter(value, replace = false) {
            const url = readerURL(value);
            if (!url || navigating) return false;
            navigating = true;
            dirtySPA = replace;
            location[replace ? 'replace' : 'assign'](url.href);
            return true;
        }
        if (!nativeDocument) return { nativeDocument, remember, enter };

        // Abort BEFORE Vue Router mutates its route state/history. Observing
        // the already-committed URL and replacing it is too late for Back.
        let hookedRouter = null;
        let observer;
        function hookRouter() {
            const root = document.getElementById('app');
            const router = root && root.__vue__ && root.__vue__.$router;
            if (!router || typeof router.beforeEach !== 'function' || typeof router.resolve !== 'function' || hookedRouter === router) return;
            hookedRouter = router;
            router.beforeEach((to, from, next) => {
                let url;
                try { url = readerURL(router.resolve(to).href); } catch (_) { /* native navigation */ }
                if (!url) { next(); return; }
                remember();
                next(false);
                enter(url.href);
            });
            if (observer) observer.disconnect();
        }
        document.addEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const link = event.target && event.target.closest && event.target.closest('a[href]');
            if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
            const url = readerURL(link.href);
            if (!url) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            remember();
            enter(url.href);
        }, true);
        hookRouter();
        if (!hookedRouter) {
            observer = new MutationObserver(hookRouter);
            observer.observe(document, { subtree: true, childList: true });
        }
        // Only repair a BFCache-restored native page that used the fallback
        // after its SPA transition had already committed. Never reload a clean
        // detail page on Back, or a reader on normal visibility changes.
        window.addEventListener('pageshow', event => {
            if (!event.persisted) return;
            navigating = false;
            if (!dirtySPA) return;
            dirtySPA = false;
            const target = isReader(location.pathname) ? lastNativeURL : location.href;
            if (target) location.replace(target);
        });
        return { nativeDocument, remember, enter };
    }

    function reader(libs, helpers) {
        const { Vue, ELEMENT, axios, store, $, JSZip, saveAs, CryptoJS } = libs;
        const GM_addStyle = helpers.addStyle;
        const cookieStore = helpers.cookies;
        let comic, chapter, lastRoute;
        // ==UserScript==
        // @name         ☄️拷贝漫画增强☄️
        // @namespace    http://tampermonkey.net/
        // @version      12.4
        // @description  拷贝漫画去广告🚫、加速访问🚀、并排布局📖、图片高度自适应↕️、辅助翻页↔️、页码显示⏱、侧边目录栏📑、暗夜模式🌙、章节评论💬
        // @author       Byaidu
        // @match        *://*.copymanga.com/*
        // @match        *://*.copymanga.org/*
        // @match        *://*.copymanga.net/*
        // @match        *://*.copymanga.info/*
        // @match        *://*.copymanga.site/*
        // @match        *://*.copymanga.tv/*
        // @match        *://*.mangacopy.com/*
        // @match        *://*.copy20.com/*
        // @match        *://*.2025copy.com/*
        // @match        *://copymanga.com/*
        // @match        *://copymanga.org/*
        // @match        *://copymanga.net/*
        // @match        *://copymanga.info/*
        // @match        *://copymanga.site/*
        // @match        *://copymanga.tv/*
        // @match        *://mangacopy.com/*
        // @match        *://copy20.com/*
        // @match        *://2025copy.com/*
        // @license      GNU General Public License v3.0 or later
        // @resource     element_css https://unpkg.com/element-ui@2.15.13/lib/theme-chalk/index.css
        // @resource     animate_css https://unpkg.com/animate.css@4.1.1/animate.min.css
        // @require      https://unpkg.com/vue@2.7.14/dist/vue.min.js
        // @require      https://unpkg.com/element-ui@2.15.13/lib/index.js
        // @require      https://unpkg.com/axios@1.3.6/dist/axios.min.js
        // @require      https://unpkg.com/store.js@1.0.4/store.js
        // @require      https://unpkg.com/jquery@3.6.4/dist/jquery.min.js
        // @require      https://unpkg.com/jszip@3.1.5/dist/jszip.min.js
        // @require      https://unpkg.com/file-saver@2.0.5/dist/FileSaver.min.js
        // @require      https://unpkg.com/crypto-js@4.1.1/crypto-js.js
        // @grant        GM_addStyle
        // @grant        GM_getResourceText
        // @grant        GM_xmlhttpRequest
        // @run-at       document-start
        // ==/UserScript==

        var largeMode = 1;
        var enableDownload = 0;
        var getPictureMode = 1;

        // Match the upstream mobile GM request path: no automatic Axios retries.

        function route() {
            if (lastRoute === location.pathname) return;
            // A native mobile SPA transition must become a document navigation, so its old reader
            // scripts cannot continue running underneath ours. Keep navigation on the current origin.
            const reading = /^\/comic\/[^/]+\/chapter\/[^/]+\/?$/.test(location.pathname) ||
                /^\/h5\/comicContent\/[^/]+\/[^/]+\/?$/.test(location.pathname);
            if (reading && (lastRoute !== undefined || helpers.navigation.nativeDocument)) {
                lastRoute = location.pathname;
                helpers.navigation.enter(location.href, true);
                return;
            }
            lastRoute = location.pathname;
            helpers.navigation.remember();
            if (/^\/comic\/[^/]+\/chapter\/[^/]+\/?$/.test(location.pathname)) comicPage(1).catch(helpers.showError);
            else if (/^\/h5\/comicContent\/[^/]+\/[^/]+\/?$/.test(location.pathname)) comicPage(0).catch(helpers.showError);
            else if (document.getElementsByClassName('ban').length) banPage();
            else if (/^\/comic\/[^/]+\/?$/.test(location.pathname)) tablePage(1);
            else if (/^\/$/.test(location.pathname)) homePage();
            else if (/^\/h5\/details\/comic\/[^/]+\/?$/.test(location.pathname)) tablePage(0);
        }

        route();

        if (/^\/h5.*$/.test(location.pathname)) {
            let previousUrl = location.href;
            const observer = new MutationObserver(function (mutations) {
                if (location.href !== previousUrl) {
                    previousUrl = location.href;
                    route();
                }
            });
            const config = { subtree: true, childList: true };
            observer.observe(document, config);
        }

        // Independent implementation inspired by ComicRead's image-type approach.
        // Natural image dimensions do not change when the viewport rotates.
        function imageLayoutKind(width, height) {
            if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '';
            const ratio = width / height;
            return ratio <= 0.4 ? 'long' : ratio >= 1.2 ? 'spread' : 'normal';
        }
        function classifyImage(image) {
            if (!image || !image.classList || image.classList.contains('blank')) return;
            const kind = imageLayoutKind(image.naturalWidth, image.naturalHeight);
            if (kind && image.getAttribute('data-layout') !== kind) image.setAttribute('data-layout', kind);
        }

        async function loadCSS() {
            helpers.installHead();
            GM_addStyle(`
                #info { right:calc(env(safe-area-inset-right) + 10px);bottom:calc(env(safe-area-inset-bottom) + 10px);z-index:4000;padding:0;display:flex;flex-direction:column;align-items:stretch; }
                #info_count { cursor:pointer;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:auto;min-width:64px;min-height:36px;padding:0 10px;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums; }
                @supports (height:100svh) {
                    @media (pointer:coarse) {
                        /* Stable minimum viewport: do not chase toolbar height. */
                        #info { top:calc(100svh - env(safe-area-inset-bottom) - 10px);bottom:auto;transform:translateY(-100%); }
                        #info-options { max-height:calc(100svh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 90px);overflow-y:auto;overscroll-behavior:contain; }
                    }
                }
                #loon-copy-status { padding:24px;color:#aaa;font:15px system-ui; }
                .page .inner_img,.scroll .inner_img { height:100dvh; }
                @media (pointer:coarse) {
                    /* Fit width without viewport-height letterboxes. Natural
                       dimensions decide whether an image occupies both columns. */
                    .page:not(.scroll) #matrix { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));direction:rtl;align-items:start;width:100%;max-width:100%; }
                    .page:not(.scroll) .inner_img { width:100%;min-width:0;height:auto; }
                    .page:not(.scroll) .inner_img:not(.blank)[data-layout="spread"],
                    .page:not(.scroll) .inner_img:not(.blank)[data-layout="long"] { grid-column:1 / -1; }
                }
                @media (pointer:coarse) { .info_item { padding:10px 0; } #info_count { min-height:44px; } }
            `);
        }

        function banPage() {
            helpers.showError('站点返回了浏览器限制页面，请先确认原站可以正常访问。');
        }

        function homePage() {
            GM_addStyle('.header-jum {display:none;}');
        }

        async function makeRequest(options) {
            const response = await axios.get(options.url, { headers: options.headers || {}, params: options.params || {} });
            if (response.data && Number(response.data.code) === 210) {
                const error = new Error('服务器限制了请求，请稍后重试');
                error.stopFallback = true;
                throw error;
            }
            return response;
        }

        async function getAesName(url, isPC, fileName) {
            let aesKeyName;
            const request = {
                url: url,
                isPC: isPC
            };
            const regexName = /\[.*?\]\['parse'\]\((.*?)\)/;
            const response = await makeRequest(request);
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.data, "text/html");
            const scripts = doc.querySelectorAll('script');
            if (fileName !== undefined){
                for (const script of scripts) {
                    if (script.src.includes(fileName)) {
                        const request = {
                            url: script.src,
                            isPC: isPC
                        };
                        const response = await makeRequest(request);
                        const scriptText = response.data;
                        const evalRegex = /^\s*eval\(\s*(.+)\s*\)\s*$/s;
                        const match = scriptText.match(evalRegex);
                        const innerCode = match[1];
                        const executeCode = new Function('return ' + innerCode);
                        const result = executeCode();
                        const matchName = result.match(regexName);
                        if (matchName && matchName[1]) {
                            aesKeyName = matchName[1];
                            break;
                        }
                    }
                }
            }
            return [aesKeyName,doc];
        }

        async function getAesKey(url, isPC, defaultName, fileName) {
            const result = await getAesName(url, isPC, fileName);
            let aesKeyValue = [];
            let aesKeyName = result[0];
            const doc = result[1];
            const scripts = doc.querySelectorAll('script');
            for (let i = 0; i < defaultName.length; i++) {
                if (result[0] === undefined){
                    aesKeyName = defaultName[i];
                }
                for (const script of scripts) {
                    if (script.textContent.includes(aesKeyName)) {
                        const regexValue = new RegExp(`var\\s+${aesKeyName}\\s*=\\s*['"]?([^'";\\s]+)['"]?`);
                        const matchValue = script.textContent.match(regexValue);
                        if (matchValue && matchValue[1]) {
                            aesKeyValue.push(matchValue[1]);
                            break;
                        }
                    }
                }
            }
            return [aesKeyValue, doc];
        }

        async function apiChapters(comic,isPC) {
            const aesKeyName = 'ccz';
            const resultsAesKey = await getAesKey(
                window.location.origin + '/comic/' + comic,
                isPC,
                [aesKeyName]
                );
            const dnts = resultsAesKey[1].getElementById('dnt').getAttribute('value');
            const headers = {'dnts': dnts};
            const request = {
                url: window.location.origin + '/comicdetail/' + comic + '/chapters',
                isPC: isPC,
                headers:headers
            };
            const results = await makeRequest(request);
            let iv = typeof results.data === "string"
                    ? JSON.parse(results.data).results.substring(0, 16)
                    : results.data.results.substring(0, 16),
                cipher = typeof results.data === "string"
                    ? JSON.parse(results.data).results.substring(16)
                    : results.data.results.substring(16),
                result = JSON.parse(CryptoJS.AES.decrypt(
                    CryptoJS.enc.Base64.stringify(
                        CryptoJS.enc.Hex.parse(cipher)
                    ),
                    CryptoJS.enc.Utf8.parse(resultsAesKey[0][0]),
                    {
                        'iv': CryptoJS.enc.Utf8.parse(iv),
                        'mode': CryptoJS.mode.CBC,
                        'padding': CryptoJS.pad.Pkcs7
                    }
                ).toString(CryptoJS.enc.Utf8));
            let type_map = new Map();
            result.build.type.forEach((v, index) => {
                type_map.set(v.id, v.name);
            });
            result.groups.default.chapters.forEach((v, index) => {
                v.index = index;
                let type_name = type_map.get(v.type);
                v.name = "【" + type_name + "】" + v.name;
                v.type_name = type_name;
            });
            return result;
        }

        function tablePage(isPC) {
            loadCSS();
            var collect, save,
                comic,
                content_comic = [],
                app;
            if (isPC)
                comic = window.location.pathname.split('/')[2];
            else
                comic = window.location.pathname.split('/')[4];
            $(() => {
                if (enableDownload) {
                  GM_addStyle('.comicParticulars-botton:nth-of-type(4) {background: lightskyblue;}');
                  if (isPC)
                      collect = document.getElementsByClassName('collect')[0];
                  else
                      collect = document.getElementsByTagName('button')[2];
                  save = collect.cloneNode();
                  save.innerHTML = '批量下载';
                  save.onclick = saveComic;
                  collect.after(save);
                  var app_html = document.createElement("div");
                  app_html.innerHTML = `
          <div id="app_save">
            下载范围：
            <el-select v-model="begin" placeholder="起始话" size="mini" style="width:150px;">
              <el-option
                v-for="item in content_comic"
                :key="item.index"
                :label="item.name"
                :value="item.index">
              </el-option>
            </el-select>
            至
            <el-select v-model="end" placeholder="终止话" size="mini" style="width:150px;margin-right:20px;">
              <el-option
                v-for="item in content_comic"
                :key="item.index"
                :label="item.name"
                :value="item.index">
              </el-option>
            </el-select>
          </div>
          `
                  collect.after(app_html);
                  if (isPC)
                      document.getElementById('app_save').setAttribute('style', 'margin-top:18px;');
                  else
                      document.getElementsByClassName('detailsTextContentItem')[0].setAttribute('style', 'flex-wrap:wrap;');
                  app = new Vue({
                      el: '#app_save',
                      data: {
                          content_comic: [],
                          begin: '',
                          end: '',
                      },
                  })
                  GM_addStyle('.el-input__suffix {display:none !important;}');
                  apiChapters(comic,isPC)
                      .then(function (response) {
                          content_comic = response.groups.default.chapters;
                          app.content_comic = content_comic;
                          app.begin = content_comic.at(0).index;
                          app.end = content_comic.at(-1).index;
                      }).catch(function (error) {
                          save.innerHTML = '下载失败';
                      })
                }
                cookieStore.get('token')
                    .then(function (token) {
                        if (token) {
                            axios.get('https://api.mangacopy.com/api/v3/comic2/query/' + comic, {
                                headers: {
                                    'authorization': 'Token ' + token.value
                                }
                            }).then(function (response) {
                                if (response.data.results.browse != null) {
                                    var read = document.getElementsByClassName('comicParticulars-botton')[0];
                                    if (!read) return;
                                    read.innerHTML = response.data.results.browse.chapter_name;
                                    read.href = window.location.origin + '/comic/' + comic + '/chapter/' + response.data.results.browse.chapter_uuid;
                                    GM_addStyle('.comicParticulars-botton {max-width:80px; overflow: hidden;text-overflow: ellipsis; white-space: nowrap;}');
                                }
                            }).catch(() => {});
                        }
                    }).catch(() => {})
            })
            let sleep = function (time) {
                return new Promise((resolve) => {
                    setTimeout(resolve, time)
                })
            }
            async function saveComic() {
                let zip = new JSZip();
                let task_cnt = 0;
                let date_created_chapter_map = new Map();
                let comic_name = null;
                for (let idx = app.begin; idx <= app.end; idx++) {
                    let c = content_comic[idx];
                    task_cnt++;
                    save.innerHTML = task_cnt + '/' + (app.end - app.begin + 1);
                    await axios.get('https://api.mangacopy.com/api/v3/comic/' + comic + '/chapter/' + c.id)
                        .then(async function (response) {
                            let task_chapter = [];
                            var chpt_index = Number(response.data.results.chapter.index) + 1
                            let dir_chpt_name = response.data.results.chapter.name
                            if (c.type_name !== undefined) {
                                dir_chpt_name = "【" + chpt_index + "】【" + c.type_name + "】" + dir_chpt_name;
                            }
                            let dir_comic = zip.folder(response.data.results.comic.name)
                            let content = response.data.results.chapter.contents,
                                size = Array.isArray(content) ? content.length : 0,
                                dict = {};
                            comic_name = response.data.results.comic.name;
                            let date_created_chapter = new Date(response.data.results.chapter.datetime_created);
                            if (idx != app.begin && date_created_chapter.getTime() <= date_created_chapter_map.get(idx - 1).getTime()) {
                                date_created_chapter = new Date(date_created_chapter_map.get(idx - 1).getTime() + 2000);
                            }
                            date_created_chapter_map.set(idx, date_created_chapter);
                            dir_comic.file(dir_chpt_name, null, {
                                dir: true,
                                date: date_created_chapter,
                            });
                            let dir_chpt = dir_comic.folder(dir_chpt_name);
                            for (let i = 0; i < size; i++) {
                                (() => {
                                    let self = i;
                                    let img_url = content[i].url;
                                    if (largeMode) img_url = img_url.replace('c800x.jpg', 'c1500x.jpg');
                                    task_chapter.push(axios.get(img_url, { responseType: 'arraybuffer' })
                                        .then(function (response) {
                                            let date_created_file = new Date(date_created_chapter.getTime() + 2000 * self);
                                            dir_chpt.file((self + 1) + '.jpg', response.data, { date: date_created_file });
                                        }).catch(function (error) {
                                            save.innerHTML = '下载失败';
                                        }))
                                })()
                            }
                            await axios.all(task_chapter);
                        }).catch(function (error) {
                            save.innerHTML = '下载失败';
                        })
                    await sleep(1000);
                }
                zip.generateAsync({ type: "blob" }, function (metadata) {
                    save.innerHTML = metadata.percent.toFixed(0) + '%';
                }).then(function (blob) {
                    saveAs(blob, comic_name + ".zip");
                    save.innerHTML = '下载完成';
                })
            }
        }

        async function comicPage(isPC) {
            // 停止加载原生网页
            // Original scripts are removed by Loon on reader documents.

            // 解析 URL
            if (isPC) {
                comic = window.location.pathname.split('/')[2];
                chapter = window.location.pathname.split('/')[4];
            } else {
                comic = window.location.pathname.split('/')[3];
                chapter = window.location.pathname.split('/')[4];
            }

            // 加载 HTML
            document.querySelectorAll('html')[0].innerHTML = `
        <head><meta charset="utf-8"></head>
        <body>
          <div id="app">
            <p id="loon-copy-status">正在获取漫画图片…</p>
            <div @mouseleave="drawer=false; isClickable=false">
              <div id="loon-copy-edge" @mouseenter="open_directory" @click.stop="open_directory" @keydown.enter.stop.prevent="open_directory" role="button" tabindex="0" aria-label="章节目录" style="top:0px;left:0px;height:100dvh;width:10vw;position:fixed;"></div>
              <aside id="sidebar" v-if="drawer" aria-label="章节目录">
                <nav class="loon-copy-chapters" aria-label="章节列表">
                <el-menu
                  background-color="transparent"
                  text-color="#fff"
                  active-text-color="#ffd04b"
                  @select="handleSelect">
                  <template v-for="(item, index) in sidebar_data">
                    <el-menu-item v-bind:index="index" :disabled="!isClickable" :title="item.title">{{item.title}}</el-menu-item>
                  </template>
                </el-menu>
                </nav>
              </aside>
            </div>
            <div id="matrix">
              <template v-for="(item, index) in comic_data">
                <img class="inner_img" v-bind:src="item.url" @load="classify_image">
              </template>
            </div>
            <ul style="margin-top:20px;">
              <template v-for="(item, index) in comment_data">
                <li style="display:inline-block;">
                  <p class="comment" v-bind:index="index">{{item.user_name}} : {{item.comment}}</p>
                </li>
              </template>
            <ul>
            <el-input v-model="comment_input" placeholder="吐槽" style="width:300px;margin:20px;" @keyup.enter.native="send_comment" @focus="is_input=1" @blur="is_input=0">
              <el-button slot="append" type="primary" @click="send_comment">发表</el-button>
            </el-input>
            <ul style="margin-bottom:20px;">
              <el-button type="primary" @click="prev_chapter">上一章</el-button>
              <el-button type="primary" @click="next_chapter">下一章</el-button>
            </ul>
            <div id="info">
              <div id="info-options" v-if="show">
                <div id="info_scroll" class="info_item" @click="switch_scroll" style="cursor:pointer;">{{message_scroll}}</div>
                <div id="info_page" class="info_item" @click="switch_page" style="cursor:pointer;">{{message_page}}</div>
                <div id="info_skip" class="info_item" @click="switch_skip" style="cursor:pointer;">{{message_skip}}</div>
                <div id="info_switch" class="info_item" @click="switch_night" style="cursor:pointer;">{{message_switch}}</div>
                <div id="info_full" class="info_item" @click="switch_full" style="cursor:pointer;">{{message_full}}</div>
                <div id="info_home" class="info_item" @click="switch_home" style="cursor:pointer;">{{message_home}}</div>
              </div>
              <div id="info_count" class="info_item" @click="toggle_settings" role="button" tabindex="0" :aria-expanded="!!show" aria-controls="info-options" @keydown.enter.stop.prevent="toggle_settings" @keydown.space.stop.prevent="toggle_settings">{{message_count}}</div>
            </div>
          </div>
          <style>
            body {
              text-align: center;
              font-size: 12px;
              line-height: normal;
              background: #edecea;
              margin: unset !important;
            }
            body.dark {
              background: #212121;
            }
            ::-webkit-scrollbar {
              width: 4px;height: 0px;
            }
            ::-webkit-scrollbar-thumb {
              background-color: rgb(48,48,48);
              border-radius: 2px;
            }
            #matrix {
              display: grid;
              justify-items: center;
              justify-content: center;
              overflow-x: hidden;
              user-select: none;
              margin: 0 auto;
              max-width: 190vh;
            }
            .page #matrix {
              display: flex;
              flex-direction: row-reverse;
              flex-wrap: wrap;
            }
            .scroll #matrix {
              display: flex;
              flex-direction: row-reverse;
              flex-wrap: wrap;
              justify-content: unset;
              flex-wrap: unset;
              overflow-x: scroll;
            }
            .scroll .inner_img {
              height: 100vh;
              object-fit: contain;
            }
            .page .inner_img {
              height: 100vh;
              object-fit: contain;
            }
            .inner_img {
              max-width: 100%;
            }
            #sidebar {
              position: fixed;
              z-index: 3000;
              top: 0;
              left: 0;
              bottom: 0;
              width: clamp(132px, 36vw, 184px);
              max-width: calc(100vw - 48px);
              height: 100dvh;
              box-sizing: border-box;
              display: flex;
              padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom) env(safe-area-inset-left);
              background: rgba(24,24,24,.94);
              border-right: 1px solid rgba(255,255,255,.15);
              overflow: hidden;
              overscroll-behavior: none;
              touch-action: pan-y;
            }
            #sidebar .loon-copy-chapters {
              flex: 1;
              min-width: 0;
              min-height: 0;
              overflow-x: hidden;
              overflow-y: auto;
              overscroll-behavior: none;
              touch-action: pan-y;
            }
            #sidebar .el-menu {
              width: 100%;
              min-width: 0;
              box-sizing: border-box;
              text-align: left;
              border-right: 0px;
            }
            #sidebar .el-menu-item {
              box-sizing: border-box;
              max-width: 100%;
              height: auto;
              min-height: 44px;
              line-height: 1.5;
              padding: 11px 12px;
              overflow: hidden;
              white-space: normal;
              overflow-wrap: anywhere;
            }
            #info {
                /* Geometry lives in loadCSS(), including the svh anchor.
                   A later bottom value here would constrain its height. */
                background: rgba(48,48,48,.7);
                position: fixed;
                color: rgba(255,255,255,.7);
                border-radius: 3px;
            }
            .info_item {
                padding:5px 0px;
                width:120px;
            }
            .skip .blank {
              display:none;
            }
            .dark .comment {
                color: rgba(255,255,255,.7);
            }
            .dark .el-input__inner {
                background-color:rgba(255,255,255,.05);
                color: rgba(255,255,255,.7);
            }
            .dark .el-input-group__append {
                background-color:rgba(255,255,255,.2);
                color: rgba(255,255,255,.7);
            }
            .dark .el-button {
                background-color:rgba(255,255,255,.2);
                color: rgba(255,255,255,.7);
                border: 1px solid #DCDFE6;
            }
            .comment {
              padding: 10px 13px;
              margin:5px 5px;
              font-size:14px;
              background-color:rgb(127,127,127,.15);
            }
            ul {
              margin: 5px;
              padding: unset;
            }
          </style>
        </body>
        `;

            loadCSS();

            // 加载 LocalStorage
            let dark = store.get('dark');
            let skip = store.get('skip');
            let page = store.get('page');
            let scroll = store.get('scroll');
            if (dark == undefined)
                dark = true;
            if (skip == undefined)
                skip = true;
            if (page == undefined)
                page = true;
            if (scroll == undefined)
                scroll = false;
            if (dark) {
                document.body.classList.add('dark');
            }
            if (skip) {
                document.body.classList.add('skip');
            }
            if (page) {
                document.body.classList.add('page');
            }
            if (scroll) {
                document.body.classList.add('scroll');
            }

            // 加载 Vue
            var app = new Vue({
                el: '#app',
                data: {
                    drawer: false,
                    isClickable: false,
                    size: '100%',
                    sidebar_data: [], // 章节数据源
                    comic_data: [],   // 图片数据源
                    comment_data: [], // 评论数据源
                    comment_input: '',
                    is_input: 0,
                    cur_lock: 0,
                    cur_id: 0,
                    cur_ch: 0,
                    dark: dark,
                    page: page,
                    skip: skip,
                    scroll: scroll,
                    show: 0,
                    full: 0,
                },
                computed: {
                    message_home: function () {
                        return '⬅️返回目录';
                    },
                    message_full: function () {
                        return this.full ? '↩️退出全屏' : '↕️进入全屏';
                    },
                    message_switch: function () {
                        return this.dark ? '☀️日间模式' : '🌙夜间模式';
                    },
                    message_page: function () {
                        return this.page ? '1️⃣单页排布' : '2️⃣双页排布';
                    },
                    message_skip: function () {
                        return this.skip ? '📑添加空页' : '📄移除空页';
                    },
                    message_scroll: function () {
                        return this.scroll ? '⏬纵向滚动' : '⏪横向滚动';
                    },
                    message_count: function () {
                        return (this.skip ? (this.cur_id <= 1 ? this.cur_id : this.cur_id - 1) : this.cur_id) + '/' + (this.comic_data.length + 1 - this.skip);
                    }
                },
                methods: {
                    classify_image(event) {
                        classifyImage(event.target);
                    },
                    open_directory() {
                        this.show = false;
                        this.drawer = true;
                        this.isClickable = true;
                        this.$nextTick(this.handleOpen);
                    },
                    toggle_settings() {
                        this.drawer = false;
                        this.isClickable = false;
                        this.show = !this.show;
                    },
                    handleSelect(key) {
                        location.href = this.sidebar_data[key].href;
                    },
                    handleOpen() {
                        const list = document.querySelector('#sidebar .el-menu');
                        const item = list && list.children[Math.max(this.cur_ch - 2, 0)];
                        const scroller = document.querySelector('#sidebar .loon-copy-chapters');
                        if (item && scroller) scroller.scrollTop = item.offsetTop;
                    },
                    switch_home: function () {
                        location.href = window.location.origin + (isPC ? '/comic/' : '/h5/details/comic/') + comic;
                    },
                    switch_full: function () {
                        if (!document.documentElement.requestFullscreen) {
                            alert(window.navigator.standalone ? '当前已在独立 Web App 中打开' : '可添加到主屏幕并开启「作为网页 App 打开」');
                            return;
                        }
                        const action = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
                        Promise.resolve(action).then(() => { this.full = !!document.fullscreenElement; }).catch(() => {});
                    },
                    switch_night: function () {
                        this.dark = !this.dark;
                        store.set('dark', this.dark);
                        document.body.classList.toggle('dark');
                    },
                    switch_skip: function () {
                        this.skip = !this.skip;
                        store.set('skip', this.skip);
                        document.body.classList.toggle('skip');
                    },
                    switch_page: function () {
                        this.page = !this.page;
                        store.set('page', this.page);
                        document.body.classList.toggle('page');
                    },
                    switch_scroll: function () {
                        this.scroll = !this.scroll;
                        store.set('scroll', this.scroll);
                        document.body.classList.toggle('scroll');
                    },
                    send_comment: async function () {
                        let token = await cookieStore.get('token');
                        if (!token) { alert('请先在当前 Web App 中登录'); return; }
                        if (!this.comment_input.trim()) return;
                        await axios.post('https://api.mangacopy.com/api/v3/member/roast', 'chapter_id=' + chapter + '&roast=' + encodeURIComponent(this.comment_input) + '&_update=true', {
                            headers: {
                                'authorization': 'Token ' + token.value
                            }
                        }).then(function (response) {
                            app.comment_input = response.data.message;
                        }).catch(error => helpers.showError('评论发送失败：' + error.message));
                        await this.load_comment().catch(() => {});
                    },
                    load_comment: async function () {
                        await axios.get('https://api.mangacopy.com/api/v3/roasts?chapter_id=' + chapter + '&limit=100&offset=0&_update=true')
                            .then(function (response) {
                                app.comment_data = response.data.results.list;
                            })
                    },
                    prev_chapter: function () {
                        const previous = app.sidebar_data[app.cur_ch - 1];
                        if (previous) location.href = previous.href;
                    },
                    next_chapter: function () {
                        const next = app.sidebar_data[app.cur_ch + 1];
                        if (next) location.href = next.href;
                    },
                }
            });

            //接口出错通知
            function showErrorNotification() {
                helpers.showError('服务器暂时限制了图片请求，请稍后重试。');
            }

            //通过图片List
            async function getImageOld() {
                const headers = {'version': '2025.08.08', 'platform': '1'};
                const request = {
                    url: 'https://api.2025copy.com/api/v3/comic/' + comic + '/chapter/' + chapter,
                    isPC: isPC,
                    headers: headers
                };
                const response = await makeRequest(request);
                if (response.data.code == 210) {
                    showErrorNotification();
                    throw new Error('服务器限制了图片请求，请稍后重试');
                }
                document.title = response.data.results.comic.name + ' - ' + response.data.results.chapter.name;
                const content = response.data.results.chapter.contents;
                return content;
            }

            //通过加密数据
            async function getImageNew() {
                const contentName = 'contentKey';
                const aesKeyName = 'cct';
                const results = await getAesKey(
                    window.location.origin + '/comic/' + comic + '/chapter/' + chapter,
                    isPC,
                    [contentName, aesKeyName]
                    );
                if (results[0].length != 2) {
                    throw new Error();
                    return;
                }
                const doc = results[1];
                const scripts = doc.querySelectorAll('script');
                const parts = doc.title.split(" - ")
                document.title = parts[0] + ' - ' + parts[1];
                const contentValue = results[0][0];
                const aesKeyValue = results[0][1];
                let iv = contentValue.substring(0, 16),
                    cipher = contentValue.substring(16),
                    content = JSON.parse(CryptoJS.AES.decrypt(
                        CryptoJS.enc.Base64.stringify(
                            CryptoJS.enc.Hex.parse(cipher)
                        ),
                        CryptoJS.enc.Utf8.parse(aesKeyValue),
                        {
                            'iv': CryptoJS.enc.Utf8.parse(iv),
                            'mode': CryptoJS.mode.CBC,
                            'padding': CryptoJS.pad.Pkcs7
                        }
                    ).toString(CryptoJS.enc.Utf8));
                return content;
            }

            // 加载图片
            async function loadImg() {
                if (getPictureMode) {
                    var content;
                    try {
                        content = await getImageNew();
                    } catch (error) {
                        if (error.stopFallback) throw error;
                        content = await getImageOld();
                    }
                } else {
                    content = await getImageOld();
                }
                const matrix = document.getElementById('matrix'),
                      size = Array.isArray(content) ? content.length : 0,
                      dict = {};
                if (!size) throw new Error('没有获取到漫画图片');
                for (let i = 0; i < size; i++) {
                    let img_url = content[i].url;
                    if (largeMode) img_url = img_url.replace('c800x.jpg', 'c1500x.jpg');
                    app.comic_data.push({
                        url: img_url
                    })
                }
                // TODO
                setTimeout(() => {
                    let $blank = $('.inner_img:eq(0)').clone();
                    $blank.addClass('blank');
                    $blank.css('filter', 'brightness(0) invert(1)');
                    $('#matrix').prepend($blank);
                }, 0);
            }

            loadImg().then(() => document.getElementById('loon-copy-status')?.remove())
                .catch(error => helpers.showError('图片加载失败：' + error.message));

            // 加载章节
            apiChapters(comic,isPC)
                .then(function (response) {
                    // var content = response.groups.default.chapters;
                    var content = Object.values(response.groups).flatMap(obj => obj.chapters);
                    content.forEach((i,index) => {
                        if (location.href.indexOf(i.id) >= 0) {
                            app.cur_ch = index;
                            GM_addStyle('.el-menu>li:nth-child(' + (index + 1) + '){background:rgba(255,165,0,.5) !important}');
                        }
                        app.sidebar_data.push({
                            title: i.name,
                            href: window.location.origin + (isPC ? '/comic/' + comic + '/chapter/' : '/h5/comicContent/' + comic + '/') + i.id
                        })
                    })
                })

                .catch(error => helpers.showError('章节目录加载失败：' + error.message));

            // 评论失败不影响阅读。
            app.load_comment().catch(() => {});

            //上下方向键滚动页面，左右方向键切换章节
            function scrollUp() {
                let img_list = document.querySelectorAll('.inner_img'),
                    first_img = img_list[app.skip ? 1 : 0],
                    last_img = img_list[img_list.length - 1];
                if (!first_img || !last_img || app.cur_id == 0) return;
                var id = img_list.length + 1;
                for (var i = (app.skip ? 1 : 0) + 1; i <= Math.min(app.cur_id, img_list.length); i++) {
                    if (((app.cur_lock && app.cur_id >= 1 && app.cur_id <= img_list.length) ? img_list[app.cur_id - 1].offsetTop : pageYOffset) < img_list[i - 1].offsetTop + img_list[i - 1].offsetHeight + 5) {
                        id = i;
                        break;
                    }
                }
                if (((app.cur_lock && app.cur_id >= 1 && app.cur_id <= img_list.length) ? img_list[app.cur_id - 1].offsetTop : pageYOffset) < first_img.offsetTop + 5) {
                    id = 0;
                }
                app.cur_lock++;
                app.cur_id = id;
                setTimeout(function () { app.cur_lock--; }, 500);
                // TODO
                $("html").stop();
                if (id == 0) {
                    $("html").animate({ scrollTop: 0 }, 500);
                } else {
                    $("html").animate({ scrollTop: img_list[id - 1].offsetTop }, 500);
                }
            }
            function scrollDown() {
                let img_list = document.querySelectorAll('.inner_img'),
                    first_img = img_list[app.skip ? 1 : 0],
                    last_img = img_list[img_list.length - 1];
                if (!first_img || !last_img || app.cur_id == img_list.length + 1) return;
                var id = img_list.length + 1;
                for (var i = Math.max(app.cur_id, (app.skip ? 1 : 0) + 1); i <= img_list.length; i++) {
                    if (((app.cur_lock && app.cur_id >= 1 && app.cur_id <= img_list.length) ? img_list[app.cur_id - 1].offsetTop : pageYOffset) < img_list[i - 1].offsetTop - 5) {
                        id = i;
                        break;
                    }
                }
                app.cur_lock++;
                app.cur_id = id;
                setTimeout(function () { app.cur_lock--; }, 500);
                // TODO
                $("html").stop();
                if (id == img_list.length + 1) {
                    $("html").animate({ scrollTop: last_img.offsetTop + last_img.offsetHeight }, 500);
                } else {
                    $("html").animate({ scrollTop: img_list[id - 1].offsetTop }, 500);
                }
            }
            // Dismiss menus in capture phase, before the manga's click-to-turn handler runs.
            // The first tap outside a menu closes it without also changing the reading position.
            document.addEventListener('click', function (event) {
                const target = event.target;
                if (!target || typeof target.closest !== 'function' || target.closest('#info, #sidebar, #loon-copy-edge')) return;
                const wasOpen = app.show || app.drawer;
                app.show = false;
                app.drawer = false;
                app.isClickable = false;
                if (wasOpen && target.closest('#matrix')) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }, true);
            document.getElementById('matrix').onclick = function (event) {
                if (event.clientY > $(window).height() / 2) {
                    if (app.page) scrollDown();
                } else {
                    if (app.page) scrollUp();
                }
            }
            document.body.onkeydown = function (event) {
                if (!app.is_input) {
                    if (app.scroll) {
                        switch(event.keyCode) {
                        case 38:
                            event.preventDefault()
                            app.prev_chapter();
                            break;
                        case 40:
                            event.preventDefault()
                            app.next_chapter();
                            break;
                        }
                    } else {
                        switch(event.keyCode) {
                        case 38:
                            if (app.page) scrollUp();
                            break;
                        case 40:
                            if (app.page) scrollDown();
                            break;
                        case 37:
                            app.prev_chapter();
                            break;
                        case 39:
                            app.next_chapter();
                            break;
                        }
                    }
                    if (event.keyCode == 13) {
                        app.switch_full();
                    } else if (event.keyCode == 8) {
                        app.switch_home();
                    }
                }
            }

            // 加载当前页码
            function getID() {
                const matrix = document.getElementById('matrix');
                if (!matrix) return;
                let cur_id = 0,
                    img_list = document.querySelectorAll('.inner_img'),
                    first_img = img_list[app.skip ? 1 : 0],
                    last_img = img_list[img_list.length - 1];
                if (img_list.length > 0) {
                    if (app.scroll) {
                        let progress = matrix.scrollLeft / (matrix.scrollWidth - matrix.clientWidth);
                        progress = Math.max(0, Math.min(1, Math.abs(progress)));
                        let referenceX = matrix.clientWidth - matrix.clientWidth * progress + matrix.offsetLeft;
                        referenceX = Math.round(referenceX);
                        for (let i = 0; i < img_list.length; i++) {
                            const imgOffsetLeft = Math.round(img_list[i].getBoundingClientRect().left);
                            const imgPosition = [imgOffsetLeft - 1, imgOffsetLeft + img_list[i].clientWidth +1];
                            if (imgPosition[1] > referenceX && referenceX > imgPosition[0]) {
                                cur_id = i + 1;
                                break;
                            }
                        }
                    } else {
                        for (let i = 0; i < img_list.length; i++) {
                            if (pageYOffset > img_list[i].offsetTop - 5 && pageYOffset < img_list[i].offsetTop + img_list[i].offsetHeight - 5 && cur_id == 0) {
                                cur_id = i + 1;
                                break;
                            }
                        }
                        if (pageYOffset > last_img.offsetTop + last_img.offsetHeight - 5)
                            cur_id = img_list.length + 1;
                    }
                    if (app.cur_lock == 0) app.cur_id = cur_id;
                }
            }
            setInterval(getID, 100);
            window.addEventListener('mousewheel', getID);
            window.addEventListener('error', event => {
                let target = event.target || event.srcElement;
                let isElementTarget = target instanceof HTMLImageElement;
                if (!isElementTarget) return false;
                target.dataset.loonRetries = String(Number(target.dataset.loonRetries || 0) + 1);
                if (Number(target.dataset.loonRetries) > 3) { target.alt = '图片加载失败，请重新加载'; return; }
                let url = target.src;
                setTimeout(() => {
                    target.src = url;
                }, Math.floor(Math.random() * 2000) + 1);
            }, true);
        }
    }
})();
