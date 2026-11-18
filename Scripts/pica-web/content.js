// PicaWeb: remove synthetic ad rows/pages at their insertion and index-mapping sites.
(function () {
    if (typeof $request === 'undefined' || typeof $response === 'undefined' ||
        $request.method !== 'GET' ||
        !/^https:\/\/manhuapica\.com\/assets\/js\/feature-comics-[A-Za-z0-9_-]+\.js(?:\?[^#]*)?$/.test($request.url) ||
        Number($response.status || $response.statusCode) !== 200 ||
        typeof $response.body !== 'string') return $done({});
    const headers = Object.assign({}, $response.headers || {});
    const type = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!type || !/(?:javascript|ecmascript)/i.test(headers[type])) return $done({});
    let body = $response.body;
    if (!body.includes('comic-list-ad-list') || !body.includes('vw-ad-container') ||
        !body.includes('chapter-navigation__ad')) return $done({});

    // All sites must match once before changing anything. Unknown minified builds
    // pass through intact instead of mixing old ad indices with new page counts.
    const edits = [
        ['Oo=e=>{if(!e||e<=0)return 0;return e+Math.floor(e/20)}',
            'Oo=e=>{if(!e||e<=0)return 0;return e}'],
        ['Bo=e=>!(!e||e<=0)&&(e-1)%21==20', 'Bo=e=>!1'],
        ['return e-Math.floor((e-1)/21)', 'return e'],
        ['if(!((a+1)%21==0)){const e=a-Math.floor(a/21);t.push(e)}', 't.push(a)'],
        ['if((t+1)%21==0)return c?e.jsx("div",{className:"vw-ad-placeholder",style:{height:"440px",backgroundColor:"var(--background-secondary-color)",margin:"10px 0"}}):e.jsx("div",{className:"vw-ad-container",children:e.jsx(Us,{onlyAds:!0})});const d=t-Math.floor(t/21)',
            'const d=t'],
        ['l=(()=>{const e=s.totalImages;return e+Math.floor(e/20)})()', 'l=s.totalImages'],
        ['const a=20,s=t+Math.floor(t/a);', 'const s=t;'],
        ['if(!t||e>=t||e%20!=0)return;', 'return;'],
        ['Oi=(e,t,a)=>(e+1)%a===0&&e<t-1', 'Oi=()=>!1']
    ];
    if (edits.some(([from]) => body.split(from).length !== 2)) return $done({});
    edits.forEach(([from, to]) => { body = body.replace(from, to); });
    Object.keys(headers).forEach(key => {
        if (['content-length', 'content-encoding', 'transfer-encoding',
            'cache-control', 'etag', 'last-modified', 'expires'].includes(key.toLowerCase())) delete headers[key];
    });
    headers['Cache-Control'] = 'no-store';
    $done({ status: 200, headers, body });
})();
