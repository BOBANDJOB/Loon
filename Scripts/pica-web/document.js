// PicaWeb: use the system's default standalone status bar instead of the
// deprecated black-translucent mode. Preserve the rest of the document exactly.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined' ||
        $request.method !== 'GET' ||
        !/^https:\/\/manhuapica\.com\/(?:index\.html)?(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});
    const source = $response.body;
    const headers = Object.assign({}, $response.headers || {});
    const type = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!type || !/text\/html/i.test(headers[type]) || !source.includes('PicaWeb') ||
        !source.includes('/manifest.json') || !source.includes('apple-mobile-web-app-capable')) return $done({});
    const tags = (source.match(/<meta\b[^>]*>/gi) || []).filter(tag =>
        /\sname\s*=\s*(["'])apple-mobile-web-app-status-bar-style\1/i.test(tag));
    if (tags.length !== 1 || !/\scontent\s*=\s*(["'])black-translucent\1/i.test(tags[0])) return $done({});
    const body = source.replace(tags[0], '');
    Object.keys(headers).forEach(key => {
        if (['content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body });
})();
