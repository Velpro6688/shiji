'use strict';
const {app}=require('electron');
const fs=require('fs'),path=require('path');
const H=require('./_harness');
const suite=H.makeSuite('verify-header');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();return true');
  suite.ok(await H.evalJson(win,'return document.getElementById("pinTodayDesktop").textContent.includes("贴便签")&&document.querySelector(".me-pin").textContent.includes("贴便签")&&document.querySelector(".me-pin").getAttribute("aria-label")==="贴便签";'),'main and editor pin actions use the requested label');
  for(const width of [320,365,520,1200]){
   win.setSize(width,720);await H.sleep(120);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("today");return true');await H.sleep(100);
    const value=await H.evalJson(win,'var h=document.querySelector(".topbar"),row=document.querySelector(".header-main"),controls=document.querySelector(".win-bar"),pin=document.getElementById("pinTodayDesktop"),avatar=document.getElementById("tbAva"),s=getComputedStyle(h);return {header:h.getBoundingClientRect().toJSON(),row:row.getBoundingClientRect().toJSON(),controls:controls.getBoundingClientRect().toJSON(),avatar:avatar.getBoundingClientRect().toJSON(),pin:pin.getBoundingClientRect().toJSON(),padding:[s.paddingLeft,s.paddingRight],hit:document.elementFromPoint(pin.getBoundingClientRect().x+pin.offsetWidth/2,pin.getBoundingClientRect().y+pin.offsetHeight/2).closest("#pinTodayDesktop")!==null}');
    suite.metric(width+'-'+theme,value);
    suite.ok(value.header.height<=72&&value.controls.right<=width-8&&value.controls.right>=width-30&&value.avatar.right<value.pin.left&&value.hit,width+'/'+theme+' header controls align, fit and accept clicks');
    fs.writeFileSync(path.join(out,'header-'+width+'-'+theme+'.png'),await H.capturePng(win));
   }
  }
  await win.webContents.executeJavaScript('(async()=>{data.memoNotes=[{id:"one",title:"不应显示的标题",html:"<p>正文示例：展示更多便签内容。</p>",text:"正文示例",ord:1},{id:"two",html:"<p>第二张</p>",text:"第二张",ord:2}];await saveMemoFields();localStorage.setItem("hb_sticky_note","one");await pinTodayToDesktop();})()');
  for(const width of [200,320,365,520]){
   win.setSize(width,480);await H.sleep(120);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();return true');await H.sleep(200);
    const value=await H.evalJson(win,'var mode=document.getElementById("wfMode").getBoundingClientRect(),lock=document.querySelector(".win-fab[data-act=lock]").getBoundingClientRect(),body=document.getElementById("memoInput").getBoundingClientRect();return {pager:!!document.querySelector("#stickyPrev,#stickyNext,#stickyNotePosition,#stickyNoteNavigation"),mode:mode.toJSON(),lock:lock.toJSON(),body:body.toJSON(),hit:document.elementFromPoint(mode.x+mode.width/2,mode.y+mode.height/2).closest("#wfMode")!==null}');
    suite.ok(!value.pager&&value.mode.right<=value.lock.left&&value.lock.bottom<=value.body.top&&value.hit,width+'/'+theme+' swipe-only sticker hides pager and keeps window actions clear of content');
    fs.writeFileSync(path.join(out,'sticky-'+width+'-'+theme+'.png'),await H.capturePng(win));
   }
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
