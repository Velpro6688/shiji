/* ============ 提醒逻辑 ============ */
 
(function(){
  function showRemindBanner(n){
    try{
      var w=document.getElementById('toastWrap');
      if(!w)return;
      var el=document.createElement('div');el.className='toast remind-banner';el.setAttribute('role','alert');
      el.innerHTML='<b>'+esc(n&&n.title||'提醒')+'</b><span style="display:block;margin-top:2px">'+esc(n&&n.body||'')+'</span>';
      w.appendChild(el);
      setTimeout(function(){el.style.transition='.4s';el.style.opacity='0';el.style.transform='translateY(-10px)';setTimeout(function(){el.remove();},400);},8000);
      playTap();
    }catch(_){}
  }
  window.showRemindBanner=showRemindBanner;
  if(window.hbShell&&window.hbShell.onRemind){ try{ window.hbShell.onRemind(showRemindBanner); }catch(_){} }
})();
/* 编辑器「自定义星期」交互 */
var edRemindWeekSel=[];
function edRemindDaysChanged(){
  var sel=document.getElementById('edRemindDays'),box=document.getElementById('edRemindCustom');
  if(!sel||!box)return;
  var custom=sel.value==='custom';
  box.style.display=custom?'':'none';
  if(custom&&!box.dataset.built){
    box.dataset.built='1';
    var names=['日','一','二','三','四','五','六'];
    var wrap=document.getElementById('edRemindWeek');
    names.forEach(function(nm,d){
      var b=document.createElement('button');b.type='button';b.className='ed-week-btn';b.textContent=nm;b.dataset.d=d;
      b.onclick=function(){var i=edRemindWeekSel.indexOf(d);if(i>=0){edRemindWeekSel.splice(i,1);b.classList.remove('on');}else{edRemindWeekSel.push(d);b.classList.add('on');}};
      wrap.appendChild(b);
    });
  }
  if(custom){ edRemindWeekSel=(window.__edRemindWeekSave||[]).slice(); (document.querySelectorAll('#edRemindWeek .ed-week-btn')||[]).forEach(function(b){var d=+b.dataset.d;if(edRemindWeekSel.indexOf(d)>=0)b.classList.add('on');}); }
  else { window.__edRemindWeekSave=edRemindWeekSel.slice(); }
}
function edRemindDaysLoad(h){
  var rule=h.remindDays||'all';
  var sel=document.getElementById('edRemindDays');
  if(/^[0-6](,[0-6])*$/.test(rule)){ sel.value='custom'; edRemindWeekSel=rule.split(',').map(Number); }
  else { sel.value=['all','weekdays','weekends'].indexOf(rule)>=0?rule:'all'; edRemindWeekSel=[]; }
  window.__edRemindWeekSave=edRemindWeekSel.slice();
  edRemindDaysChanged();
}
function edRemindDaysSave(){
  var sel=document.getElementById('edRemindDays');
  if(sel.value==='custom'){ edRemindWeekSel.sort(); return edRemindWeekSel.length?edRemindWeekSel.join(','):'all'; }
  return sel.value;
}

function checkReminders(){
  // 连续里程碑（14/28/42…）庆祝
  activeHabits().forEach(h=>{
    const s=streakOf(h.key);
    [14,28,42,60,100].forEach(ms=>{
      if(s>=ms && !data.meta.notifiedStreak[h.key+'_'+ms]){
        data.meta.notifiedStreak[h.key+'_'+ms]=1;saveDebounced();
        toast(T('t_streak_milestone')(h.name,ms),'backup');
      }
    });
  });
  /* v2.1：20 点汇总与单习惯到点提醒已整体移交主进程（reminders.js 调度，托盘态照常触发，
     reminder-state.json 去重）。渲染层不再发系统通知，这里只保留连续里程碑 toast。 */
}

