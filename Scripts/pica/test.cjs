// Run: node --test Scripts/pica/test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'banners.js'), 'utf8');
const announcementSource = fs.readFileSync(path.join(__dirname, 'announcements.js'), 'utf8');
const capturedError = { code: 500, error: 'Unexpected token < in JSON at position 0', message: '--', detail: ':(' };
function run(request = {}, response = {}) {
    const results = [];
    vm.runInNewContext(source, {
        $request: { method: 'GET', url: 'https://api.tipatipa.xyz/banners', ...request },
        $response: { status: 500, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(capturedError), ...response },
        $done: value => results.push(JSON.parse(JSON.stringify(value)))
    }, { timeout: 1000 });
    assert.equal(results.length, 1);
    return results[0];
}
test('the captured /banners HTTP 500 becomes a successful empty banner list', () => {
    const result = run();
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { code: 200, message: 'success', data: { banners: [] } });
    assert.equal(result.headers['Content-Type'], 'application/json; charset=utf-8');
    assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('healthy banners are left intact', () => {
    assert.deepEqual(run({}, { status: 200, body: JSON.stringify({ code: 200, message: 'success', data: { banners: [{ title: 'fixture' }] } }) }), {});
});
test('init, sources, comics, other hosts and URL variants are never changed', () => {
    for (const url of [
        'https://api.tipatipa.xyz/init?platform=ios', 'https://api.tipatipa.xyz/sources',
        'https://api.tipatipa.xyz/comics/fixture', 'https://api.tipatipa.xyz/banners/fixture',
        'https://api.tipatipa.xyz/banners/', 'https://api.tipatipa.xyz/banners?fixture=1',
        'https://uatapi.tipatipa.xyz/banners', 'https://example.com/banners',
        'https://api.tipatipa.xyz.evil.test/banners', 'http://api.tipatipa.xyz/banners'
    ]) assert.deepEqual(run({ url }), {});
});
test('only GET and HTTP 500 match; authentication and other HTTP errors remain visible', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.deepEqual(run({ method }), {});
    for (const status of [200, 304, 400, 401, 403, 404, 429, 502, 503]) assert.deepEqual(run({}, { status }), {});
});
test('other error types and malformed bodies are not hidden', () => {
    for (const body of [
        '', '<html>server error</html>', 'null', '[]', '{}',
        JSON.stringify({ ...capturedError, code: 401 }),
        JSON.stringify({ ...capturedError, code: '500' }),
        JSON.stringify({ ...capturedError, error: 'Database unavailable' })
    ]) assert.deepEqual(run({}, { body }), {});
});
test('rewritten responses drop stale length, compression and validators while retaining other headers', () => {
    const result = run({}, { headers: {
        'Content-Type': 'application/json', 'Content-Length': '92', 'Content-Encoding': 'gzip',
        'Transfer-Encoding': 'chunked', ETag: 'fixture', 'Last-Modified': 'fixture', Expires: 'fixture',
        'cache-control': 'max-age=3600', Server: 'cloudflare'
    } });
    assert.deepEqual(result.headers, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Server: 'cloudflare' });
    assert.equal(run({}, { status: undefined, statusCode: 500 }).status, 200);
});
test('manual execution without response context safely passes through', () => {
    const results = [];
    vm.runInNewContext(source, { $done: value => results.push(JSON.parse(JSON.stringify(value))) });
    assert.deepEqual(results, [{}]);
});
test('plugin matches only the observed endpoint, trusts the necessary host and references a local script', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/Pica/App.plugin'), 'utf8');
    const line = plugin.split('\n').find(s => s.startsWith('http-response '));
    const regex = new RegExp(line.split(' ')[1]);
    assert.ok(regex.test('https://api.tipatipa.xyz/banners'));
    assert.ok(!regex.test('https://api.tipatipa.xyz/init?platform=ios'));
    assert.ok(!regex.test('https://api.tipatipa.xyz/banners/fixture'));
    assert.ok(!regex.test('https://api.tipatipa.xyz.evil.test/banners'));
    assert.match(line, /requires-body=true/);
    const relative = /script-path=https:\/\/raw.githubusercontent.com\/BOBANDJOB\/Loon\/main\/([^,]+)/.exec(line)[1];
    assert.ok(fs.existsSync(path.join(__dirname, '../..', relative)));
    const hosts = /hostname\s*=\s*([^\n]+)/.exec(plugin)[1].split(',').map(h => h.trim());
    assert.ok(hosts.includes('api.tipatipa.xyz'));
});

function announcement(request = {}, response = {}) {
    const results = [];
    vm.runInNewContext(announcementSource, {
        $request: { method: 'GET', url: 'https://api.tipatipa.xyz/announcements?page=1', ...request },
        $response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            code: 200, message: 'success', data: { announcements: {
                docs: [{ title: '推广公告 fixture' }, { title: '普通公告 fixture' }], total: 30, limit: 5, page: '1', pages: 6
            }, untouched: { fixture: true } }
        }), ...response },
        $done: value => results.push(JSON.parse(JSON.stringify(value)))
    }, { timeout: 1000 });
    assert.equal(results.length, 1);
    return results[0];
}
test('first-page announcements become an empty successful page with consistent totals', () => {
    const result = announcement();
    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.deepEqual(body.data.announcements, { docs: [], total: 0, limit: 5, page: '1', pages: 0 });
    assert.deepEqual(body.data.untouched, { fixture: true });
    assert.equal(body.code, 200);
    assert.equal(body.message, 'success');
    assert.equal(result.headers['Cache-Control'], 'no-store');
});
test('other pages, detail routes, hosts and methods are not suppressed', () => {
    for (const url of [
        'https://api.tipatipa.xyz/announcements?page=2', 'https://api.tipatipa.xyz/announcements/fixture',
        'https://api.tipatipa.xyz/announcements?page=10', 'https://api.tipatipa.xyz/announcements',
        'https://api.tipatipa.xyz/collections', 'https://api.tipatipa.xyz/init?platform=ios',
        'https://api.tipatipa.xyz/sources', 'https://api.tipatipa.xyz/banners',
        'https://example.com/announcements?page=1'
    ]) assert.deepEqual(announcement({ url }), {});
    for (const method of ['POST', 'HEAD', 'DELETE']) assert.deepEqual(announcement({ method }), {});
    for (const status of [401, 403, 429, 500, 503]) assert.deepEqual(announcement({}, { status }), {});
});
test('announcement failures, unexpected schemas and already-empty pages remain unchanged', () => {
    for (const body of [
        '<html>error</html>', 'null', '{}',
        JSON.stringify({ code: 401, data: { announcements: { docs: ['fixture'], page: 1 } } }),
        JSON.stringify({ code: 200, data: { announcements: { docs: [], page: 1, total: 0 } } }),
        JSON.stringify({ code: 200, data: { announcements: { docs: {}, page: 1 } } }),
        JSON.stringify({ code: 200, data: { announcements: { docs: ['fixture'], page: 2 } } })
    ]) assert.deepEqual(announcement({}, { body }), {});
});
test('the new plugin rule is separate from banners and resolves to its own script', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/Pica/App.plugin'), 'utf8');
    const line = plugin.split('\n').find(s => s.startsWith('http-response ') && s.includes('announcements'));
    const regex = new RegExp(line.split(' ')[1]);
    assert.ok(regex.test('https://api.tipatipa.xyz/announcements?page=1'));
    assert.ok(!regex.test('https://api.tipatipa.xyz/announcements?page=10'));
    assert.ok(!regex.test('https://api.tipatipa.xyz/announcements?page=2'));
    assert.ok(!regex.test('https://api.tipatipa.xyz/banners'));
    assert.match(line, /requires-body=true/);
    const relative = /script-path=https:\/\/raw.githubusercontent.com\/BOBANDJOB\/Loon\/main\/([^,]+)/.exec(line)[1];
    assert.ok(fs.existsSync(path.join(__dirname, '../..', relative)));
});
