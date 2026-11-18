const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'../..');
const qx=fs.existsSync(path.join(root,'Rewrites/Pica/Web.conf'));
const source=fs.readFileSync(path.join(__dirname,'document.js'),'utf8');
const cache=fs.readFileSync(path.join(__dirname,'pwa-cache.js'),'utf8');
const tag='<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">';
const html='<!doctype html><html><head><title>PicaWeb</title><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+
 '<meta name="apple-mobile-web-app-capable" content="yes">'+tag+'<link rel="manifest" href="/manifest.json">'+
 '<script type="module" src="/assets/js/index-fixture.js"></script></head><body><div id="app"></div></body></html>';
function execute(code,request={},response={}){
 const done=[];vm.runInNewContext(code,{$request:{method:'GET',url:'https://manhuapica.com/',...request},
  $response:{status:200,statusCode:200,headers:{'Content-Type':'text/html'},body:html,...response},
  $done:value=>done.push(JSON.parse(JSON.stringify(value)))});assert.equal(done.length,1);return done[0];
}
test('HTML removes only the deprecated status-bar tag before page parsing',()=>{
 for(const url of ['https://manhuapica.com/','https://manhuapica.com/?vflush=fixture','https://manhuapica.com/index.html?__WB_REVISION__=fixture']){
  const r=execute(source,{url});assert.equal(r.body,html.replace(tag,''));
  assert.match(r.body,/apple-mobile-web-app-capable/);assert.match(r.body,/viewport-fit=cover/);
  assert.doesNotMatch(r.body,/padding|height:|filter:|location\.reload|localStorage/);
  assert.deepEqual(execute(source,{url},{body:r.body}),{});
 }
});
test('quoted attribute order, case and whitespace variants work without changing other metadata',()=>{
 for(const alternate of ["<meta content='black-translucent' name='apple-mobile-web-app-status-bar-style' />",
  '<META NAME = "apple-mobile-web-app-status-bar-style" CONTENT = "black-translucent">']){
  assert.equal(execute(source,{},{body:html.replace(tag,alternate)}).body,html.replace(tag,''));
 }
});
test('documents with missing, duplicate or unrelated metadata pass through',()=>{
 for(const body of ['',html.replace(tag,''),html.replace(tag,tag+tag),html.replace('black-translucent','default'),
  html.replace('black-translucent','black'),html.replace('PicaWeb','OtherApp'),html.replace('/manifest.json','/other.json')]){
  assert.deepEqual(execute(source,{},{body}),{});
 }
});
test('HTML rewrite keeps URL, method, MIME and response-status boundaries',()=>{
 for(const url of ['https://manhuapica.com/profile','https://manhuapica.com/index.html/',
  'https://manhuapica.com/assets/js/index-fixture.js','https://manhuapica.com/sw.js',
  'https://manhuapica.com.evil.test/','http://manhuapica.com/'])assert.deepEqual(execute(source,{url}),{});
 for(const method of ['POST','HEAD','OPTIONS'])assert.deepEqual(execute(source,{method}),{});
 for(const status of [204,304,401,500])assert.deepEqual(execute(source,{},{status,statusCode:status}),{});
 assert.deepEqual(execute(source,{},{headers:{'Content-Type':'application/javascript'}}),{});
 if(qx)assert.deepEqual(execute(source,{},{statusCode:undefined,status:200}),{});
});
test('HTML transport preserves credentials/CORS and caller headers with platform-specific body handling',()=>{
 const headers={'Content-Type':'text/html','Content-Length':'999','Content-Encoding':'br','Transfer-Encoding':'chunked',
  ETag:'fixture','Last-Modified':'fixture','Cache-Control':'max-age=999',Vary:'Origin','Set-Cookie':'fixture=1','Access-Control-Allow-Origin':'*'};
 const copy={...headers},r=execute(source,{},{headers});assert.deepEqual(headers,copy);
 for(const key of ['Vary','Set-Cookie','Access-Control-Allow-Origin','Content-Type'])assert.equal(r.headers[key],headers[key]);
 for(const key of ['ETag','Last-Modified'])assert.equal(r.headers[key],undefined);
 for(const key of ['Content-Length','Content-Encoding','Transfer-Encoding'])assert.equal(r.headers[key],qx?headers[key]:undefined);
 assert.equal(r.headers['Cache-Control'],'no-store');
 const done=[];vm.runInNewContext(source,{$done:value=>done.push(JSON.stringify(value))});assert.deepEqual(done,['{}']);
});
const reg='{url:"assets/js/virtual_pwa-register-fixture.js",revision:null}';
const comic='{url:"assets/js/feature-comics-fixture.js",revision:null}';
const index='{url:"index.html",revision:"fixture-html"}';
const sw='self.addEventListener("message",()=>"SKIP_WAITING");wb.precacheAndRoute(['+index+','+reg+','+comic+
 ',{url:"images/fixture.png",revision:"original-image"}],{});wb.cleanupOutdatedCaches();';
function patchWorker(body=sw){return execute(cache,{url:'https://manhuapica.com/sw.js'},{body,headers:{'Content-Type':'application/javascript'}});}
function entries(body){return JSON.parse(JSON.stringify(vm.runInNewContext('('+body.match(/precacheAndRoute\((\[[\s\S]*?\]),/)[1]+')')));}
test('cache migration upgrades only HTML and registration from e; comic revision stays d',()=>{
 const old=sw.replace(reg,reg.replace('null','"loon-pwa-quiet-20261116e-fixture"'))
  .replace(comic,comic.replace('null','"loon-pwa-quiet-20261116d-fixture"'));
 const r=patchWorker();assert.ok(r.body);const before=entries(old),after=entries(r.body);
 assert.deepEqual(after.filter((e,i)=>e.revision!==before[i].revision).map(e=>e.url),
  ['index.html','assets/js/virtual_pwa-register-fixture.js']);
 assert.equal(after[0].revision,'loon-pwa-statusbar-20261117a-fixture-html');
 assert.equal(after[1].revision,'loon-pwa-quiet-20261117a-fixture');
 assert.equal(after[2].revision,'loon-pwa-quiet-20261116d-fixture');
 assert.equal(patchWorker().body,r.body);assert.deepEqual(patchWorker(r.body),{});
 assert.ok(!/caches\.delete|clients\.claim|Date\.now|\$prefs|\$persistentStore/.test(r.body));
});
test('cache migration refuses missing/ambiguous HTML entries and wrong HTML revision type',()=>{
 for(const body of [sw.replace(index,''),sw.replace(index,index+','+index),sw.replace(index,'{url:"index.html",revision:null}')])
  assert.deepEqual(patchWorker(body),{});
});
test('registration removes the previous oversized header compensation entirely',()=>{
 const update=fs.readFileSync(path.join(__dirname,'pwa-update.js'),'utf8');
 assert.doesNotMatch(update,/\.mobile-header\{|\.mobile-header-container\{/);
 assert.match(update,/\.chapter-navigation__ad\{display:none!important\}/);
});
test('root and precache HTML use exactly one response handler and a conditional-cache request handler',()=>{
 const config=fs.readFileSync(path.join(root,qx?'Rewrites/Pica/Web.conf':'Plugins/Pica/Web.plugin'),'utf8');
 const lines=config.split('\n');const responses=lines.filter(l=>qx?l.includes(' url script-response-body '):l.startsWith('http-response '));
 const requests=lines.filter(l=>qx?l.includes(' url script-request-header '):l.startsWith('http-request '));
 assert.equal(responses.length,6);assert.equal(requests.length,1);
 const pattern=line=>new RegExp(line.split(' ')[qx?0:1]);
 for(const url of ['https://manhuapica.com/','https://manhuapica.com/index.html?__WB_REVISION__=fixture']){
  assert.equal(responses.filter(l=>pattern(l).test(url)).length,1);
  assert.match(responses.find(l=>pattern(l).test(url)),/document\.js/);
  assert.ok(pattern(requests[0]).test(url));
 }
 assert.equal(responses.filter(l=>pattern(l).test('https://manhuapica.com/assets/image.png')).length,0);
});
