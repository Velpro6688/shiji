'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v264');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.habits=[{key:"test",name:"学习",icon:"📖",color:"#0071e3",type:"bool",createdAt:daysAgoStr(30)}];data.days={};[12,12,12,12,12,19,19,19,19,19,11,11,11,11,22,22,22,22,17,17].forEach((hour,i)=>{data.days[daysAgoStr(i)]={test:true,test_ts:String(hour)+":00"};});data.memoNotes=[{id:"sample",title:"今日随记",html:"<p>紧凑布局预览。</p>",text:"紧凑布局预览。",ord:1}];syncHabits();renderAll();renderMemoList();return true');
  for(const width of [320,520,1200]){
   win.setSize(width,720);await H.sleep(250);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();return true');
    for(const page of ['today','stat','memo','mine']){
     await H.evalJson(win,'go('+JSON.stringify(page)+');document.getElementById("scroll").scrollTop=0;return true');await H.sleep(400);
     const v=await H.evalJson(win,'var p=document.querySelector(".page.active");return {fits:p.scrollWidth<=p.clientWidth+1,gap:document.getElementById("insightReport")?document.getElementById("insightReport").getBoundingClientRect().top-document.querySelector(".topbar").getBoundingClientRect().bottom:0}');
     suite.ok(v.fits&&(page!=='stat'||(v.gap>=0&&v.gap<=16)),width+'/'+theme+'/'+page+' fits with a compact first section');
     fs.writeFileSync(path.join(out,'compact-'+width+'-'+theme+'-'+page+'.png'),await H.capturePng(win));
    }
    await H.evalJson(win,'go("stat");document.querySelector("#statExtras details").open=true;document.querySelector(".se-brow").scrollIntoView({block:"center"});return true');await H.sleep(300);
    const bars=await H.evalJson(win,'return [...document.querySelectorAll(".se-brow")].map(n=>{var label=n.querySelector(".se-bh").getBoundingClientRect(),bar=n.querySelector(".se-bar").getBoundingClientRect(),track=n.querySelector(".se-bar-track").getBoundingClientRect(),count=n.querySelector("b").getBoundingClientRect(),card=n.closest(".card").getBoundingClientRect();return bar.right<=track.right+1&&bar.left>=label.right&&bar.right<count.left&&count.right<=card.right-8;})');
    suite.ok(bars.length>=5&&bars.every(Boolean),width+'/'+theme+' full-length hour bars leave room for every count');
    fs.writeFileSync(path.join(out,'hour-chart-'+width+'-'+theme+'.png'),await H.capturePng(win));
   }
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
