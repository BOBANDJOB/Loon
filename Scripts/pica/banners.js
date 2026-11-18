// Pica /banners error fallback, BOBANDJOB, 2026-11-16.
// Only the exact JSON parser failure captured in the user's HAR is replaced.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined') return $done({});
    if ($request.method !== 'GET' || $request.url !== 'https://api.tipatipa.xyz/banners' ||
        Number($response.status || $response.statusCode) !== 500 || typeof $response.body !== 'string') return $done({});

    let original;
    try { original = JSON.parse($response.body); } catch (_) { return $done({}); }
    if (!original || original.code !== 500 || original.error !== 'Unexpected token < in JSON at position 0') return $done({});

    const headers = Object.assign({}, $response.headers || {});
    Object.keys(headers).forEach(key => {
        if (['content-type', 'content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Content-Type'] = 'application/json; charset=utf-8';
    headers['Cache-Control'] = 'no-store';
    $done({
        status: 200,
        headers,
        body: JSON.stringify({ code: 200, message: 'success', data: { banners: [] } })
    });
})();
