'use strict';
const { app } = require('electron');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-audit-workflows');
H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async function(){
  const win=H.makeWin(suite,{show:false,offscreen:true,frame:false,width:520,height:720});let editor;
  const read=body=>H.evalJson(win,body);
  try {
    await H.loadPage(win);await H.bootWait(win);await H.sleep(2100);
    await read('var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.habits=Array.from({length:6},function(_,i){return {key:"a"+i,name:"习惯"+i,type:"bool",icon:"✓",color:"#0071e3",size:"wide",createdAt:daysAgoStr(89)}});syncHabits();data.days={};data.days[todayStr()]={a0:true};renderAll();go("today");return true');
    await read('document.querySelector("[data-filter=done]").click();jumpToHabit("a5");return true');await H.sleep(850);
    let value=await read('var c=document.querySelector(".hcard[data-habit-key=a5]");var r=c&&c.getBoundingClientRect(),top=document.querySelector("#app>.date-nav").getBoundingClientRect().bottom,bottom=document.querySelector(".tabbar").getBoundingClientRect().top;return {exists:!!c,flash:c&&c.classList.contains("flash"),top:r&&r.top,bottom:r&&r.bottom,usableTop:top,usableBottom:bottom,scroll:document.getElementById("scroll").scrollTop}');
    suite.ok(value.exists&&value.flash&&value.scroll>0&&value.top>=value.usableTop&&value.bottom<=value.usableBottom, 'filtered target becomes visible and actually scrolls into the usable viewport');
    await read('viewDate=daysAgoStr(1);viewDateLabel();renderAll();jumpToHabit("a5");return true');await H.sleep(850);
    value=await read('return {date:viewDate,expected:daysAgoStr(1)}');suite.ok(value.date===value.expected,'jump preserves the selected historical date');
    value=await read('var day={};for(var i=0;i<150;i++)day["h"+i]=1;var raw={days:{},habits:[]};raw.days[todayStr()]=day;return Object.keys(normalizeImported(raw).days[todayStr()]).length');
    suite.ok(value===150,'import retains all 150 daily fields');
    value=await read('var d={habits:[{key:"h1"}],days:{}};d.days[todayStr()]={h1:true,h1_done:1,h1_tsb:1,_late:1};return recoverOrphanHabitRecords(d)');suite.ok(value===0,'metadata does not create ghost habits');
    value=await read('data.habits=[{key:"count",name:"喝水",type:"count",target:2,unit:"杯",icon:"💧",color:"#0071e3",size:"wide",createdAt:daysAgoStr(89)}];syncHabits();data.days[viewDate]={count:4,count_t:8};localStorage.setItem("hb_admin_mode","1");renderAll();var label=document.querySelector("#checkinList .info").textContent;addCount("count",1,null);return {label:label,value:data.days[viewDate].count}');suite.ok(value.label==='4/8 杯'&&value.value===5,'historical target displays correctly and plus one increases the value');
    await read('viewDate=todayStr();data.habits=[{key:"hours",name:"专注",type:"hours",target:1,unit:"小时",icon:"📖",color:"#0071e3",size:"wide",createdAt:todayStr(),reward:{per:"hour",text:"休息",minutes:5}}];syncHabits();data.days[todayStr()]={};data.meta.rewardQueue=[];data.meta.rewardHourAcc={};data.meta.rewardRun={key:"hours",text:"正在休息",min:5,total:300,endAt:Date.now()+300000};data.meta.activeTimer={key:"hours",totalSeconds:3600,remainingSeconds:3600,endAt:Date.now()-10,dayKey:todayStr(),paused:false};tickTimer();return true');
    value=await read('return {hours:data.days[todayStr()].hours,stamp:data.days[todayStr()].hours_ts,rewards:rwQueue().length}');suite.ok(value.hours===1&&/^\d{2}:\d{2}$/.test(value.stamp)&&value.rewards===1,'focus completion records timestamp and earns reward while another reward is running');
    await win.webContents.executeJavaScript('flushRendererChanges()',true);
    editor=H.makeWin(suite,{show:false,offscreen:true,width:360,height:480});await H.loadPage(editor,{view:'editor',sticky:'1'});await H.bootWait(editor);
    await read('data.days[todayStr()].hours=7;save();return true');await H.sleep(500);
    value=await H.evalJson(editor,'return (data.days[todayStr()]||{}).hours');suite.ok(value===7,'independent editor receives updated progress');
    value=await read('data.habits=[{key:"only",name:"审查",type:"bool",createdAt:daysAgoStr(89),color:"#0071e3",icon:"✓"}];syncHabits();data.days={};data.days[todayStr()]={only:true};renderAll();renderStatExtras();document.querySelector("#statExtras details").open=true;return {all:completionRate("only"),weekday:document.querySelector("#statExtras .se-card:last-child").innerText}');suite.ok(value.all===1&&!value.weekday.includes('100%'),'weekday denominator includes days without records');
    value=await win.webContents.executeJavaScript('(async()=>{data.profile.motto="导出前的最新内容";saveDebounced();await flushRendererChanges();var r=await hbShell.exportDoc();return r.doc.profile.motto})()',true);suite.ok(value==='导出前的最新内容','export snapshot contains the last debounced edit');
    await H.drainPageErrs(win,suite);await H.drainPageErrs(editor,suite);
  }catch(error){suite.errs.push(error.stack);}
  finally{try{if(editor)editor.destroy();win.destroy();}catch(_){}H.finish(suite);app.exit(suite.errs.length?1:0);}
});
