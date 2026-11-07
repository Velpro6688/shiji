/* ============ 时长倒计时 ============ */
let focusCompletionTimer=null;
function timerMinutesOf(h){return clamp(Math.round(Number(h&&h.timerMinutes)||25),1,180);}
function timerDisplay(seconds){
  const safe=Math.max(0,Math.ceil(Number(seconds)||0));
  return String(Math.floor(safe/60)).padStart(2,'0')+':'+String(safe%60).padStart(2,'0');
}
function formatHours(n){
  const v=Math.round((Number(n)||0)*100)/100;
  return Number.isInteger(v)?String(v):String(v);
}
function activeTimer(){
  const t=data&&data.meta&&data.meta.activeTimer;
  if(!t||typeof t!=='object')return null;
  const total=Math.floor(Number(t.totalSeconds));
  const remaining=Math.floor(Number(t.remainingSeconds));
  const validKey=typeof t.key==='string'&&t.key.length>0;
  const validDay=/^\d{4}-\d{2}-\d{2}$/.test(t.dayKey||'');
  if(!validKey||!validDay||!Number.isFinite(total)||total<1||total>10800||!Number.isFinite(remaining)||remaining<0||remaining>total){
    delete data.meta.activeTimer;
    return null;
  }
  if(!t.paused&&(!Number.isFinite(Number(t.endAt))||Number(t.endAt)<1)){
    delete data.meta.activeTimer;
    return null;
  }
  t.totalSeconds=total;t.remainingSeconds=remaining;t.paused=!!t.paused;
  return t;
}
function timerRemaining(t){
  if(!t)return 0;
  return t.paused?t.remainingSeconds:Math.max(0,Math.ceil((Number(t.endAt)-Date.now())/1000));
}
function showFocusOverlay(){
  const overlay=document.getElementById('focusOverlay');
  if(!overlay)return;
  clearTimeout(focusCompletionTimer);
  overlay.classList.remove('is-complete');
  overlay.classList.add('show');
  document.getElementById('focusTip').textContent='完成后会自动计入今天的时长';
  renderFocusOverlay();
}
function hideFocusOverlay(){
  const overlay=document.getElementById('focusOverlay');
  if(overlay)overlay.classList.remove('show');
}
function renderFocusOverlay(){
  const overlay=document.getElementById('focusOverlay');
  if(!overlay||!overlay.classList.contains('show')||overlay.classList.contains('is-complete'))return;
  const active=activeTimer(),h=active&&HMAP[active.key];
  if(!active||!h){hideFocusOverlay();return;}
  const total=active.totalSeconds,remaining=timerRemaining(active),progress=clamp((total-remaining)/total,0,1);
  document.getElementById('focusTitle').textContent=h.name;
  document.getElementById('focusTime').textContent=timerDisplay(remaining);
  document.getElementById('focusState').textContent=active.paused?'已暂停':'专注中';
  document.getElementById('focusProgress').style.strokeDashoffset=String(672.3*(1-progress));
  const pause=document.getElementById('focusPauseButton'),icon=document.getElementById('focusPauseIcon');
  if(pause){pause.title=active.paused?'继续':'暂停';pause.setAttribute('aria-label',active.paused?'继续':'暂停');}
  if(icon)icon.innerHTML=active.paused?'<path d="M8 5v14l11-7z"/>':'<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>';
}
function showFocusComplete(h,seconds){
  const overlay=document.getElementById('focusOverlay');
  if(!overlay)return;
  clearTimeout(focusCompletionTimer);
  overlay.classList.add('show','is-complete');
  document.getElementById('focusTitle').textContent=`${h.name} 已完成`;
  document.getElementById('focusTime').textContent='完成';
  document.getElementById('focusState').textContent=`已计入 ${formatHours(seconds/3600)} ${h.unit||T('unit_hour')}`;
  document.getElementById('focusTip').textContent='做得不错，休息一下再继续吧';
  document.getElementById('focusProgress').style.strokeDashoffset='0';
  focusCompletionTimer=setTimeout(hideFocusOverlay,2200);
}
function renderTimerPanel(h,totalToday){
  const active=activeTimer();
  const own=active&&active.key===h.key?active:null;
  const total=own?own.totalSeconds:timerMinutesOf(h)*60;
  const remaining=own?timerRemaining(own):total;
  const progress=clamp(Math.round((total-remaining)/total*100),0,100);
  const state=own?(own.paused?'专注已暂停':'专注进行中'):`准备开始 · ${timerMinutesOf(h)} 分钟`;
  const action=own?(own.paused?'继续':'暂停'):'开始专注';
  const unit=esc(h.unit||T('unit_hour'));
  return `<div class="timer-panel ${own&&!own.paused?'running':''}" data-tk="${esc(h.key)}">
    <div class="timer-head"><span class="timer-label">专注计时 · ${state}</span><div class="timer-head-actions">${own?`<button type="button" class="timer-open-focus" onclick="showFocusOverlay()" title="打开专注时钟"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.8 1.8"/></svg>时钟</button>`:''}<button type="button" class="timer-config" onclick="openTimerSettings('${jsStr(h.key)}')">设置时段</button></div></div>
    <div class="timer-clock">${timerDisplay(remaining)}</div>
    <div class="timer-track"><i style="width:${progress}%"></i></div>
    <div class="timer-foot"><span class="timer-total">今日 ${formatHours(totalToday)} ${unit} / ${h.target||1} ${unit}</span><div class="timer-actions">${viewDate===todayStr()?`<button type="button" class="tm-step" onclick="addHoursManually('${jsStr(h.key)}',-0.5,event)" title="减少 0.5 小时（需管理员模式）">－0.5</button><button type="button" class="tm-step" onclick="addHoursManually('${jsStr(h.key)}',0.5,event)" title="手动补录 0.5 小时">＋0.5</button><button type="button" class="timer-reset" onclick="resetTimer('${jsStr(h.key)}')">放弃本次</button><button type="button" class="timer-start" onclick="startOrPauseTimer('${jsStr(h.key)}',event)">${action}</button>`:`<button type="button" class="tm-step" onclick="addHoursManually('${jsStr(h.key)}',-0.5,event)" title="减少 0.5 小时（需管理员模式）">－0.5</button><button type="button" class="tm-step" onclick="addHoursManually('${jsStr(h.key)}',0.5,event)" title="给 ${viewDate} 补录 0.5 小时">＋0.5 补录</button>`}</div></div>
  </div>`;
}
function clearTimerTicker(){if(timerTick){clearInterval(timerTick);timerTick=null;}}
function startTimerTicker(){
  clearTimerTicker();
  const t=activeTimer();
  if(!t)return;
  tickTimer();
  const t2=activeTimer();
  if(t2&&!t2.paused)timerTick=setInterval(tickTimer,1000);
}
/* 运行中的局部刷新：只更新可见的时钟/进度 DOM。
   禁止整表重建 checkinList —— 重建会打断 range 的 <input type=time> 选择器、
   并让正在拖拽排序的卡片 DOM 失效（历史卡死 bug 根因之一）。 */
function updateTimerPanels(){
  const active=activeTimer();if(!active)return;
  const total=active.totalSeconds,remaining=timerRemaining(active);
  const progress=clamp((total-remaining)/total,0,1);
  const overlay=document.getElementById('focusOverlay');
  if(overlay&&overlay.classList.contains('show')&&!overlay.classList.contains('is-complete')){
    const ft=document.getElementById('focusTime');
    if(ft)ft.textContent=timerDisplay(remaining);
    const fp=document.getElementById('focusProgress');
    if(fp)fp.style.strokeDashoffset=String(672.3*(1-progress));
  }
  const panel=document.querySelector('.timer-panel[data-tk="'+active.key+'"]');
  if(panel){
    const clock=panel.querySelector('.timer-clock');if(clock)clock.textContent=timerDisplay(remaining);
    const track=panel.querySelector('.timer-track i');if(track)track.style.width=Math.round(progress*100)+'%';
  }
}
function tickTimer(){
  const active=activeTimer();
  if(!active){clearTimerTicker();return;}
  if(active.recoveryPending){clearTimerTicker();return;}
  if(!HMAP[active.key]||HMAP[active.key].type!=='hours'||HMAP[active.key].archived||HMAP[active.key].deleted){
    delete data.meta.activeTimer;
    clearTimerTicker();hideFocusOverlay();saveDebounced();renderAll();return;
  }
  if(active.paused){clearTimerTicker();return;}
  if(timerRemaining(active)>0){updateTimerPanels();if(!active.checkpointAt||Date.now()-active.checkpointAt>=10000)checkpointTimer(true);return;}
  const h=HMAP[active.key];
  delete data.meta.activeTimer;
  clearTimerTicker();
  if(!h||h.type!=='hours'){saveDebounced();renderAll();return;}
  

  const endKey=todayStr();
  const d=ensureDay(endKey);
  const before=isDone(h.key,d);
  // 数据层保留真实秒数换算，避免 1 分钟被四舍五入为 0.02 小时后长期累计产生误差。
  d[h.key]=(Number(d[h.key])||0)+active.totalSeconds/3600;
  stampTarget(d,h.key);
  delete d[h.key+'_done'];
  stampDoneTs(d,h.key,endKey);
  /* Earn synchronously with the completed session; presentation may wait. */
  maybeReward(h,'hours',active.totalSeconds/3600,true);
  saveDebounced();renderAll();checkReminders();
  playFocusCompleteSound();
  celebrate(null,h.color,!before&&isDone(h.key,d),true,h.icon);
  showFocusComplete(h,active.totalSeconds);
  toast(`${h.name} 倒计时完成，已计入 ${formatHours(active.totalSeconds/3600)} ${h.unit||T('unit_hour')}`,'good');
  if(endKey!==active.dayKey){
    /* 跨零点：明确告知归属日，别让用户以为记丢了 */
    setTimeout(function(){try{toast(`本次计时跨越零点，时长已计入 ${endKey}`,'good');}catch(_){}},2600);
  }
   
  setTimeout(function(){ try{pumpReward();}catch(_){} },2300);
}
function openTimerSettings(key){
  const h=HMAP[key];if(!h||h.type!=='hours')return;
  timerSettingKey=key;
  document.getElementById('timerMinutesInput').value=timerMinutesOf(h);
  openSheet('timerSheet');
}
function setTimerPreset(minutes){document.getElementById('timerMinutesInput').value=clamp(Math.round(Number(minutes)||25),1,180);}
function saveTimerSettings(){
  const h=HMAP[timerSettingKey];if(!h||h.type!=='hours'){closeSheet();return;}
  h.timerMinutes=clamp(Math.round(Number(document.getElementById('timerMinutesInput').value)||25),1,180);
  saveDebounced();renderAll();if(window.HabitUI)window.HabitUI.markSheetClean();closeSheet();
  toast(`已设为 ${h.timerMinutes} 分钟`,'good');
}
function startOrPauseTimer(key,e){
  const h=HMAP[key];if(!h||h.type!=='hours')return;
  let active=activeTimer();
  if(active&&active.key!==key){
    const other=HMAP[active.key];
    toast(`请先完成或重置「${other?other.name:'当前'}」的倒计时`);
    return;
  }
  if(!active){
    const total=timerMinutesOf(h)*60;
    active={key:key,totalSeconds:total,remainingSeconds:total,endAt:Date.now()+total*1000,dayKey:todayStr(),paused:false,checkpointAt:Date.now()};
    data.meta.activeTimer=active;
    primeFocusSound();saveDebounced();startTimerTicker();renderAll();showFocusOverlay();return;
  }
  if(active.paused){
    if(active.recoveryPending){showTimerRecovery();return;}
    active.endAt=Date.now()+active.remainingSeconds*1000;
    active.paused=false;
  }else{
    active.remainingSeconds=timerRemaining(active);
    active.endAt=null;
    active.paused=true;
  }
  primeFocusSound();saveDebounced();startTimerTicker();renderAll();showFocusOverlay();
}
function resetTimer(key){
  const active=activeTimer();
  if(!active||active.key!==key)return;
  const h=HMAP[active.key];
  showConfirm(T('cf_abandon_title'),T('cf_abandon_timer')(h?h.name:T('focus')),function(){
    delete data.meta.activeTimer;
    clearTimerTicker();saveDebounced();renderAll();hideFocusOverlay();
    toast('倒计时已重置');
  },true);
}
function toggleFocusPause(){const active=activeTimer();if(active)startOrPauseTimer(active.key);}
function resetFocusTimer(){const active=activeTimer();if(active)resetTimer(active.key);}
function checkpointTimer(persist){
  const t=activeTimer();if(!t||t.recoveryPending||t.paused)return;
  t.remainingSeconds=timerRemaining(t);t.checkpointAt=Date.now();
  if(persist)save();
}
function prepareTimerRecovery(){
  const t=activeTimer();if(!t||IS_EDITOR_WIN)return;
  // Never treat time while the process was absent as focused work.
  t.recoveryPending=true;t.paused=true;t.endAt=null;
  save();setTimeout(showTimerRecovery,900);
}
function showTimerRecovery(){
  const t=activeTimer();if(!t||!t.recoveryPending)return;
  const h=HMAP[t.key];
  document.getElementById('timerRecoveryText').textContent=(h?h.name:'上次专注')+'：已完成约 '+Math.floor((t.totalSeconds-t.remainingSeconds)/60)+' 分钟，剩余 '+timerDisplay(t.remainingSeconds)+'。只计上次保存的进度，关闭期间不计时。';
  openSheet('timerRecoverySheet');
}
async function resolveTimerRecovery(action){
  const t=activeTimer(),h=t&&HMAP[t.key];if(!t||!t.recoveryPending)return;
  if(action==='discard'){
    showConfirm('放弃上次专注','本次尚未结算的时长将不计入记录，已有打卡不会改变。',()=>finishTimerRecovery('discard'),true,{confirm:'放弃本次',cancel:'返回'});return;
  }
  if(!h||h.deleted||h.archived){toast('该习惯已结束，请放弃本次专注','bad');return;}
  await finishTimerRecovery(action);
}
async function finishTimerRecovery(action){
  const t=activeTimer(),h=t&&HMAP[t.key];if(!t||!t.recoveryPending)return;
  const snapshot=JSON.parse(JSON.stringify({days:data.days,meta:data.meta}));
  try{
    if(action==='continue'){
      delete t.recoveryPending;t.paused=false;t.endAt=Date.now()+t.remainingSeconds*1000;t.checkpointAt=Date.now();
    }else{
      delete data.meta.activeTimer;
      const seconds=t.totalSeconds-t.remainingSeconds;
      if(action==='settle'&&seconds>0&&h){
        const ds=t.dayKey,dd=ensureDay(ds);dd[h.key]=(Number(dd[h.key])||0)+seconds/3600;
        stampTarget(dd,h.key);delete dd[h.key+'_done'];stampDoneTs(dd,h.key,ds);
        maybeReward(h,'hours',seconds/3600,true);
      }
    }
    if(!await save())throw new Error('尚未写入磁盘');closeSheet(true);renderAll();startTimerTicker();if(action==='continue')showFocusOverlay();else toast(action==='settle'?'已结算到专注开始日期':'已放弃本次专注','good');
  }catch(error){data.days=snapshot.days;data.meta=snapshot.meta;toast('保存失败，请重试：'+error.message,'bad');}
}
