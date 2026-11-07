'use strict';
const {app,screen}=require('electron');
const H=require('./_harness');
const scale=Number(process.argv[2])||1.25;
app.commandLine.appendSwitch('force-device-scale-factor',String(scale));
const suite=H.makeSuite('verify-scale-'+String(scale).replace('.','-'));H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{show:true,width:520,height:720});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();return true');
  suite.metric('displays',screen.getAllDisplays().map(d=>({scale:d.scaleFactor,size:d.size,workArea:d.workArea})));
  const dpr=await H.evalJson(win,'return devicePixelRatio');suite.metric('devicePixelRatio',dpr);suite.ok(Math.abs(dpr-scale)<.05,'Chromium runs at requested device pixel ratio '+scale);
  for(const [width,height] of [[320,480],[520,720],[1200,860]]){
   win.setSize(width,height);await H.sleep(100);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("today");return true');
    for(const page of ['today','stat','memo','mine']){
     await H.evalJson(win,'go('+JSON.stringify(page)+');return true');await H.sleep(60);
     const geometry=await H.evalJson(win,'var p=document.querySelector(".page.active"),b=document.getElementById("pinTodayDesktop").getBoundingClientRect(),bar=document.querySelector(".win-bar").getBoundingClientRect();return {overflow:p.scrollWidth-p.clientWidth,button:b.toJSON(),bar:bar.toJSON(),vw:innerWidth}');
     suite.ok(geometry.overflow<=1&&geometry.button.left>=0&&geometry.button.right<=geometry.vw,scale+'/'+width+'/'+theme+'/'+page+' page and desktop button fit');
    }
    await H.evalJson(win,'openAdd();return true');await H.sleep(400);
    const sheet=await H.evalJson(win,'var f=document.querySelector("#editorSheet .sheet-footer").getBoundingClientRect(),b=document.querySelector("#editorSheet .sheet-body").getBoundingClientRect();return {f:f.toJSON(),b:b.toJSON(),vh:innerHeight}');suite.ok(sheet.b.bottom<=sheet.f.top+1&&sheet.f.bottom<=sheet.vh+1,'scaled editor footer stays separate and visible');
    await H.evalJson(win,'closeSheet(true);return true');await H.sleep(400);
   }
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
