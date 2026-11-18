// Optional macOS WebKit geometry regression. No npm packages or site requests.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
if(process.platform!=='darwin') throw new Error('This check requires macOS WebKit and Apple Command Line Tools');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'response.js'),'utf8');
const base=source.match(/<style>([\s\S]*?)<\/style>/)[1];
const overrides=source.match(/async function loadCSS\(\)[\s\S]*?GM_addStyle\(`([\s\S]*?)`\);/)[1];
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'copymanga-layout-'));
try {
    const binary=path.join(directory,'layout-webkit');
    execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',
        path.join(__dirname,'tests/layout-webkit.m'),'-o',binary],{stdio:'pipe'});
    const cases=[
        {width:375,height:812,count:'15/15',coarse:true},
        {width:375,height:812,count:'15/15',coarse:true,expanded:true},
        {width:320,height:568,count:'999/999',coarse:true,sidebar:true},
        {width:430,height:932,count:'15/15',coarse:true,sidebar:true},
        {width:812,height:375,count:'15/15',coarse:true,expanded:true,sidebar:true},
        {width:1280,height:800,count:'15/15'}
    ];
    for(const scenario of cases) {
        const {width,height,count,coarse,expanded,sidebar}=scenario;
        const insets={top:coarse?62:0,bottom:coarse?34:0,left:0,right:0};
        let styles=overrides.replace(/env\(safe-area-inset-(top|bottom|left|right)\)/g,(_,side)=>insets[side]+'px');
        if(coarse) styles=styles.replaceAll('@media (pointer:coarse)','@media (min-width:0px)');
        const options=expanded?'<div id="info-options">'+Array(6).fill('<div class="info_item">阅读设置</div>').join('')+'</div>':'';
        const chapters=sidebar?'<aside id="sidebar"><nav class="loon-copy-chapters"><ul class="el-menu"><li class="el-menu-item">【話】第151话</li><li class="el-menu-item">【番外篇】完整长章节标题不会被截断</li></ul></nav></aside>':'';
        // Keep the production ordering: helper CSS is in head, template CSS is
        // later in body. This catches overrides that jsdom media queries miss.
        const html='<!doctype html><html><head><meta charset="utf-8"><style>'+styles+'</style></head><body class="dark"><div style="height:2400px"></div><div id="info">'+options+'<div id="info_count" class="info_item">'+count+'</div></div>'+chapters+'<style>'+base+'</style></body></html>';
        const file=path.join(directory,'fixture.html');fs.writeFileSync(file,html);
        const result=JSON.parse(execFileSync(binary,[file,String(width),String(height)],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}));
        const contains=(outer,inner)=>inner.top>=outer.top-1&&inner.bottom<=outer.bottom+1&&inner.left>=outer.left-1&&inner.right<=outer.right+1;
        assert.ok(contains(result.outer,result.counter),'counter must fit gray background: '+JSON.stringify(result));
        assert.ok(contains(result.counter,result.text),'digits must fit counter: '+JSON.stringify(result));
        assert.ok(result.centerDelta<=1,'digits must be vertically centered');
        assert.equal(result.style.padding,'0px');
        assert.ok(result.counter.height>=(coarse?44:36));
        assert.ok(result.outer.top>=0 && result.outer.bottom<=height);
        if(!expanded) assert.ok(result.outer.width<120,'collapsed control stays narrow');
        if(sidebar) {
            const expected=Math.min(184,Math.max(132,width*0.36));
            assert.ok(Math.abs(result.sidebar.width-expected)<=1,'sidebar width follows clamp');
        }
        console.log('PASS WebKit '+width+'x'+height+' '+(coarse?'touch CSS':'desktop')+' '+(expanded?'expanded':'collapsed')+' counter='+result.counter.height+'px center delta='+result.centerDelta+'px'+(sidebar?' sidebar='+result.sidebar.width+'px':''));
    }
} finally {
    fs.rmSync(directory,{recursive:true,force:true});
}
