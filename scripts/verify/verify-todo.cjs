/* verify-todo —— 待办事项（3.1.0）回归
   真实窗口：待办页 CRUD/勾选/优先级排序/due 徽章/子任务联动/清空已完成/tab 红点/数字键 3 切页；
   贴纸待办卡三态切换、贴纸勾选、解锁直达待办页；导入清洗 normalizeImported。
   纯函数直测：reminders.js computeDue 待办计数 + check() 提醒/去重/并入汇总；backup-history summary 计数。 */
'use strict';
const {app}=require('electron'),fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-todo');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{offscreen:true,width:520,height:520,frame:false});
 const run=s=>H.evalJson(win,s);
 try{
  await H.loadPage(win);await H.bootWait(win);await H.sleep(600);
  await run(`window.addEventListener('unhandledrejection',function(e){console.log('[REJ-STACK] '+(e.reason&&e.reason.stack||e.reason));});var g=document.getElementById('guideSkip');if(g)g.click();hideConfirm();data.settings.sound=false;return true;`);

  /* —— 1) 切页与快速添加 —— */
  await run(`go('todo');return true;`);await H.sleep(120);
  suite.ok(await run(`return document.getElementById('page-todo').classList.contains('active')&&document.querySelector('.tab[data-tab=todo]').classList.contains('on');`),'go(todo) activates the todo page and tab');
  await run(`todoQuickAdd('买牛奶');return true;`);await H.sleep(80);
  suite.ok(await run(`return data.todos.length===1&&data.todos[0].text==='买牛奶'&&!!data.todos[0].id;`),'quick add stores a shaped todo');
  suite.ok(await run(`return document.querySelectorAll('#todoList .td-item').length===1;`),'list renders the new item');
  await run(`document.querySelector('#todoList .td-main').focus();return true;`);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Return'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Return'});await H.sleep(120);
  suite.ok(await run(`return !!document.querySelector('.sheet.show');`),'keyboard Enter on todo content opens editor');
  await run(`closeSheet(true);return true;`);
  suite.ok(await run(`return (window.hbSaveCalls||[]).length>0||typeof saveDebounced==='function';`),'save path available');
  await run(`var input=document.getElementById('todoInput');input.value='';return true;`);

  /* —— 2) 勾选/取消、置顶 —— */
  await run(`toggleTodo(data.todos[0].id);return true;`);await H.sleep(60);
  suite.ok(await run(`return data.todos[0].done===true&&data.todos[0].doneAt>0;`),'toggle marks done with doneAt');
  suite.ok(await run(`return document.querySelector('#todoList .td-item.done .td-check').getAttribute('aria-pressed')==='true';`),'done item renders checked');
  await run(`toggleTodo(data.todos[0].id);return true;`);await H.sleep(60);
  suite.ok(await run(`return data.todos[0].done===false&&data.todos[0].doneAt===null;`),'untoggle clears done state');

  /* —— 3) 优先级 + due 排序：置顶 > 逾期 > 今天 > 无日期 > 未来 —— */
  const today=await run(`return todayStr();`);
  await run(`data.todos=[
    {id:'t-a',text:'无优先级',priority:0,done:false,createdAt:1,due:null,pinned:false,subs:[]},
    {id:'t-b',text:'高优今天',priority:1,done:false,createdAt:2,due:'${today}',pinned:false,subs:[]},
    {id:'t-c',text:'中优逾期',priority:2,done:false,createdAt:3,due:'2026-10-20',pinned:false,subs:[]},
    {id:'t-d',text:'未来低优',priority:3,done:false,createdAt:4,due:'2027-01-01',pinned:false,subs:[]},
    {id:'t-e',text:'置顶未来',priority:0,done:false,createdAt:5,due:'2027-01-02',pinned:true,subs:[]}];
   renderTodoPage();return true;`);await H.sleep(80);
  suite.ok(await run(`return [...document.querySelectorAll('#todoList .td-item')].map(el=>el.dataset.tid).join(',')==='t-e,t-c,t-b,t-a,t-d';`),'sort = pinned, overdue, today, nodate, future then priority');
  suite.ok(await run(`return document.querySelector('.td-item[data-tid=t-c]').classList.contains('p-mid')&&document.querySelector('.td-item[data-tid=t-b]').classList.contains('p-high');`),'priority color class on item');

  /* —— 4) due 徽章文案 —— */
  suite.ok(await run(`return document.querySelector('.td-item[data-tid=t-b] .td-due').classList.contains('is-today');`),'today badge highlighted');
  suite.ok(await run(`return document.querySelector('.td-item[data-tid=t-c] .td-due').classList.contains('overdue');`),'overdue badge red');
  suite.ok(await run(`return document.querySelector('.td-item[data-tid=t-d] .td-due').textContent==='01/01';`),'future badge shows short date');

  /* —— 5) 子任务联动 —— */
  await run(`data.todos.find(t=>t.id==='t-a').subs=[{id:'s1',text:'第一步',done:false},{id:'s2',text:'第二步',done:false}];renderTodoPage();return true;`);
  suite.ok(await run(`return document.querySelector('.td-item[data-tid=t-a] .td-sub').textContent.indexOf('0/2')>=0;`),'subtask progress rendered');
  await run(`toggleTodoSub('t-a','s1');toggleTodoSub('t-a','s2');return true;`);await H.sleep(60);
  suite.ok(await run(`var t=data.todos.find(t=>t.id==='t-a');return t.done===true&&t.subs.every(s=>s.done);`),'all subtasks done auto-completes the todo');
  await run(`toggleTodoSub('t-a','s1');return true;`);await H.sleep(60);
  suite.ok(await run(`var t=data.todos.find(t=>t.id==='t-a');return t.done===false&&t.subs[1].done===true;`),'unticking a subtask un-completes the todo');

  /* —— 6) tab 红点 —— */
  suite.ok(await run(`return document.querySelector('.tab[data-tab=todo]').classList.contains('has-dot');`),'tab dot shows when due/overdue items exist');
  await run(`data.todos.forEach(t=>{t.due=null;t.pinned=false;});ensureTodoTabDot();return true;`);
  suite.ok(await run(`return !document.querySelector('.tab[data-tab=todo]').classList.contains('has-dot');`),'tab dot hides with nothing due');

  /* —— 7) 编辑抽屉 —— */
  await run(`openTodoEditor('t-b');return true;`);await H.sleep(100);
  suite.ok(await run(`return document.getElementById('todoEditSheet').classList.contains('show')&&document.getElementById('todoEditText').value==='高优今天';`),'editor sheet opens prefilled');
  await run(`document.getElementById('todoEditText').value='高优今天（改）';todoPickPri(1);document.getElementById('todoEditDue').value='${today}';todoAddSubRow();todoSubDraft[0].text='子步骤';saveTodoEditor();return true;`);await H.sleep(80);
  suite.ok(await run(`var t=data.todos.find(t=>t.id==='t-b');return t.text==='高优今天（改）'&&t.priority===1&&t.due==='${today}'&&t.subs.length===1&&t.subs[0].text==='子步骤';`),'editor saves text/priority/due/subtask');

  /* —— 8) 数字键 3 切页 —— */
  await run(`go('today');return true;`);await H.sleep(80);
  await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'3',bubbles:true}));`);
  await H.sleep(120);
  suite.ok(await run(`return document.getElementById('page-todo').classList.contains('active');`),'number key 3 jumps to todo page');

  /* —— 9) 清空已完成（确认流） —— */
  await run(`data.todos=[{id:'t-x',text:'已办1',done:true,doneAt:9,createdAt:1,due:null,pinned:false,subs:[]},{id:'t-y',text:'已办2',done:true,doneAt:8,createdAt:2,due:null,pinned:false,subs:[]},{id:'t-z',text:'未办',done:false,createdAt:3,due:null,pinned:false,subs:[]}];renderTodoPage();return true;`);
  suite.ok(await run(`return document.querySelectorAll('#todoList .td-done-list .td-item').length===2;`),'done group renders completed items');
  await run(`clearDoneTodos();return true;`);await H.sleep(120);
  await run(`var ok=document.getElementById('confirmOk');if(ok)ok.click();return true;`);await H.sleep(120);
  suite.ok(await run(`return data.todos.length===1&&data.todos[0].id==='t-z';`),'clear completed removes only done items after confirm');

  /* —— 10) 贴纸待办卡三态 —— */
  await run(`data.todos=[{id:'t-1',text:'今天要交报告',priority:1,done:false,createdAt:1,due:'${today}',pinned:false,subs:[]},{id:'t-2',text:'逾期账单',priority:0,done:false,createdAt:2,due:'2026-10-15',pinned:false,subs:[]},{id:'t-3',text:'无日期',priority:0,done:false,createdAt:3,due:null,pinned:false,subs:[]}];renderTodoPage();return true;`);
  await win.webContents.executeJavaScript("(async()=>{data.memoNotes=[{id:'todo-sticky-regression',ts:Date.now(),title:'便签',html:'<p>贴纸跳转测试</p>',text:'贴纸跳转测试'}];await saveMemoFields();await pinTodayToDesktop();setStickyMode('todo');})()");await H.sleep(150);
  suite.ok(await run(`return document.body.classList.contains('memo-editor-open');`),'regression fixture uses the real pin flow with an open memo layer');
  suite.ok(await run(`return document.body.classList.contains('m-sticky-todo')&&getComputedStyle(document.getElementById('stickyTodo')).display!=='none';`),'sticky todo mode activates the todo card');
  suite.ok(await run(`return document.querySelectorAll('#stickyTodo .st-td-item').length===2;`),'sticky card shows only due/overdue items');
  suite.ok(await run(`return !!document.querySelector('#stickyTodo .st-td-item.overdue');`),'overdue item marked on sticky card');
  /* 三态循环方向：today→todo→note→today；此处从 todo 起始 */
  suite.ok(await run(`toggleStickyMode();var a=currentStickyMode();toggleStickyMode();var b=currentStickyMode();toggleStickyMode();var c=currentStickyMode();return a==='note'&&b==='today'&&c==='todo';`),'mode button cycles note, today, todo');
  await run(`setStickyMode('todo');return true;`);await H.sleep(120);
  /* 贴纸勾选 */
  await run(`toggleTodo('t-1');return true;`);await H.sleep(100);
  suite.ok(await run(`var t=data.todos.find(t=>t.id==='t-1');return t.done===true&&document.querySelectorAll('#stickyTodo .st-td-item').length===1;`),'checking on the sticky card updates data and rerenders');

  /* —— 11) 解锁直达待办页 —— */
  await run(`document.querySelector('.st-td-open').click();return true;`);await H.sleep(300);
  suite.ok(await run(`return !document.body.classList.contains('app-locked')&&!document.body.classList.contains('m-sticky-todo')&&document.getElementById('page-todo').classList.contains('active');`),'open-from-sticky unlocks and lands on the todo page');
  suite.ok(await run(`return window._unlockTarget==null;`),'unlock target is consumed');
  suite.ok(await run(`var i=document.getElementById('todoInput'),r=i.getBoundingClientRect();return !document.body.classList.contains('memo-editor-open')&&getComputedStyle(document.getElementById('scroll')).display!=='none'&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===i;`),'todo input is visible and receives pointer input after unlocking');

  /* —— 12) 导入清洗 —— */
  const clean=await run(`var out=normalizeImported({days:{},habits:[],memo:{},memoNotes:[],todos:[
    {id:'x1',text:'正常',priority:9,due:'bad-date',subs:[{text:'保留'},{},null]},
    {text:'无id',done:'yes',createdAt:'x'},
    {id:'x1',text:'重复id'}]});return {n:out&&out.todos?out.todos.length:-1,first:out&&out.todos?out.todos[0]:null,dup:out&&out.todos?out.todos[2].id!==out.todos[0].id:false};`);
  if(!clean||clean.n!==3)console.log('[verify-todo] normalize clean =',JSON.stringify(clean));
  suite.ok(clean.n===3&&clean.first.priority===3&&clean.first.due===null&&clean.first.subs.length===1&&clean.first.subs[0].text==='保留'&&clean.first.done===false&&Number.isFinite(clean.first.createdAt),'normalizeImported clamps priority, drops bad dates, keeps valid subtasks and dedupes ids');
  suite.ok(clean.dup===true,'duplicate imported todo ids are rewritten');
  const legacy=await run(`var out=normalizeImported({days:{},habits:[],memo:{},memoNotes:[]});return Array.isArray(out.todos)&&out.todos.length===0;`,'legacy import without todos yields an empty array');
  suite.ok(legacy===true,'legacy backup without todos normalizes to []');

  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}

 /* —— 13) 提醒纯函数直测（reminders.js） —— */
 try{
  const {createReminders}=require(path.join(H.ROOT,'reminders.js'));
  const PROF=path.join(H.ROOT,'scripts','verify','profiles','verify-todo','remind-'+Date.now());
  fs.mkdirSync(PROF,{recursive:true});
  const D='2026-09-25';
  const mkDoc=(todos,settings)=>({settings:settings||{remindPerHabit:true,remindSummary:false},days:{},habits:[],todos:todos});
  let notifyCalls=[];
  const mkRem=(doc,now)=>createReminders({getDoc:()=>doc,userDataDir:PROF,notify:o=>{notifyCalls.push(o);return true;},banner:()=>{},nowFn:()=>now});
  const base=new Date(D+'T20:30:00');
  /* 计数：今天 1、昨天 2（1 条已完成）、明天 1、无 due 1 */
  const doc=mkDoc([
    {id:'a',text:'今天到期',done:false,due:D,createdAt:1},
    {id:'b',text:'昨天未完成',done:false,due:'2026-09-24',createdAt:2},
    {id:'c',text:'昨天已完成',done:true,due:'2026-09-24',createdAt:3},
    {id:'d',text:'明天',done:false,due:'2026-09-26',createdAt:4},
    {id:'e',text:'无日期',done:false,due:null,createdAt:5}
  ]);
  const due=mkRem(doc,base).computeDue(doc,{},base);
  suite.ok(due.todoDue===1&&due.todoOverdue===1,'computeDue counts due-today and overdue separately');
  /* 提醒触发 + 去重：remindTodo 默认开（settings 无键），20:00 后独立发 */
  notifyCalls=[];
  const r2=mkRem(mkDoc([{id:'a',text:'今天到期',done:false,due:D,createdAt:1}]),base);
  let f1=r2.check();
  suite.ok(f1===1&&notifyCalls.length===1&&notifyCalls[0].key==='__todo__'&&notifyCalls[0].body.indexOf('待办今日到期 1 项')>=0&&notifyCalls[0].body.indexOf('今天到期')>=0,'todo reminder fires after 20:00 with item text');
  notifyCalls=[];
  f1=r2.check();
  suite.ok(f1===0&&notifyCalls.length===0,'todo reminder is deduped per day');
  /* remindTodo=false 关闭 */
  notifyCalls=[];
  const r3=mkRem(mkDoc([{id:'a',text:'今天到期',done:false,due:D,createdAt:1}],{remindPerHabit:true,remindSummary:false,remindTodo:false}),base);
  suite.ok(r3.check()===0&&notifyCalls.length===0,'remindTodo=false disables todo reminders');
  /* 20:00 闸：独立待办提醒在白天（习惯全完成→summaryNeeded=false 的路径）绝不提前触发 */
  notifyCalls=[];
  const rDay=mkRem(mkDoc([{id:'a',text:'今天到期',done:false,due:D,createdAt:1}]),new Date(D+'T09:00:00'));
  suite.ok(rDay.check()===0&&notifyCalls.length===0,'standalone todo reminder never fires before 20:00');
  /* 汇总同时触发：并入正文而非独立通知（汇总前提 = 有未完成的到点习惯 undone>0） */
  notifyCalls=[];
  const docSum=mkDoc([{id:'a',text:'今天到期',done:false,due:D,createdAt:1}],{remindPerHabit:false,remindSummary:true});
  docSum.days={};
  docSum.habits=[{key:'h1',name:'喝水',icon:'💧',type:'bool',target:1}];
  const r4=mkRem(docSum,base);
  const f4=r4.check();
  suite.ok(f4===1&&notifyCalls.length===1&&notifyCalls[0].key==='__summary__'&&notifyCalls[0].body.indexOf('待办今日到期')>=0,'summary-open merges todo part into the summary notification');
  /* 全部完成 → 不提醒 */
  notifyCalls=[];
  const r5=mkRem(mkDoc([{id:'a',text:'已完成',done:true,due:D,createdAt:1}]),base);
  suite.ok(r5.check()===0&&notifyCalls.length===0,'completed todos never remind');
 }catch(e){suite.errs.push(e.stack);}

 /* —— 14) backup-history summary 计数 —— */
 try{
  const bh=require(path.join(H.ROOT,'backup-history.js'));
  const s=bh.summary({days:{a:1,b:2},habits:[{deleted:false},{deleted:true}],memoNotes:[{}],todos:[{id:1},{id:2}]});
  suite.ok(s.days===2&&s.habits===1&&s.notes===1&&s.todos===2,'backup summary counts todos');
  const s2=bh.summary({days:{},habits:[]});
  suite.ok(s2.todos===0,'backup summary tolerates docs without todos');
 }catch(e){suite.errs.push(e.stack);}

 finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
