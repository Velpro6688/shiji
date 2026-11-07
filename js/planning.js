/* Calendar scheduling, pinning and time-off controls. */
function scheduleLabel(h,ds){
  const r=window.HabitRules.rule(h,ds||todayStr());
  if(r.mode==='weekly')return '每周 '+r.times+' 次';
  if(r.mode==='weekdays')return r.days.map(n=>['日','一','二','三','四','五','六'][n]).map(n=>'周'+n).join('、')||'尚未选择星期';
  return '每天';
}
function loadScheduleEditor(h){
  const rule=window.HabitRules.rule(h||{},todayStr());
  document.getElementById('edScheduleMode').value=rule.mode;
  document.getElementById('edWeeklyTimes').value=rule.times||3;
  document.querySelectorAll('#edScheduleDays input').forEach(el=>{el.checked=(rule.days||[1,2,3,4,5]).includes(Number(el.value));});
  document.getElementById('edPinned').checked=!!(h&&h.pinned);
  updateScheduleEditor();
}
function updateScheduleEditor(){
  const mode=document.getElementById('edScheduleMode').value;
  document.getElementById('edWeeklyField').hidden=mode!=='weekly';
  document.getElementById('edScheduleDays').hidden=mode!=='weekdays';
}
function readScheduleEditor(){
  const mode=document.getElementById('edScheduleMode').value;
  if(mode==='weekly')return {mode,times:Math.max(1,Math.min(7,Math.round(Number(document.getElementById('edWeeklyTimes').value)||3)))};
  if(mode==='weekdays')return {mode,days:[...document.querySelectorAll('#edScheduleDays input:checked')].map(el=>Number(el.value))};
  return {mode:'daily'};
}
function saveScheduleEditor(h){
  const rule=readScheduleEditor(),previous=window.HabitRules.rule(h,todayStr());
  if(JSON.stringify(rule)!==JSON.stringify(previous)){
    if(!Array.isArray(h.scheduleHistory))h.scheduleHistory=h.schedule?[{from:habitCreatedAt(h),rule:previous}]:[];
    h.scheduleHistory=h.scheduleHistory.filter(r=>r.from!==todayStr());
    h.scheduleHistory.push({from:todayStr(),rule});
  }
  h.pinned=document.getElementById('edPinned').checked;
}
function toggleHabitPin(key){
  const h=HMAP[key];if(!h||h.archived||h.deleted)return;
  h.pinned=!h.pinned;saveDebounced();mineDirty=true;renderAll();
}
function habitAvailabilityControls(h){
  const ex=window.HabitRules.exception(h,todayStr());
  const future=(h.pauseRanges||[]).filter(r=>r.from>todayStr()).sort((a,b)=>a.from.localeCompare(b.from))[0];
  const weekly=window.HabitRules.rule(h,todayStr()).mode==='weekly'?window.HabitRules.weeklyProgress(h,todayStr(),data.days):null;
  return '<div class="planning-actions"><span>'+esc(ex?(ex.kind==='leave'?'请假至 '+(ex.to||'恢复时'):'暂停中'):scheduleLabel(h)+(weekly?' · 本周 '+weekly.done+'/'+weekly.target:''))+'</span>'
    +'<button type="button" onclick="toggleHabitPin(\''+jsStr(h.key)+'\')" aria-pressed="'+!!h.pinned+'">'+(h.pinned?'取消置顶':'置顶')+'</button>'
    +'<button type="button" onclick="openHabitTimeOff(\''+jsStr(h.key)+'\')">'+(ex?'恢复计划':future?'预定 '+future.from+' · 管理':'暂停 / 请假')+'</button></div>';
}
var timeOffKey='';
var timeOffEditIndex=-1,timeOffEditBase='';
function renderFutureTimeOff(){
  const h=HMAP[timeOffKey];if(!h)return;
  let host=document.getElementById('futureTimeOffList');
  if(!host){host=document.createElement('div');host.id='futureTimeOffList';const field=document.getElementById('timeOffKind').closest('.field');field.parentNode.insertBefore(host,field);}
  host.replaceChildren();
  (h.pauseRanges||[]).forEach((r,index)=>{
    if(r.from<=todayStr())return;
    const row=document.createElement('div');row.className='future-time-off';
    const label=document.createElement('span');label.textContent=r.from+' 至 '+(r.to||'手动恢复')+' · '+(r.kind==='leave'?'请假':'暂停');row.appendChild(label);
    [['修改',()=>{timeOffEditIndex=index;timeOffEditBase=JSON.stringify(r);document.getElementById('timeOffFrom').value=r.from;document.getElementById('timeOffTo').value=r.to||r.from;document.getElementById('timeOffKind').value=r.kind;updateTimeOffKind();}],['取消预定',()=>showConfirm('取消预定','取消 '+r.from+' 开始的安排？已有记录保留。',()=>{const current=HMAP[timeOffKey];current.pauseRanges=(current.pauseRanges||[]).filter(item=>JSON.stringify(item)!==JSON.stringify(r));timeOffEditIndex=-1;timeOffEditBase='';saveDebounced();mineDirty=true;renderAll();renderFutureTimeOff();if(window.HabitUI)window.HabitUI.markSheetClean();},false)]].forEach(([text,action])=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;row.appendChild(b);});
    host.appendChild(row);
  });
}
function openHabitTimeOff(key){
  const h=HMAP[key];if(!h)return;
  const ex=window.HabitRules.exception(h,todayStr());
  if(ex){
    showConfirm('恢复计划','从今天起恢复「'+h.name+'」。暂停或请假期间不计缺卡，原记录保留。',()=>{
      const yesterday=window.HabitRules.shift(todayStr(),-1);
      h.pauseRanges=(h.pauseRanges||[]).filter(r=>{if(r===ex){if(r.from>=todayStr())return false;r.to=yesterday;}return true;});
      saveDebounced();mineDirty=true;renderAll();
    },false,{confirm:'恢复计划',cancel:'取消'});return;
  }
  timeOffKey=key;timeOffEditIndex=-1;timeOffEditBase='';document.getElementById('timeOffTitle').textContent=h.name+' · 暂停 / 请假';
  document.getElementById('timeOffFrom').value=todayStr();document.getElementById('timeOffFrom').min=todayStr();
  document.getElementById('timeOffTo').value=window.HabitRules.shift(todayStr(),6);document.getElementById('timeOffKind').value='leave';
  updateTimeOffKind();renderFutureTimeOff();openSheet('timeOffSheet');
}
function updateTimeOffKind(){document.getElementById('timeOffToField').hidden=document.getElementById('timeOffKind').value==='pause';}
function saveHabitTimeOff(){
  const h=HMAP[timeOffKey];if(!h)return;
  const from=document.getElementById('timeOffFrom').value,kind=document.getElementById('timeOffKind').value,to=kind==='pause'?'':document.getElementById('timeOffTo').value;
  if(!window.HabitRules.validDate(from)||from<todayStr()||(kind==='leave'&&(!window.HabitRules.validDate(to)||to<from))){toast('请选择今天或之后的有效日期范围','bad');return;}
  if(timeOffEditIndex>=0&&JSON.stringify((h.pauseRanges||[])[timeOffEditIndex])!==timeOffEditBase){toast('安排已变化，请重新打开后修改','bad');return;}
  if((h.pauseRanges||[]).some((r,index)=>index!==timeOffEditIndex&&r.from<=(to||'9999-12-31')&&(!r.to||r.to>=from))){toast('该日期与已有暂停 / 请假重叠','bad');return;}
  if(!Array.isArray(h.pauseRanges))h.pauseRanges=[];
  if(timeOffEditIndex>=0)h.pauseRanges[timeOffEditIndex]={from,to,kind};else h.pauseRanges.push({from,to,kind});saveDebounced();mineDirty=true;renderAll();
  if(window.HabitUI)window.HabitUI.markSheetClean();closeSheet();toast('计划已更新，历史记录保留','good');
}

(function(){const group=document.getElementById('habitFilters');if(!group)return;const button=document.createElement('button');button.type='button';button.dataset.filter='pinned';button.className='habit-filter-btn';button.setAttribute('aria-pressed','false');button.innerHTML='置顶 <span id="habitFilterCountPinned">0</span>';group.appendChild(button);})();

async function pinTodayToDesktop(){
  if(pinTodayToDesktop.busy)return;pinTodayToDesktop.busy=true;
  try{
    await flushRendererChanges();
    const notes=notesSorted(),last=localStorage.getItem('hb_sticky_note');
    const target=notes.find(n=>String(n.id)===last)||notes[0];
    if(target){curNoteId=String(target.id);renderNoteToEditor(target,true);await window.lockStickyNote();}
    else{setStickyMode('today');window.applyLock(true);toast('还没有便签，已贴出今日进度');}
  }
  catch(error){toast('未能贴便签：'+error.message,'bad');}
  finally{pinTodayToDesktop.busy=false;}
}
function renderStickyNavigation(){
  const nav=document.getElementById('stickyNoteNavigation');if(nav)nav.remove();
  const notes=notesSorted();
  const pin=document.getElementById('pinTodayDesktop');if(pin)pin.title=notes.length?'贴便签：恢复上次使用的便签':'贴便签：当前没有便签，将显示今日进度';
}

var stickyPageAnimation=null;
var stickyReadingPositions=new Map();
function restoreStickyReadingPosition(page,id){
  const top=stickyReadingPositions.get(id)||0;
  page.scrollTop=top;
  if(!top)return;
  let expected=page.scrollTop,cancelled=false;
  function restore(){
    if(cancelled||String(curNoteId)!==id)return;
    // 用户开始滚动后不再被迟到的图片加载拉回原处。
    if(page.scrollTop!==expected){cancelled=true;return;}
    page.scrollTop=top;expected=page.scrollTop;
  }
  requestAnimationFrame(restore);
  page.querySelectorAll('img').forEach(img=>{if(!img.complete)img.addEventListener('load',restore,{once:true});});
}
function animateStickyPage(page,offset){
  if(stickyPageAnimation)stickyPageAnimation.cancel();
  page.style.transform='';
  if(!offset||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  stickyPageAnimation=page.animate([{transform:'translateX('+offset+'px)'},{transform:'translateX(0)'}],{duration:220,easing:'cubic-bezier(0.16,1,0.3,1)'});
}
async function switchStickyNote(direction){
  if(switchStickyNote.busy)return false;switchStickyNote.busy=true;renderStickyNavigation();
  try{
    await flushRendererChanges();
    const notes=notesSorted();if(notes.length<2)return false;
    const index=notes.findIndex(n=>String(n.id)===String(curNoteId)),next=(Math.max(0,index)+(direction<0?-1:1)+notes.length)%notes.length;
    const page=document.getElementById('memoInput');
    const previousId=String(curNoteId);
    stickyReadingPositions.delete(previousId);stickyReadingPositions.set(previousId,page.scrollTop);
    if(stickyReadingPositions.size>200)stickyReadingPositions.delete(stickyReadingPositions.keys().next().value);
    curNoteId=String(notes[next].id);renderNoteToEditor(notes[next],true);
    animateStickyPage(page,(direction<0?-1:1)*page.clientWidth*.35);
    localStorage.setItem('hb_sticky_note',curNoteId);localStorage.setItem('hb_lock_mode','note');
    window._lockFitManual=true;applyStickyMode();
    if(!IS_EDITOR_WIN&&document.body.classList.contains('app-locked'))document.getElementById('memoInput').setAttribute('contenteditable','false');
    restoreStickyReadingPosition(page,String(curNoteId));
    return true;
  }catch(error){toast('未能切换，当前内容已保留：'+error.message,'bad');return false;}
  finally{switchStickyNote.busy=false;renderStickyNavigation();}
}

/* 只读贴纸的横向阅读手势；纵向滚动及编辑器内的图文拖动不受影响。 */
(function(){
  const page=document.getElementById('memoInput');if(!page)return;
  let gesture=null;
  const enabled=()=>document.body.matches('.app-locked:not(.m-sticky-today),.sticky-sticker:not(.m-sticky-today)');
  page.addEventListener('pointerdown',event=>{
    if(!enabled()||event.button!==0||!event.isPrimary||switchStickyNote.busy||notesSorted().length<2)return;
    if(event.target.closest('button,a,input,textarea,.mt-cb,.memo-image-grip,.memo-image-remove,.memo-image-crop'))return;
    if(stickyPageAnimation)stickyPageAnimation.cancel();
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,horizontal:false,offset:0};
    event.stopImmediatePropagation();
  },true);
  page.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!gesture.horizontal){
      if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){gesture=null;return;}
      if(Math.abs(dx)<12||Math.abs(dx)<Math.abs(dy)*1.5)return;
      gesture.horizontal=true;page.setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    gesture.offset=Math.max(-page.clientWidth*.32,Math.min(page.clientWidth*.32,dx*.65));
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)page.style.transform='translateX('+gesture.offset+'px)';
  });
  function end(event){
    if(!gesture||event.pointerId!==gesture.id)return;
    const state=gesture;gesture=null;
    if(page.hasPointerCapture(event.pointerId))page.releasePointerCapture(event.pointerId);
    const dx=event.clientX-state.x,dy=event.clientY-state.y;
    if(event.type==='pointerup'&&enabled()&&state.horizontal&&Math.abs(dx)>=48&&Math.abs(dx)>=Math.abs(dy)*1.5){
      switchStickyNote(dx<0?1:-1).then(changed=>{if(!changed)animateStickyPage(page,state.offset);});
    }else animateStickyPage(page,state.offset);
  }
  page.addEventListener('pointerup',end);page.addEventListener('pointercancel',end);
  function cancel(){
    if(!gesture)return;
    const state=gesture;gesture=null;
    if(page.hasPointerCapture(state.id))page.releasePointerCapture(state.id);
    animateStickyPage(page,state.offset);
  }
  page.addEventListener('lostpointercapture',cancel);
  window.addEventListener('blur',cancel);
  page.addEventListener('dragstart',event=>{if(enabled())event.preventDefault();});
})();
