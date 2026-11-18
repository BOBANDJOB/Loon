// Run: node --test Scripts/pica-web/test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'response.js'), 'utf8');
const baseUrl = 'https://pica-ad-api.diwodiwo.xyz/get-ad-zones';
const fixture = count => ({
    code: 200, message: 'fixture-success', data: {
        zones: Array.from({ length: count }, (_, i) => ({
            name: `fixture-zone-${i}`, remark: 'fixture', id: `fixture-${i}`,
            ad: { image: 'https://ad.example.test/fixture.mp4', title: 'fixture',
                link: 'https://ad.example.test/', rawLink: 'https://ad.example.test/' }
        })),
        untouched: { fixture: true }
    }
});
function run(request = {}, response = {}) {
    const results = [];
    vm.runInNewContext(source, {
        $request: { method: 'GET', url: `${baseUrl}?z=zone_7,zone_8,zone_10`, ...request },
        $response: { status: 200, headers: {
            'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*',
            'access-control-allow-credentials': 'true'
        }, body: JSON.stringify(fixture(3)), ...response },
        $done: value => results.push(JSON.parse(JSON.stringify(value)))
    }, { timeout: 1000 });
    assert.equal(results.length, 1);
    return results[0];
}
test('the captured three response shapes become successful empty ad-zone lists', () => {
    for (const count of [3, 8, 3]) {
        const result = run({}, { body: JSON.stringify(fixture(count)) });
        assert.equal(result.status, 200);
        const expected = fixture(count);
        expected.data.zones = [];
        assert.deepEqual(JSON.parse(result.body), expected);
    }
});
test('different ad combinations, encoded commas, and an absent query use the same ad endpoint', () => {
    for (const query of ['', '?', '?z=zone_7%2Czone_8', '?z=zone_16,zone_22', '?z=zone_23&fixture=1']) {
        assert.equal(run({ url: baseUrl + query }).status, 200);
    }
});
test('business, media, foreign hosts and path variants pass through', () => {
    for (const url of [
        'https://manhuapica.com/', 'https://picaapi.go2778.com/comics/fixture',
        'https://picaapi.acbbb.com/users/profile', 'https://api.tipatipa.xyz/announcements?page=1',
        'https://pica-ad-api.diwodiwo.xyz/medias/fixture.mp4',
        'https://pica-ad-api.diwodiwo.xyz/get-ad-zones/',
        'https://pica-ad-api.diwodiwo.xyz/get-ad-zones/fixture',
        'https://pica-ad-api.diwodiwo.xyz/get-ad-zones-extra?z=zone_1',
        'https://pica-ad-api.diwodiwo.xyz.evil.test/get-ad-zones?z=zone_1',
        'https://example.test/get-ad-zones?z=zone_1',
        'http://pica-ad-api.diwodiwo.xyz/get-ad-zones?z=zone_1'
    ]) assert.deepEqual(run({ url }), {});
});
test('only GET HTTP 200 is modified; auth failures and preflight requests stay visible', () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) assert.deepEqual(run({ method }), {});
    for (const status of [204, 206, 304, 400, 401, 403, 404, 429, 500, 503]) assert.deepEqual(run({}, { status }), {});
    assert.equal(run({}, { status: undefined, statusCode: 200 }).status, 200);
});
test('malformed, failed, unexpected, and already-empty responses stay unchanged', () => {
    for (const body of [
        '', '<html>error</html>', 'null', '[]', '{}',
        JSON.stringify({ code: '200', data: { zones: ['fixture'] } }),
        JSON.stringify({ code: 401, data: { zones: ['fixture'] } }),
        JSON.stringify({ code: 200, data: { zones: null } }),
        JSON.stringify({ code: 200, data: { zones: {} } }),
        JSON.stringify({ code: 200, data: { comics: ['fixture'] } }),
        JSON.stringify({ code: 200, data: { zones: [] } })
    ]) assert.deepEqual(run({}, { body }), {});
    assert.deepEqual(run({}, { body: undefined }), {});
});
test('CORS and unrelated headers survive while stale body metadata is removed', () => {
    const headers = {
        'Content-Type': 'application/json', 'Content-Length': '100', 'Content-Encoding': 'br',
        'Transfer-Encoding': 'chunked', ETag: 'fixture', 'Last-Modified': 'fixture', Expires: 'fixture',
        'cache-control': 'max-age=900', 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true', Vary: 'Origin', 'Set-Cookie': 'fixture=1', Server: 'fixture'
    };
    const original = { ...headers };
    const result = run({}, { headers });
    assert.deepEqual(headers, original);
    assert.deepEqual(result.headers, {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin', 'Set-Cookie': 'fixture=1', Server: 'fixture',
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'
    });
});
test('manual invocation outside response context passes through once', () => {
    const results = [];
    vm.runInNewContext(source, { $done: value => results.push(JSON.parse(JSON.stringify(value))) });
    assert.deepEqual(results, [{}]);
});
test('the independent plugin has precise routes, explicit MitM hosts and existing local references', () => {
    const plugin = fs.readFileSync(path.join(__dirname, '../../Plugins/Pica/Web.plugin'), 'utf8');
    const line = plugin.split('\n').find(s => s.startsWith('http-response '));
    const regex = new RegExp(line.split(' ')[1]);
    assert.ok(regex.test(baseUrl + '?z=zone_8'));
    assert.ok(!regex.test(baseUrl + '/fixture'));
    assert.ok(!regex.test('https://picaapi.go2778.com/comics/fixture'));
    assert.match(line, /requires-body=true/);
    for (const match of plugin.matchAll(/https:\/\/raw\.githubusercontent\.com\/BOBANDJOB\/Loon\/main\/([^,\s]+)/g)) {
        assert.ok(fs.existsSync(path.join(__dirname, '../..', match[1].split('?')[0])), match[1]);
    }
    assert.equal(/hostname\s*=\s*([^\n]+)/.exec(plugin)[1], 'pica-ad-api.diwodiwo.xyz, picaapi.go2778.com, picaapi.acbbb.com, manhuapica.com');
    assert.ok(!plugin.includes('DOMAIN-SUFFIX'));
});
