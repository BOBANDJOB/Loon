// Refresh patched HTML/registration/content without clearing account data.
(function () {
    if (typeof $request === 'undefined' || $request.method !== 'GET' ||
        !/^https:\/\/manhuapica\.com\/(?:sw\.js|index\.html|assets\/js\/(?:virtual_pwa-register|feature-comics)-[A-Za-z0-9_-]+\.js)?(?:\?[^#]*)?$/.test($request.url)) return $done({});

    if (typeof $response === 'undefined') {
        // A 304 has no script body to modify. Preserve auth/cookies and other headers.
        const headers = Object.assign({}, $request.headers || {});
        Object.keys(headers).forEach(key => {
            if (['if-none-match', 'if-modified-since', 'cache-control', 'pragma'].includes(key.toLowerCase())) delete headers[key];
        });
        headers['Cache-Control'] = 'no-cache';
        headers.Pragma = 'no-cache';
        return $done({ headers });
    }

    if (!/^https:\/\/manhuapica\.com\/sw\.js(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});
    const source = $response.body;
    const headers = Object.assign({}, $response.headers || {});
    const type = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!type || !/(?:javascript|ecmascript)/i.test(headers[type]) ||
        !source.includes('.precacheAndRoute([') || !source.includes('"SKIP_WAITING"') ||
        !source.includes('.cleanupOutdatedCaches()')) return $done({});

    const entry = /\{url:"assets\/js\/(virtual_pwa-register|feature-comics)-([A-Za-z0-9_-]+)\.js",revision:null\}/g;
    const entries = [...source.matchAll(entry)];
    const htmlEntry = /\{url:"index\.html",revision:"([A-Za-z0-9_-]+)"\}/g;
    const htmlEntries = [...source.matchAll(htmlEntry)];
    if (entries.length !== 2 || entries.filter(m => m[1] === 'virtual_pwa-register').length !== 1 ||
        entries.filter(m => m[1] === 'feature-comics').length !== 1 || htmlEntries.length !== 1) return $done({});
    // Deterministic revision = patch version + original asset hash. Never use time or
    // randomness: that would manufacture a new worker on every update check.
    const body = source.replace(entry, (_, name, hash) => {
        // Re-fetch HTML metadata and remove the previous registration CSS height
        // compensation. Keep the large comic module's validated revision.
        const version = name === 'virtual_pwa-register' ? '20261117a' : '20261116d';
        return '{url:"assets/js/' + name + '-' + hash + '.js",revision:"loon-pwa-quiet-' + version + '-' + hash + '"}';
    }).replace(htmlEntry, (_, hash) =>
        '{url:"index.html",revision:"loon-pwa-statusbar-20261117a-' + hash + '"}');
    Object.keys(headers).forEach(key => {
        if (['content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body });
})();
