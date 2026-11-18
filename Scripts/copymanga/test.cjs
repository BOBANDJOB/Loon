// SPDX-License-Identifier: GPL-3.0-or-later
// Run: node --test Scripts/copymanga/test.cjs (no dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const requestCode = fs.readFileSync(path.join(__dirname, 'request.js'), 'utf8');
const responseCode = fs.readFileSync(path.join(__dirname, 'response.js'), 'utf8');
const host = 'www.copymanga.com';
const origin = 'https://' + host;

test('image classification follows natural dimensions, ignores unknown sizes and leaves blank pages alone', () => {
    const start=responseCode.indexOf('function imageLayoutKind(');
    const end=responseCode.indexOf('async function loadCSS()',start);
    const context={};vm.runInNewContext(responseCode.slice(start,end),context);
    for(const [w,h,expected]of [[600,1000,'normal'],[200,4000,'long'],[1600,1000,'spread'],[0,1000,''],[1000,0,''],[NaN,100,''],[Infinity,100,'']])
        assert.equal(context.imageLayoutKind(w,h),expected);
    let value=null,writes=0;
    const image={naturalWidth:200,naturalHeight:4000,classList:{contains:()=>false},
        getAttribute:()=>value,setAttribute:(key,next)=>{assert.equal(key,'data-layout');value=next;writes++;}};
    context.classifyImage(image);assert.equal(value,'long');
    context.classifyImage(image);assert.equal(writes,1,'repeated load does not cause redundant layout writes');
    image.naturalWidth=1600;image.naturalHeight=1000;
    context.classifyImage(image);assert.equal(value,'spread','reused image element updates after a new load');
    image.classList.contains=()=>true;value=null;
    context.classifyImage(image);assert.equal(value,null,'synthetic blank never becomes a full-row strip');
});

function execute(code, request, response, replies = []) {
    const calls = [];
    const completions = [];
    const context = {
        $request: request, $response: response,
        $done: result => completions.push(JSON.parse(JSON.stringify(result))),
        $httpClient: Object.fromEntries(['get', 'post'].map(method => [method, (options, callback) => {
            calls.push({ method, options });
            const next = replies.shift() || { response: { status: 200, headers: { 'Content-Type': 'text/html' } }, data: 'raw' };
            callback(next.error, next.response, next.data);
        }]))
    };
    vm.runInNewContext(code, context, { timeout: 3000 });
    assert.equal(completions.length, 1, 'each Loon execution must finish exactly once');
    return { result: completions[0], calls };
}
function bridge(payload, overrides = {}, replies) {
    return execute(requestCode, {
        url: origin + '/__loon_copymanga__/fetch', method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: 'token=fixture; session=fixture' },
        body: JSON.stringify(payload), ...overrides
    }, undefined, replies);
}
function inject(url = origin + '/comic/book/chapter/first', overrides = {}, responseOverrides = {}) {
    return execute(responseCode, { url, method: 'GET', ...overrides }, {
        status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "script-src 'none'", ETag: 'old' },
        body: '<!doctype html><html><head><title>原站</title></head><body><script>originalSite()</script><div>原站</div></body></html>',
        ...responseOverrides
    }).result;
}

test('reader documents become a clean shell with a syntactically valid self-contained bootstrap', () => {
    for (const pathname of ['/comic/book/chapter/first', '/h5/comicContent/book/first']) {
        const result = inject(origin + pathname);
        assert.match(result.body, /loon-copymanga-bootstrap/);
        assert.doesNotMatch(result.body, /originalSite\(\)/);
        assert.match(result.body, /viewport-fit=cover/);
        assert.equal(result.headers['Cache-Control'], 'private, no-cache');
        assert.equal(result.headers['Content-Security-Policy'], undefined);
        assert.equal(result.headers.ETag, undefined);
        const scripts = [...result.body.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
        assert.equal(scripts.length, 1);
        new vm.Script(scripts[0][1]);
    }
});
test('home/details keep native content, remove document CSP, and never double-inject', () => {
    const original = '<html><head><meta http-equiv="Content-Security-Policy" content="script-src none"></head><body>native</body></html>';
    const once = inject(origin + '/comic/book', {}, { body: original });
    assert.match(once.body, />native</);
    assert.doesNotMatch(once.body, /<meta http-equiv="Content-Security-Policy"/);
    assert.deepEqual(inject(origin + '/comic/book', {}, { body: once.body }), {});
});
test('non-documents, non-GETs, other hosts, bad statuses and bridge data stay untouched', () => {
    for (const args of [
        [origin + '/api/v3/roasts'], ['https://example.com/comic/a/chapter/b'],
        [origin + '/comic/book', { method: 'POST' }],
        [origin + '/comic/book', {}, { status: 403 }],
        [origin + '/comic/book', {}, { headers: { 'Content-Type': 'application/json' } }],
        [origin + '/__loon_copymanga__/fetch'],
        ['https://api.mangacopy.com/comic/book']
    ]) assert.deepEqual(inject(...args), {});
});
test('the actual mangacopy mobile homepage keeps its native app and receives one bootstrap', () => {
    const result = inject('https://www.mangacopy.com/h5/index');
    assert.match(result.body, /originalSite\(\)/);
    assert.equal((result.body.match(/id="loon-copymanga-bootstrap"/g) || []).length, 1);
    assert.match(inject('https://www.mangacopy.com/h5/comicContent/book/first').body, /loon-copy-loading/);
});
test('conditional caching is cleared only for relevant HTML document requests', () => {
    const request = { url: origin + '/comic/book', method: 'GET', headers: {
        Accept: 'text/html', 'If-None-Match': 'old', 'If-Modified-Since': 'yesterday', Cookie: 'fixture'
    } };
    const result = execute(requestCode, request).result;
    assert.equal(result.headers['If-None-Match'], undefined);
    assert.equal(result.headers['If-Modified-Since'], undefined);
    assert.equal(result.headers.Cookie, 'fixture');
    assert.deepEqual(execute(requestCode, { ...request, url: origin + '/static/app.js' }).result, {});
});
test('same-host source fetch preserves dnts/cookies/desktop UA and returns raw HTML without reinjection', () => {
    const { result, calls } = bridge({ url: origin + '/comic/book', headers: { dnts: 'fixture', 'X-Unrelated': 'omit' } });
    assert.equal(calls[0].options.url, origin + '/comic/book');
    assert.equal(calls[0].options.headers.dnts, 'fixture');
    assert.match(calls[0].options.headers.Cookie, /token=fixture/);
    assert.match(calls[0].options.headers['User-Agent'], /Windows NT/);
    assert.equal(calls[0].options.headers['X-Unrelated'], undefined);
    assert.equal(calls[0].options['auto-redirect'], false);
    assert.equal(calls[0].options.insecure, false);
    assert.equal(JSON.parse(result.response.body).data, 'raw');
});
test('API calls carry allowed headers without leaking Safari cookies', () => {
    const { calls } = bridge({ url: 'https://api.2025copy.com/api/v3/comic/book/chapter/first', headers: { version: '2025.08.08', platform: '1', Authorization: 'omit' } });
    assert.equal(calls[0].options.headers.Cookie, undefined);
    assert.equal(calls[0].options.headers.Authorization, undefined);
    assert.equal(calls[0].options.headers.version, '2025.08.08');
    const post = bridge({ url: 'https://api.mangacopy.com/api/v3/member/roast', method: 'POST', data: 'roast=fixture', headers: { Authorization: 'Token fixture' } });
    assert.equal(post.calls[0].method, 'post');
    assert.equal(post.calls[0].options.body, 'roast=fixture');
    assert.equal(post.calls[0].options.headers.Authorization, 'Token fixture');
});
test('bridge rejects external/private URLs, unrelated APIs, traversal, writes and cross-origin calls', () => {
    for (const payload of [
        { url: 'http://127.0.0.1/' }, { url: 'https://example.com/comic/book' },
        { url: 'https://www.copymanga.com.evil.test/comic/book' },
        { url: 'https://www.copymanga.com@127.0.0.1/comic/book' },
        { url: origin + '/comic/../admin.js' }, { url: origin + '/comic/%2e%2e/admin.js' },
        { url: origin + '/__loon_copymanga__/fetch' },
        { url: 'https://api.mangacopy.com/api/v3/member/profile' },
        { url: origin + '/comic/book', method: 'POST', data: 'x' },
        { url: 'https://api.mangacopy.com/api/v3/member/roast', method: 'DELETE' }
    ]) {
        const { result, calls } = bridge(payload);
        assert.equal(result.response.status, 403);
        assert.equal(calls.length, 0);
    }
    assert.equal(bridge({ url: origin + '/comic/book' }, { headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' } }).result.response.status, 403);
    assert.equal(bridge({}, { body: 'malformed' }).result.response.status, 400);
    assert.equal(bridge({}, { method: 'GET' }).result.response.status, 405);
});
test('upstream redirects cannot escape the allowed scope or run forever', () => {
    const redirect = location => ({ response: { status: 302, headers: { Location: location } }, data: '' });
    const escaped = bridge({ url: origin + '/comic/book' }, {}, [redirect('https://127.0.0.1/')]);
    assert.equal(escaped.result.response.status, 502);
    assert.equal(escaped.calls.length, 1);
    const followed = bridge({ url: origin + '/comic/book' }, {}, [redirect('/comic/book/chapter/first')]);
    assert.equal(followed.calls.length, 2);
    assert.equal(JSON.parse(followed.result.response.body).data, 'raw');
    const loop = bridge({ url: origin + '/comic/book' }, {}, Array(3).fill(redirect('/comic/book')));
    assert.equal(loop.calls.length, 3);
    assert.equal(loop.result.response.status, 502);
});
test('network errors and non-2xx upstream statuses are reported to the reader', () => {
    assert.equal(bridge({ url: origin + '/comic/book' }, {}, [{ error: 'timeout' }]).result.response.status, 502);
    const result = bridge({ url: origin + '/comic/book' }, {}, [{ response: { status: 403, headers: {} }, data: 'denied' }]).result;
    assert.equal(JSON.parse(result.response.body).status, 403);
});
test('every plugin script URL resolves to a local source and regexes distinguish documents and bridge', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/CopyMangaHelper.lpx'), 'utf8');
    const rules = plugin.split('\n').filter(line => /^http-/.test(line));
    assert.equal(rules.length, 4);
    for (const line of rules) {
        const relative = /script-path=https:\/\/raw.githubusercontent.com\/BOBANDJOB\/Loon\/main\/([^,]+)/.exec(line)[1];
        assert.ok(fs.existsSync(path.join(__dirname, '../..', relative.split('?')[0])));
        const pattern = new RegExp(line.split(' ')[1]);
        assert.equal(pattern.test('https://evil.test/comic/book'), false);
        assert.equal(pattern.test(origin + '/static/image.jpg'), false);
        assert.equal(pattern.test(origin + '/api/v3/roasts'), false);
        assert.equal(pattern.test(origin + '/comic/book'), line.includes('页面缓存处理') || line.includes('阅读器注入'));
        assert.equal(pattern.test(origin + '/__loon_copymanga__/fetch'), line.includes('timeout=30'));
        assert.equal(pattern.test(origin + '/__loon_copymanga__/manifest.webmanifest'), line.includes('Web App 清单'));
    }
});

test('Web App manifest is same-origin, root scoped, stable, and never uses the request bridge', () => {
    for (const currentHost of ['www.mangacopy.com', 'mangacopy.com', 'www.copymanga.com']) {
        const request = { url:'https://' + currentHost + '/__loon_copymanga__/manifest.webmanifest', method:'GET', headers:{} };
        const {result,calls} = execute(requestCode, request);
        assert.equal(calls.length,0);
        assert.equal(result.response.status,200);
        assert.match(result.response.headers['Content-Type'],/^application\/manifest\+json/);
        const manifest=JSON.parse(result.response.body);
        assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');
        assert.equal(manifest.start_url,'/h5/index');
        assert.equal(new URL(manifest.start_url,request.url).origin,'https://'+currentHost);
        assert.equal(execute(requestCode,request).result.response.body,result.response.body);
        assert.deepEqual(execute(requestCode,{...request,method:'POST'}).result,{});
    }
});

test('native home receives one manifest before original scripts, reader rebuilding retains it', () => {
    const original='<html><head><link rel="manifest" href="/old.json"><meta name="apple-mobile-web-app-capable" content="no"><script>native()</script></head><body>native</body></html>';
    const home=inject(origin+'/h5/index',{}, {body:original}).body;
    assert.equal((home.match(/<link\b[^>]*rel="manifest"[^>]*>/g)||[]).length,1);
    assert.ok(home.indexOf('manifest.webmanifest')<home.indexOf('native()'));
    assert.doesNotMatch(home,/old\.json|capable" content="no/);
    assert.match(inject().body,/rel="manifest" href="\/__loon_copymanga__\/manifest\.webmanifest"/);
});

test('announcement rewrite has one Loon owner and preserves exact GET/200 conditions', () => {
    const plugin=fs.readFileSync(path.join(__dirname,'../../Plugins/CopyMangaHelper.lpx'),'utf8');
    const general=fs.readFileSync(path.join(__dirname,'../../Plugins/my-plugin.plugin'),'utf8');
    assert.match(plugin,/request\.method\} == "GET"/);
    assert.match(plugin,/response\.status\} == 200 && \$\{request\.header\['User-Agent'\]\} ~=/);
    assert.match(plugin,/hostname = api\.copy4000\.com,/);
    assert.equal((plugin.match(/then response\.json\.replace\("results\.code", ""\)/g)||[]).length,1);
    assert.doesNotMatch(general,/copy4000|results\.code/);
});

function navigationFixture({router=true,pathname='/h5/details/comic/book'}={}) {
    const begin=responseCode.indexOf('    function browserNavigation() {');
    const finish=responseCode.indexOf('\n    function reader(',begin);
    assert.ok(begin>0 && finish>begin);
    let current=new URL(origin+pathname);
    const navigations=[],listeners={},guards=[],observers=[];
    const nativeRouter={beforeEach:guard=>guards.push(guard),resolve:to=>({href:to.href})};
    const root={__vue__:{$router:router?nativeRouter:null}};
    const location={get href(){return current.href;},get pathname(){return current.pathname;},get origin(){return current.origin;},
        assign:url=>navigations.push(['assign',url]),replace:url=>navigations.push(['replace',url])};
    const context={URL,location,window:{addEventListener:(name,callback)=>{listeners[name]=callback;}},
        document:{getElementById:()=>root,addEventListener:(name,callback)=>{listeners[name]=callback;}},
        MutationObserver:class {constructor(callback){this.callback=callback;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}};
    const nav=vm.runInNewContext('('+responseCode.slice(begin,finish).trim()+')()',context);
    return {nav,navigations,listeners,guards,observers,root,nativeRouter,setURL:path=>{current=new URL(path,origin);}};
}

test('native chapter transition aborts before history commit and preserves a clean Back entry', () => {
    const f=navigationFixture();assert.equal(f.guards.length,1);
    let commits=0,rendered='/h5/details/comic/book';
    f.guards[0]({href:'/h5/comicContent/book/first'},null,allowed=>{if(allowed!==false){commits++;rendered='/h5/comicContent/book/first';}});
    assert.equal(commits,0);assert.equal(rendered,'/h5/details/comic/book');
    assert.deepEqual(f.navigations,[['assign',origin+'/h5/comicContent/book/first']]);
    f.listeners.pageshow({persisted:true});
    assert.equal(f.navigations.length,1,'Back to unmodified details must not reload or re-enter reader');
    let allowed=false;f.guards[0]({href:'/h5/index'},null,value=>{allowed=value!==false;});assert.equal(allowed,true);
    f.guards[0]({href:'/h5/comicContent/book/second'},null,()=>{});
    assert.equal(f.navigations.length,2,'the restored details page remains usable');
});

test('late Vue mount installs one guard; unknown-SPA BFCache repair reloads only the return entry', () => {
    const f=navigationFixture({router:false});assert.equal(f.observers.length,1);
    f.root.__vue__.$router=f.nativeRouter;f.observers[0].callback();f.observers[0].callback();
    assert.equal(f.guards.length,1);assert.equal(f.observers[0].disconnected,true);
    const unknown=navigationFixture({router:false});
    unknown.setURL('/h5/details/comic/another?tab=chapters');unknown.nav.remember();
    unknown.setURL('/h5/comicContent/another/first');unknown.nav.enter(origin+'/h5/comicContent/another/first',true);
    unknown.setURL('/h5/details/comic/another?tab=chapters');unknown.listeners.pageshow({persisted:true});
    assert.deepEqual(unknown.navigations[1],['replace',origin+'/h5/details/comic/another?tab=chapters']);
    unknown.listeners.pageshow({persisted:true});assert.equal(unknown.navigations.length,2);
    const stale=navigationFixture({router:false});stale.setURL('/h5/comicContent/book/first');stale.nav.enter(origin+'/h5/comicContent/book/first',true);
    stale.listeners.pageshow({persisted:true});assert.equal(stale.navigations.at(-1)[1],origin+'/h5/details/comic/book');
});

test('navigation interception preserves external links, modifier keys, downloads and native non-reader routes', () => {
    for (const overrides of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{button:1},{defaultPrevented:true},{target:'_blank'},{download:true},{href:'https://evil.test/h5/comicContent/book/first'},{href:'/h5/index'}]) {
        const f=navigationFixture();let prevented=false;
        const link={href:overrides.href||origin+'/h5/comicContent/book/first',target:overrides.target||'',hasAttribute:()=>!!overrides.download};
        f.listeners.click({button:0,...overrides,target:{closest:()=>link},preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{}});
        assert.equal(prevented,false);assert.equal(f.navigations.length,0);
    }
    const f=navigationFixture();let stopped=false;
    f.listeners.click({button:0,target:{closest:()=>({href:origin+'/h5/comicContent/book/first',target:'',hasAttribute:()=>false})},preventDefault(){},stopImmediatePropagation(){stopped=true;}});
    assert.equal(stopped,true);assert.equal(f.navigations[0][0],'assign');
    const direct=navigationFixture({pathname:'/h5/comicContent/book/first'});assert.equal(direct.nav.nativeDocument,false);assert.equal(direct.guards.length,0);assert.equal(Object.keys(direct.listeners).length,0);
});

test('coarse-pointer controls anchor to the stable small viewport and menus remain bounded', () => {
    assert.match(responseCode,/@supports \(height:100svh\)/);
    assert.match(responseCode,/#info \{ top:calc\(100svh - env\(safe-area-inset-bottom\) - 10px\);bottom:auto;transform:translateY\(-100%\)/);
    assert.match(responseCode,/#info-options \{ max-height:calc\(100svh[^}]+overflow-y:auto/);
});

test('reader and public native documents permit private page caching without duplicate policy headers', () => {
    for (const pathname of ['/h5/index','/h5/details/comic/book','/h5/comicContent/book/first','/comic/book/chapter/first']) {
        for (const headers of [
            {'Content-Type':'text/html'},
            {'Content-Type':'text/html','cache-control':'public,max-age=3600'},
            {'Content-Type':'text/html','Cache-Control':'no-cache'}
        ]) {
            const original={...headers};const result=inject(origin+pathname,{}, {headers});
            assert.deepEqual(headers,original);
            const keys=Object.keys(result.headers).filter(k=>k.toLowerCase()==='cache-control');
            assert.deepEqual(keys,['Cache-Control']);
            assert.equal(result.headers['Cache-Control'],'private, no-cache');
        }
    }
    const headers={'Content-Type':'text/html','cache-control':'private, no-store','Set-Cookie':'fixture=1'};
    const detail=inject(origin+'/h5/details/comic/book',{}, {headers});
    assert.equal(detail.headers['Cache-Control'],'private, no-store','respect native account-page policy');
    assert.equal(detail.headers['Set-Cookie'],'fixture=1');
    const reader=inject(origin+'/h5/comicContent/book/first',{}, {headers});
    assert.equal(reader.headers['Cache-Control'],'private, no-cache','synthetic reader shell has its own policy');
    assert.doesNotMatch(reader.body,/originalSite\(\)/);
});

test('collapsed counter has content-sized width, centered digits and a usable touch target', () => {
    const counter=responseCode.match(/#info_count \{[^}]*\}/)[0];
    for (const declaration of ['display:flex','align-items:center','justify-content:center','width:auto','min-width:64px','padding:0 10px','line-height:1']) {
        assert.ok(counter.includes(declaration),declaration);
    }
    assert.match(responseCode,/#info \{[^}]*padding:0;display:flex;flex-direction:column/);
    assert.match(responseCode,/#info_count \{ min-height:44px; \}/);
});

test('template styles cannot override the stable anchor or constrain its height', () => {
    const templateStyle=responseCode.match(/<style>([\s\S]*?)<\/style>/)[1];
    const info=templateStyle.match(/#info \{([^}]+)\}/)[1].replace(/\/\*[\s\S]*?\*\//g,'');
    assert.doesNotMatch(info,/(?:^|;)\s*(?:top|bottom|left|right|padding|height|transform)\s*:/);
    assert.match(info,/position:\s*fixed/);
    assert.match(responseCode,/#info \{ top:calc\(100svh[^}]+bottom:auto;/);
});

test('narrower chapter sidebar keeps left-aligned full wrapped titles', () => {
    assert.match(responseCode,/width:\s*clamp\(132px, 36vw, 184px\)/);
    assert.match(responseCode,/#sidebar \.el-menu \{[^}]*text-align:\s*left/);
    assert.match(responseCode,/#sidebar \.el-menu-item \{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere/);
});

test('native standalone header gets a small opaque edge without changing its dimensions', () => {
    const original='<html><head><script>native()</script></head><body><main id="indexV2"><div class="indexTitle">native header</div></main></body></html>';
    const home=inject(origin+'/h5/index',{}, {body:original}).body;
    const style=home.match(/<style id="loon-copy-native-app-chrome">([^<]+)<\/style>/)[1];
    assert.match(style,/@media \(display-mode:standalone\)/);
    assert.match(style,/#indexV2>\.indexTitle,#discover>\.indexTitle,\.seekPopup>form,\.login>\.van-sticky\{/);
    assert.match(style,/position:sticky;top:0;z-index:20;background-color:#fff/);
    assert.doesNotMatch(style,/height|padding|margin|transform|filter|safe-area|!important/);
    assert.ok(home.indexOf('loon-copy-native-app-chrome')<home.indexOf('native()'));
    assert.match(home,/<div class="indexTitle">native header<\/div>/);
    assert.doesNotMatch(inject().body,/loon-copy-native-app-chrome/);
    assert.deepEqual(inject(origin+'/h5/index',{}, {body:home}),{});
});

const desktopAgents=[
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/27.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/143.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Mozilla/5.0 (X11; Linux x86_64)', 'Mozilla/5.0 (X11; CrOS aarch64)'
];
const mobileAgents=[
    'Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_1 like Mac OS X) Mobile/15E148',
    'Mozilla/5.0 (iPad; CPU OS 27_2 like Mac OS X) Mobile/15E148',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148',
    'Mozilla/5.0 (Linux; Android 15) Mobile', 'COPY/3.0.6', ''
];
test('desktop browser documents, validator handling, manifest and bridge are all untouched', () => {
    for(const agent of desktopAgents) for(const key of ['User-Agent','user-agent','USER-AGENT']) {
        const headers={[key]:agent,Accept:'text/html','If-None-Match':'fixture'};
        for(const pathname of ['/h5/index','/comic/book','/comic/book/chapter/first','/h5/comicContent/book/first']) {
            assert.deepEqual(inject(origin+pathname,{headers}),{});
            assert.deepEqual(execute(requestCode,{url:origin+pathname,method:'GET',headers}).result,{});
        }
        assert.deepEqual(execute(requestCode,{url:origin+'/__loon_copymanga__/manifest.webmanifest',method:'GET',headers}).result,{});
        const raw=bridge({url:origin+'/comic/book'},{headers:{...headers,Origin:origin,'Content-Type':'application/json'}});
        assert.deepEqual(raw.result,{});assert.equal(raw.calls.length,0);
    }
});
test('mobile requests retain reading and bridge behavior; outgoing desktop UA does not disable injection', () => {
    for(const agent of mobileAgents) {
        const headers={'User-Agent':agent};
        assert.match(inject(origin+'/h5/comicContent/book/first',{headers}).body,/loon-copymanga-bootstrap/);
        const result=bridge({url:origin+'/comic/book'},{headers:{...headers,Origin:origin,'Content-Type':'application/json'}});
        assert.equal(result.calls.length,1);assert.match(result.calls[0].options.headers['User-Agent'],/Windows NT/);
    }
});
test('native announcement UA condition agrees with the JavaScript desktop guards', () => {
    const plugin=fs.readFileSync(path.join(__dirname,'../../Plugins/CopyMangaHelper.lpx'),'utf8');
    const expression=plugin.match(/request\.header\['User-Agent'\]\} ~= \/(.+)\/i then response\.json/)[1];
    const allowed=new RegExp(expression,'i');
    for(const agent of desktopAgents) assert.equal(allowed.test(agent),false);
    for(const agent of mobileAgents) assert.equal(allowed.test(agent),true);
});

test('bridge failure is attempted once and redirect requests share a finite budget', () => {
    const failed=bridge({url:origin+'/comic/book'}, {}, [{error:'timeout'}]);
    assert.equal(failed.calls.length,1);
    assert.equal(failed.result.response.status,502);
    assert.ok(failed.calls[0].options.timeout>0 && failed.calls[0].options.timeout<=24000);
    const redirected=bridge({url:origin+'/comic/book'}, {}, [{response:{status:302,headers:{location:'/comic/book/chapter/first'}}}]);
    assert.equal(redirected.calls.length,2);
    assert.ok(redirected.calls[1].options.timeout<=redirected.calls[0].options.timeout);
});

test('browser bridge stops timeout, network, HTTP and business restrictions without replay', async () => {
    const start=responseCode.indexOf('axios.defaults.adapter = async config => {');
    const end=responseCode.indexOf('\n            libs.axios = axios;',start);
    for(const scenario of ['timeout','network','502','210','403','ok']) {
        let calls=0;
        class AxiosError extends Error {constructor(message,code,config,request,response){super(message);Object.assign(this,{code,config,response});}}
        const ctx={axios:{defaults:{}},nativeAxios:{getUri:c=>c.url,AxiosError},defaultAdapter:null,
            URL,AbortController,setTimeout,clearTimeout,location:{href:origin+'/',origin},BRIDGE:'/bridge',
            fetch:async()=>{calls++;if(['timeout','network'].includes(scenario)) throw new Error(scenario);
                return {ok:scenario!=='502',status:scenario==='502'?502:200,json:async()=>({status:scenario==='ok'?200:Number(scenario),data:'body',contentType:'text/html'})};}};
        vm.runInNewContext(responseCode.slice(start,end),ctx);
        const action=ctx.axios.defaults.adapter({url:origin+'/comic/book',validateStatus:s=>s>=200&&s<300});
        if(scenario==='ok') assert.equal((await action).data,'body');
        else await assert.rejects(action,e=>e.stopFallback===true);
        assert.equal(calls,1);
    }
    assert.doesNotMatch(responseCode,/axios\.interceptors\.response\.use/);
});

test('image fallback only follows parse failure, not a failed network request', async () => {
    const start=responseCode.indexOf('async function loadImg() {');
    const end=responseCode.indexOf('\n            loadImg().then',start);
    for(const stop of [true,false]) {
        let oldCalls=0;
        const error=Object.assign(new Error('fixture'),{stopFallback:stop});
        const ctx={getPictureMode:1,getImageNew:async()=>{throw error;},getImageOld:async()=>{oldCalls++;return [{url:'image'}];},
            document:{getElementById:()=>({})},largeMode:0,app:{comic_data:[]},setTimeout:()=>{}};
        vm.runInNewContext(responseCode.slice(start,end),ctx);
        if(stop) await assert.rejects(ctx.loadImg(),e=>e===error);else await ctx.loadImg();
        assert.equal(oldCalls,stop?0:1);
    }
});

test('HTTP 200 carrying business code 210 cannot trigger an API fallback', async () => {
    const start=responseCode.indexOf('async function makeRequest(options) {');
    const end=responseCode.indexOf('\n        async function getAesName',start);
    const ctx={axios:{get:async()=>({data:{code:210}})}};
    vm.runInNewContext(responseCode.slice(start,end),ctx);
    await assert.rejects(ctx.makeRequest({url:'fixture'}),e=>e.stopFallback===true);
});
