/* ============ 日期工具 ============ */
function fmt(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function todayStr(){return fmt(new Date());}


function daysAgoStr(n){var d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-n);return fmt(d);}
function daysAgoTime(n){var d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-n);return d.getTime();}
let viewDate=todayStr();
function viewDateLabel(){var el=document.getElementById('viewDateLabel');if(!el)return;var isToday=viewDate===todayStr();
  var wd=['周日','周一','周二','周三','周四','周五','周六'][new Date(viewDate+'T12:00:00').getDay()];
  el.textContent=(isToday?'今天':viewDate.slice(5).replace('-','/'))+' · '+wd;   
  var rb=document.getElementById('btnBackToday');if(rb)rb.hidden=isToday;   /* 已经在今天就不必再显示「今天」按钮，否则读起来是「今天 今天」 */
  refreshDayNoteChip();
  var lt=document.getElementById('lateTag');
  if(lt){var past=!isToday&&(dayObj(viewDate)||{})._late===1;lt.hidden=!past;lt.textContent=T('late_tag');}    }
function shiftViewDate(delta){var d=new Date(viewDate+'T12:00:00');d.setDate(d.getDate()+delta);var nd=fmt(d);if(delta>0&&nd>todayStr())return;   viewDate=nd;viewDateLabel();renderViewDateChange();}
function resetViewDate(){viewDate=todayStr();viewDateLabel();renderViewDateChange();}


function renderViewDateChange(){
  topDirty=ringDirty=todoDirty=checkinDirty=moodDirty=true;
  if(document.getElementById('page-stat').classList.contains('active'))statDirty=true;
  renderAll(false);
}
function dayObj(ds){return data.days[ds];}
function ensureDay(ds){if(!data.days[ds])data.days[ds]={};return data.days[ds];}


function lateGate(onOk){
  if(viewDate===todayStr())return onOk();
  var proceed=function(){ var d=ensureDay(viewDate); d._late=1; onOk(); };
  if(adminOn())return proceed();
  showConfirm(T('late_title'),T('late_msg').replace('{d}',viewDate),function(){ proceed(); },true);
}
/* 当天一句话备注（day.__note ≤100 字）：复用 confirm-box 视觉的小输入弹窗 */
function setDayNote(){
  try{
    var d=data.days[viewDate]||null;   
    var wrap=document.getElementById('dayNoteMask');
    if(!wrap){
      wrap=document.createElement('div');wrap.id='dayNoteMask';wrap.className='confirm-mask';
      wrap.innerHTML='<div class="confirm-box" role="dialog" aria-modal="true">'
        +'<div class="confirm-title">'+esc(T('note_title'))+'</div>'
        +'<div class="confirm-msg">'+esc(T('note_date_label'))+'<b id="dayNoteDate"></b></div>'
        +'<input id="dayNoteInput" maxlength="100" style="width:100%;box-sizing:border-box;margin:10px 0 2px">'
        +'<div class="confirm-actions"><button type="button" class="btn-ghost" id="dayNoteCancel">'+esc(T('cancel'))+'</button>'
        +'<button type="button" id="dayNoteOk" class="btn-ok" style="background:var(--accent);border:none;color:#fff;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer">'+esc(T('note_save'))+'</button></div>'
        +'</div>';
      document.body.appendChild(wrap);
      wrap.addEventListener('click',function(e){ if(e.target===wrap)hideDayNote(); });
      document.getElementById('dayNoteCancel').onclick=hideDayNote;
      document.getElementById('dayNoteOk').onclick=saveDayNote;
      document.getElementById('dayNoteInput').addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();saveDayNote();} if(e.key==='Escape')hideDayNote(); });
    }
    document.getElementById('dayNoteDate').textContent=viewDate===todayStr()?T('today'):viewDate;
    document.getElementById('dayNoteInput').value=(d&&typeof d.__note==='string')?d.__note:'';
    wrap.classList.add('show');
    setTimeout(function(){var i=document.getElementById('dayNoteInput');if(i){i.focus();i.select();}},80);
  }catch(_){}
}
function hideDayNote(){ var w=document.getElementById('dayNoteMask'); if(w)w.classList.remove('show'); }
function saveDayNote(){
  try{
    var i=document.getElementById('dayNoteInput');
    var v=i?String(i.value||'').trim().slice(0,100):'';
    var d=ensureDay(viewDate);
    if(v)d.__note=v; else delete d.__note;
    saveDebounced();
    refreshDayNoteChip();
    toast(T('note_saved'),'good');
  }catch(_){}
  hideDayNote();
}
/* 日期行备注角标：有备注显示 ✏️（实心），无备注显示空心 */
function refreshDayNoteChip(){
  var chip=document.getElementById('dayNoteChip');
  if(!chip)return;
  var d=dayObj(viewDate)||{};
  var has=typeof d.__note==='string'&&d.__note.length>0;
  chip.textContent=has?'✏️':'✏';
  chip.title=has?(d.__note):T('note_add');
  chip.classList.toggle('has',has);
}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function hexA(hex,a){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return `rgba(${r},${g},${b},${a})`;}
function isDarkHex(hex){
  const value=String(hex||'').replace('#','');
  if(!/^[0-9a-f]{6}$/i.test(value))return false;
  const r=parseInt(value.slice(0,2),16),g=parseInt(value.slice(2,4),16),b=parseInt(value.slice(4,6),16);
  return (r*0.299+g*0.587+b*0.114)<150;
}

/* ============ 完成判定 ============ */
/* 判定用「当天记录时的目标」而不是当前目标：原来把喝水目标 8 杯改成 2 杯，
   历史每一天都会被重新判定，整条记录变绿、连续天数凭空暴涨。
   首次写入某天时把当时的 target 冻结进 d[key+'_t']（与 range 的 _s/_e 同一套路）。 */
function targetOf(key,d,h){
  h=h||HMAP[key];
  const cur=(h&&Number(h.target))||1;
  const frozen=d?Number(d[key+'_t']):NaN;
  return (isFinite(frozen)&&frozen>0)?frozen:cur;
}
function stampTarget(dd,key){
  const h=HMAP[key]; if(!h||dd[key+'_t']!==undefined)return;
  const t=Number(h.target); if(isFinite(t)&&t>0)dd[key+'_t']=t;
}


function stampDoneTs(dd,key,ds){
  try{
    if(!dd||dd[key+'_ts'])return;
    var n=new Date();
    if(isDone(key,dd)){
      dd[key+'_ts']=String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
      if(ds&&ds!==todayStr())dd[key+'_tsb']=1;
    }
  }catch(_){}
}
function isDone(key,d){
  if(!d)return false;const h=HMAP[key];if(!h)return false;
  const fz=d[key+'_done'];if(fz!==undefined)return fz===1||fz===true;   /* 类型切换冻结的历史判定（见 freezeHabitHistory） */
  if(h.type==='bool')return !!d[key];
  if(h.type==='count')return (d[key]||0)>=targetOf(key,d,h);
  if(h.type==='hours')return (d[key]||0)>=targetOf(key,d,h);
  if(h.type==='range')return (d[key]||0)>=targetOf(key,d,h);
  return false;
}
function doneRatio(key,d){
  if(!d)return 0;const h=HMAP[key];if(!h)return 0;
  const fz=d[key+'_done'];if(fz!==undefined)return (fz===1||fz===true)?1:0;
  if(h.type==='bool')return d[key]?1:0;
  if(h.type==='count')return clamp((d[key]||0)/targetOf(key,d,h),0,1);
  if(h.type==='hours')return clamp((d[key]||0)/targetOf(key,d,h),0,1);
  if(h.type==='range')return clamp((d[key]||0)/targetOf(key,d,h),0,1);
  return 0;
}
/* 时间段 → 时长（小时），支持跨天 */
function rangeDuration(start,end){
  if(!start||!end)return 0;
  const [sh,sm]=start.split(':').map(Number);
  const [eh,em]=end.split(':').map(Number);
  let mins=(eh*60+em)-(sh*60+sm);
  if(mins<=0)mins+=24*60; // 跨天
  return Math.round(mins/30)/2; // 精确到 0.5 小时
}

