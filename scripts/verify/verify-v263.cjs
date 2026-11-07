'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-v263');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
async function evaluate(w,body){return w.webContents.executeJavaScript('(async()=>{'+body+'})()');}
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:365,height:720,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(2200);
  await evaluate(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.days={};data.meta={};return true');
  let v=await evaluate(win,'var start=HabitRules.week(todayStr());data.habits=[{key:"weekly",name:"每周运动",icon:"🏃",type:"bool",color:"#0071e3",createdAt:daysAgoStr(30),schedule:{mode:"weekly",times:1}}];data.days={};data.days[start]={weekly:true};syncHabits();viewDate=HabitRules.shift(start,1);renderAll();return document.getElementById("ringTitle").textContent.includes("本周计划已完成")&&!document.getElementById("ringTodo").textContent.includes("还没有习惯")');suite.ok(v,'completed weekly quota is distinguished from no habits');
  v=await evaluate(win,'data.habits=[{key:"arch",name:"归档",type:"bool",createdAt:daysAgoStr(13),archived:true,archivedAt:daysAgoStr(6)}];data.days={};syncHabits();editingKey="arch";toggleHabitArchive();return HabitRules.stats(HMAP.arch,daysAgoStr(13),todayStr(),data.days).expected===8&&HMAP.arch.pauseRanges[0].to===daysAgoStr(1)');suite.ok(v,'archive restoration preserves inactive days and resumes today');
  v=await evaluate(win,'HMAP.arch.deleted=true;HMAP.arch.deletedAt=daysAgoStr(2);restoreHabit("arch");return HMAP.arch.pauseRanges.some(r=>r.from===daysAgoStr(2)&&r.to===daysAgoStr(1))');suite.ok(v,'deleted habit restoration preserves its inactive interval');
  v=await evaluate(win,'data.habits=[{key:"streak",name:"连续",type:"bool",createdAt:daysAgoStr(10)}];data.days={};for(var i=1;i<=10;i++)data.days[daysAgoStr(i)]={streak:true};syncHabits();HMAP.streak.scheduleHistory=[{from:todayStr(),rule:{mode:"weekly",times:3}}];streakCacheReset();return maxStreakAll()===10&&streakOf("streak")===0');suite.ok(v,'daily achievements survive a weekly plan change without being counted as weeks');
  await evaluate(win,'data.habits=[{key:"dates",name:"日期跳转",icon:"✓",type:"bool",color:"#0071e3",createdAt:daysAgoStr(13)}];data.days={};data.days[daysAgoStr(1)]={dates:true};syncHabits();viewDate=todayStr();renderAll();go("stat");insightMode="month";statSelectedMonth=daysAgoStr(1).slice(0,7);renderInsights();openInsightDates("dates");[...document.querySelectorAll("#insightDateList button")].find(b=>b.textContent.startsWith(daysAgoStr(1))).click();return true');await H.sleep(500);
  v=await evaluate(win,'return viewDate===daysAgoStr(1)&&document.querySelector("#checkinList .hcard").classList.contains("done")&&document.querySelector(".ring-center").textContent.includes("100")');suite.ok(v,'report date navigation refreshes card and ring to the actual record');
  for(const width of [320,365,520]){win.setSize(width,720);await H.sleep(100);for(const theme of ['light','dark']){
   v=await evaluate(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();var b=document.getElementById("btnBackToday").getBoundingClientRect(),n=document.querySelector(".date-nav").getBoundingClientRect();return b.top>=n.top&&b.bottom<=n.bottom&&b.right<=n.right&&b.height<40');suite.ok(v,width+'/'+theme+' back-to-today stays inside the date bar');
   if(width===520){await H.sleep(400);fs.writeFileSync(path.join(out,'date-navigation-'+width+'-'+theme+'.png'),await H.capturePng(win));}
  }}
  v=await evaluate(win,'go("stat");renderStat();var p=document.querySelector(".stat-month-picker");p.value="2099-01";p.dispatchEvent(new Event("change",{bubbles:true}));return p.value===(statSelectedMonth||todayStr().slice(0,7))&&p.closest("#insightReport")!==null');suite.ok(v,'month control is beside the report and rejects invalid values visibly');
  await evaluate(win,'data.habits=[{key:"future",name:"运动",icon:"🏃",type:"bool",color:"#0071e3",createdAt:todayStr(),pauseRanges:[{from:daysAgoStr(-5),to:"",kind:"pause"}]}];syncHabits();openHabitTimeOff("future");return true');
  await evaluate(win,'document.querySelectorAll("#toastWrap .toast").forEach(n=>n.remove());return true');await H.sleep(400);fs.writeFileSync(path.join(out,'future-time-off.png'),await H.capturePng(win));
  v=await evaluate(win,'return document.getElementById("futureTimeOffList").textContent.includes("取消预定")&&habitAvailabilityControls(HMAP.future).includes("预定")');suite.ok(v,'future time off is visible with edit and cancellation controls');
  v=await evaluate(win,'document.querySelector("#futureTimeOffList button").click();document.getElementById("timeOffFrom").value=daysAgoStr(-6);saveHabitTimeOff();return HMAP.future.pauseRanges.length===1&&HMAP.future.pauseRanges[0].from===daysAgoStr(-6)');suite.ok(v,'editing a future range replaces it without duplicate overlap');
  v=await evaluate(win,'openHabitTimeOff("future");document.querySelectorAll("#futureTimeOffList button")[1].click();document.getElementById("confirmOk").click();return HMAP.future.pauseRanges.length===0');suite.ok(v,'future time-off cancellation removes the pending range');
  await evaluate(win,'closeSheet(true);await flushRendererChanges();data.memoNotes=[{id:"a",title:"A",html:"<p>A旧</p>",text:"A旧",ord:1},{id:"b",title:"B",html:"<p>B旧</p>",text:"B旧",ord:2}];await saveMemoFields();return true');
  const editors=[];
  try{
   for(const id of ['a','b']){const e=H.makeWin(suite,{offscreen:true,width:365,height:520});editors.push(e);await H.loadPage(e,{view:'editor',note:id});await H.bootWait(e);await H.sleep(150);}
   async function snapshot(e,id,text){return evaluate(e,'curNoteId='+JSON.stringify(id)+';renderNoteToEditor(curNote(),true);document.getElementById("memoInput").innerHTML='+JSON.stringify('<p>'+text+'</p>')+';saveMemoHtml(false);clearTimeout(memoTimer);memoTimer=null;return noteSaveFields()');}
   let payload=await Promise.all(editors.map((e,i)=>snapshot(e,i?'b':'a',i?'B新内容':'A新内容')));
   await Promise.all(editors.map((e,i)=>evaluate(e,'return hbSaveFields('+JSON.stringify(payload[i])+')')));
   let notes=H.storeInternal().ensureDoc().memoNotes;suite.ok(notes.find(n=>n.id==='a').text==='A新内容'&&notes.find(n=>n.id==='b').text==='B新内容'&&notes.length===2,'concurrent edits to different notes preserve both contents');
   await H.sleep(150);payload=await Promise.all(editors.map((e,i)=>snapshot(e,'a','同条修改'+i)));
   await Promise.all(editors.map((e,i)=>evaluate(e,'return hbSaveFields('+JSON.stringify(payload[i])+')')));
   notes=H.storeInternal().ensureDoc().memoNotes;suite.ok(notes.some(n=>n.text==='同条修改0')&&notes.some(n=>n.text==='同条修改1'),'conflicting edits to one note preserve both versions');
   await H.sleep(150);const late=await snapshot(editors[0],'b','删除交错时的新草稿');
   await evaluate(win,'data.memoNotes=data.memoNotes.filter(n=>n.id!=="b");await saveMemoFields();return true');
   await evaluate(editors[0],'return hbSaveFields('+JSON.stringify(late)+')');notes=H.storeInternal().ensureDoc().memoNotes;
   suite.ok(!notes.some(n=>n.id==='b')&&notes.some(n=>n.text==='删除交错时的新草稿'&&n.id!=='b'),'editing a deleted note preserves a draft copy without resurrecting the original');
   await evaluate(win,'data.memoNotes=hbShell.dataLoadSync().doc.memoNotes;noteBases=new Map(data.memoNotes.map(n=>[n.id,noteContent(n)]));data.memoNotes.push({id:"pending",title:"未提交草稿",html:"<p>旧</p>",text:"旧"});await saveMemoFields();return true');await H.sleep(100);
   await evaluate(editors[0],'curNoteId="pending";renderNoteToEditor(curNote(),true);document.getElementById("memoInput").innerHTML="<p>仍在输入的正文</p>";saveMemoHtml(true);return true');
   await evaluate(win,'data.memoNotes=data.memoNotes.filter(n=>n.id!=="pending");await saveMemoFields();return true');await H.sleep(100);
   await evaluate(editors[0],'await flushRendererChanges();return true');notes=H.storeInternal().ensureDoc().memoNotes;
   suite.ok(!notes.some(n=>n.id==='pending')&&notes.some(n=>n.text==='仍在输入的正文'),'remote deletion during the input debounce preserves the uncommitted DOM draft');
   const count=notes.length;
   await evaluate(editors[0],'document.getElementById("memoInput").innerHTML="<p>连续修改一</p>";saveMemoHtml(false);var first=save();document.getElementById("memoInput").innerHTML="<p>连续修改二</p>";saveMemoHtml(false);var second=save();await Promise.all([first,second]);await flushRendererChanges();return true');notes=H.storeInternal().ensureDoc().memoNotes;
   suite.ok(notes.length===count&&notes.some(n=>n.text==='连续修改二'),'successive saves from the same editor do not create false conflict copies');
  }finally{for(const e of editors)e.destroy();}
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
