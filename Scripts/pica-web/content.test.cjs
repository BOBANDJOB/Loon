const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/content-original.js'), 'utf8');
const url = 'https://manhuapica.com/assets/js/feature-comics-fixture.js';
const clone = value => JSON.parse(JSON.stringify(value));
function run(request = {}, response = {}) {
    const values = [];
    vm.runInNewContext(source, { $request: { method: 'GET', url, ...request },
        $response: { status: 200, statusCode: 200, headers: { 'Content-Type': 'application/javascript' },
            body: fixture, ...response }, $done: value => values.push(clone(value)) }, { timeout: 1000 });
    assert.equal(values.length, 1);return values[0];
}
function model(body) {
    const context = {};vm.runInNewContext(body, context, { timeout: 1000 });return context.model;
}
function patched() { const result = run();assert.ok(result.body);return model(result.body); }
test('single reader counts and maps only real pages at every former advertisement boundary', () => {
    const m = patched();
    for (const total of [1, 19, 20, 21, 39, 40, 41, 72, 95, 500]) {
        assert.equal(m.Oo(total), total);
        for (let p = 1; p <= total; p++) {
            assert.equal(m.Bo(p), false);assert.equal(m.Uo(p), p);
            assert.equal(m.Wo(p, total).type, 'comic');assert.equal(m.Wo(p, total).actualPage, p);
        }
        assert.equal(m.Wo(total + 1, total).type, 'invalid');
    }
    assert.equal(m.Oo(0), 0);assert.equal(m.Uo(0), null);
});
test('waterfall item count, viewport range and jump indices agree without zero-height ad rows', () => {
    const m = patched();
    for (const n of [20, 21, 40, 41, 72, 95]) {
        assert.equal(m.total(n), n);
        for (let i = 0; i < n; i++) {
            assert.deepEqual(clone(m.render(i)), { type: 'image', page: i + 1 });
            assert.equal(m.jump(i), i);
        }
    }
    assert.deepEqual(clone(m.range({ startIndex: 18, endIndex: 43 })), Array.from({ length: 26 }, (_, i) => i + 18));
});
test('dual reader keeps all image ordering and chapter navigation across complete/partial loads', () => {
    const original = model(fixture),m = patched();
    const images = items => items.flatMap(item => [item.leftPage, item.rightPage].filter(Boolean).map(p => p.pageNumber));
    for (const n of [1, 19, 20, 21, 39, 40, 41, 72, 95]) for (const initialSingles of [0, 1, 2]) {
        const pages = Array.from({ length: n }, (_, i) => ({ pageNumber: i + 1 }));
        for (const partial of [false, true]) {
            const options = { pages, totalPages: partial ? n + 10 : n, hasMore: partial, initialSingles };
            const before = original.Mi(options),after = m.Mi(options);
            assert.ok(after.every(item => item.type !== 'ad'));
            assert.deepEqual(clone(images(after)), clone(images(before)));
            assert.equal(after.filter(item => item.type === 'navigation').length, partial ? 0 : 1);
            if (!partial) assert.deepEqual(clone(images(after)), pages.map(p => p.pageNumber));
        }
    }
});
test('favorites/list/grid ad insertion stops without losing or reordering comic cards', () => {
    const m = patched();
    for (const n of [0, 1, 20, 21, 41, 95]) for (const interval of [8, 12, 16, 20]) {
        assert.deepEqual(clone(m.cards(n, interval)), Array.from({ length: n }, (_, id) => ({ type: 'comic', id })));
    }
});
test('all-or-nothing guards preserve unknown builds, other hosts, statuses and image errors', () => {
    for (const method of ['POST', 'HEAD', 'OPTIONS']) assert.deepEqual(run({ method }), {});
    for (const status of [204, 304, 401, 404, 500]) assert.deepEqual(run({}, { status, statusCode: status }), {});
    for (const other of ['https://manhuapica.com/sw.js', 'https://manhuapica.com/assets/js/index-fixture.js',
        'https://manhuapica.com.evil.test/assets/js/feature-comics-fixture.js']) assert.deepEqual(run({ url: other }), {});
    assert.deepEqual(run({}, { headers: { 'Content-Type': 'text/html' } }), {});
    assert.deepEqual(run({}, { body: fixture.replace('(e-1)%21==20', '(e-1)%22==20') }), {});
    assert.deepEqual(run({}, { body: fixture + ';const duplicate=()=>{return e-Math.floor((e-1)/21)};' }), {});
    const imageError = ';const unchanged="page-error vw-image-loading-placeholder chapter-navigation__btn";';
    assert.ok(run({}, { body: fixture + imageError }).body.endsWith(imageError));
});
test('rewrites are idempotent and preserve CORS/cookies without changing caller objects', () => {
    const headers = { 'Content-Type': 'application/javascript', 'Content-Length': '100',
        'Content-Encoding': 'br', ETag: 'fixture', 'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'fixture=1' };
    const original = { ...headers };const result = run({}, { headers });
    assert.deepEqual(headers, original);assert.equal(result.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(result.headers['Set-Cookie'], 'fixture=1');assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.ok(!('ETag' in result.headers));assert.deepEqual(run({}, { body: result.body }), {});
    const values = [];vm.runInNewContext(source, { $done: value => values.push(clone(value)) });assert.deepEqual(values, [{}]);
});
test('the content module route is distinct from registration/entry response routes', () => {
    const root = path.resolve(__dirname, '../..');
    const loon = path.join(root, 'Plugins/Pica/Web.plugin');
    const qx = path.join(root, 'Rewrites/Pica/Web.conf');
    const lines = fs.readFileSync(fs.existsSync(loon) ? loon : qx, 'utf8').split('\n');
    const routes = lines.filter(l => l.startsWith('http-response ') || l.includes(' url script-response-body '));
    const matched = routes.filter(l => new RegExp(l.startsWith('http-response ') ? l.split(' ')[1] : l.split(' ')[0]).test(url));
    assert.equal(matched.length, 1);assert.ok(matched[0].includes('/content.js?'));
});
