'use strict';
const {app}=require('electron');
const fs=require('fs');
const H=require('./_harness.js');
const suite=H.makeSuite('verify-import-transaction');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const w=H.makeWin(suite,{offscreen:true});const originalCopy=fs.cpSync;
 try{
  await H.loadPage(w);await H.bootWait(w);await H.sleep(2100);await H.evalJson(w,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();return true');
  await w.webContents.executeJavaScript('flushRendererChanges()');
  const before=await H.evalJson(w,'return data.habits.map(function(h){return h.key}).join(",")');
  const trigger='var source={days:{},habits:[{key:"transaction-new",name:"新导入",type:"bool",icon:"✓",color:"#0071e3"}],meta:{},settings:{sound:false},profile:{name:"Test"},memo:{html:"",text:""},memoNotes:[]};importBackupFile(new File([JSON.stringify(source)],"transaction.json",{type:"application/json"}));return true';
  fs.cpSync=function(){throw new Error('图片复制失败（故障注入）');};
  await H.evalJson(w,trigger);await H.sleep(150);await H.evalJson(w,'document.getElementById("confirmOk").click();return true');await H.sleep(500);
  let value=await H.evalJson(w,'return {keys:data.habits.map(function(h){return h.key}).join(","),message:document.getElementById("toastWrap").innerText}');
  suite.ok(value.keys===before&&value.message.includes('导入失败'),'failed pre-import backup leaves the original document intact and reports failure');
  fs.cpSync=originalCopy;
  await H.evalJson(w,trigger);await H.sleep(150);await H.evalJson(w,'document.getElementById("confirmOk").click();return true');await H.sleep(600);
  value=await H.evalJson(w,'return data.habits.some(function(h){return h.key==="transaction-new"})');suite.ok(value,'retry completes import only after a successful backup');
  await H.drainPageErrs(w,suite);
 }catch(error){suite.errs.push(error.stack);}finally{fs.cpSync=originalCopy;w.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
