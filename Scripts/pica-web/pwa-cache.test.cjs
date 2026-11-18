const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cacheSource = fs.readFileSync(path.join(__dirname, 'pwa-cache.js'), 'utf8');
const updateSource = fs.readFileSync(path.join(__dirname, 'pwa-update.js'), 'utf8');
const workerUrl = 'https://manhuapica.com/sw.js';
const registerUrl = 'https://manhuapica.com/assets/js/virtual_pwa-register-fixture.js';
const registerEntry = '{url:"assets/js/virtual_pwa-register-fixture.js",revision:null}';
const contentEntry = '{url:"assets/js/feature-comics-fixture.js",revision:null}';
const worker = 'self.addEventListener("message",()=>"SKIP_WAITING");wb.precacheAndRoute([' +
    '{url:"index.html",revision:"fixture-html"},' + registerEntry +
    ',' + contentEntry + ',{url:"assets/js/index-fixture.js",revision:null}],{});wb.cleanupOutdatedCaches();';
// Synthetic registration fixture: both notifications share a callback as in the inspected build.
const registration = 'function registerSW(options){const{onNeedRefresh:n,onOfflineReady:r}=options;' +
    'const w=new Workbox("/sw.js");const notify=()=>n?.();w.addEventListener("waiting",notify);' +
    'w.addEventListener("installed",event=>{if(event.isExternal)notify();else r?.()});' +
    'return()=>w.messageSkipWaiting()}';
function run(source, request = {}, response) {
    const values = [];
    const context = { $request: { method: 'GET', url: workerUrl, ...request },
        $done: value => values.push(JSON.parse(JSON.stringify(value))) };
    if (response !== undefined) context.$response = { status: 200,
        headers: { 'Content-Type': 'application/javascript' }, body: worker, ...response };
    vm.runInNewContext(source, context, { timeout: 1000 });
    assert.equal(values.length, 1);
    return values[0];
}
test('conditional headers are removed only for targeted HTML, worker and module GET requests', () => {
    const headers = { 'If-None-Match': 'fixture', 'if-modified-since': 'fixture',
        'cache-control': 'max-age=9999', Pragma: 'fixture', Cookie: 'fixture=1',
        Authorization: 'fixture', Origin: 'https://manhuapica.com', Accept: '*/*' };
    for (const url of ['https://manhuapica.com/', 'https://manhuapica.com/index.html?__WB_REVISION__=fixture', workerUrl, workerUrl + '?fixture=1', registerUrl, 'https://manhuapica.com/assets/js/feature-comics-fixture.js']) {
        const result = run(cacheSource, { url, headers });
        assert.deepEqual(result.headers, { Cookie: 'fixture=1', Authorization: 'fixture',
            Origin: 'https://manhuapica.com', Accept: '*/*', 'Cache-Control': 'no-cache', Pragma: 'no-cache' });
    }
    assert.equal(headers['If-None-Match'], 'fixture');
    for (const method of ['POST', 'HEAD', 'OPTIONS']) assert.deepEqual(run(cacheSource, { method, headers }), {});
    for (const url of ['https://picaapi.go2778.com/users/profile', workerUrl + '/fixture',
        'https://manhuapica.com/assets/js/index-fixture.js',
        'https://manhuapica.com.evil.test/sw.js']) assert.deepEqual(run(cacheSource, { url, headers }), {});
});
test('only HTML and targeted module precache revisions change deterministically', () => {
    const result = run(cacheSource, {}, {});
    const revisedEntry = registerEntry.replace('revision:null', 'revision:"loon-pwa-quiet-20261117a-fixture"');
    const revisedContent = contentEntry.replace('revision:null', 'revision:"loon-pwa-quiet-20261116d-fixture"');
    assert.equal(result.body, worker.replace(registerEntry, revisedEntry).replace(contentEntry, revisedContent).replace('revision:"fixture-html"', 'revision:"loon-pwa-statusbar-20261117a-fixture-html"'));
    assert.deepEqual(run(cacheSource, {}, {}), result);
    assert.deepEqual(run(cacheSource, {}, { body: result.body }), {});
    assert.ok(!result.body.includes('Date.now'));
    assert.ok(!result.body.includes('caches.delete'));
    assert.ok(!result.body.includes('clients.claim'));
    assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('worker errors, unexpected builds, duplicate entries and already-revisioned entries pass through', () => {
    for (const status of [204, 304, 401, 404, 500]) assert.deepEqual(run(cacheSource, {}, { status }), {});
    for (const body of ['', '<html>error</html>', worker.replace('"SKIP_WAITING"', '"OTHER"'),
        worker.replace('.cleanupOutdatedCaches()', '.other()'), worker.replace(registerEntry, ''),
        worker.replace(registerEntry, registerEntry + ',' + registerEntry),
        worker.replace('revision:null}', 'revision:"server-revision"}')]) {
        assert.deepEqual(run(cacheSource, {}, { body }), {});
    }
    assert.deepEqual(run(cacheSource, {}, { headers: { 'Content-Type': 'text/html' } }), {});
    assert.deepEqual(run(cacheSource, { url: registerUrl }, { body: registration }), {});
});
test('worker body metadata is refreshed without changing unrelated headers', () => {
    const headers = { 'Content-Type': 'text/javascript', 'Content-Length': '1000',
        'Content-Encoding': 'br', ETag: 'fixture', 'Last-Modified': 'fixture',
        'Service-Worker-Allowed': '/', 'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'fixture=1' };
    const result = run(cacheSource, {}, { headers });
    assert.deepEqual(result.headers, { 'Content-Type': 'text/javascript', 'Service-Worker-Allowed': '/',
        'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'fixture=1', 'Cache-Control': 'no-store' });
    assert.equal(headers.ETag, 'fixture');
});
test('registration patch silences repeated waiting/external events while manual activation and offline callbacks survive', () => {
    const result = run(updateSource, { url: registerUrl }, { body: registration });
    assert.ok(result.body.startsWith(registration.replace('n?.()', 'void 0')));
    let wb;let prompts = 0;let offline = 0;let activation = 0;
    const elements = new Map();const styles = [];
    const context = {
        Workbox: function () { wb = this;this.handlers = {};this.addEventListener = (name, handler) => this.handlers[name] = handler;
            this.messageSkipWaiting = () => activation++; },
        document: { getElementById: id => elements.get(id), createElement: () => ({}),
            head: { appendChild: node => { styles.push(node);elements.set(node.id, node); } } }
    };
    vm.createContext(context);vm.runInContext(result.body, context);
    const update = context.registerSW({ onNeedRefresh: () => prompts++, onOfflineReady: () => offline++ });
    wb.handlers.waiting();wb.handlers.waiting();wb.handlers.installed({ isExternal: true });
    assert.equal(prompts, 0);assert.equal(activation, 0);
    wb.handlers.installed({ isExternal: false });assert.equal(offline, 1);
    update();assert.equal(activation, 1);
    vm.runInContext(result.body, context);
    assert.equal(styles.length, 1);
    assert.ok(styles[0].textContent.startsWith('.logged-in-home-container .slideshow-section,.chapter-navigation__ad{display:none!important}'));
    assert.ok(!styles[0].textContent.includes('.mobile-header'));
    assert.ok(!styles[0].textContent.includes('filter:'));
    assert.ok(!styles[0].textContent.includes('announcements-section'));
});
test('registration patch accepts identifier changes but rejects ambiguous or unknown notification code', () => {
    assert.equal(run(updateSource, { url: registerUrl }, { body: registration.replaceAll('onNeedRefresh:n', 'onNeedRefresh:$n').replace('n?.()', '$n?.()') }).status, 200);
    for (const body of [registration.replace('n?.()', 'n()'), registration + ';n?.();',
        registration.replace('messageSkipWaiting', 'otherMethod'), registration.replace('"/sw.js"', '"/other.js"')]) {
        assert.deepEqual(run(updateSource, { url: registerUrl }, { body }), {});
    }
    const result = run(updateSource, { url: registerUrl }, { body: registration });
    assert.deepEqual(run(updateSource, { url: registerUrl }, { body: result.body }), {});
});
test('request and response plugin routes call separate phases of the cache repair', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/Pica/Web.plugin'), 'utf8');
    const requests = plugin.split('\n').filter(line => line.startsWith('http-request '));
    assert.equal(requests.length, 1);
    const regex = new RegExp(requests[0].split(' ')[1]);
    assert.ok(regex.test(workerUrl));assert.ok(regex.test(registerUrl));
    assert.ok(regex.test('https://manhuapica.com/assets/js/feature-comics-fixture.js'));
    assert.ok(!regex.test('https://picaapi.go2778.com/comics/fixture'));
    assert.ok(new URL(/script-path=([^,]+)/.exec(requests[0])[1]).pathname.endsWith('/pwa-cache.js'));
    const values = [];
    vm.runInNewContext(cacheSource, { $done: value => values.push(JSON.stringify(value)) });
    assert.deepEqual(values, ['{}']);
});
