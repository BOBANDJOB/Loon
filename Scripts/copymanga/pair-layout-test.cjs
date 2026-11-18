// Optional real WebKit check. Only local SVG fixtures; no website or account.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
if(process.platform!=='darwin')throw new Error('Requires macOS WebKit and Apple Command Line Tools');
const source=fs.readFileSync(process.argv[2]||path.join(__dirname,'response.js'),'utf8');
const base=source.match(/<style>([\s\S]*?)<\/style>/)[1];
const overrides=source.match(/async function loadCSS\(\)[\s\S]*?GM_addStyle\(`([\s\S]*?)`\);/)[1]
    .replaceAll('@media (pointer:coarse)','@media (min-width:0px)');
const helpers=source.slice(source.indexOf('function imageLayoutKind('),source.indexOf('async function loadCSS()'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'copymanga-pair-'));
try{
    const binary=path.join(directory,'webkit'),measure=path.join(directory,'measure.js');
    execFileSync('clang',['-fobjc-arc','-framework','Cocoa','-framework','WebKit',path.join(__dirname,'tests/layout-webkit.m'),'-o',binary],{stdio:'pipe'});
    fs.writeFileSync(measure,`JSON.stringify((()=>{
        window.scrollTo(0,0);
        const matrix=document.querySelector('#matrix');
        const images=[...matrix.children].filter(el=>getComputedStyle(el).display!=='none').map(el=>{
            const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,ratio:el.naturalWidth/el.naturalHeight,kind:el.getAttribute('data-layout'),blank:el.classList.contains('blank'),loaded:el.complete&&el.naturalWidth>0};
        });
        return {images,width:matrix.clientWidth,available:document.body.clientWidth,scrollWidth:matrix.scrollWidth};
    })())`);
    const cases=[
        {name:'double tall',body:'page skip',ratios:Array(6).fill(.06),double:true},
        {name:'double ordinary',body:'page skip',ratios:Array(6).fill(.7),double:true},
        {name:'double mixed',body:'page skip',ratios:[.7,.6,1.6,.08,.7,.65],double:true},
        {name:'double with blank',body:'page',ratios:Array(6).fill(.06),double:true},
        {name:'double normal cover blank',body:'page',ratios:Array(6).fill(.7),double:true},
        {name:'single tall',body:'skip',ratios:Array(6).fill(.06)},
        {name:'horizontal tall',body:'page scroll skip',ratios:Array(36).fill(.08),horizontal:true}
    ];
    for(const [width,height]of [[375,812],[812,375]])for(const scenario of cases){
        const image=(ratio,blank=false)=>'<img onload="classifyImage(this)" class="inner_img'+(blank?' blank':'')+'" src="data:image/svg+xml,'+
            encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="'+Math.round(ratio*10000)+'" height="10000"><rect width="100%" height="100%" fill="#527"/></svg>')+'">';
        const images=image(scenario.ratios[0],true)+scenario.ratios.map(r=>image(r)).join('');
        const html='<!doctype html><html><head><meta charset="utf-8"><script>'+helpers+'</script><style>'+overrides+'</style></head><body class="'+scenario.body+'"><div id="matrix">'+images+'</div><style>'+base+'</style></body></html>';
        const file=path.join(directory,'fixture.html');fs.writeFileSync(file,html);
        const result=JSON.parse(execFileSync(binary,[file,String(width),String(height),measure],{encoding:'utf8',timeout:20000,stdio:['ignore','pipe','pipe']}));
        assert.ok(result.images.every(i=>i.loaded),'all local fixture images load');
        const rows=new Map();for(const image of result.images){const y=Math.round(image.y);rows.set(y,(rows.get(y)||0)+1);}
        if(scenario.double){
            assert.ok(Math.abs(result.width-result.available)<=1,'double layout uses available content width, allowing the native scrollbar gutter');
            if(scenario.name==='double with blank')assert.ok(result.images[0].blank,'explicit blank option is retained');
            if(scenario.name==='double normal cover blank')assert.ok(result.images[0].blank,'normal cover can keep its blank partner');
            assert.ok([...rows.values()].every(n=>n<=2),'double mode must have at most 2 images per row: '+JSON.stringify({width,scenario:scenario.name,rows:[...rows.values()]}));
            let expectedRows=0,slots=0;
            for(const i of result.images){
                const full=!i.blank&&(i.kind==='long'||i.kind==='spread');
                assert.ok(Math.abs(i.width-result.width/(full?1:2))<=1,'image fits its classified slot');
                assert.ok(Math.abs(i.height-i.width/i.ratio)<=1,'image height follows its natural ratio without viewport letterboxing');
                if(full){if(slots)expectedRows++;expectedRows++;slots=0;}
                else if(++slots===2){expectedRows++;slots=0;}
                if(i.kind==='long'&&!i.blank)assert.ok(i.height>height,'long strip remains readable at full container width');
            }
            assert.equal(rows.size,expectedRows+(slots?1:0),'wide/long images have their own row, with normal page gaps retained');
            for(const y of rows.keys()){
                const row=result.images.filter(i=>Math.round(i.y)===y);
                if(row.length===2)assert.ok(row[0].x>row[1].x,'paired first page remains on the right');
            }
        }else if(scenario.horizontal){
            assert.equal(rows.size,1,'horizontal mode stays one strip');
            assert.ok(result.scrollWidth>result.width,'horizontal mode retains scrollable overflow');
        }else assert.equal(rows.size,result.images.length,'single mode remains one image per row');
        for(let i=0;i<result.images.length;i++)for(let j=i+1;j<result.images.length;j++){
            const a=result.images[i],b=result.images[j];
            assert.ok(!(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>1&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>1),'image boxes never overlap');
        }
        console.log('PASS WebKit '+width+'x'+height+' '+scenario.name+' rows='+rows.size);
    }
}finally{fs.rmSync(directory,{recursive:true,force:true});}
