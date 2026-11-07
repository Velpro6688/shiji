'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-responsive');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 const measurements=[];
 async function resize(width,height){await H.resizeWindow(win,width,height);}
 try{
  await H.loadPage(win);await H.bootWait(win);win.showInactive();await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.memoNotes=[1,2,3,4,5,6].map((n,i)=>({id:"r"+n,title:"窗口自适应便签 "+n,html:"<p>拉伸窗口时，便签内容和操作都应清楚显示。</p>",text:"拉伸窗口时，便签内容和操作都应清楚显示。",ord:i}));renderMemoList();return true');
  for(const page of ['today','stat','memo','mine']){
   await H.evalJson(win,'go('+JSON.stringify(page)+');document.getElementById("scroll").scrollTop=0;return true');await H.sleep(300);
   for(const width of [1200,320,359,360,361,419,420,421,999,1000,1001,520,320]){
    await resize(width,480);
    const v=await H.evalJson(win,'var p=document.querySelector(".page.active"),s=document.getElementById("scroll"),n=document.querySelector("#app>.date-nav"),r=p.getBoundingClientRect(),b=document.querySelector("#app>.tabbar").getBoundingClientRect(),d=n.getBoundingClientRect(),ring=document.querySelector(".ring-card").getBoundingClientRect();return {anchor:CSS.supports("top","anchor(bottom)"),tb:document.querySelector(".topbar").getBoundingClientRect().bottom,rootTop:document.documentElement.style.getPropertyValue("--hb-topbar-h"),computedTop:getComputedStyle(n).top,inner:innerWidth,page:p.id,client:p.clientWidth,scroll:p.scrollWidth,padding:getComputedStyle(s).padding,left:r.left,top:r.top,nav:{left:d.left,right:d.right,bottom:d.bottom},ringTop:ring.top,tab:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},controls:[...document.querySelectorAll(".header-actions button,.header-brand")].every(n=>{var r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})}');
    measurements.push({width,...v});
    suite.ok(v.inner===width&&v.scroll<=v.client+1&&v.controls,width+'/'+page+' fits without horizontal overflow or clipped header '+JSON.stringify(v));
    if(page==='today')suite.ok(v.ringTop-v.nav.bottom>=8&&v.ringTop-v.nav.bottom<=20&&(width<1000||Math.abs(v.nav.left-v.tab.right)<2),width+' date navigation stays aligned and clear of content '+JSON.stringify(v));
    if(page==='memo')suite.ok(v.top>=50&&(width>=1000?v.tab.right<=v.left+1:v.tab.top>=400),width+' notes and navigation occupy separate regions '+JSON.stringify(v));
   }
  }
  await H.evalJson(win,'go("today");openAdd();document.querySelectorAll("#editorSheet details").forEach(n=>n.open=true);document.getElementById("edName").value="缩放窗口时保留输入";return true');await H.sleep(400);
  for(const size of [[1200,480],[999,480],[1000,480],[420,480],[320,480],[780,560],[520,720]]){
   await H.evalJson(win,'window.resizeFrames=[];var start=performance.now();function sample(){var r=document.getElementById("editorSheet").getBoundingClientRect();resizeFrames.push({width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom});if(performance.now()-start<400)requestAnimationFrame(sample);}requestAnimationFrame(sample);return true');
   await resize(...size);await H.sleep(350);
   const frames=await H.evalJson(win,'return resizeFrames');suite.metric('form-frames-'+size.join('x'),frames);
   suite.ok(frames.every(r=>r.top>=-1&&r.bottom<=r.height+1&&r.left>=-1&&r.right<=r.width+1),size.join('x')+' open form remains inside the window during resize');
   const v=await H.evalJson(win,'var s=document.getElementById("editorSheet"),b=s.querySelector(".sheet-body"),h=s.querySelector(".sheet-top").getBoundingClientRect(),f=s.querySelector(".sheet-footer").getBoundingClientRect(),r=s.getBoundingClientRect();b.scrollTop=b.scrollHeight;var last=document.getElementById("edRewardPer").getBoundingClientRect();return {value:document.getElementById("edName").value,inside:r.top>=0&&r.bottom<=innerHeight+1&&r.left>=0&&r.right<=innerWidth+1,body:b.getBoundingClientRect().toJSON(),header:h.toJSON(),footer:f.toJSON(),last:last.toJSON()}');
   suite.ok(v.inside&&v.value==='缩放窗口时保留输入'&&v.header.bottom<=v.body.top+1&&v.body.bottom<=v.footer.top+1&&v.last.bottom<=v.footer.top+1,size.join('x')+' resizing open form retains input and visible actions '+JSON.stringify(v));
  }
  await H.evalJson(win,'closeSheet(true);return true');await H.sleep(400);
  await H.evalJson(win,'openHabitManager();return true');await H.sleep(400);
  for(const width of [1200,999,1000,320,600,599,520]){
   await H.evalJson(win,'window.managerFrames=[];var start=performance.now();function sample(){var r=document.getElementById("habitManager").getBoundingClientRect(),c=document.querySelector(".hm-close").getBoundingClientRect(),body=document.querySelector(".hm-body").getBoundingClientRect();managerFrames.push({width:innerWidth,height:innerHeight,left:r.left,right:r.right,top:r.top,bottom:r.bottom,closeBottom:c.bottom,bodyRight:body.right});if(performance.now()-start<400)requestAnimationFrame(sample);}requestAnimationFrame(sample);return true');
   await resize(width,480);await H.sleep(350);
   const frames=await H.evalJson(win,'return managerFrames');suite.metric('manager-frames-'+width,frames);
   suite.ok(frames.every(r=>r.top>=-1&&r.bottom<=r.height+1&&r.left>=-1&&r.right<=r.width+1&&r.closeBottom<=r.bottom&&r.bodyRight<=r.right),width+' manager and internal scrollbar stay inside during resizing');
  }
  await H.evalJson(win,'closeHabitManager();return true');
  for(const theme of ['light','dark']){
   await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("today");return true');
   await resize(1000,560);await H.sleep(200);
   suite.ok(await H.evalJson(win,'document.documentElement.style.setProperty("--hb-topbar-h","200px");document.documentElement.style.setProperty("--hb-content-left","0px");document.documentElement.style.setProperty("--hb-content-width","100px");var n=document.querySelector("#app>.date-nav").getBoundingClientRect(),t=document.querySelector(".topbar").getBoundingClientRect(),p=document.getElementById("page-today").getBoundingClientRect();var aligned=Math.abs(n.top-t.bottom)<1.5&&Math.abs(n.left-176)<1.5&&Math.abs(n.right-innerWidth)<1.5;hbLayoutSync();return aligned'),theme+' date navigation uses current layout even when JS measurements are stale');
   fs.writeFileSync(path.join(out,'responsive-wide-'+theme+'.png'),await H.capturePng(win));
   await resize(320,480);await H.sleep(200);
   fs.writeFileSync(path.join(out,'responsive-small-'+theme+'.png'),await H.capturePng(win));
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{suite.metric('measurements',measurements);win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
