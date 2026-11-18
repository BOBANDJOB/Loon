// Optional macOS WebKit check: standalone chrome patch must not move native UI.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
if(process.platform!=='darwin') throw new Error('Requires macOS WebKit and Apple Command Line Tools');
let result;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'response.js'),'utf8'),{
    $request:{method:'GET',url:'https://www.mangacopy.com/h5/index'},
    $response:{status:200,headers:{'Content-Type':'text/html'},body:'<html><head></head><body>native</body></html>'},
    $done:value=>{result=value;}
});
const chrome=result.body.match(/<style id="loon-copy-native-app-chrome">([^<]+)<\/style>/)[1];
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'copymanga-native-header-'));
try {
    const binary=path.join(directory,'webkit'),script=path.join(directory,'measure.js');
    execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',path.join(__dirname,'tests/layout-webkit.m'),'-o',binary],{stdio:'pipe'});
    fs.writeFileSync(script,`JSON.stringify((()=>{
        const header=document.querySelector('[data-test-header]');
        const boxes=[header,...header.querySelectorAll('[data-control]'),document.querySelector('.tabs')].map(el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
        return {boxes,position:getComputedStyle(header).position,background:getComputedStyle(header).backgroundColor};
    })())`);
    // Native class names and header declarations checked against the public H5
    // stylesheet. No external scripts, images, fonts, APIs or accounts are used.
    for(const root of ['indexV2','discover','search','login']) for(const [width,height] of [[375,812],[430,932],[812,375]]) {
        function measure(mode) {
            const css=mode==='baseline'?'':mode==='standalone'?chrome.replace('(display-mode:standalone)','(min-width:0px)'):chrome;
            const controls='<span data-control class="indexTitleText">漫画</span><span data-control class="indexTitleInputBox"></span><span data-control class="icon"></span>';
            const native=root==='search'?'<main class="seekPopup"><form data-test-header><div class="form">'+controls+'</div></form>':
                root==='login'?'<main class="login"><div data-test-header class="van-sticky"><div><div class="navBar">'+controls+'</div></div></div>':
                '<main id="'+root+'"><div data-test-header class="indexTitle">'+controls+'</div>';
            const html='<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style><style>'+
                'html{font-size:'+width/10+'px}body{margin:0;font:14px Arial}'+
                '#'+root+' .indexTitle{display:flex;align-items:center;padding:.3rem .24rem;background:#fff}'+
                'form{margin:0;background:#fff}.seekPopup .form{display:flex;align-items:center;background:#fff;padding:10px 12px}'+
                '.navBar{display:flex;align-items:center;height:1.5rem;line-height:1.5rem;background:rgba(255,255,255,1)}'+
                '.indexTitleText{font-size:.73rem;font-weight:800;margin-right:.45rem}'+
                '.indexTitleInputBox{margin-left:.23rem;flex:1;height:.62rem;background:#f1f3f5;border-radius:42px}'+
                '.icon{width:.72rem;height:.72rem;margin-left:.4rem}.tabs{height:44px}'+
                '</style></head><body>'+native+'<div class="tabs">首页 / 发现</div></main></body></html>';
            const file=path.join(directory,'fixture.html');fs.writeFileSync(file,html);
            return JSON.parse(execFileSync(binary,[file,String(width),String(height),script],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}));
        }
        const before=measure('baseline'),browser=measure('browser'),standalone=measure('standalone');
        assert.deepEqual(browser,before,'Safari tab must keep original layout/styles');
        assert.deepEqual(standalone.boxes,before.boxes,'header, controls and tabs must not move or grow');
        assert.equal(standalone.position,'sticky');
        assert.equal(standalone.background,'rgb(255, 255, 255)');
        console.log('PASS native header '+root+' '+width+'x'+height+': Safari unchanged; standalone sticky with identical rectangles');
    }
} finally {fs.rmSync(directory,{recursive:true,force:true});}
