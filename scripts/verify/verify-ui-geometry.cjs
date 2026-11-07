'use strict';
const {app}=require('electron');
const H=require('./_harness.js');
const suite=H.makeSuite('verify-ui-geometry');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
  const w=H.makeWin(suite,{offscreen:true,frame:false,transparent:true,backgroundColor:'#00000000',width:520,height:720});
  try{
    await H.loadPage(w);await H.bootWait(w);await H.sleep(2100);
    await H.evalJson(w,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();return true');
    for(const [width,height] of [[320,480],[520,720],[780,900],[1200,860]]){
      w.setSize(width,height);await H.sleep(200);
      for(const theme of ['light','dark']){
        await H.evalJson(w,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();go("today");document.getElementById("scroll").scrollTop=0;return true');await H.sleep(150);
        let value=await H.evalJson(w,'var r=document.querySelector("#ringWrap svg").getBoundingClientRect(),c=document.querySelector(".ring-center").getBoundingClientRect();return {w:r.width,h:r.height,cx:c.x+c.width/2,cy:c.y+c.height/2,rx:r.x+r.width/2,ry:r.y+r.height/2}');
        suite.ok(Math.abs(value.w-value.h)<1&&Math.abs(value.cx-value.rx)<1&&Math.abs(value.cy-value.ry)<1,width+'/'+theme+' ring is square and the text shares its centre');
        if(width>=1000){
          value=await H.evalJson(w,'var n=document.querySelector("#app>.date-nav").getBoundingClientRect(),t=document.querySelector("#app>.tabbar").getBoundingClientRect(),a=document.getElementById("app").getBoundingClientRect(),h=document.querySelector(".topbar").getBoundingClientRect();return {nav:n.toJSON(),tabs:t.toJSON(),app:a.toJSON(),header:h.toJSON()}');
          suite.ok(Math.abs(value.nav.left-value.tabs.right)<1.5&&Math.abs(value.nav.right-value.app.right)<2&&Math.abs(value.nav.top-value.header.bottom)<1.5,width+'/'+theme+' date navigation joins the header without covering the sidebar');
        }
        for(const page of ['today','stat','memo','mine']){
          await H.evalJson(w,'go('+JSON.stringify(page)+');return true');await H.sleep(80);
          value=await H.evalJson(w,'var p=document.querySelector(".page.active");return {client:p.clientWidth,scroll:p.scrollWidth}');suite.ok(value.scroll<=value.client+1,width+'/'+theme+'/'+page+' has no unintended horizontal overflow');
        }
        await H.evalJson(w,'go("today");openAdd();return true');await H.sleep(400);
        value=await H.evalJson(w,'var s=document.getElementById("editorSheet"),head=s.querySelector(".sheet-top").getBoundingClientRect(),body=s.querySelector(".sheet-body").getBoundingClientRect(),footer=s.querySelector(".sheet-footer").getBoundingClientRect(),button=s.querySelector(".btn-primary").getBoundingClientRect();return {head:head.toJSON(),body:body.toJSON(),footer:footer.toJSON(),button:button.toJSON(),vh:innerHeight}');
        suite.ok(value.head.bottom<=value.body.top+1&&value.body.bottom<=value.footer.top+1&&value.button.bottom<=value.vh&&value.button.top>=value.footer.top,width+'/'+theme+' form content and save action never overlap');
        await H.evalJson(w,'document.querySelectorAll("#editorSheet details").forEach(function(n){n.open=true});var b=document.querySelector("#editorSheet .sheet-body");b.scrollTop=b.scrollHeight;return true');await H.sleep(100);
        value=await H.evalJson(w,'var last=document.getElementById("edRewardPer").getBoundingClientRect(),footer=document.querySelector("#editorSheet .sheet-footer").getBoundingClientRect();return {last:last.toJSON(),footer:footer.toJSON()}');
        suite.ok(value.last.bottom<=value.footer.top+1&&value.last.height>0,width+'/'+theme+' the last form control can scroll fully above the save area');
        await H.evalJson(w,'closeSheet(true);return true');await H.sleep(380);
      }
    }
    await H.drainPageErrs(w,suite);
  }catch(error){suite.errs.push(error.stack);}
  finally{w.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
