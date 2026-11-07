/* ============ 交互：打卡 ============ */
function toggleBool(key,e){const d=dayObj(viewDate)||{};const was=!!d[key];   /* 只读预取：物化空日推迟到确认弹窗通过之后（go 内 ensureDay），点「取消」不再留下空日 */
  const go=function(){const dd=ensureDay(viewDate);dd[key]=!dd[key];delete dd[key+'_done'];stampDoneTs(dd,key,viewDate);saveDebounced();if(dd[key]){celebrate(e,HMAP[key].color,true,false,HMAP[key].icon);if(!was)maybeReward(HMAP[key],'check');}after('checkin');};
  if(was){adminGate(T('admin_gate_undo').replace('{n}',HMAP[key].name),go);}
  else lateGate(go);
}
function addCount(key,n,e){const d=dayObj(viewDate)||{},h=HMAP[key],b=d[key]||0;const wasDone=isDone(key,d);
  const go=function(){const dd=ensureDay(viewDate);dd[key]=clamp(b+n,0,targetOf(key,dd,h));delete dd[key+'_done'];stampTarget(dd,key);stampDoneTs(dd,key,viewDate);saveDebounced();celebrate(e,h.color,isDone(key,dd),false,h.icon);if(isDone(key,dd)&&!wasDone)maybeReward(h,'check');after('checkin');};
  if(n<0){adminGate(T('admin_gate_reduce').replace('{n}',h.name),go);}
  else lateGate(go);
}
function setCount(key,idx,e){const d=dayObj(viewDate)||{},h=HMAP[key],cur=d[key]||0;const next=idx+1;const wasDone=isDone(key,d);
  const go=function(){const dd=ensureDay(viewDate);dd[key]=(next===cur)?0:next;delete dd[key+'_done'];stampTarget(dd,key);stampDoneTs(dd,key,viewDate);saveDebounced();if(dd[key]>cur)celebrate(e,h.color,isDone(key,dd),false,h.icon);if(isDone(key,dd)&&!wasDone)maybeReward(h,'check');after('checkin');};
  if(next===cur){adminGate(T('admin_gate_undo').replace('{n}',h.name),go);}   /* 点当前格 = 清零，属于取消打卡，必须过闸 */
  else if(next<cur){adminGate(T('admin_gate_reduce').replace('{n}',h.name),go);}
  else lateGate(go);
}
function setCountValue(key,raw,e){
  const h=HMAP[key],next=Number(raw);
  if(!h)return;
  if(!Number.isSafeInteger(next)||next<0||next>targetOf(key,dayObj(viewDate),h)){toast(T('count_value_error'));renderCheckin();return;}
  const d=dayObj(viewDate)||{},cur=Number(d[key]||0),wasDone=isDone(key,d);
  if(next===cur)return;
  const go=function(){const dd=ensureDay(viewDate);dd[key]=next;delete dd[key+'_done'];stampTarget(dd,key);stampDoneTs(dd,key,viewDate);saveDebounced();if(next>cur)celebrate(e,h.color,isDone(key,dd),false,h.icon);if(isDone(key,dd)&&!wasDone)maybeReward(h,'check');after('checkin');};
  if(next<cur)adminGate(T('admin_gate_reduce').replace('{n}',h.name),go);
  else lateGate(go);
}
/* 时间段打卡：存开始/结束时间点，自动算时长 */
function setRange(key,which,val,e){
  const d=dayObj(viewDate)||{},h=HMAP[key];
  const hasDurationRecord=Number(d[key])>0;
  const startFallback=hasDurationRecord?'':(h.start||'23:00');
  const endFallback=hasDurationRecord?'':(h.end||'07:00');
  const ns=which==='s'?val:(d[key+'_s']||startFallback);
  const ne=which==='e'?val:(d[key+'_e']||endFallback);
  const go=function(){
    const dd=ensureDay(viewDate);
    if(which==='s')dd[key+'_s']=val; else dd[key+'_e']=val;
    const s=dd[key+'_s']||startFallback;
    const en=dd[key+'_e']||endFallback;
    if(!s||!en){saveDebounced();after('checkin');return;}
    const wasB=isDone(key,dd);
    dd[key]=rangeDuration(s,en);
    delete dd[key+'_done'];
    stampTarget(dd,key);
    stampDoneTs(dd,key,viewDate);
    saveDebounced();
    if(!wasB && isDone(key,dd)){celebrate(e,h.color,true,false,h.icon);maybeReward(h,'check');}
    after('checkin');
  };
  if(ns&&ne&&rangeDuration(ns,ne)<(d[key]||0)){adminGate(T('admin_gate_reduce').replace('{n}',h.name),go);}
  else lateGate(go);
}
/* 专注型手动补录/减少：习惯编辑里写着「手动加减小时」，但原来只能等计时器整段跑完才计入
   —— 中途「放弃本次」会把已用的时间全丢掉，也没有任何补录入口。 */
function addHoursManually(key,delta,e){
  const h=HMAP[key]; if(!h||h.type!=='hours'||h.archived||h.deleted)return;
   
  const wasDone=isDone(key,dayObj(viewDate));
  const go=function(){
    const dd=ensureDay(viewDate);
    const before=Number(dd[key])||0;
    const v=Math.max(0,Math.round((before+delta)*100)/100);
    dd[key]=v;
    delete dd[key+'_done'];
    stampTarget(dd,key);
    stampDoneTs(dd,key,viewDate);
    if(delta<0){
      /* 减了要把奖励累计一起回收，否则「加满→领奖→减掉→再加」可以无限刷奖 */
      const m=rwMeta();
      if(m.rewardHourAcc){ const a=Number(m.rewardHourAcc[key])||0; m.rewardHourAcc[key]=Math.max(0,Math.round((a+delta)*100)/100); }
    }
    saveDebounced();
    if(delta>0){ if(!wasDone&&isDone(key,dd))celebrate(e,h.color,true,false,h.icon); maybeReward(h,'hours',delta); }
    after('checkin');
  };
  if(delta<0){ adminGate(T('admin_gate_reduce').replace('{n}',h.name),go); } else lateGate(go);
}
function setMood(key,e){const cur=(dayObj(viewDate)||{}).mood;const dd=ensureDay(viewDate);dd.mood=cur===key?undefined:key;saveDebounced();if(dd.mood){celebrate(e,MMAP[key].color,false);moodBurst(e,key);}after('mood');}
/* 今日是否所有（未归档未删除）习惯都已完成 */
function allDoneToday(){
  const d=dayObj(todayStr())||{};
  const act=habitsVisibleOn(todayStr()).filter(h=>window.HabitRules.eligible(h,todayStr()));
  return act.length>0 && act.every(h=>isDone(h.key,d));
}
/* 达成"今日全勤"时弹出庆祝横幅，每天只庆祝一次 */
function maybeFullDayCheer(){
  try{
    if(!data.meta)data.meta={};
    if(data.meta.fullDayCheered===todayStr())return;
    if(!allDoneToday())return;
    data.meta.fullDayCheered=todayStr();saveDebounced();
    const pool=[T('cheer_alldone_1'),T('cheer_alldone_2'),T('cheer_alldone_3')];
    showCheer(pool[Math.floor(Math.random()*pool.length)],'🏆');
  }catch(_){}
}
function after(kind){
  try{streakCacheReset();}catch(_){}    
  statDirty=true;
  if(kind==='mood')moodDirty=true;
  else{checkinDirty=true;ringDirty=true;todoDirty=true;topDirty=true;}
  renderAll(false);checkReminders();
  if(kind!=='mood')maybeFullDayCheer();   /* 打卡后检测全勤庆祝 */
}

/* ============ 满足感反馈 ============ */
let audioCtx=null;
function primeFocusSound(){
  if(!data.settings.sound)return;
  try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();}catch(e){}
}
function beep(freq,dur){
  if(!data.settings.sound)return;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(audioCtx.destination);
    o.type='sine';o.frequency.value=freq;
    g.gain.setValueAtTime(0.001,audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.15,audioCtx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+dur);
    o.start();o.stop(audioCtx.currentTime+dur);
  }catch(e){}
}
/* 点击触感音：极短高频下滑"嗒"，明显轻于打卡音，避免听觉疲劳 */
function playTap(){
  if(!data.settings.sound)return;
  try{
    audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    if(audioCtx.state==='suspended')audioCtx.resume();
    const t0=audioCtx.currentTime;
    const o=audioCtx.createOscillator(),g=audioCtx.createGain();
    o.connect(g);g.connect(audioCtx.destination);
    o.type='sine';
    o.frequency.setValueAtTime(1180,t0);
    o.frequency.exponentialRampToValueAtTime(720,t0+0.04);
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(0.085,t0+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+0.07);
    o.start(t0);o.stop(t0+0.08);
  }catch(e){}
}
function playFocusCompleteSound(){
  if(!data.settings.sound)return;
  beep(784,.13);setTimeout(()=>beep(988,.13),150);setTimeout(()=>beep(1319,.24),300);
}
function celebrate(e,color,big,quiet){
  /* 卡片弹性回弹：打卡成功的"卡点"手感 */
  if(e&&e.target&&e.target.closest){
    const host=e.target.closest('.hcard,.mood-pick,.cup,.ring-card');
    if(host){host.classList.remove('fx-pop');void host.offsetWidth;host.classList.add('fx-pop');setTimeout(()=>host.classList.remove('fx-pop'),420);}
  }
  if(data.settings.sound&&!quiet){
    beep(big?880:660,0.18);
    if(big)setTimeout(()=>beep(1174,0.2),90);
    if(navigator.vibrate)navigator.vibrate(big?[15,30,15]:12);
  }
  const x=(e&&e.clientX)||window.innerWidth/2;
  const y=(e&&e.clientY)||window.innerHeight/2;
  /* 即时彩蛋：优先用刚打卡的习惯图标做粒子，让反馈跟当前动作绑定 */
  const habitIcon=arguments.length>4?arguments[4]:null;
  const pool=(habitIcon?[habitIcon]:[]).concat(big?['✨','🎉','⭐','💫','🌟','☕']:['✨','💫','·']);
  const n=big?12:6;
  for(let i=0;i<n;i++){
    const p=document.createElement('div');p.className='particle';
    p.textContent=pool[Math.floor(Math.random()*pool.length)];
    const ang=Math.random()*Math.PI*2,dist=40+Math.random()*70;
    p.style.left=x+'px';p.style.top=y+'px';
    p.style.setProperty('--dx',Math.cos(ang)*dist+'px');
    p.style.setProperty('--dy',(Math.sin(ang)*dist-40)+'px');
    p.style.setProperty('--rot',(Math.random()*360)+'deg');
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),900);
  }
  /* 达成目标（big）时：弹出随机鼓励文案横幅，给情绪价值 */
  if(big&&!quiet){
    const CHEERS=[T('cheer_goal_1'),T('cheer_goal_2'),T('cheer_goal_3'),T('cheer_goal_4'),T('cheer_goal_5')];
    showCheer(CHEERS[Math.floor(Math.random()*CHEERS.length)],habitIcon||'✅');
  }
}
/* 中央文案横幅：短促出现 1.5s 后淡出，纯展示不挡点击 */
function showCheer(text,icon){
  if(!text)return;
  const old=document.querySelector('.cheer');if(old)old.remove();
  const el=document.createElement('div');el.className='cheer';
  el.innerHTML='<span class="cheer-ic">'+(icon?esc(icon):'✨')+'</span><span class="cheer-tx">'+esc(text)+'</span>';
  document.body.appendChild(el);
  setTimeout(function(){el.classList.add('cheer-out');},1500);
  setTimeout(function(){el.remove();},2200);
}

/* ===== 贴纸「今日进度卡」视图（锁定态/独立编辑窗可用） ===== */
function currentStickyMode(){try{var m=localStorage.getItem('hb_lock_mode');return (m==='note')?'note':(m==='todo'?'todo':'today');}catch(_){return 'today';}}  /* 贴纸默认今日进度卡；仅当用户明确选过便签/待办卡才用对应形态 */
function renderStickyToday(){
  const box=document.getElementById('stickyToday');if(!box)return;
  const act=habitsVisibleOn(todayStr()).filter(h=>window.HabitRules.eligible(h,todayStr()));
  const d=dayObj(todayStr())||{};
  const done=act.filter(h=>isDone(h.key,d)).length;
  const total=act.length;
  const pct=total?Math.min(100,Math.round(done/total*100)):0;
  const R=30,C=2*Math.PI*R,off=C*(1-pct/100);
  const allDone=total>0&&done===total;
  let rows='';
  if(!total){
    rows='<div class="st-empty">'+T('st_empty')+'</div>';
  }else{
    rows=act.map(h=>{
      const ok=isDone(h.key,d);
      return '<div class="st-habit '+(ok?'done':'')+'"><div class="sh-ic">'+esc(h.icon)+'</div><div class="sh-nm">'+esc(h.name)+'</div><div class="sh-st" style="color:'+(ok?'#22C55E':'#C4CCD9')+'">'+(ok?'✓':'·')+'</div></div>';
    }).join('');
  }
  box.innerHTML='<div class="st-today">'
    +'<div class="st-head">'
    +'<div class="st-ring"><svg width="74" height="74" viewBox="0 0 74 74"><circle cx="37" cy="37" r="30" fill="none" stroke="#E5E5EA" stroke-width="8"/><circle cx="37" cy="37" r="30" fill="none" stroke="'+(allDone?'#22C55E':'#007AFF')+'" stroke-width="8" stroke-linecap="round" stroke-dasharray="'+C+'" stroke-dashoffset="'+off+'"/></svg><div class="ring-num">'+done+'/'+total+'</div><div class="ring-sub">'+T('st_today_sub')+'</div></div>'
    +'<div style="min-width:0"><div class="st-title">'+(allDone?T('st_alldone'):T('st_progress'))+'</div><div class="st-date">'+fmtNoteDate(new Date())+' · '+T('st_done_n')(done)+'</div></div>'
    +'</div>'
    +'<div class="st-habits">'+rows+'</div>'
    +'<div class="st-foot">'
    +'<div class="sf-cell"><b>'+maxStreakAll()+'</b><span>'+T('p_streak')+'</span></div>'
    +'<div class="sf-cell"><b>'+recordCount()+'</b><span>'+T('sf_record')+'</span></div>'
    +'<div class="sf-cell"><b>'+activeHabits().length+'</b><span>'+T('p_habits')+'</span></div>'
    +'</div>'
    +'</div>';
}
function applyStickyMode(){
  if(typeof renderStickyNavigation==='function')renderStickyNavigation();
  var mode=currentStickyMode();
  

  if(mode==='note'){
    var mi0=document.getElementById('memoInput');
    var hasNotes=false; try{ hasNotes=(notesSorted()||[]).length>0; }catch(_){}
    if(mi0 && !mi0.innerHTML.trim() && !curNoteId && !hasNotes){
      mode='today'; try{ localStorage.setItem('hb_lock_mode','today'); }catch(_){}
    }
  }
  document.body.classList.toggle('m-sticky-today', mode==='today');
  document.body.classList.toggle('m-sticky-todo', mode==='todo');   /* 3.1.0：待办卡第三形态 */
  /* 浮按钮（贴纸态右上角）三态循环：note→点击到今日进度→点击到待办卡→点击回便签 */
  const btn=document.getElementById('wfMode');
  if(btn){
    btn.hidden=false;                        /* 防误带 hidden 属性导致永不显示（[hidden] 的 display:none!important 会盖过 CSS） */
    const isToday=(mode==='today');
    btn.title=isToday?'切到待办卡':(mode==='todo'?'切回便签':'切到今日进度');
    btn.classList.toggle('on',isToday);
  }
  if(mode==='today')renderStickyToday();
  else if(mode==='todo'){
    if(typeof renderStickyTodo==='function')renderStickyTodo();
  }
  else{
    /* 便签形态：若 memoInput 空（如从编辑窗 pin 过来主窗未加载过该便签）本地补渲染当前/最近便签，
       避免贴纸便签形态空白/图不可见。注意：必须本地渲染，不能再调 openNote()——主窗分支会弹新编辑窗。 */
    var mi=document.getElementById('memoInput');
    if(mi && !mi.innerHTML.trim()){
      try{
        var ns=notesSorted()||[];
        var target=curNote();
        if(!target && ns.length){ curNoteId=ns[0].id; target=curNote(); }   /* curNoteId 失效/抛错时回退最近便签 */
        if(target){ renderNoteToEditor(target,true); }
      }catch(_){}
    }
    window.watchMemoImagesForFit();   /* 图片加载完成/内容变化后复测自适应，修首帧偏小 */
  }
}
/* 把"当前编辑中的便签"贴到桌面（编辑页顶栏 📌 按钮调用）。
   已锁定则仅刷新贴纸内容；未锁定则触发锁定流程。
   在独立编辑窗（贴纸的真正宿主）里点 📌：先关窗回主窗，由主窗执行锁定——否则 setLocked
   作用于隐藏的主窗，编辑窗（用户正在看的）不会动，表现为"没跳右上角、窗口还很大"。 */
async function lockStickyNote(){
  if(typeof curNoteId==='undefined'||!curNoteId){toast&&toast('请先打开一张便签');return;}
  if(lockStickyNote.busy)return false;
  lockStickyNote.busy=true;
  try{
    await flushRendererChanges();
    try{localStorage.setItem('hb_sticky_note',String(curNoteId));}catch(_){}
    try{localStorage.setItem('hb_lock_mode','note');}catch(_){}   /* 点 📌 的意图就是贴这条便签，显式切到便签形态（否则可能贴成今日进度卡） */
    const inEditor=document.body.classList.contains('editor-window');
    if(inEditor){
      if(window.hbShell&&window.hbShell.pinNote){
        const result=await window.hbShell.pinNote(curNoteId);
        if(result&&result.ok===false)throw new Error(result.message||'未能贴便签');
        return true;
      }
      /* 无 IPC 时降级：留在本窗锁定 */
    }
    if(document.body.classList.contains('app-locked')){
      window.applyStickyMode&&window.applyStickyMode();
    }else{
      await (window.handleWindowAction&&window.handleWindowAction('lock',{preventDefault(){},stopPropagation(){}}));
    }
    return true;
  }catch(error){toast('未能贴便签：'+error.message,'bad');return false;}
  finally{lockStickyNote.busy=false;}
}
/* 主窗锁定入口（含 main.js hb-pin-note 回调 / 页面恢复贴纸）：指定便签后贴桌面 */
window.lockStickyNoteById=function(id){
  try{ if(id!=null){ curNoteId=String(id); } }catch(_){}
  const target=notesSorted().find(n=>String(n.id)===String(curNoteId));
  if(target)renderNoteToEditor(target,true);
  /* 📌 pin 某便签 → 本次锁定显示该便签（note 形态）；win-fab 🔒 无 note 上下文时用存储/默认形态 */
  try{ if(id!=null){ localStorage.setItem('hb_lock_mode','note'); } }catch(_){}
  return window.lockStickyNote&&window.lockStickyNote();
};
/* 贴纸窗口的"上次手动拉伸"尺寸（页面拉伸结束写入 hb_sticky_w/h，锁定时交给主进程） */
window.stickyRememberedSize=function(){
  try{
    const w=parseInt(localStorage.getItem('hb_sticky_w')||'',10);
    const h=parseInt(localStorage.getItem('hb_sticky_h')||'',10);
    if(w>=200&&w<=3000&&h>=160&&h<=3000)return {width:w,height:h};   /* 问题 6：下限与锁定态最小尺寸一致（200×160） */
  }catch(_){}
  return null;
};


window.stickyRememberedPos=function(){
  try{
    var o=JSON.parse(localStorage.getItem('hb_sticky_pos')||'');
    if(o&&isFinite(o.x)&&isFinite(o.y))return {x:Math.round(o.x),y:Math.round(o.y)};
  }catch(_){}
  return null;
};
/* 记录当前贴纸窗口在屏幕上的位置（拉伸结束 / 拖动结束 / 锁定完成时调用） */
function rememberStickyPos(){
  try{
    var x=Math.round(window.screenX||0),y=Math.round(window.screenY||0);
    if(!isFinite(x)||!isFinite(y))return;
    localStorage.setItem('hb_sticky_pos',JSON.stringify({x:x,y:y}));
  }catch(_){}
}
window.rememberStickyPos=rememberStickyPos;
/* 贴纸形态切换后：进入「今日进度卡」时让贴纸窗按卡内容自适应高度；切回便签则保持用户当前窗口大小 */
function stickyFitSelf(){
  try{
    const isTodo=document.body.classList.contains('m-sticky-todo');
    if(!document.body.classList.contains('m-sticky-today')&&!isTodo)return;   /* 只对进度卡/待办卡形态做内容贴合 */
    if(document.body.classList.contains('sticky-sticker')&&window.hbShell&&window.hbShell.fitSelf){
      const el=document.getElementById(isTodo?'stickyTodo':'stickyToday');
      const inner=el&&el.querySelector(isTodo?'.st-todo':'.st-today');   /* 量内容固有高度；勿用拉伸容器(flex:1)的 scrollHeight，它会随窗高累加 */
      let h=(inner&&inner.offsetHeight)?(inner.offsetHeight+30):((el&&el.scrollHeight)?(el.scrollHeight+30):0);
      if(h<220)h=220;
      window.hbShell.fitSelf(h);
    }
  }catch(_){}
}
window.stickyFitSelf=stickyFitSelf;
/* 贴纸/锁定态自适应前先等便签内的图片就绪：
   图片未 decode 时 <img> 的 getBoundingClientRect().height 为 0，测量会把窗口算得远小于实际内容
   （典型症状：一条"一张图 + 一行字"的便签贴到桌面后高度只有一行字，内容显示不完整）。
   等全部 img complete（或 load/error）后再测，超时兜底；图片晚到时再补一次自适应。 */
function memoImagesReady(cb,timeout){
  var done=false;
  var finish=function(){ if(done)return; done=true; try{cb();}catch(_){} };
  try{
    var memo=document.getElementById('memoInput');
    var imgs=memo?[].slice.call(memo.querySelectorAll('img')):[];
    var pending=imgs.filter(function(im){return !im.complete||!im.naturalHeight;});
    if(!pending.length){ finish(); return; }
    pending.forEach(function(im){
      im.addEventListener('load',finish,{once:true});
      im.addEventListener('error',finish,{once:true});
      /* 兜底：图片晚于超时才到时补一次自适应（主进程有 16px 阈值，尺寸已一致时为 no-op） */
      im.addEventListener('load',function(){setTimeout(function(){try{window.refreshLockedHeight();if(window.fitLockedToContent)window.fitLockedToContent();}catch(_){}},60);},{once:true});
    });
    setTimeout(finish,timeout||400);
  }catch(_){ finish(); }
}
window.memoImagesReady=memoImagesReady;
function toggleStickyMode(){
  /* 三态循环：便签 → 今日进度 → 待办卡 → 便签（3.1.0） */
  const cur=currentStickyMode();
  const next=cur==='today'?'todo':(cur==='todo'?'note':'today');
  setStickyMode(next);
}
function setStickyMode(m){
  try{localStorage.setItem('hb_lock_mode',String(m==='today'?'today':(m==='todo'?'todo':'note')));}catch(_){}
  window._lockFitManual=false;   /* 问题 6：切换形态是有意的重排 → 重新允许内容自适应 */
  applyStickyMode();
  /* 切形态后窗口自适应：多次复测（立即/250/700/1300ms）覆盖图片异步加载与布局稳定，
     确保切回便签时回缩、切到进度卡时撑高，都不残留空白/裁切 */
  var fit=function(){
    try{
      if(document.body.classList.contains('sticky-sticker')){ if(window.stickyFitSelf)window.stickyFitSelf(); }
      else if(document.body.classList.contains('app-locked')){ window.refreshLockedHeight(); if(window.fitLockedToContent)window.fitLockedToContent(); }
    }catch(_){}
  };
  try{ if(window.memoImagesReady)window.memoImagesReady(fit,400); else fit(); }catch(_){}
  [250,700,1300].forEach(function(ms){ setTimeout(fit, ms); });
  try{ if(window.startLockFitWatch)window.startLockFitWatch(); }catch(_){}   /* 切换形态也重启收敛复测 */
}
window.setStickyMode=setStickyMode;
window.renderStickyToday=renderStickyToday;
window.applyStickyMode=applyStickyMode;
window.lockStickyNote=lockStickyNote;

