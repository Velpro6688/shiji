'use strict';
const {app}=require('electron');
const H=require('./_harness');
const fs=require('fs'),path=require('path');
const shots=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(shots,{recursive:true});
async function shot(win,name){await evaluate(win,'document.querySelectorAll("#toastWrap .toast").forEach(n=>n.remove());return true');await H.sleep(350);fs.writeFileSync(path.join(shots,name+'.png'),await H.capturePng(win));}
async function evaluate(win,body){return win.webContents.executeJavaScript('(async function(){'+body+'})()');}
const suite=H.makeSuite('verify-v260');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const w=H.makeWin(suite,{offscreen:true,width:520,height:720});
 try{
  await H.loadPage(w);await H.bootWait(w);await H.sleep(2200);
  await evaluate(w,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.habits=[{key:"plan",name:"计划",type:"bool",icon:"✓",color:"#0071e3",createdAt:daysAgoStr(14)},{key:"focus",name:"专注",type:"hours",target:1,icon:"◷",color:"#0071e3",createdAt:daysAgoStr(14)}];data.days={};data.meta={};syncHabits();renderAll();return true');
  let v=await evaluate(w,'openEdit("plan");document.getElementById("edScheduleMode").value="weekly";document.getElementById("edWeeklyTimes").value=3;document.getElementById("edPinned").checked=true;updateScheduleEditor();saveHabit();return {pinned:HMAP.plan.pinned,rule:window.HabitRules.rule(HMAP.plan,todayStr()).mode,history:HMAP.plan.scheduleHistory[0].from}');
  suite.ok(v.pinned&&v.rule==='weekly'&&v.history,'editor saves pin and a dated weekly schedule');await H.sleep(400);
  v=await evaluate(w,'renderCheckin();return {first:document.querySelector("#checkinList .hcard").dataset.habitKey,weekly:!!document.querySelector(".weekly-progress")}');suite.ok(v.first==='plan'&&v.weekly,'pinned habit is first and weekly progress is visible');
  await shot(w,'today-planned');
  v=await evaluate(w,'document.querySelector("[data-filter=pinned]").click();return document.querySelectorAll("#checkinList .hcard").length');suite.ok(v===1,'pinned filter selects the pinned habit');
  await evaluate(w,'window.HabitUI.resetFilter();openHabitTimeOff("plan");document.getElementById("timeOffKind").value="leave";document.getElementById("timeOffFrom").value=todayStr();document.getElementById("timeOffTo").value=daysAgoStr(-2);saveHabitTimeOff();return true');await H.sleep(400);
  v=await evaluate(w,'return {due:window.HabitRules.due(HMAP.plan,todayStr(),data.days),present:habitsVisibleOn(todayStr()).some(h=>h.key==="plan"),history:data.days}');suite.ok(!v.due&&!v.present&&Object.keys(v.history).length===0,'leave removes the obligation without fabricating records');
  v=await evaluate(w,'var source=JSON.parse(JSON.stringify(data));source.habits[0].scheduleHistory=[{from:todayStr(),rule:{mode:"weekdays",days:[1,3,5]}}];return normalizeImported(source).habits[0]');suite.ok(v.scheduleHistory[0].rule.days.join(',')==='1,3,5'&&v.pauseRanges.length===1&&v.pinned,'import preserves nested schedules, time off and pinning');
  v=await evaluate(w,'renderStat();return {report:!!document.getElementById("insightReport"),rule:document.querySelector(".report-definition").textContent.includes("每周") }');suite.ok(v.report&&v.rule,'report shows explicit quota and pause definitions');
  await evaluate(w,'go("stat");return true');await shot(w,'insights');
  await evaluate(w,'await flushRendererChanges();await window.hbShell.backupNow();await openBackupHistory();return true');
  v=await evaluate(w,'return {entry:!!document.getElementById("backupHistoryEntry"),rows:document.querySelectorAll(".backup-history-item").length,preview:document.getElementById("backupHistoryList").textContent.includes("预览恢复")}');suite.ok(v.entry&&v.rows>0&&v.preview,'backup history displays verified snapshots and preview controls');await shot(w,'backup-history');
  await evaluate(w,'closeSheet(true);data.meta.activeTimer={key:"focus",totalSeconds:600,remainingSeconds:420,endAt:Date.now()-3600000,dayKey:todayStr(),paused:false};prepareTimerRecovery();return true');await H.sleep(1000);
  v=await evaluate(w,'return {paused:activeTimer().paused,pending:activeTimer().recoveryPending,hours:(dayObj(todayStr())||{}).focus||0}');suite.ok(v.paused&&v.pending&&v.hours===0,'restart does not silently count time while the app was absent');
  await evaluate(w,'await resolveTimerRecovery("settle");return true');
  v=await evaluate(w,'return {hours:dayObj(todayStr()).focus,timer:activeTimer()}');suite.ok(Math.abs(v.hours-0.05)<1e-8&&!v.timer,'recovery settles only the checkpointed elapsed time once');
  await evaluate(w,'await resolveTimerRecovery("settle");return true');v=await evaluate(w,'return dayObj(todayStr()).focus');suite.ok(Math.abs(v-0.05)<1e-8,'a repeated settlement cannot double count');
  await evaluate(w,'data.memoNotes=[{id:"first",title:"一",html:"<p>第一张</p>",text:"第一张",ord:1,ts:1},{id:"second",title:"二",html:"<p>第二张</p>",text:"第二张",ord:2,ts:2}];curNoteId=null;localStorage.setItem("hb_sticky_note","second");await saveMemoFields();await pinTodayToDesktop();return true');await H.sleep(600);
  v=await evaluate(w,'return {id:curNoteId,html:document.getElementById("memoInput").innerText,locked:document.body.classList.contains("app-locked"),mode:currentStickyMode()}');suite.ok(v.id==='second'&&v.html.includes('第二张')&&v.locked&&v.mode==='note','main button directly restores the last pinned note');await shot(w,'desktop-note');
  await evaluate(w,'await switchStickyNote(1);return true');v=await evaluate(w,'return {id:curNoteId,remembered:localStorage.getItem("hb_sticky_note"),counter:!!document.getElementById("stickyNotePosition"),html:document.getElementById("memoInput").innerText}');suite.ok(v.id==='first'&&v.remembered==='first'&&!v.counter&&v.html.includes('第一张'),'next wraps in list order and remembers the selected note without a page counter');
  v=await evaluate(w,'return document.getElementById("memoInput").getAttribute("contenteditable")');suite.ok(v==='false','switching a main-window sticker preserves its read-only protection');
  await evaluate(w,'await switchStickyNote(-1);return true');v=await evaluate(w,'return curNoteId');suite.ok(v==='second','previous switches back without opening another editor');
  await evaluate(w,'data.memoNotes=data.memoNotes.slice(0,1);renderStickyNavigation();window.oneNoteId=curNoteId;await switchStickyNote(1);return true');v=await evaluate(w,'return curNoteId===oneNoteId&&!document.querySelector("#stickyPrev,#stickyNext")');suite.ok(v,'single-note swipe does not switch or create pager buttons');
  await evaluate(w,'data.memoNotes=[{id:"first",title:"第一张标题",html:"<p>旧正文</p>",text:"旧正文",ord:1,ts:1},{id:"second",title:"第二张标题",html:"<p>第二张</p>",text:"第二张",ord:2,ts:2}];await saveMemoFields();return true');
  const editor=H.makeWin(suite,{offscreen:true,width:320,height:480});
  try{
    await H.loadPage(editor,{view:'editor',note:'first',sticky:'1'});await H.bootWait(editor);await H.sleep(300);
    await evaluate(editor,'curNoteId="first";renderNoteToEditor(curNote(),true);document.getElementById("memoInput").innerHTML="<p>切换前最后输入</p>";saveMemoHtml(true);await switchStickyNote(1);return true');
    v=await evaluate(editor,'return {id:curNoteId,title:document.getElementById("memoEdTitle").value,text:document.getElementById("memoInput").innerText}');
    const saved=H.storeInternal().ensureDoc().memoNotes;
    suite.ok(v.id==='second'&&v.title==='第二张标题'&&v.text.includes('第二张')&&saved.find(n=>n.id==='first').text.includes('切换前最后输入'),'editor switching flushes the final debounced draft to disk and updates the title');
    const write=fs.promises.writeFile;
    fs.promises.writeFile=async function(file,...args){if(String(file).endsWith('data.json.tmp'))throw new Error('injected disk failure');return write.call(this,file,...args);};
    try{await evaluate(editor,'document.getElementById("memoInput").innerHTML="<p>失败时保留</p>";saveMemoHtml(true);await switchStickyNote(1);return true');}
    finally{fs.promises.writeFile=write;}
    v=await evaluate(editor,'return {id:curNoteId,text:document.getElementById("memoInput").innerText}');suite.ok(v.id==='second'&&v.text.includes('失败时保留'),'failed save blocks switching and preserves current editor content');
    await editor.webContents.executeJavaScript('flushRendererChanges()');await H.drainPageErrs(editor,suite);
  }finally{editor.destroy();}
  await H.drainPageErrs(w,suite);
 }catch(e){suite.errs.push(e.stack);}finally{w.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
