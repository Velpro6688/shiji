/* ============ 习惯编辑器 ============ */
function buildEditorOptions(){
  document.getElementById('edIcons').innerHTML=ICONS.map(ic=>`<div class="icon-opt ${ic===edSel.icon?'sel':''}" onclick="pickIcon('${ic}')">${ic}</div>`).join('');
  const types=[{k:'bool',e:icn('check',22,2),n:T('type_bool'),d:T('type_bool_d')},{k:'count',e:icn('hash',22,2),n:T('type_count'),d:T('type_count_d')},{k:'hours',e:icn('clock',22,2),n:T('type_hours'),d:T('type_hours_d')},{k:'range',e:icn('moon',22,2),n:T('type_range'),d:T('type_range_d')}];
  document.getElementById('edTypes').innerHTML=types.map(t=>`<div class="type-opt ${t.k===edSel.type?'sel':''}" onclick="pickType('${t.k}')"><div class="to-e">${t.e}</div><div class="to-n">${t.n}</div><div class="to-d">${t.d}</div></div>`).join('');
  const sizes=[{k:'wide',e:'▭',n:T('sz_wide'),d:T('sz_wide_d')},{k:'square',e:'◻',n:T('sz_square'),d:T('sz_square_d')}];
  document.getElementById('edSizes').innerHTML=sizes.map(t=>`<div class="type-opt ${t.k===edSel.size?'sel':''}" onclick="pickSize('${t.k}')"><div class="to-e">${t.e}</div><div class="to-n">${t.n}</div><div class="to-d">${t.d}</div></div>`).join('');
  document.getElementById('edCountFields').style.display=(edSel.type==='count'||edSel.type==='hours')?'flex':'none';
  document.getElementById('edRangeField').style.display=(edSel.type==='range')?'block':'none';
  syncHabitTargetConstraints();
  if(edSel.type==='hours'){document.getElementById('edUnit').value=document.getElementById('edUnit').value||T('unit_hour');}
  updateRewardPreview();   /* 类型与触发方式的错配要当场说话，别存完才发现奖励永远不弹 */
  enhanceKeyboardTargets();
}
function pickIcon(ic){edSel.icon=ic;buildEditorOptions();}
function pickSize(s){edSel.size=s;buildEditorOptions();}
function syncHabitTargetConstraints(){
  var input=document.getElementById('edTarget');if(!input)return;
  var current=Number(input.value)||0;
  if(edSel.type==='hours'){
    input.min='0.1';input.max=String(Math.max(99,current));input.step='0.1';
  }else{
    input.min='1';input.max=String(Math.max(1000000,Number.isSafeInteger(current)?current:0));input.step='1';
  }
}
function clearHabitFieldError(id){
  var errorIds={edName:'edNameError',edTarget:'edTargetError',edRangeTarget:'edRangeError'};
  var input=document.getElementById(id),error=document.getElementById(errorIds[id]||'');
  if(input)input.removeAttribute('aria-invalid');
  if(error){error.textContent='';error.hidden=true;}
}
function setHabitFieldError(id,message){
  var errorIds={edName:'edNameError',edTarget:'edTargetError',edRangeTarget:'edRangeError'};
  var input=document.getElementById(id),error=document.getElementById(errorIds[id]||'');
  if(input){input.setAttribute('aria-invalid','true');input.focus();}
  if(error){error.textContent=message;error.hidden=false;}
}
function validateHabitTargets(){
  var targetInput=document.getElementById('edTarget'),value=Number(targetInput.value),max=Number(targetInput.max)||1000000;
  clearHabitFieldError('edName');clearHabitFieldError('edTarget');clearHabitFieldError('edRangeTarget');
  if(edSel.type==='count'&&(!Number.isSafeInteger(value)||value<1||value>max)){
    setHabitFieldError('edTarget','请输入 1 到 '+max.toLocaleString()+' 之间的整数。');return false;
  }
  if(edSel.type==='hours'&&(!Number.isFinite(value)||value<0.1||value>max||Math.abs(value*10-Math.round(value*10))>1e-7)){
    setHabitFieldError('edTarget','请输入 0.1 到 '+max+' 小时，最多保留一位小数。');return false;
  }
  if(edSel.type==='range'){
    var range=Number(document.getElementById('edRangeTarget').value);
    if(!Number.isFinite(range)||range<0.5||range>24||Math.abs(range*2-Math.round(range*2))>1e-7){
      setHabitFieldError('edRangeTarget','请输入 0.5 到 24 小时，按半小时递增。');return false;
    }
  }
  return true;
}
function pickType(t){edSel.type=t;if(t==='hours'){document.getElementById('edTarget').value=1;document.getElementById('edUnit').value=T('unit_hour');}else if(t==='count'){document.getElementById('edTarget').value=8;document.getElementById('edUnit').value=T('unit_cup');}clearHabitFieldError('edTarget');clearHabitFieldError('edRangeTarget');buildEditorOptions();}

 
const HABIT_TEMPLATES=[
  {icon:'📖',zh:'阅读',en:'Read',type:'hours',target:1,unitZh:'小时',unitEn:'h',color:'#D08D98'},
  {icon:'🏃',zh:'运动',en:'Exercise',type:'bool',color:'#8FAE86'},
  {icon:'💧',zh:'喝水',en:'Water',type:'count',target:8,unitZh:'杯',unitEn:'cups',color:'#7FA0B4'},
  {icon:'🧘',zh:'冥想',en:'Meditate',type:'hours',target:0.5,unitZh:'小时',unitEn:'h',color:'#6EB8AE'},
  {icon:'🌅',zh:'早睡',en:'Early to bed',type:'bool',color:'#D69B72'},
  {icon:'✍️',zh:'写日记',en:'Journal',type:'bool',color:'#9BA890'},
  {icon:'💊',zh:'吃维生素',en:'Vitamins',type:'bool',color:'#E0BC72'},
  {icon:'🚶',zh:'散步',en:'Walk',type:'count',target:6000,unitZh:'步',unitEn:'steps',color:'#8B9DAE'},
  {icon:'💪',zh:'力量训练',en:'Strength',type:'bool',color:'#E89A82'},
  {icon:'🌙',zh:'不熬夜',en:'No late nights',type:'bool',color:'#A794C0'},
  {icon:'🦷',zh:'刷牙',en:'Brush teeth',type:'bool',color:'#7FA0B4'},
  {icon:'📵',zh:'少刷手机',en:'Less scrolling',type:'bool',color:'#C77B85'}
];
function renderHabitTemplates(){
  var wrap=document.getElementById('edTemplates');if(!wrap)return;
  wrap.innerHTML='';
  HABIT_TEMPLATES.forEach(function(t){
    var b=document.createElement('button');b.type='button';b.className='tpl-chip';
    b.innerHTML='<span class="tp-ic">'+t.icon+'</span>'+(LANG==='en'?t.en:t.zh);
    b.onclick=function(){
      try{
        document.getElementById('edName').value=(LANG==='en'?t.en:t.zh).slice(0,10);
        edSel.icon=t.icon;edSel.color=t.color;edSel.type=t.type;
        if(t.target)document.getElementById('edTarget').value=t.target;
        document.getElementById('edUnit').value=LANG==='en'?(t.unitEn||''):(t.unitZh||'');
        document.getElementById('edRangeTarget').value=t.target||8;
        buildEditorOptions();
      }catch(_){}
    };
    wrap.appendChild(b);
  });
}
window.renderHabitTemplates=renderHabitTemplates;

function openAdd(){
  renderHabitTemplates();
  editingKey=null;edSel={icon:ICONS[0],color:COLORS[HABITS.length%COLORS.length],type:'bool',size:'wide'};
  document.getElementById('edTitle').textContent=T('ed_add');
  document.getElementById('edName').value='';
  clearHabitFieldError('edName');clearHabitFieldError('edTarget');clearHabitFieldError('edRangeTarget');
  document.getElementById('edTarget').value=8;document.getElementById('edUnit').value=T('unit_cup');
  document.getElementById('edRangeTarget').value=8;
  document.getElementById('edRemindAt').value='';
  document.getElementById('edRemindDays').value='all';document.getElementById('edRemindCustom').style.display='none';
  document.getElementById('edRewardText').value='';
  document.getElementById('edRewardMin').value=20;
  document.getElementById('edRewardPer').value='check';
  document.getElementById('edDelBtn').style.display='none';
  document.getElementById('edArchiveBtn').style.display='none';
  loadScheduleEditor(null);buildEditorOptions();openSheet('editorSheet');
}
function openEdit(key){
  const h=HMAP[key];if(!h)return;
  editingKey=key;edSel={icon:h.icon,color:h.color,type:h.type,size:h.size||'wide'};
  document.getElementById('edTitle').textContent=T('ed_edit');
  document.getElementById('edName').value=h.name;
  clearHabitFieldError('edName');clearHabitFieldError('edTarget');clearHabitFieldError('edRangeTarget');
  document.getElementById('edTarget').value=h.target||8;document.getElementById('edUnit').value=h.unit||T('unit_times');
  document.getElementById('edRangeTarget').value=(h.type==='range'?(h.target||8):8);
  document.getElementById('edRemindAt').value=h.remindAt||'';   
  edRemindDaysLoad(h);
  var rw0=h.reward||{};
  document.getElementById('edRewardText').value=rw0.text||'';
  document.getElementById('edRewardMin').value=(rw0.minutes!=null?rw0.minutes:20);
  document.getElementById('edRewardPer').value=rw0.per||'check';
  document.getElementById('edDelBtn').style.display='block';
  var ab=document.getElementById('edArchiveBtn');ab.style.display='block';ab.textContent=h.archived?T('btn_unarchive'):T('archive_title');
  loadScheduleEditor(h);buildEditorOptions();openSheet('editorSheet');
}
function toggleHabitArchive(){
  if(!editingKey)return;
  var h=HMAP[editingKey];if(!h)return;
  if(h.archived){
    preserveInactiveRange(h);h.archived=false;delete h.archivedAt;save();mineDirty=true;syncHabits();renderAll();closeSheet(true);
    toast(T('t_restored_named')(h.name),'good');return;
  }
  adminGate(T('admin_gate_delete').replace('{n}',h.name),function(){
    showConfirm(T('archive_title'),T('confirm_archive')(h.name),function(){
      if(data.meta.activeTimer&&data.meta.activeTimer.key===editingKey){delete data.meta.activeTimer;clearTimerTicker();hideFocusOverlay();}
      h.archived=true;h.archivedAt=todayStr();save();mineDirty=true;syncHabits();renderAll();closeSheet(true);
      toast(T('t_archived'),'good');
    });
  });
}


function clearHabitHistory(key){
  let cleared=0;
  Object.keys(data.days).forEach(function(ds){
    const day=data.days[ds];if(!day||typeof day!=='object')return;
    let hit=false;
    [key,key+'_s',key+'_e',key+'_t',key+'_ts',key+'_tsb',key+'_done'].forEach(function(f){if(f in day){delete day[f];hit=true;}});
    if(hit)cleared++;
  });
  return cleared;
}


function freezeHabitHistory(key){
  const h=HMAP[key];if(!h)return 0;
  let frozen=0;
  Object.keys(data.days).forEach(function(ds){
    const day=data.days[ds];if(!day||typeof day!=='object')return;
    if(!((key in day)||((key+'_s') in day)||((key+'_e') in day)))return;
    if(day[key+'_done']!==undefined)return;
    stampTarget(day,key);   /* 冻结目标一并锁死：解冻编辑旧日时仍按当时目标判 */
    day[key+'_done']=isDone(key,day)?1:0;
    frozen++;
  });
  return frozen;
}
function saveHabit(){
  const name=document.getElementById('edName').value.trim();
  if(!name){setHabitFieldError('edName',T('t_name_first'));return;}
  if(!validateHabitTargets())return;
  const schedule=readScheduleEditor();
  if(schedule.mode==='weekdays'&&!schedule.days.length){toast('请至少选择一个执行星期','bad');return;}
  const weekly=Number(document.getElementById('edWeeklyTimes').value);
  if(schedule.mode==='weekly'&&(!Number.isInteger(weekly)||weekly<1||weekly>7)){toast('每周次数应为 1 到 7 的整数','bad');return;}
  const active=activeTimer();
  const eh=editingKey?HMAP[editingKey]:null;
  const rwTxt=(document.getElementById('edRewardText').value||'').trim();
  const rwMin=Math.max(0,Math.min(600,Math.round(Number(document.getElementById('edRewardMin').value)||0)));
  const rewardUp=!!(eh&&eh.reward&&rwTxt&&rwMin>(eh.reward.minutes||0));
  const needAbandon=!!(editingKey&&active&&active.key===editingKey&&edSel.type!=='hours');
  const doType=function(){
    if(editingKey){
      const h=HMAP[editingKey];
      

      if(h.type!==edSel.type){
        const hasHistory=Object.keys(data.days).some(function(ds){
          const day=data.days[ds];
          return day&&(editingKey in day||(editingKey+'_s') in day||(editingKey+'_e') in day);
        });
        if(hasHistory){ showConfirm(T('cf_type_title'),T('cf_type_msg')(h.name,h.type,edSel.type),function(){ const fn=freezeHabitHistory(editingKey);toast(T('cf_type_frozen')(fn),'backup'); doSaveHabit(); },true); return; }
      }
    }
    doSaveHabit();
  };
  const go=function(){ if(needAbandon){ showConfirm(T('cf_abandon_title'),T('cf_abandon_timer')(HMAP[editingKey].name),doType,true); } else doType(); };
  if(rewardUp){ adminGate(T('admin_gate_reward'),go); } else { go(); }
}
function doSaveHabit(){
  const name=document.getElementById('edName').value.trim();
  const target=edSel.type==='hours'?parseFloat(document.getElementById('edTarget').value):parseInt(document.getElementById('edTarget').value,10);
  const unit=document.getElementById('edUnit').value.trim()||(edSel.type==='hours'?T('unit_hour'):T('unit_times'));
  const rangeTarget=parseFloat(document.getElementById('edRangeTarget').value)||1;
  if(editingKey){
    const h=HMAP[editingKey];
    saveScheduleEditor(h);
    h.name=name;h.icon=edSel.icon;h.color=edSel.color;h.type=edSel.type;h.size=edSel.size;
    h.remindAt=document.getElementById('edRemindAt').value||'';
    h.remindDays=edRemindDaysSave();
    var rwT=(document.getElementById('edRewardText').value||'').trim();
    if(rwT){h.reward={text:rwT.slice(0,30),minutes:Math.max(0,Math.min(600,Math.round(Number(document.getElementById('edRewardMin').value)||0))),per:(document.getElementById('edRewardPer').value||'check')};}else{delete h.reward;}
    if(edSel.type==='count'){h.target=target;h.unit=unit;delete h.start;delete h.end;}
    else if(edSel.type==='hours'){h.target=target;h.unit=unit;delete h.start;delete h.end;}
    else if(edSel.type==='range'){h.target=rangeTarget;h.unit=T('unit_hour');if(!h.start)h.start='23:00';if(!h.end)h.end='07:00';}
    else{delete h.target;delete h.unit;delete h.start;delete h.end;}
    if(data.meta.activeTimer&&data.meta.activeTimer.key===editingKey&&edSel.type!=='hours'){
      delete data.meta.activeTimer;clearTimerTicker();hideFocusOverlay();
    }
  }else{
    const nh={key:'h'+Date.now(),name,icon:edSel.icon,color:edSel.color,type:edSel.type,size:edSel.size,createdAt:todayStr()};
    if(edSel.type==='count'){nh.target=target;nh.unit=unit;}
    else if(edSel.type==='hours'){nh.target=target;nh.unit=unit;}
    else if(edSel.type==='range'){nh.target=rangeTarget;nh.unit=T('unit_hour');nh.start='23:00';nh.end='07:00';}
    saveScheduleEditor(nh);HABITS.push(nh);
    nh.remindAt=document.getElementById('edRemindAt').value||'';
    nh.remindDays=edRemindDaysSave();
    var rwT2=(document.getElementById('edRewardText').value||'').trim();
    if(rwT2){nh.reward={text:rwT2.slice(0,30),minutes:Math.max(0,Math.min(600,Math.round(Number(document.getElementById('edRewardMin').value)||0))),per:(document.getElementById('edRewardPer').value||'check')};}
  }
  saveDebounced();mineDirty=true;syncHabits();renderAll();if(window.HabitUI)window.HabitUI.markSheetClean();closeSheet();
  toast(editingKey?T('t_updated'):T('t_added'),'good');
}
/* 软删除：只打标记，习惯定义与全部历史记录原样保留（往期日期只读可见、管理页可恢复） */
function softDeleteHabit(key){
  const h=HMAP[key];if(!h)return;
  if(!adminOn()&&!softDeleteHabit._ok){ showConfirm(T('admin_gate_title'),T('admin_gate_delete').replace('{n}',h.name),function(){ softDeleteHabit._ok=true; softDeleteHabit(key); softDeleteHabit._ok=false; },true); return; }
  if(data.meta.activeTimer&&data.meta.activeTimer.key===key){delete data.meta.activeTimer;clearTimerTicker();hideFocusOverlay();}
  h.deleted=true;h.deletedAt=todayStr();
  preserveInactiveRange(h);h.archived=false;delete h.archivedAt;   /* 保留此前归档区间 */
  /* 一条活跃习惯都不剩时打持久标记：下次启动不再用默认习惯兜底（否则"删了又回来"） */
  if(!HABITS.some(x=>!x.deleted)){if(!data.meta)data.meta={};data.meta.habitsCleared=true;}
  save();mineDirty=true;syncHabits();renderAll();
}
function delHabitFromEditor(){
  if(!editingKey)return;
  showConfirm(T('del_habit_title'),T('confirm_del'),function(){
    softDeleteHabit(editingKey);closeSheet(true);
    toast(T('t_habit_del'));
  },true);
}
function confirmSoftDeleteHabit(key){
  showConfirm(T('del_habit_title'),T('confirm_del'),function(){
    softDeleteHabit(key);
    toast(T('t_habit_del'));
  },true);
}
/* 恢复：从「已归档」或「已删除」区一键回到活跃列表，历史记录从未变动 */
function preserveInactiveRange(h){
  const from=[h.archivedAt,h.deletedAt].filter(window.HabitRules.validDate).sort()[0],to=daysAgoStr(1);
  if(from&&from<=to){if(!Array.isArray(h.pauseRanges))h.pauseRanges=[];h.pauseRanges.push({from,to,kind:'pause'});}
}
function restoreHabit(key){
  const h=HMAP[key];if(!h)return;
  preserveInactiveRange(h);
  if(h.deleted){h.deleted=false;delete h.deletedAt;}
  if(h.archived){h.archived=false;delete h.archivedAt;}
  save();mineDirty=true;syncHabits();renderAll();
  toast(T('t_restored_named')(h.name),'good');
}
/* 彻底删除：双重确认后清除全部历史记录并真正移除（唯一会动历史数据的入口，需用户显式选择） */
function confirmPurgeHabit(key){
  const h=HMAP[key];if(!h)return;
  showConfirm(T('purge_title'),T('confirm_purge')(h.name),function(){
    if(data.meta.activeTimer&&data.meta.activeTimer.key===key){delete data.meta.activeTimer;clearTimerTicker();hideFocusOverlay();}
    const n=clearHabitHistory(key);
    rwDropHabit(key);   /* 历史清了却留下 rewardHourAcc 余额和领不到的待领奖励，会成幽灵数据 */
    HABITS=HABITS.filter(x=>x.key!==key);
    if(!HABITS.some(x=>!x.deleted)){if(!data.meta)data.meta={};data.meta.habitsCleared=true;}
    save();mineDirty=true;syncHabits();renderAll();
    toast(T('t_purged')(n));
  },true);
}

/* ============ 头像统一渲染（优先图片，其次 emoji/文字） ============ */
function setAva(id){
  const el=document.getElementById(id);if(!el)return;
  const img=data.profile.avatarImg;
  el.replaceChildren();
  el.style.backgroundImage='';
  if(img){
    const photo=document.createElement('img');
    photo.src=img;photo.alt='头像';photo.draggable=false;
    el.appendChild(photo);
  }else el.textContent=data.profile.avatar||'☕';
}

/* ============ 个人资料（上传图片 / 任意 emoji / 预设） ============ */
let pfAvatar=null;     // 暂存本次选择的 emoji/文字
let pfImg=undefined;   // undefined=未改动；''=清除图片；base64=新图片
function openProfile(){
  document.getElementById('pfName').value=data.profile.name||'';
  document.getElementById('pfEmoji').value='';
  pfAvatar=null;pfImg=undefined;
  refreshPfPreview();
  document.getElementById('pfAvatars').innerHTML=AVATARS.map(a=>`<div class="icon-opt ${(!currentImg()&&a===currentEmoji())?'sel':''}" onclick="pickAvatar('${a}')">${a}</div>`).join('');
  openSheet('profileSheet');
}
// 预览时优先级：本次新图 > 已存图 > 本次选的emoji > 已存emoji
function currentImg(){return pfImg!==undefined?pfImg:(data.profile.avatarImg||'');}
function currentEmoji(){return pfAvatar!==null?pfAvatar:(data.profile.avatar||'☕');}
function refreshPfPreview(){
  const p=document.getElementById('pfPreview');
  const img=currentImg();
  if(img){p.textContent='';p.style.backgroundImage=`url(${img})`;}
  else{p.style.backgroundImage='';p.textContent=currentEmoji();}
}
function pickAvatar(a){
  pfAvatar=a;pfImg='';  // 选预设 emoji 即清除图片
  refreshPfPreview();
  document.getElementById('pfAvatars').innerHTML=AVATARS.map(av=>`<div class="icon-opt ${av===a?'sel':''}" onclick="pickAvatar('${av}')">${av}</div>`).join('');
  enhanceKeyboardTargets();
}
function uploadAvatar(ev){
  const f=ev.target.files[0];if(!f)return;
  if(f.size>3*1024*1024){toast(T('t_img_big'),'backup');ev.target.value='';return;}
  const r=new FileReader();
  r.onload=()=>{
    // 压缩到 256px 方图，避免 localStorage 爆掉
    const im=new Image();
    im.onload=()=>{
      const S=256,cv=document.createElement('canvas');cv.width=S;cv.height=S;
      const ctx=cv.getContext('2d');
      const side=Math.min(im.width,im.height);
      const sx=(im.width-side)/2,sy=(im.height-side)/2;
      ctx.drawImage(im,sx,sy,side,side,0,0,S,S);
      pfImg=cv.toDataURL('image/jpeg',0.85);
      document.getElementById('pfAvatars').innerHTML=AVATARS.map(av=>`<div class="icon-opt" onclick="pickAvatar('${av}')">${av}</div>`).join('');
      enhanceKeyboardTargets();
      refreshPfPreview();
      toast(T('t_img_ready'),'good');
    };
    im.src=r.result;
  };
  r.readAsDataURL(f);ev.target.value='';
}
function applyEmojiAvatar(){
  const v=document.getElementById('pfEmoji').value.trim();
  if(!v){toast(T('t_emoji_first'));return;}
  pfAvatar=v;pfImg='';  // 用 emoji 即清除图片
  refreshPfPreview();
  document.getElementById('pfAvatars').innerHTML=AVATARS.map(av=>`<div class="icon-opt" onclick="pickAvatar('${av}')">${av}</div>`).join('');
  enhanceKeyboardTargets();
}
function saveProfile(){
  const name=document.getElementById('pfName').value.trim()||'用户';
  data.profile.name=name;
  if(pfImg!==undefined)data.profile.avatarImg=pfImg;   // 更新/清除图片
  if(pfAvatar!==null)data.profile.avatar=pfAvatar;     // 更新 emoji
  saveDebounced();mineDirty=true;renderAll();if(window.HabitUI)window.HabitUI.markSheetClean();closeSheet();pfAvatar=null;pfImg=undefined;
  toast(T('t_profile_saved'),'good');
}

// 十六进制转 rgba

// 生成强调色的浅色 tint（混白）

/* 解析 #RRGGBB 或 rgb(r,g,b) → [r,g,b] */
function parseRGB(c){c=(c||'').trim();if(c[0]==='#'){const h=c.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}const m=c.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);return m?[+m[1],+m[2],+m[3]]:[245,239,230];}
function toHex2(n){return Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');}
/* 两色按 ratio 混合(0=a,1=b) → #hex，便于链式再派生 */
function mixHex(a,b,ratio){const A=parseRGB(a),B=parseRGB(b);return '#'+toHex2(A[0]+(B[0]-A[0])*ratio)+toHex2(A[1]+(B[1]-A[1])*ratio)+toHex2(A[2]+(B[2]-A[2])*ratio);}
