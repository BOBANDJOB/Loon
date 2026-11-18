// Run: node --test Scripts/pica-web/*.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sources = Object.fromEntries(['announcements', 'pwa-update'].map(name =>
    [name, fs.readFileSync(path.join(__dirname, name + '.js'), 'utf8')]));
const boardUrl = 'https://picaapi.go2778.com/announcements';
const moduleUrl = 'https://manhuapica.com/assets/js/index-ea_4Germ.js';
const board = () => ({ code: 200, message: 'fixture', data: {
    announcements: { docs: [{ id: 'fixture', title: 'fixture' }], total: 30, limit: 5, page: 1, pages: 6 },
    untouched: true
} });
const callback = 'onNeedRefresh(){confirm(t.t("common:pwa.updateAvailable"))&&s(!0)}';
const moduleBody = '// virtual_pwa-register-fixture.js\nconst s=registerSW({' + callback +
    ',onOfflineReady(){offlineReady()}});confirm("unrelated-fixture");';
function run(name, request = {}, response = {}) {
    const results = [];
    vm.runInNewContext(sources[name], {
        $request: { method: 'GET', url: name === 'announcements' ? boardUrl : moduleUrl, ...request },
        $response: { status: 200, headers: { 'content-type': name === 'announcements' ?
            'application/json' : 'application/javascript' }, body: name === 'announcements' ?
            JSON.stringify(board()) : moduleBody, ...response },
        $done: value => results.push(JSON.parse(JSON.stringify(value)))
    }, { timeout: 1000 });
    assert.equal(results.length, 1);
    return results[0];
}
test('announcement first page becomes a consistent empty list with other fields retained', () => {
    for (const host of ['go2778.com', 'acbbb.com']) for (const query of ['', '?page=1', '?limit=5&page=1']) {
        const result = run('announcements', { url: `https://picaapi.${host}/announcements${query}` });
        const expected = board();
        Object.assign(expected.data.announcements, { docs: [], total: 0, pages: 0 });
        assert.deepEqual(JSON.parse(result.body), expected);
        assert.equal(result.status, 200);
    }
});
test('announcement other pages, details, App endpoint and unrelated hosts pass through', () => {
    const page2 = board();page2.data.announcements.page = 2;
    assert.deepEqual(run('announcements', {}, { body: JSON.stringify(page2) }), {});
    for (const url of [boardUrl + '/fixture', boardUrl + '/',
        'https://picaapi.go2778.com/comics/fixture/recommendation',
        'https://api.tipatipa.xyz/announcements?page=1',
        'https://picaapi.go2778.com.evil.test/announcements', 'http://picaapi.go2778.com/announcements']) {
        assert.deepEqual(run('announcements', { url }), {});
    }
});
test('announcement errors, malformed schemas and already-empty pages remain visible', () => {
    for (const body of ['', '<html>error</html>', 'null', '{}',
        JSON.stringify({ ...board(), code: '200' }), JSON.stringify({ ...board(), code: 401 }),
        JSON.stringify({ code: 200, data: { announcements: { docs: [], page: 1 } } }),
        JSON.stringify({ code: 200, data: { announcements: { docs: {}, page: 1 } } })]) {
        assert.deepEqual(run('announcements', {}, { body }), {});
    }
});
test('PWA callback alone is removed and no forced refresh is introduced', () => {
    const result = run('pwa-update');
    assert.equal(result.body, moduleBody.replace(callback, 'onNeedRefresh(){}'));
    let options;let refreshes = 0;let offline = 0;const confirms = [];
    vm.runInNewContext(result.body, { registerSW: value => { options = value;return () => refreshes++; },
        confirm: message => { confirms.push(message);return true; }, offlineReady: () => offline++ });
    options.onNeedRefresh();options.onOfflineReady();
    assert.equal(refreshes, 0);assert.equal(offline, 1);
    assert.deepEqual(confirms, ['unrelated-fixture']);
});
test('PWA build hashes and minified identifiers may change without widening the host scope', () => {
    assert.equal(run('pwa-update', { url: 'https://manhuapica.com/assets/js/index-new_123-x.js?v=2' }, {
        body: moduleBody.replace('t.t(', '$i18n.t(').replace('&&s(!0)', '&&update$(!0)')
    }).status, 200);
    for (const url of ['https://manhuapica.com/sw.js', 'https://manhuapica.com/',
        'https://manhuapica.com/assets/js/feature-comics-fixture.js',
        'https://manhuapica.com.evil.test/assets/js/index-fixture.js', moduleUrl + '/fixture']) {
        assert.deepEqual(run('pwa-update', { url }), {});
    }
});
test('unknown, ambiguous or non-JavaScript modules are left intact', () => {
    for (const body of [moduleBody.replace('common:pwa.updateAvailable', 'other.prompt'),
        moduleBody.replace('virtual_pwa-register-', 'other-module-'),
        moduleBody.replace('onOfflineReady', 'otherCallback'),
        moduleBody + '\nconst another={' + callback + '};', '<html>error</html>']) {
        assert.deepEqual(run('pwa-update', {}, { body }), {});
    }
    assert.deepEqual(run('pwa-update', {}, { headers: { 'content-type': 'text/html' } }), {});
});
test('new handlers preserve method/status boundaries and finish once outside response context', () => {
    for (const name of Object.keys(sources)) {
        for (const method of ['POST', 'OPTIONS', 'HEAD']) assert.deepEqual(run(name, { method }), {});
        for (const status of [204, 304, 401, 403, 404, 500]) assert.deepEqual(run(name, {}, { status }), {});
        assert.equal(run(name, {}, { status: undefined, statusCode: 200 }).status, 200);
        const results = [];
        vm.runInNewContext(sources[name], { $done: value => results.push(JSON.stringify(value)) });
        assert.deepEqual(results, ['{}']);
    }
});
test('new handlers preserve CORS and cookies without mutating original headers', () => {
    for (const name of Object.keys(sources)) {
        const headers = { 'Content-Type': name === 'announcements' ? 'application/json' : 'text/javascript',
            'Content-Length': '9999', 'Content-Encoding': 'br', ETag: 'fixture',
            'Access-Control-Allow-Origin': '*', 'Set-Cookie': 'fixture=1', Vary: 'Origin' };
        const original = { ...headers };
        const result = run(name, {}, { headers });
        assert.deepEqual(headers, original);
        for (const key of ['Access-Control-Allow-Origin', 'Set-Cookie', 'Vary']) assert.equal(result.headers[key], headers[key]);
        for (const key of ['Content-Length', 'Content-Encoding', 'ETag']) assert.ok(!(key in result.headers));
        assert.equal(result.headers['Cache-Control'], 'no-store');
    }
});
test('all response routes target distinct resources and use the tested handler', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/Pica/Web.plugin'), 'utf8');
    const routes = plugin.split('\n').filter(line => line.startsWith('http-response '));
    assert.equal(routes.length, 6);
    for (const [url, file] of [[boardUrl, 'announcements.js'], [moduleUrl, 'pwa-update.js'],
        ['https://manhuapica.com/assets/js/virtual_pwa-register-fixture.js', 'pwa-update.js'],
        ['https://manhuapica.com/assets/js/feature-comics-fixture.js', 'content.js'],
        ['https://manhuapica.com/sw.js', 'pwa-cache.js'],
        ['https://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=fixture', 'response.js']]) {
        const matched = routes.filter(line => new RegExp(line.split(' ')[1]).test(url));
        assert.equal(matched.length, 1);
        assert.ok(new URL(/script-path=([^,]+)/.exec(matched[0])[1]).pathname.endsWith('/' + file));
    }
});
