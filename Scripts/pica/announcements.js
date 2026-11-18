// Pica first-page announcement suppression, BOBANDJOB, 2026-11-16.
// The startup popup and announcement list share this exact endpoint.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done({});
    if ($request.method !== 'GET' || $request.url !== 'https://api.tipatipa.xyz/announcements?page=1' ||
        Number($response.status || $response.statusCode) !== 200 || typeof $response.body !== 'string') return $done({});

    let result;
    try { result = JSON.parse($response.body); } catch (_) { return $done({}); }
    const announcements = result && result.code === 200 && result.data && result.data.announcements;
    if (!announcements || !Array.isArray(announcements.docs) ||
        String(announcements.page) !== '1' || announcements.docs.length === 0) return $done({});

    announcements.docs = [];
    announcements.total = 0;
    announcements.pages = 0;
    const headers = Object.assign({}, $response.headers || {});
    Object.keys(headers).forEach(key => {
        if (['content-type', 'content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body: JSON.stringify(result) });
})();
