/* ============ 待办事项（3.1.0） ============
   data.todos 顶层实体（主窗字段属主，编辑窗不提交）。本模块提供：
   - 第 5 Tab「待办」页：快速添加、分组列表、编辑抽屉、删除/清空
   - 贴纸「待办卡」形态（hb_lock_mode='todo'）：renderStickyTodo 渲染 + 贴纸上直接勾选
   命名与 render.js 的 renderTodo/todoDirty（今日页未完成习惯芯片）刻意区分。
   排序：置顶 → 已过期 → 今天 → 无日期 → 未来；同桶内优先级高在前、due 升序、创建时间升序。 */

var todoPageDirty=true;        /* 待办页脏标记（renderAll 失效/刷新） */
var todoDoneFold=false;        /* 已完成分组折叠态（会话内记忆，重启复位） */
var todoEditingId=null;        /* 编辑抽屉当前待办 id；null=新建 */
var todoEditPriVal=0;          /* 抽屉当前优先级（0无 1高 2中 3低） */
var todoSubDraft=[];           /* 抽屉子任务草稿 [{id,text,done}] */

function todoList(){ return Array.isArray(data.todos)?data.todos:[]; }
function todoFind(id){ return todoList().find(function(t){return String(t.id)===String(id);})||null; }
function todoActive(){ return todoList().filter(function(t){return t&&!t.done;}); }

/* 日期桶：overdue（早于今天）/ today / nodate / future。YYYY-MM-DD 字典序即时间序。
   due 形状守卫：手改备份可能带非字符串 due（store 侧 todos 只查长度不查元素形状），非法值按 nodate 处理 */
function todoBucket(t,today){
  if(!t.due||typeof t.due!=='string')return 'nodate';
  if(t.due<today)return 'overdue';
  if(t.due===today)return 'today';
  return 'future';
}
function todoCompare(a,b,today){
  if(!!b.pinned-!!a.pinned)return (b.pinned?1:0)-(a.pinned?1:0);
  var bo={overdue:0,today:1,nodate:2,future:3};
  var ba=bo[todoBucket(a,today)],bb=bo[todoBucket(b,today)];
  if(ba!==bb)return ba-bb;
  if((a.priority||0)!==(b.priority||0))return (b.priority||0)-(a.priority||0);   /* 高(1)>中(2)>低(3)>无(0) */
  /* 逾期/未来桶内按 due 升序（逾期久的更靠前）；无日期桶无 due 可比 */
  if((ba===0||ba===3)&&a.due!==b.due)return a.due<b.due?-1:1;
  return (a.createdAt||0)-(b.createdAt||0);
}
function todoSortedActive(){
  var today=todayStr();
  return todoActive().slice().sort(function(a,b){return todoCompare(a,b,today);});
}
function todoSortedDone(){
  return todoList().filter(function(t){return t&&t.done;}).sort(function(a,b){return (b.doneAt||0)-(a.doneAt||0);});
}
/* 今日到期 + 过期的未完成数（tab 红点 / 贴纸头部 / 提醒共用口径） */
function todoUrgentCount(){
  var today=todayStr();
  return todoActive().filter(function(t){return t.due&&t.due<=today;}).length;
}

/* ───────── 待办页渲染 ───────── */
function todoDueBadge(t){
  var today=todayStr(),cls='',txt='';
  if(!t.due||typeof t.due!=='string')return '';
  if(t.due<today){
    var days=Math.max(1,Math.round((new Date(today+'T12:00:00')-new Date(t.due+'T12:00:00'))/86400000));
    cls=' overdue';txt=T('todo_overdue').replace('{n}',days);
  }else if(t.due===today){cls=' is-today';txt=T('todo_today');}
  else if(t.due===todoShiftDay(today,1)){cls='';txt=T('todo_tomorrow');}
  else{cls='';txt=t.due.slice(5).replace('-','/');}
  return '<span class="td-due'+cls+'">'+esc(txt)+'</span>';
}
function todoShiftDay(ds,delta){
  var d=new Date(ds+'T12:00:00');d.setDate(d.getDate()+delta);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function todoSubLine(t){
  if(!Array.isArray(t.subs)||!t.subs.length)return '';
  var dn=t.subs.filter(function(s){return s.done;}).length;
  return '<span class="td-sub'+(dn===t.subs.length?' all':'')+'">'+icn('check',11,2)+dn+'/'+t.subs.length+'</span>';
}
function renderTodoPage(){
  var host=document.getElementById('todoList');if(!host)return;
  var heading=document.getElementById('todoPageTitle'),detail=document.getElementById('todoDetailLabel');
  if(heading)heading.textContent=T('tab_todo');
  if(detail)detail.textContent=T('habit_new');
  var act=todoSortedActive(),done=todoSortedDone();
  var html='';
  if(!act.length&&!done.length){
    /* 空态：图标 + 引导按钮（点击聚焦快速添加框），比纯文字更可执行 */
    html='<div class="td-empty"><div class="td-empty-ic">'+icn('check',20,2.2)+'</div><div>'+T('todo_empty')+'</div>'
      +'<button type="button" class="td-empty-btn" onclick="var i=document.getElementById(\'todoInput\');if(i)i.focus();">'+T('todo_empty_action')+'</button></div>';
  }else{
    html+='<div class="td-group-title"><span>'+T('todo_active')+'</span><b>'+act.length+'</b></div>';
    html+=act.length?act.map(todoItemHtml).join(''):'<div class="td-none">'+T('todo_group_none')+'</div>';
    if(done.length){
      html+='<div class="td-group-title td-done-title'+(todoDoneFold?' fold':'')+'" onclick="todoToggleFold()" role="button" tabindex="0">'
        +'<span>'+T('todo_done_group')+'</span><b>'+done.length+'</b>'
        +'<button type="button" class="td-clear" onclick="event.stopPropagation();clearDoneTodos()">'+T('todo_clear_done')+'</button></div>';
      if(!todoDoneFold)html+='<div class="td-done-list">'+done.map(todoItemHtml).join('')+'</div>';
    }
  }
  host.innerHTML=html;
  ensureTodoTabDot();
}
function todoItemHtml(t){
  var pri=t.priority||0;
  var priCls=pri===1?' p-high':pri===2?' p-mid':pri===3?' p-low':'';
  var subLine=todoSubLine(t);
  return '<div class="td-item'+(t.done?' done':'')+(t.pinned?' pinned':'')+priCls+'" data-tid="'+esc(String(t.id))+'">'
    +'<div class="td-pri"></div>'
    +'<button type="button" class="td-check" onclick="toggleTodo(\''+jsStr(String(t.id))+'\')" aria-pressed="'+(t.done?'true':'false')+'" aria-label="'+T(t.done?'todo_aria_undone':'todo_aria_done')+'">'+(t.done?'✓':'')+'</button>'
    +'<div class="td-main" role="button" tabindex="0" onclick="openTodoEditor(\''+jsStr(String(t.id))+'\')">'
    +'<div class="td-text">'+esc(t.text||'')+'</div>'
    +((t.note&&t.note.trim())?'<div class="td-note">'+esc(t.note)+'</div>':'')
    +'</div>'
    +((subLine||t.due)?'<div class="td-meta">'+(subLine||'')+todoDueBadge(t)+'</div>':'')
    +(t.done?'':'<button type="button" class="td-pin'+(t.pinned?' on':'')+'" onclick="toggleTodoPin(\''+jsStr(String(t.id))+'\')" aria-label="'+T('todo_aria_pin')+'" title="'+T('todo_aria_pin')+'">'+icn('pin',13,2)+'</button>')
    +'</div>';
}
function todoToggleFold(){ todoDoneFold=!todoDoneFold;renderTodoPage(); }
function ensureTodoTabDot(){
  var dot=document.getElementById('todoTabDot');if(!dot)return;
  var tab=dot.closest('.tab');if(!tab)return;
  tab.classList.toggle('has-dot',todoUrgentCount()>0);   /* 与今日 tab 红点同一机制（.tab.has-dot .tdot） */
}

/* ───────── 数据操作（改 data.todos → saveDebounced → 置脏/重渲染） ───────── */
function todoChanged(){
  saveDebounced();
  /* 编辑窗 save() 只提交 noteSaveFields（memo/noteChanges），todos 显式单独提交，
     否则贴纸待办卡上的勾选只改内存、300ms 后即被主窗广播回滚 */
  if(IS_EDITOR_WIN&&window.hbShell){ try{ hbSaveFields({todos:todoList()}); }catch(_){} }
  todoPageDirty=true;
  statDirty=true;   /* 统计概览的「待办完成」格直接读 data.todos，勾选后必须失效 */
  /* 本窗立即重绘：待办页可见则刷新列表，贴纸待办卡可见则刷新贴纸并复测高度 */
  if(document.getElementById('page-todo')&&document.getElementById('page-todo').classList.contains('active'))renderTodoPage();
  if(document.body.classList.contains('app-locked')&&typeof currentStickyMode==='function'&&currentStickyMode()==='todo'){
    renderStickyTodo();
    /* 锁定卡行数变了要重新定高：refreshLockedHeight 清缓存 + fitLockedToContent 重测（与跨零点分支同款） */
    if(typeof window.refreshLockedHeight==='function')window.refreshLockedHeight();
    if(typeof window.fitLockedToContent==='function')window.fitLockedToContent();
  }else if(document.body.classList.contains('m-sticky-todo')&&typeof renderStickyTodo==='function'){
    renderStickyTodo();
    if(typeof window.stickyFitSelf==='function')window.stickyFitSelf();   /* 编辑贴纸形态按内容重贴合 */
  }
  ensureTodoTabDot();
}
function todoNew(text,patch){
  var t=Object.assign({id:'t'+Date.now().toString(36)+Math.random().toString(36).slice(2,6),text:String(text||'').slice(0,500),note:'',priority:0,done:false,createdAt:Date.now(),doneAt:null,due:null,pinned:false,subs:[]},patch||{});
  data.todos=todoList().concat([t]);
  return t;
}
/* 快速添加（输入框回车 / 加号按钮） */
function todoQuickAdd(text){
  text=String(text||'').trim();
  if(!text){toast&&toast(T('todo_need_text'));return null;}
  var t=todoNew(text);
  todoChanged();
  return t;
}
function todoInputKey(e){
  if(e.isComposing||e.keyCode===22)return;   /* IME 组合输入不触发 */
  if(e.key!=='Enter')return;
  e.preventDefault();
  var input=document.getElementById('todoInput');
  if(!input)return;
  var t=todoQuickAdd(input.value);
  if(t)input.value='';
}
function toggleTodo(id){
  var t=todoFind(id);if(!t)return;
  t.done=!t.done;
  t.doneAt=t.done?Date.now():null;
  /* 联动对称：完成主任务连带勾选全部子任务；取消完成同样回滚子任务——
     否则出现「主任务未完成但子任务全勾」的展示态，再勾任一子任务会把主任务再次带回完成 */
  if(Array.isArray(t.subs)&&t.subs.length)t.subs.forEach(function(s){s.done=t.done;});
  todoChanged();
}
function toggleTodoSub(id,sid){
  var t=todoFind(id);if(!t||!Array.isArray(t.subs))return;
  var s=t.subs.find(function(x){return String(x.id)===String(sid);});if(!s)return;
  s.done=!s.done;
  /* 全部子任务完成时自动勾选主任务；取消任一子任务则取消主任务完成态 */
  var all=t.subs.length&&t.subs.every(function(x){return x.done;});
  if(all&&!t.done){t.done=true;t.doneAt=Date.now();}
  else if(!all&&t.done){t.done=false;t.doneAt=null;}
  todoChanged();
}
function toggleTodoPin(id){
  var t=todoFind(id);if(!t)return;
  t.pinned=!t.pinned;
  todoChanged();
}
function deleteTodo(id){
  var t=todoFind(id);if(!t)return;
  showConfirm(T('todo_del_title'),T('todo_del_confirm').replace('{n}',t.text||''),function(){
    data.todos=todoList().filter(function(x){return String(x.id)!==String(id);});
    if(String(todoEditingId)===String(id)){
      if(window.HabitUI)window.HabitUI.markSheetClean();
      closeSheet();
      todoEditingId=null;
    }
    todoChanged();
    toast&&toast(T('todo_deleted'),'good');
  },true);
}
function clearDoneTodos(){
  var n=todoSortedDone().length;if(!n)return;
  showConfirm(T('todo_clear_title'),T('todo_clear_confirm').replace('{n}',n),function(){
    data.todos=todoList().filter(function(x){return !x||!x.done;});
    todoChanged();
    toast&&toast(T('todo_cleared'),'good');
  },true);
}

/* ───────── 编辑抽屉（#todoEditSheet） ───────── */
function todoPickPri(p){ todoEditPriVal=p;syncTodoPriSeg(); }
function syncTodoPriSeg(){
  var seg=document.getElementById('todoEditPri');if(!seg)return;
  [].forEach.call(seg.querySelectorAll('button'),function(b){b.classList.toggle('on',Number(b.getAttribute('data-p'))===todoEditPriVal);});
}
function todoAddSubRow(){
  todoSubDraft.push({id:'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,5),text:'',done:false});
  renderTodoSubDraft(true);
}
function todoRemoveSubRow(sid){
  todoSubDraft=todoSubDraft.filter(function(s){return String(s.id)!==String(sid);});
  renderTodoSubDraft(false);
}
function todoSubKey(e,sid){
  if(e.isComposing||e.keyCode===22)return;
  if(e.key!=='Enter')return;
  e.preventDefault();
  var s=todoSubDraft.find(function(x){return String(x.id)===String(sid);});
  if(s&&e.target.value.trim())s.text=e.target.value.trim();
  todoAddSubRow();   /* 回车追加下一行 */
}
function renderTodoSubDraft(focusLast){
  var host=document.getElementById('todoSubList');if(!host)return;
  host.innerHTML=todoSubDraft.map(function(s,i){
    return '<div class="todo-sub-row" data-sid="'+esc(String(s.id))+'">'
      +'<button type="button" class="todo-sub-check'+(s.done?' on':'')+'" onclick="todoDraftToggleSub(\''+jsStr(String(s.id))+'\')" aria-pressed="'+(s.done?'true':'false')+'">'+(s.done?'✓':'')+'</button>'
      +'<input type="text" maxlength="500" value="'+esc(s.text)+'" placeholder="'+T('todo_sub_ph').replace('{n}',i+1)+'" oninput="todoDraftSubInput(\''+jsStr(String(s.id))+'\',this.value)" onkeydown="todoSubKey(event,\''+jsStr(String(s.id))+'\')">'
      +'<button type="button" class="todo-sub-del" onclick="todoRemoveSubRow(\''+jsStr(String(s.id))+'\')" aria-label="'+T('todo_aria_sub_del')+'">×</button>'
      +'</div>';
  }).join('');
  if(focusLast){var last=host.querySelector('.todo-sub-row:last-child input');if(last)last.focus();}
}
function todoDraftToggleSub(sid){ var s=todoSubDraft.find(function(x){return String(x.id)===String(sid);});if(s)s.done=!s.done;renderTodoSubDraft(false); }
function todoDraftSubInput(sid,val){ var s=todoSubDraft.find(function(x){return String(x.id)===String(sid);});if(s)s.text=val; }

function openTodoEditor(id){
  var text='';
  if(id!=null&&id!==''){
    var t=todoFind(id);
    if(!t)return;
    todoEditingId=t.id;
    text=t.text||'';
    todoEditPriVal=t.priority||0;
    todoSubDraft=(Array.isArray(t.subs)?t.subs:[]).map(function(s){return {id:String(s.id),text:String(s.text||''),done:!!s.done};});
    document.getElementById('todoEditNote').value=t.note||'';
    document.getElementById('todoEditDue').value=t.due||'';
    document.getElementById('todoEditTitle').textContent=T('todo_edit_title');
  }else{
    var input=document.getElementById('todoInput');
    text=input?input.value.trim():'';
    todoEditingId=null;
    todoEditPriVal=0;
    todoSubDraft=[];
    document.getElementById('todoEditNote').value='';
    document.getElementById('todoEditDue').value='';
    document.getElementById('todoEditTitle').textContent=T('todo_new_title');
  }
  document.getElementById('todoEditText').value=text;
  syncTodoPriSeg();
  renderTodoSubDraft(false);
  openSheet('todoEditSheet');
  setTimeout(function(){var el=document.getElementById('todoEditText');if(el)el.focus();},80);
}
function saveTodoEditor(){
  var text=String(document.getElementById('todoEditText').value||'').trim();
  if(!text){toast&&toast(T('todo_need_text'));return;}
  var due=String(document.getElementById('todoEditDue').value||'')||null;
  var note=String(document.getElementById('todoEditNote').value||'').slice(0,2000);
  var subs=todoSubDraft.map(function(s){return {id:String(s.id),text:String(s.text||'').trim().slice(0,500),done:!!s.done};}).filter(function(s){return s.text;});
  if(todoEditingId!=null){
    var t=todoFind(todoEditingId);
    /* 目标待办已被并发删除（清空已完成/跨窗删除）：明示用户，不静默丢弃输入 */
    if(!t){toast&&toast(T('todo_deleted_while_editing'),'bad');todoEditingId=null;return;}
    t.text=text;t.note=note;t.priority=todoEditPriVal;t.due=due;t.pinned=!!t.pinned;
    /* 子任务全量替换；主任务完成态只由勾选/子任务联动驱动（toggleTodoSub），抽屉保存不改动 */
    t.subs=subs;
  }else{
    todoNew(text,{note:note,priority:todoEditPriVal,due:due,subs:subs});
    var input=document.getElementById('todoInput');if(input)input.value='';
  }
  /* 先重置未保存基线再关（timeOff 同款）：否则 HabitUI 的脏检查会弹「放弃修改」把 sheet 留在屏幕上 */
  if(window.HabitUI)window.HabitUI.markSheetClean();
  closeSheet();
  todoChanged();
}
/* 编辑抽屉内删除入口 */


/* ───────── 贴纸待办卡（hb_lock_mode='todo'） ─────────
   结构仿 renderStickyToday（checkin.js）：头部统计 + 今日/过期待办列表 + 打开待办入口。
   贴纸上可直接勾选；子任务不展开（空间受限），只显示主任务与子任务进度。 */
function renderStickyTodo(){
  var box=document.getElementById('stickyTodo');if(!box)return;
  var today=todayStr();
  /* 只显示「今天要做」的：今日到期 + 逾期；无日期/未来的不上贴纸（保持贴纸聚焦） */
  var act=todoSortedActive().filter(function(t){return t.due&&t.due<=today;});
  var overdue=act.filter(function(t){return t.due&&t.due<today;}).length;
  

  var dayAll=todoList().filter(function(t){return t&&t.due&&typeof t.due==='string'&&t.due<=today;});
  var total=dayAll.length;
  var dn=dayAll.filter(function(t){return t.done;}).length;
  var limit=8;
  var pct=total?Math.min(100,Math.round(dn/total*100)):0;
  var ringCol=total&&dn===total?'var(--ui-positive, #187344)':'var(--ui-accent, #0071e3)';
  var rows=act.slice(0,limit).map(function(t){
    var sub=todoSubLine(t);
    return '<div class="st-td-item'+(t.due&&t.due<today?' overdue':'')+'">'
      +'<button type="button" class="td-check" onclick="toggleTodo(\''+jsStr(String(t.id))+'\')" aria-pressed="false"></button>'
      +'<div class="td-main" role="button" tabindex="0" onclick="openTodoFromSticky()"><div class="td-text">'+esc(t.text||'')+'</div></div>'
      +(sub||'')+(t.due&&t.due<today?'<span class="td-due overdue">'+T('todo_overdue').replace('{n}',Math.max(1,Math.round((new Date(today+'T12:00:00')-new Date(t.due+'T12:00:00'))/86400000)))+'</span>':'')
      +'</div>';
  }).join('');
  if(act.length>limit)rows+='<div class="st-td-more">'+T('todo_sticky_more').replace('{n}',act.length-limit)+'</div>';
  if(!act.length)rows='<div class="td-empty">'+T('todo_sticky_clear')+'</div>';
  box.innerHTML='<div class="st-todo">'
    +'<div class="st-head"><div class="st-ring" style="background:conic-gradient('+ringCol+' 0 '+pct+'%,var(--tile-3,#E5E5EA) '+pct+'% 100%)"><div class="ring-num">'+dn+'/'+total+'</div><div class="ring-sub">'+T('todo_ring_sub')+'</div></div>'
    +'<div style="min-width:0"><div class="st-title">'+T('todo_sticky_title')+'</div><div class="st-date">'+(overdue?'<span class="st-td-overdue">'+T('todo_overdue_n').replace('{n}',overdue)+'</span> · ':'')+fmtNoteDate(new Date())+'</div></div></div>'
    +'<div class="st-td-list">'+rows+'</div>'
    +'<button type="button" class="st-td-open" onclick="openTodoFromSticky()">'+T('todo_open_todo')+' ›</button>'
    +'</div>';
}
/* 贴纸 → 主窗待办页：解锁恢复窗口后直接落在待办页。
   主窗贴纸=本窗解锁（applyLock 解锁分支读 _unlockTarget）；
   编辑窗贴纸（sticky-sticker）=「打开待办」的实际宿主是主窗——走 editorBack 让主窗上屏解锁并落待办页，
   在编辑窗内本地 applyLock(false) 会错摘本窗贴纸形态且主窗停在原页面。 */
function openTodoFromSticky(){
  if(document.body.classList.contains('sticky-sticker')&&window.hbShell&&window.hbShell.editorBack){
    try{ window.hbShell.editorBack('todo'); }catch(_){}
    return;
  }
  try{ window._unlockTarget='todo'; }catch(_){}
  if(window.applyLock)window.applyLock(false);
}

/* ───────── 初始化 ───────── */
(function(){
  if(IS_EDITOR_WIN)return;   /* 编辑窗无待办页；贴纸渲染由 applyStickyMode 按形态触发 */
  var run=function(){
    if(todoPageDirty){renderTodoPage();todoPageDirty=false;}
  };
  if(document.readyState==='complete')run();
  else window.addEventListener('load',run);
})();
