// PicaWeb: silence only its known PWA refresh callback. Do not reload a reader.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done({});
    if ($request.method !== 'GET' ||
        !/^https:\/\/manhuapica\.com\/assets\/js\/(?:index|virtual_pwa-register)-[A-Za-z0-9_-]+\.js(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});

    const source = $response.body;
    const headers = Object.assign({}, $response.headers || {});
    const type = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!type || !/(?:javascript|ecmascript)/i.test(headers[type])) return $done({});

    let body;
    if (/\/virtual_pwa-register-/.test($request.url)) {
        // The old entry module can stay cached: silence both Workbox notification
        // paths at their shared callback in the small registration module instead.
        if (!source.includes('"/sw.js"') || !source.includes('messageSkipWaiting') ||
            !source.includes('addEventListener("waiting",') || !source.includes('onOfflineReady')) return $done({});
        const bindings = [...source.matchAll(/\bonNeedRefresh:([A-Za-z_$][\w$]*)(?=[,}])/g)];
        if (bindings.length !== 1) return $done({});
        const identifier = bindings[0][1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const notify = new RegExp('(^|[^\\w$])' + identifier + '\\?\\.\\(\\)', 'g');
        if ((source.match(notify) || []).length !== 1) return $done({});
        body = source.replace(notify, '$1void 0');
        // This module runs in the page even when the old entry stays precached.
        // Hide the entire home ad carousel, including its fixed-size loading state.
        body += '\n;(()=>{const id="loon-pica-web-home-clean";if(typeof document==="undefined"||document.getElementById(id))return;const style=document.createElement("style");style.id=id;style.textContent=".logged-in-home-container .slideshow-section,.chapter-navigation__ad{display:none!important}";(document.head||document.documentElement).appendChild(style)})();\n';
    } else {
        if (!source.includes('virtual_pwa-register-') || !source.includes('onOfflineReady')) return $done({});
        // Keep the entry-module fix for new installations. Unknown builds pass through.
        const callback = /onNeedRefresh\(\)\{confirm\([A-Za-z_$][\w$]*\.t\(["']common:pwa\.updateAvailable["']\)\)&&[A-Za-z_$][\w$]*\(!0\)\}/g;
        if ((source.match(callback) || []).length !== 1) return $done({});
        body = source.replace(callback, 'onNeedRefresh(){}');
    }
    Object.keys(headers).forEach(key => {
        if (['content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body });
})();
