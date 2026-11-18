// PicaWeb ad-zone response cleanup, BOBANDJOB, 2026-11-16.
// Empty zones are accepted by the observed web client as a successful result.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done({});
    if ($request.method !== 'GET' ||
        !/^https:\/\/pica-ad-api\.diwodiwo\.xyz\/get-ad-zones(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});

    let result;
    try { result = JSON.parse($response.body); } catch (_) { return $done({}); }
    const zones = result && result.code === 200 && result.data && result.data.zones;
    if (!Array.isArray(zones) || zones.length === 0) return $done({});

    result.data.zones = [];
    const headers = Object.assign({}, $response.headers || {});
    Object.keys(headers).forEach(key => {
        if (['content-type', 'content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    // Retain CORS and other unrelated headers for the cross-origin web client.
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body: JSON.stringify(result) });
})();
