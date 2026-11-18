// PicaWeb: remove the announcement board using the captured first-page response.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done({});
    if ($request.method !== 'GET' ||
        !/^https:\/\/picaapi\.(?:go2778\.com|acbbb\.com)\/announcements(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});

    let result;
    try { result = JSON.parse($response.body); } catch (_) { return $done({}); }
    const page = result && result.code === 200 && result.data && result.data.announcements;
    if (!page || Number(page.page) !== 1 || !Array.isArray(page.docs) || page.docs.length === 0) return $done({});
    page.docs = [];
    page.total = 0;
    page.pages = 0;

    const headers = Object.assign({}, $response.headers || {});
    Object.keys(headers).forEach(key => {
        if (['content-type', 'content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body: JSON.stringify(result) });
})();
