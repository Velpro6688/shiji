/* ============ 初始化 ============ */
renderStaticI18n();    // 先把静态 DOM 文案按语言填充
moveMemoToPage();      // 备忘录从今日页抽离为底部独立便签页
initMemoEditor();      // 备忘录富文本：工具栏命令 + 粘贴 / 拖图 / 选图插图
/* 便签左下角状态角标：编辑区滚动时淡出（.memo-scrub），停 0.2s 后淡回——滚动过程不挡文字 */
(function(){var _me=document.getElementById('memoInput'),_mb=document.querySelector('.memo-bar'),_t=null;if(_me&&_mb){_me.addEventListener('scroll',function(){_mb.classList.add('memo-scrub');clearTimeout(_t);_t=setTimeout(function(){_mb.classList.remove('memo-scrub');},200);},{passive:true});}})();
initBackupImport();
initRecoveryTools();
if(window.hbStartupNotice)setTimeout(function(){toast(window.hbStartupNotice,'good');},800);
if(window.hbShell&&window.hbShell.onSaveState)window.hbShell.onSaveState(function(value){
  if(value&&value.state==='error')setSaveState('error');
  else if(value&&value.state==='saved'&&!pendingCommits.size&&!_saveTimer&&!memoCommitPending&&!memoOrderNeedsSave&&!lastCommitFailed)setSaveState('saved');
});
applyTheme();          // 按 settings.theme 应用浅色/深色/跟随系统
  watchSystemTheme();    // 跟随系统：nativeTheme 校准 + 订阅变化
  renderThemeUI();       // 「我的」页主题行副标题
renderAll();
viewDateLabel();
renderMemo();          // 常驻便签：内容独立存 data.memo，跨天保留
let renderedDay=todayStr();
/* 存档损坏过的一次性告知：不告诉用户「现在看到的是示例」，比静默丢数据更糟 */
if(data.meta&&data.meta.corruptRecovered){
  setTimeout(function(){
    try{
      showConfirm(T('corrupt_title'),T('corrupt_msg')+'\n\n'+(localStorage.getItem(LS_KEY+'_corrupt')?T('corrupt_kept'):T('corrupt_lost')),function(){
        data.meta.corruptRecovered=false; saveDebounced();
      });
    }catch(_){ toast(T('corrupt_title'),'backup'); }
  },1200);
}
/* 样例数据一次性引导：示例便于体验，但会计入统计，提醒用户可在「我的」页清空 */
if(data.meta&&data.meta.sampleLoaded&&!data.meta.sampleGuideShown&&!(data.meta&&data.meta.corruptRecovered)){
  data.meta.sampleGuideShown=true;
  try{hbSaveFields({meta:data.meta});}catch(e){}
  setTimeout(function(){
     
    showConfirm('示例数据','当前展示的是 12 天示例打卡数据（用于体验界面与交互）。\n\n点「确定」清空示例、开始真实记录；点「取消」保留示例继续逛逛。',function(){ clearSample(true); });
  },600);
}
 
if(IS_EDITOR_WIN!==true&&data.meta&&!data.meta.guideDone){
  setTimeout(runNewbieGuide,1800);
}
function runNewbieGuide(){
  if(IS_EDITOR_WIN||document.body.classList.contains('app-locked')||document.getElementById('guideMask'))return;
  if(document.querySelector('.confirm-mask.show,.sheet.show,#habitManager.is-open')){setTimeout(runNewbieGuide,1500);return;}
  var returnPage=(document.querySelector('.page.active')||{}).id||'page-today';
  var steps=[
    {page:'today',title:T('gd1_t'),text:T('gd1_d')},
    {page:'todo',title:T('guide_todo_title'),text:T('guide_todo_text')},
    {page:'memo',title:T('gd3_t'),text:T('guide_memo_text')},
    {page:'stat',title:T('gd2_t'),text:T('gd2_d')},
    {page:'mine',title:T('guide_backup_title'),text:T('guide_backup_text')}
  ],idx=0,mask=document.createElement('div');
  mask.id='guideMask';mask.className='guide-mask';mask.setAttribute('role','dialog');mask.setAttribute('aria-modal','true');mask.setAttribute('aria-labelledby','guideTitle');
  function finish(create){
    mask.remove();data.meta.guideDone=true;saveDebounced();go(create?'today':returnPage.replace('page-',''));
    if(create)openAdd();else {var replay=document.getElementById('guideReplay');if(replay&&returnPage==='page-mine')replay.focus();}
  }
  function paint(){
    var step=steps[idx];go(step.page);
    mask.innerHTML='<div class="guide-card"><div class="gd-progress" aria-live="polite">'+(idx+1)+' / '+steps.length+'</div><h2 class="gd-t" id="guideTitle">'+esc(step.title)+'</h2><p class="gd-d">'+esc(step.text)+'</p><div class="gd-btns"><button type="button" class="gd-skip" id="guideSkip">'+esc(T('gd_skip'))+'</button>'+(idx?'<button type="button" class="gd-skip" id="guidePrev">'+esc(T('guide_previous'))+'</button>':'')+'<button type="button" class="gd-next" id="guideNext">'+esc(T(idx===steps.length-1?'guide_create':'gd_next'))+'</button></div></div>';
    document.getElementById('guideSkip').onclick=function(){finish(false);};
    var prev=document.getElementById('guidePrev');if(prev)prev.onclick=function(){idx--;paint();};
    document.getElementById('guideNext').onclick=function(){if(idx<steps.length-1){idx++;paint();}else finish(true);};
    document.getElementById('guideNext').focus();
  }
  document.body.appendChild(mask);paint();
}

/* 提醒的时钟驱动：每分钟查一次。刻意【不】注册进 _pausableTimers ——
   收进托盘时页面隐藏，Chromium 会把定时器节流到约每分钟一次，正好是提醒需要的粒度；
   若跟着一起清掉，托盘期间就永远不提醒了。 */
let _reminderTimer=null;
function startReminderTick(){
  if(_reminderTimer)clearInterval(_reminderTimer);
  _reminderTimer=setInterval(function(){ try{ checkReminders(); }catch(_){ } },60000);
}

if(!IS_EDITOR_WIN){
  prepareTimerRecovery();startTimerTicker();    // 恢复本地保存的倒计时；超时则自动计入时长（便签编辑窗不跑计时，避免主/编辑双窗重复计时）
  rwResume();             
  startReminderTick();   // 提醒：原来 checkReminders 只在启动/跨零点/打卡后被调，挂机等到 20 点也不会响
  document.addEventListener('visibilitychange',function(){ if(!document.hidden){ if(rwRunning())rwPaint(); try{checkReminders();}catch(_){} } });  // 从托盘/休眠回来补一次（提醒 + 墙钟剩余）
  checkReminders();
}

/* 跨零点后重新计算“今天”、热力图和连续天数；无需关闭或重启应用。 */
(function scheduleDayRefresh(){
  function refreshForNewDay(){
    const current=todayStr();
    if(current===renderedDay)return;
    const prevDay=renderedDay;
    renderedDay=current;
    /* 正在看「今天」的话必须跟着翻页。否则挂机过午夜后 viewDate 仍停在昨天：
       打卡会写进昨天的格子，列表又被当成往期只读渲染（顶栏却是新日期）。
       用户手动翻到历史日期时 prevDay!==viewDate，不打扰。 */
    if(viewDate===prevDay){viewDate=current;viewDateLabel();}
    renderAll();
    checkReminders();
     
    try{
      if(document.body.classList.contains('app-locked')&&document.body.classList.contains('m-sticky-today')){
        if(window.renderStickyToday)window.renderStickyToday();
        if(window.refreshLockedHeight)window.refreshLockedHeight();
        if(window.fitLockedToContent)window.fitLockedToContent();
      }
      /* 3.1.0：待办卡跨零点——待办桶随日期变化（今天的到期/过期数会变），同样重绘复测 */
      if(document.body.classList.contains('app-locked')&&document.body.classList.contains('m-sticky-todo')){
        if(window.renderStickyTodo)window.renderStickyTodo();
        if(window.refreshLockedHeight)window.refreshLockedHeight();
        if(window.fitLockedToContent)window.fitLockedToContent();
      }
    }catch(_){}
  }
  function refreshAtNextDay(){
    const now=new Date(),next=new Date(now);
    next.setHours(24,0,1,0);
    setTimeout(function(){refreshForNewDay();refreshAtNextDay();},Math.max(1000,next-now));
  }
  /* 休眠、锁屏后恢复时，补做一次日期检查。 */
  window.addEventListener('focus',refreshForNewDay);
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshForNewDay();});
  refreshAtNextDay();
})();

/* —— Electron 无边框窗：拖动后鼠标捕获复位 ——
   根因：-webkit-app-region:drag 区拖完窗口后，Windows 可能残留 mouse capture，
   导致随后界面按钮的 click 被吞（典型现象：锁定态拖动便签 → 解锁成功 → 打卡/切页点了没反应）。
   兜底：锁定/解锁这类大布局切换后，经 IPC 让壳层把窗口位移 1px 再移回（视觉无感），强制系统重新 hit-test。 */
function shellNudge(){
  if(window.hbShell&&window.hbShell.nudge){try{window.hbShell.nudge();}catch(_){}}
}
(function(){
  var dw={x:0,y:0,on:false,moved:false};
  document.addEventListener('mousedown',function(e){
    var t=e.target;
    dw.on=!!(t&&t.closest&&(t.closest('.topbar')||t.closest('.sec-title.memo-locked-only')));
    dw.x=e.clientX;dw.y=e.clientY;dw.moved=false;
  });
  document.addEventListener('mousemove',function(e){
    if(dw.on&&!dw.moved&&(Math.abs(e.clientX-dw.x)>3||Math.abs(e.clientY-dw.y)>3))dw.moved=true;
  });
  document.addEventListener('mouseup',function(){
    if(dw.on&&dw.moved){dw.on=false;dw.moved=false;setTimeout(shellNudge,80);}  /* 拖完窗口自动复位一次 */
  });
})();

/* 原生拖动区会在窗口 resize 后偶发吃掉 click，改为仅在非交互顶栏区域手动移动窗口。 */
(function(){
  var drag=null;
  function isDragZone(target){return target&&target.closest&&(target.closest('.topbar,.window-drag-handle,.me-top,.me-dragstrip,.memo-page,.memo-editor'));}  /* 便签页空白区域也可拖动窗口（按钮/输入/正文由 isControl 排除） */
  function isControl(target){return target&&target.closest&&target.closest('button,a,input,select,textarea,[contenteditable],.tb-ava,.win-bar,.win-fab,.memo-note,.memo-list,.memo-search-wrap,.memo-view-switch');}
  document.addEventListener('pointerdown',function(e){
    if(document.body.classList.contains('app-locked')||e.button!==0||!isDragZone(e.target)||isControl(e.target))return;
    drag={pointerId:e.pointerId,target:e.target};
    window.__hbGestureActive=true;
    try{e.target.setPointerCapture&&e.target.setPointerCapture(e.pointerId);}catch(_){}
    if(window.hbShell&&window.hbShell.beginWindowDrag)window.hbShell.beginWindowDrag();
    e.preventDefault();
  });
  window.addEventListener('pointermove',function(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    var dx=e.movementX||0,dy=e.movementY||0;
    if(window.hbShell&&window.hbShell.moveWindowDrag&&(dx||dy))window.hbShell.moveWindowDrag(dx,dy);
  });
  function stopDrag(e){
    if(!drag||e&&e.pointerId!=null&&e.pointerId!==drag.pointerId)return;
    try{drag.target.releasePointerCapture&&drag.target.releasePointerCapture(drag.pointerId);}catch(_){}
    drag=null;window.__hbGestureActive=false;window.__hbResizeActive=false;
    if(window.hbShell&&window.hbShell.endWindowDrag)window.hbShell.endWindowDrag();
  }
  window.addEventListener('pointerup',stopDrag);window.addEventListener('pointercancel',stopDrag);window.addEventListener('blur',stopDrag);
})();

/* 锁定态便签拖动：仅四边 lock-edge 热区可拖（不再整张可拖），走 hbShell IPC（避免 -webkit-app-region:drag 在 resize 后吞 click 的副作用）。
   根因兜底：无边框窗自绘拖动后 Windows 会残留 mouse capture / 陈旧 hit-test，若不复位，
   紧接着的点击会被吞。故真拖过才复位（shellNudge），纯点击不抖动。 */
(function(){
  var drag=null,pending=null,queued=false;
  var DRAG_SLOP=4;  /* 超过 4px 才算「拖动」；原地点击不触发窗口移动与复位 */
  function isControl(t){return t&&t.closest&&t.closest('button,input,select,textarea,[contenteditable],a,.win-fab');}
  function isDragEdge(t){return t&&t.closest&&t.closest('.lock-edge');}
  function sendMove(){
    queued=false;
    if(drag&&pending&&(pending.dx||pending.dy)&&window.hbShell&&window.hbShell.moveWindowDrag){
      window.hbShell.moveWindowDrag(pending.dx,pending.dy);pending={dx:0,dy:0};
    }
  }
  document.addEventListener('pointerdown',function(e){
    if(!document.body.classList.contains('app-locked'))return;
    if(e.button!==0||isControl(e.target)||!isDragEdge(e.target))return;
    drag={pointerId:e.pointerId,target:e.target,startX:e.clientX,startY:e.clientY,moved:false};pending={dx:0,dy:0};
    try{e.target.setPointerCapture&&e.target.setPointerCapture(e.pointerId);}catch(_){}
    if(window.hbShell&&window.hbShell.beginWindowDrag)window.hbShell.beginWindowDrag();
    e.preventDefault();
  });
  window.addEventListener('pointermove',function(e){
    if(!drag||e.pointerId!==drag.pointerId)return;
    if(!drag.moved){
      if(Math.abs(e.clientX-drag.startX)<=DRAG_SLOP&&Math.abs(e.clientY-drag.startY)<=DRAG_SLOP)return;
      drag.moved=true;pending.dx=e.clientX-drag.startX;pending.dy=e.clientY-drag.startY;
    }else{pending.dx+=e.movementX||0;pending.dy+=e.movementY||0;}
    if(!queued){queued=true;requestAnimationFrame(sendMove);}
  });
  function stopDrag(e){
    if(!drag||(e&&e.pointerId!=null&&e.pointerId!==drag.pointerId))return;
    var didMove=drag.moved;
    sendMove();
    try{drag.target&&drag.target.releasePointerCapture&&drag.target.releasePointerCapture(drag.pointerId);}catch(_){}
    drag=null;pending=null;queued=false;
    if(window.hbShell&&window.hbShell.endWindowDrag)window.hbShell.endWindowDrag();
    if(didMove){
      setTimeout(shellNudge,90);
      setTimeout(rememberStickyPos,140);   /* 问题 5：记下用户把便签拖到哪儿了，下次启动贴回同一位置 */
    }
  }
  window.addEventListener('pointerup',stopDrag);window.addEventListener('pointercancel',stopDrag);window.addEventListener('blur',stopDrag);
})();



(function(){
  var rz=null,pending=null,queued=false;
  var RESIZE_SLOP=4;
  function isControl(t){return t&&t.closest&&t.closest('button,input,select,textarea,[contenteditable],a,.win-bar,.win-fab');}
  function resizeDir(t){
    var c=t&&t.closest?t.closest('.lock-corner,.resize-edge'):null;
    if(!c)return null;
    if(c.classList.contains('lock-corner')){
      if(c.classList.contains('corner-tl'))return 'nw';
      if(c.classList.contains('corner-tr'))return 'ne';
      if(c.classList.contains('corner-bl'))return 'sw';
      return 'se';
    }
    if(c.classList.contains('edge-l'))return 'w';
    if(c.classList.contains('edge-r'))return 'e';
    if(c.classList.contains('edge-b'))return 's';
    return null;
  }
  function sendMove(){
    queued=false;
    if(rz&&pending&&(pending.dx||pending.dy)&&window.hbShell&&window.hbShell.moveWindowResize){
      window.hbShell.moveWindowResize(rz.dir,pending.dx,pending.dy);pending={dx:0,dy:0};
    }
  }
  document.addEventListener('pointerdown',function(e){
    if(e.button!==0)return;
    var dir=resizeDir(e.target);
    if(!dir||isControl(e.target))return;
    rz={pointerId:e.pointerId,target:e.target,dir:dir,moved:false,startX:e.clientX,startY:e.clientY}
    window.__hbGestureActive=true;window.__hbResizeActive=true;;
    pending={dx:0,dy:0};
    try{e.target.setPointerCapture&&e.target.setPointerCapture(e.pointerId);}catch(_){}
    if(window.hbShell&&window.hbShell.beginWindowResize)window.hbShell.beginWindowResize(dir);
    e.preventDefault();
  });
  window.addEventListener('pointermove',function(e){
    if(!rz||e.pointerId!==rz.pointerId)return;
    if(!rz.moved){
      if(Math.abs(e.clientX-rz.startX)<=RESIZE_SLOP&&Math.abs(e.clientY-rz.startY)<=RESIZE_SLOP)return;
      rz.moved=true;
      if(document.body.classList.contains('app-locked')||document.body.classList.contains('sticky-sticker'))window._lockFitManual=true;
      pending.dx=e.clientX-rz.startX;pending.dy=e.clientY-rz.startY;
    }else{pending.dx+=(e.movementX||0);pending.dy+=(e.movementY||0);}
    if(!queued){queued=true;requestAnimationFrame(sendMove);}
  });
  function stopResize(e){
    if(!rz||(e&&e.pointerId!=null&&e.pointerId!==rz.pointerId))return;
    sendMove();   /* 松手前提交最后一帧，避免尾段位移被清掉。 */
    var ended=rz,didMove=ended.moved;
    rz=null;pending=null;queued=false;window.__hbGestureActive=false;window.__hbResizeActive=false;
    try{ended.target&&ended.target.releasePointerCapture&&ended.target.releasePointerCapture(ended.pointerId);}catch(_){}
    if(window.hbShell&&window.hbShell.endWindowResize)window.hbShell.endWindowResize();
    if(didMove){
      

      if(document.body.classList.contains('app-locked')||document.body.classList.contains('sticky-sticker')){
        try{
          var memWrite=function(ww,hh){
            try{
              localStorage.setItem('hb_sticky_w',String(Math.max(200,Math.min(3000,Math.round(ww)))));
              localStorage.setItem('hb_sticky_h',String(Math.max(160,Math.min(3000,Math.round(hh)))));
            }catch(_){}
          };
          if(window.hbShell&&window.hbShell.winSize){
            window.hbShell.winSize().then(function(b){
              if(b&&b.width>0&&b.height>0)memWrite(b.width,b.height);
              else memWrite(window.innerWidth,window.innerHeight);
            }).catch(function(){ memWrite(window.innerWidth,window.innerHeight); });
          }else memWrite(window.innerWidth,window.innerHeight);
        }catch(_){}
      }
      setTimeout(shellNudge,120);
    }
  }
  window.addEventListener('pointerup',stopResize);
  window.addEventListener('pointercancel',stopResize);
  window.addEventListener('lostpointercapture',stopResize);
  window.addEventListener('blur',stopResize);
})();

/* 命中复位只由真实手势结束触发，程序化 resize 不再触发微移。 */
window.__hbGestureActive=false;

/* —— 窗口控制条：锁定 / 最小化到托盘（退出仅在托盘右键菜单） —— */
(function(){
  var lockOpacities=[1,.85,.7];
  

  function lsGet(k){try{return localStorage.getItem(k);}catch(_){return null;}}
  function lsSet(k,v){try{localStorage.setItem(k,v);}catch(_){}}
  function applyLockOpacity(){var v=Number(lsGet('hb_lock_opacity'));if(!v)v=1;document.documentElement.style.setProperty('--lock-opacity',String(v));document.body.style.opacity=document.body.classList.contains('app-locked')?String(v):'1';}
  document.addEventListener('contextmenu',function(e){var b=e.target.closest&&e.target.closest('.win-fab');if(!b||!document.body.classList.contains('app-locked'))return;e.preventDefault();var cur=Number(lsGet('hb_lock_opacity'))||1,idx=lockOpacities.indexOf(cur);var next=lockOpacities[(idx+1)%lockOpacities.length];lsSet('hb_lock_opacity',String(next));applyLockOpacity();toast('锁定透明度 '+Math.round(next*100)+'%','good');});
  /* A：锁定态只读展示，移除「双击切换只读/编辑」（贴纸纯展示，不落盘） */
  document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.win-fab');if(!b||!e.shiftKey||!document.body.classList.contains('app-locked'))return;e.preventDefault();e.stopPropagation();var on=lsGet('hb_lock_topmost')!=='1';lsSet('hb_lock_topmost',on?'1':'0');if(window.hbShell&&window.hbShell.setTopmost)window.hbShell.setTopmost(on);toast(on?'已开启始终置顶':'已关闭始终置顶','good');});
  /* 锁定 note 形态期间收敛复测：每 500ms 复测 fit（阈值 8px），最多 10s，
     保证图片异步加载/布局稳定/形态切换后窗口高度收敛到正确值（修首帧偏小/切换不自适应） */
  function startLockFitWatch(){
    try{
      if(window._lockFitWatch){clearInterval(window._lockFitWatch);window._lockFitWatch=null;}
      var n=0;
      window._lockFitWatch=setInterval(function(){
        n++;
        if(n>20||!document.body.classList.contains('app-locked')){clearInterval(window._lockFitWatch);window._lockFitWatch=null;return;}
        

        if(window.__hbResizeActive||window._lockFitManual)return;
        /* 进度卡/待办卡形态高度已在锁定时定死（内容固定），不做周期性贴合；仅便签形态需要 */
        if(!document.body.classList.contains('m-sticky-today')&&!document.body.classList.contains('m-sticky-todo')){ try{ fitLockedToContent(); }catch(_){} }
      },500);
    }catch(_){}
  }
  window.startLockFitWatch=startLockFitWatch;
  function applyLock(locked,restoreMode){
    try{ var _lf=document.querySelector('.win-fab[data-act="lock"]'); if(_lf){ _lf.title=locked?'解锁':'贴便签'; _lf.setAttribute('aria-label',_lf.title); } }catch(_){}   
    document.body.classList.toggle('app-locked', locked);
    refreshLockedHeight();   /* 每次进入/离开锁定都重新算一次统一高度 */
    

    try{ if(locked){ localStorage.setItem('hb_lock_on_start','1'); } }catch(_){}
    window._lockFitManual=false;   /* 问题 6：进入/退出锁定都重置「用户手动拉伸过」标记 */
    try{ if(locked){ startLockFitWatch(); } else { if(window._lockFitWatch){clearInterval(window._lockFitWatch);window._lockFitWatch=null;} } }catch(_){}
    if(!locked&&window.hbShell&&window.hbShell.setTopmost){try{window.hbShell.setTopmost(false);}catch(_){}lsSet('hb_lock_topmost','0');}
    applyLockOpacity();
    if(!locked&&window.hbShell&&window.hbShell.setLocked){try{window.hbShell.setLocked(false,null);}catch(_){}}
    if(locked&&window.hbShell&&window.hbShell.setTopmost&&lsGet('hb_lock_topmost')==='1'){try{window.hbShell.setTopmost(true);}catch(_){}
    }
    var lockBtn=document.querySelector('.win-bar [data-act="lock"]');
    if(lockBtn) lockBtn.classList.toggle('on', locked);
    var memo=document.getElementById('memoInput');
    if(locked){
      /* 锁定=把当前便签贴到桌面（只读展示）：优先恢复上次贴过的便签（hb_sticky_note），否则取最近编辑的一条；
         back/删除按钮由 .app-locked CSS 隐藏，避免锁定态误触跳页。 */
      if(!curNote()){
        var ns0=notesSorted();
        var stickyId=null;try{stickyId=localStorage.getItem('hb_sticky_note');}catch(_){}
        if(stickyId&&ns0.some(function(x){return x.id===stickyId;}))curNoteId=stickyId;
        else curNoteId=ns0.length?ns0[0].id:(getNotes()[0]||{}).id;
      }
      if(curNoteId){
        /* 问题 5：把这次实际贴出来的便签记账 → 下次启动自动贴回「同一条」 */
        try{ localStorage.setItem('hb_sticky_note',String(curNoteId)); }catch(_){}
        openNote(curNoteId);
      }
      if(memo)memo.blur();
      /* 贴纸形态：恢复上次选择的 便签 / 今日进度 模式 */
      if(window.applyStickyMode)window.applyStickyMode();
      /* A：锁定态只读展示——必须放在 openNote/applyStickyMode 之后设，
         因为 renderNoteToEditor 内部的 prepareMemoCanvas 会把 contenteditable 设回 true */
      if(memo)memo.setAttribute('contenteditable','false');
    }
    if(locked){
      go('memo');
      /* 锁定后让主进程把窗口按内容真实高度自适应：短内容贴底无留白、长内容完整显示。
         双 rAF 等 .app-locked CSS 完全应用、图片解 max-width:100% 重排完才测量，避免拿到旧高度。 */
      requestAnimationFrame(function(){requestAnimationFrame(function(){
        try{
          var sz=window.stickyRememberedSize?window.stickyRememberedSize():null;
          /* v2.1.1（开机贴回窗口慢慢变大/被撑满整屏的根因修复）：
             restoreMode=开机自动贴回。用户手动拉伸过的尺寸（hb_sticky_w/h）是【用户意图】，
             必须 1:1 原样恢复并让内容在贴纸内滚动——绝不能再用内容高度覆盖它：
             旧逻辑按内容自适应，长图便签会把贴纸撑到接近整屏，且图片解码后逐轮变大（"慢慢变大"）。
             无手动记忆（从未拉伸过）→ 才按内容自适应（主进程会钳到屏幕内）。 */
          

          if(restoreMode&&sz&&sz.width&&sz.height){
            var payload0={width:sz.width,height:sz.height};
            var pz0=window.stickyRememberedPos?window.stickyRememberedPos():null;
            if(pz0){payload0.x=pz0.x;payload0.y=pz0.y;}
            window._lockFitManual=true;   /* 本轮锁定会话：内容自适应让位于用户尺寸 */
            if(window.hbShell&&window.hbShell.setLocked){window.hbShell.setLocked(true,payload0);}
            setTimeout(rememberStickyPos,260);
            return;
          }
          

          if(sz&&sz.width&&sz.height){
            window._lockFitManual=true;   /* 本轮锁定会话：内容自适应让位于用户尺寸 */
            if(window.hbShell&&window.hbShell.setLocked){window.hbShell.setLocked(true,{width:sz.width,height:sz.height});}
            setTimeout(rememberStickyPos,260);
            return;
          }
          var ww=(sz&&sz.width)?sz.width:360;
          /* 必须等图片 decode 完再测：图片未就绪时高度为 0，会把窗口量成“只有一行字”的小窗（内容显示不完整） */
          var doMeasure=function(){
            try{
              /* 在目标宽度下同步测量（改宽→测→还原，同一同步块内无绘制）：保证设宽后内容重排的高度正确，避免“太小/太大” */
              var hh=(window.measureAtWidth?window.measureAtWidth(ww):0);
              var hh2=hh>0?hh:((sz&&sz.height)?sz.height:580);
              /* 问题 5：带上记忆的屏幕位置 → 主进程直接锁定到该位置（不再先贴右上角再跳，避免可见位移） */
              var payload={width:ww,height:hh2};
              var pz=(restoreMode)?(window.stickyRememberedPos?window.stickyRememberedPos():null):null;
              /* v2.2.2 语义：只有【开机自动贴回】恢复上次位置；手动贴桌面一律贴右上角 */
              if(restoreMode&&pz){payload.x=pz.x;payload.y=pz.y;}
              if(window.hbShell&&window.hbShell.setLocked){window.hbShell.setLocked(true,payload);}
              setTimeout(rememberStickyPos,260);   /* 位置已由主进程落定后记账，供下次启动还原 */
              fitLockedToContent();   /* 主进程有阈值，尺寸已一致时为 no-op */
              /* 带图便签：图片异步加载会使内容变高 → 图片就绪后复测自适应（主进程阈值跳过微小差异） */
              setTimeout(function(){ try{ fitLockedToContent(); }catch(_){} }, 350);
              try{ if(window.memoImagesReady) window.memoImagesReady(function(){ try{ fitLockedToContent(); }catch(_){} }, 900); }catch(_){}
            }catch(_){}
          };
          if(window.memoImagesReady)window.memoImagesReady(doMeasure,400); else doMeasure();
        }catch(_){}
      });});
      return;
    }
    if(memo){memo.setAttribute('contenteditable','true');memo.style.pointerEvents='auto';}
    document.body.classList.remove('m-sticky-today');   /* 解锁离开贴纸，清掉进度卡形态 */
    document.body.classList.remove('m-sticky-todo');    /* 3.1.0：清掉待办卡形态 */
    /* 解锁去向：默认回便签列表页；贴纸待办卡「打开待办」入口会预设 _unlockTarget='todo'，
       解锁恢复窗口后直接落在待办页（避免用户还要再手动找页签） */
    var _ut=null;try{ _ut=String(window._unlockTarget||''); }catch(__){ window._unlockTarget=null; }
    try{ window._unlockTarget=null; }catch(__){}
    if(_ut==='todo'&&typeof go==='function'&&document.getElementById('page-todo')){ try{openMemoList();}catch(_){} go('todo'); }
    else{ try{openMemoList();}catch(_){} }
    setTimeout(shellNudge,140);
  }
   
  /* 锁定态统一高度 = 今日进度卡自适应高度（用户选择：便签/今日切换零跳变，便签超出在贴纸内滚动）。
     同步加/摘 m-sticky-today 测量，同一帧内完成不闪。
     ⚠ 但这个「统一高度」原来是每次 refit 都重算一遍今日卡：今日卡内容一变
     （打卡、增删习惯、跨零点），贴在桌面的便签窗就跟着改尺寸并被重新贴到右上角
     —— 用户看到的正是「过一会儿内容跳一下、上移一点」。
     现在改成：一次锁定只算一次，之后复用同一个值；需要重算的时机（进入锁定、
     切换形态、图片迟到）显式调 refreshLockedHeight() 清缓存。 */
let _fitBusy=false, _fitSwallowTimer=null, _lastFitH=0, _fitTimer=null, _sharedLockedH=0;
function refreshLockedHeight(){ _sharedLockedH=0; _lastFitH=0; }
window.refreshLockedHeight=refreshLockedHeight;
function todayFitHeight(){
    var st=document.getElementById('stickyToday'); if(!st)return 0;
    var wasToday=document.body.classList.contains('m-sticky-today');
    try{
      _fitBusy=true;                                   /* 测量期间的 reflow 不算内容变化 */
      if(window.renderStickyToday)window.renderStickyToday();
      document.body.classList.add('m-sticky-today');
      var inner=st.querySelector('.st-today');
      var h=((inner&&inner.offsetHeight)?inner.offsetHeight:st.scrollHeight)+30;
      if(!wasToday)document.body.classList.remove('m-sticky-today');
      if(h<220)h=220;
      return h;
    }catch(_){ try{ if(!wasToday)document.body.classList.remove('m-sticky-today'); }catch(__){} return 0; }
    finally{
      /* 浏览器把这次 reflow 的 RO 回调排在本帧之后，所以延迟解除守卫 */
      clearTimeout(_fitSwallowTimer);
      _fitSwallowTimer=setTimeout(function(){ _fitBusy=false; },120);
    }
  }
  /* 待办卡形态高度（3.1.0）：仿 todayFitHeight，但内容固定（无图片迟到），量一次即可 */
  function stickyTodoFitHeight(){
    var stt=document.getElementById('stickyTodo'); if(!stt)return 0;
    var wasTodo=document.body.classList.contains('m-sticky-todo');
    try{
      _fitBusy=true;
      if(window.renderStickyTodo)window.renderStickyTodo();
      document.body.classList.add('m-sticky-todo');
      var inner=stt.querySelector('.st-todo');
      var h=((inner&&inner.offsetHeight)?inner.offsetHeight:stt.scrollHeight)+30;
      if(!wasTodo)document.body.classList.remove('m-sticky-todo');
      if(h<220)h=220;
      return h;
    }catch(_){ try{ if(!wasTodo)document.body.classList.remove('m-sticky-todo'); }catch(__){} return 0; }
    finally{
      clearTimeout(_fitSwallowTimer);
      _fitSwallowTimer=setTimeout(function(){ _fitBusy=false; },120);
    }
  }
  function computeLockedHeight(){
    

    if(document.body.classList.contains('app-locked')&&document.body.classList.contains('m-sticky-today')){
      if(!_sharedLockedH){ var uh=todayFitHeight(); if(uh>0)_sharedLockedH=uh; }
      if(_sharedLockedH>0)return _sharedLockedH;
    }
    /* 待办卡形态（3.1.0）：量待办卡自身高度（内容固定，无图片迟到问题，直接量即可） */
    if(document.body.classList.contains('app-locked')&&document.body.classList.contains('m-sticky-todo')){
      if(!_sharedLockedH){ _sharedLockedH=stickyTodoFitHeight(); }
      if(_sharedLockedH>0)return _sharedLockedH;
    }
    /* 今日进度卡形态：量卡自身高度 */
    if(document.body.classList.contains('m-sticky-today')){
      const st=document.getElementById('stickyToday');
      /* 注意：不能用 st.hidden 门控——hidden 属性常驻但 .app-locked/.sticky-sticker 下 CSS 已 display:flex!important，
         若按 hidden 跳过会误落到 memo 分支量到隐藏内容→高度钳到 220（“贴桌面太小”根因） */
      if(st){
        const inner=st.querySelector('.st-today');   /* 内容固有高度，避免拉伸容器 scrollHeight 逐次累加 */
        let sh=((inner&&inner.offsetHeight)?inner.offsetHeight:st.scrollHeight)+30;if(sh<220)sh=220;
        return sh;
      }
    }
    /* 待办卡形态（3.1.0）：同今日卡，量 .st-todo 固有高度 */
    if(document.body.classList.contains('m-sticky-todo')){
      const stt=document.getElementById('stickyTodo');
      if(stt){
        const innerT=stt.querySelector('.st-todo');
        let shT=((innerT&&innerT.offsetHeight)?innerT.offsetHeight:stt.scrollHeight)+30;if(shT<220)shT=220;
        return shT;
      }
    }
    var memo=document.getElementById('memoInput');if(!memo)return 0;
    /* v2.1.1 关键修复（贴纸窗自动变大/缩跳的根因）：锁定态 memoInput 处于 flex 拉伸布局，
       任何带「实时布局位置」的测量（容器内矩形、input 的 top、Range 底边）都会混入窗高——
       窗高变→测量变→窗口再变。改为：临时 height:auto 解除拉伸后量 scrollHeight
       （= 自然内容高，与窗高彻底无关），顶部工具栏/内边距用固定 16px 余量，
       测量值在构造上与窗高解耦，一步收敛不抖动。 */
    var naturalH=0;
    try{
      

      var prevHs=memo.style.height, prevFlex=memo.style.flex;
      memo.style.flex='0 0 auto';
      memo.style.height='auto';
      naturalH=memo.scrollHeight||0;
      memo.style.height=prevHs;
      memo.style.flex=prevFlex;
    }catch(_){ }
    if(naturalH<=0)naturalH=memo.scrollHeight||0;
    var h=Math.round(naturalH+16);    
    if(h<220)h=220;
    return h;
  }
  function fitLockedToContent(){
    if(_fitBusy||window.__hbResizeActive)return;          /* 手动缩放期间不再反向调整尺寸 */
    if(window._lockFitManual)return;                     /* v2.1.1：用户手动定过尺寸/已按记忆尺寸恢复 → 内容自适应全面让位 */
    var h=computeLockedHeight();
    if(h<=0)return;
    /* 与主进程同一把 8px 尺子：差在阈值内就不发 IPC，杜绝「每次微调一点」的可见跳动 */
    if(_lastFitH&&Math.abs(h-_lastFitH)<8)return;
    _lastFitH=h;
    if(window.hbShell&&window.hbShell.fitLockedContent){try{window.hbShell.fitLockedContent(h);}catch(_){}}
  }
  /* 带图便签：图片异步加载完成后内容变高 → 复测自适应，避免首帧偏小裁切文字 */
  function watchMemoImagesForFit(){
    try{
      var mi=document.getElementById('memoInput'); if(!mi)return;
      var refit=function(){ try{ fitLockedToContent(); }catch(_){} };
      Array.prototype.forEach.call(mi.querySelectorAll('img'),function(im){
        if(!im.complete){ im.addEventListener('load',refit,{once:true}); im.addEventListener('error',refit,{once:true}); }
      });
      if(!mi._rwRO && window.ResizeObserver){
        mi._rwRO=new ResizeObserver(function(){
          if(_fitBusy)return;                                  /* 测量期的 reflow 不算内容变化 */
          if(window._lockFitManual)return;                     /* 手动尺寸模式：内容自适应全面让位 */
          if(document.body.classList.contains('app-locked')&&!document.body.classList.contains('m-sticky-today')){
            clearTimeout(_fitTimer);                           /* 合并一帧内的多次尺寸变化后再量 */
            _fitTimer=setTimeout(function(){ try{ fitLockedToContent(); }catch(_){} },160);
          }
        });
        mi._rwRO.observe(mi);
      }
    }catch(_){}
  }
  window.watchMemoImagesForFit=watchMemoImagesForFit;
  window.fitLockedToContent=fitLockedToContent;
  window.computeLockedHeight=computeLockedHeight;
  /* 在指定宽度下同步测量锁定态内容高度：临时把容器宽设为目标宽→测量→还原，
     全在同一同步块内完成（无绘制），避免按旧窗宽测量导致设宽后高度不对（太小/太大） */
  function measureAtWidth(w){
    var isToday=document.body.classList.contains('m-sticky-today');
    var isTodo=document.body.classList.contains('m-sticky-todo');
    var el=isToday?document.getElementById('stickyToday'):(isTodo?document.getElementById('stickyTodo'):(document.querySelector('.memo-box')||document.getElementById('memoInput')));
    if(!el||!w)return computeLockedHeight();
    var prev=el.style.width;
    el.style.width=w+'px';
    var h=0;
    try{ h=computeLockedHeight(); }finally{ el.style.width=prev; }
    return h;
  }
  window.measureAtWidth=measureAtWidth;
  function minimizeToTaskbar(){
    if(window.hbShell&&window.hbShell.minimize){
      try{window.hbShell.minimize();}catch(_){}
    }else{window.blur();}
  }
  function closeWindow(){
    if(window.hbShell&&window.hbShell.close){
      try{window.hbShell.close();}catch(_){}
    }else{window.close();}
  }
  window.applyLock=applyLock;   /* 问题 5：启动自动贴回需要用同一套锁定流程 */
  /* 「开机自启后便签自己变大」的取证：全文件只有 applyLock(false) 一处会发 setLocked(false)，
     而它只能被一次 click 触发。用户说没点过 —— 那就把每一次窗口动作的来源钉下来：
     isTrusted=false ⇒ 代码合成的点击；true ⇒ 真的鼠标/键盘落在按钮上（连同目标与时刻）。
     走 console.warn，由主进程 console-message 落进 app.log。 */
  window.__winAction=function(act,event){
    try{
      var t=event&&event.target;
      console.warn('[win-action] '+act
        +' trusted='+(event?(event.isTrusted?'真':'合成'):'无事件')
        +' type='+(event&&event.type?event.type:'无')
        +' detail='+(event&&typeof event.detail==='number'?event.detail:'-')   /* detail=0 ⇒ 键盘 Enter/Space 触发的 click；≥1 ⇒ 真鼠标 */
        +' at='+Math.round(t&&t.getBoundingClientRect?t.getBoundingClientRect().left:-1)+','+Math.round(t&&t.getBoundingClientRect?t.getBoundingClientRect().top:-1)
        +' target='+(t?(t.tagName+'.'+(typeof t.className==='string'?t.className.slice(0,24):'')):'-')
        +' locked='+(document.body.classList.contains('app-locked')?1:0)
        +' t+'+(performance&&performance.now?Math.round(performance.now()):0)+'ms');
    }catch(_){}
  };
  window.handleWindowAction=function(act,event){
    if(act==='lock'&&event)window.__winAction(act,event);
    if(event){event.preventDefault();event.stopPropagation();}
    if(act==='lock'&&document.body.classList.contains('sticky-sticker')){
      /* 贴纸编辑窗（?sticky=1）：🔒 = 关闭贴纸 → 主窗解锁并回便签列表（editorBack 由主进程处理解锁） */
      try{ if(window.hbShell&&window.hbShell.editorBack){ window.hbShell.editorBack(); return false; } }catch(_){}
      try{ window.close(); }catch(_){}   /* 兜底：无 IPC 直接关窗 */
      return false;
    }
    if(act==='lock')applyLock(!document.body.classList.contains('app-locked'));
  if(act==='lock'&&document.body.classList.contains('app-locked')&&!lsGet('hb_lock_hint_shown')){
    try{ localStorage.setItem('hb_lock_hint_shown','1'); }catch(_){}
    setTimeout(function(){ try{ toast('小提示：右键浮钮调透明度 · Shift+点浮钮始终置顶 · 拉四角改大小','good'); }catch(_){} },1200);
  }
    else if(act==='minimize')minimizeToTaskbar();
    else if(act==='close')closeWindow();
    return false;
  };
  document.addEventListener('click',function(e){
    var t=e.target.closest && e.target.closest('[data-act]');
    if(!t) return;
    var act=t.getAttribute('data-act');
    window.handleWindowAction(act,e);
  });
  /* 全局点击触感音：仅对真正的可点控件发声，编辑输入静音，避免与打卡 celebrate 抢戏 */
  document.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.closest)return;
    var tag=(t.tagName||'').toUpperCase();
    if(tag==='INPUT'||tag==='TEXTAREA'||t.isContentEditable)return;
    var hit=t.closest('button,.tab,[data-act],[onclick],.big-btn,.mini-btn,.sbtn,.chip,.mood-pick,.cup,.icon-opt,.type-opt,.opt,.toggle,.mode-opt,.dropdown-item,.qsel,.unit-seg,[role="button"]');
    if(!hit)return;
    playTap();
  });
  // URL hash 自动触发：#lock → 锁定为便签
  var _wh=(location.hash||'').toLowerCase();
  if(_wh==='#lock'){
    setTimeout(function(){
      applyLock(true);
    },320);
  }
})();
// 晚8点后每分钟刷新一次 todo 闪烁状态
function startTodoRefresh(){if(_todoRefreshTimer)clearInterval(_todoRefreshTimer);_todoRefreshTimer=setInterval(()=>{if(document.getElementById('page-today').classList.contains('active'))renderTodo();},60000);_pausableTimers.push(_todoRefreshTimer);}
startTodoRefresh();

/* ============ 便签自动保存（兜底保险网）============
   虽然 oninput 已经在每次输入触发 saveMemoHtml，但剪贴板粘贴 / 菜单粘贴 / 程序修改等场景
   可能不发 input 事件；这里每 30 秒兜底一次，附绿点脉冲反馈给用户「还在保护你的便签」。 */
(function(){
  if(!IS_EDITOR_WIN)return;  /* 主窗口不再直接编辑便签：自动保存兜底只在编辑窗跑（主窗空 DOM 会把当前便签覆盖成空） */
  var AUTO_SAVE_MS = 30000;
  var _pulseTimer = null;
  function flashAutoSaved(){
    var el = document.getElementById('autosavePulse');
    if(!el){
      el = document.createElement('div');
      el.id = 'autosavePulse';
      el.className = 'autosave-pulse';
      el.innerHTML = '<span>已自动保存</span>';
      document.body.appendChild(el);
      positionAutoSave(el);
    }
    el.classList.add('show');
    clearTimeout(_pulseTimer);
    _pulseTimer = setTimeout(function(){ el.classList.remove('show'); }, 1400);
  }
  function positionAutoSave(el){
    /* v30→v32：追加到顶栏「最长连续」徽章右侧，静态流式定位，不再 fixed 绝对定位 */
    el.style.left='';el.style.top='';el.style.bottom='';el.style.right='';
    el.style.position='relative';
    el.style.marginLeft='8px';
    el.style.alignSelf='center';
    el.style.flex='0 0 auto';
    var bar=document.querySelector('.topbar');
    var flame=bar&&bar.querySelector('.tb-flame');
    if(bar && flame){
      flame.insertAdjacentElement('afterend', el);
    }else if(bar){
      bar.appendChild(el);
    }
  }
  function autoSaveTick(){
    try {
      /* 主窗原来无条件调 saveMemoHtml()（它在主窗第一行就 return）然后闪「已自动保存」，
         等于每 30 秒对用户撒一次谎。现在：编辑窗照常回写便签；主窗只在确实有
         未落盘的防抖写入时才兜底 flush，并且只有真写了才提示。 */
      if(IS_EDITOR_WIN){
        var _el=document.getElementById('memoInput');
        var _cur=_el?_el.innerHTML:'';
        if(_cur===window._lastAutoSavedHtml)return;    
        saveMemoHtml();
        var _el2=document.getElementById('memoInput');
        window._lastAutoSavedHtml=_el2?_el2.innerHTML:'';
        flashAutoSaved(); return;
      }
      if(_saveTimer){ clearTimeout(_saveTimer); _saveTimer=null; save(); flashAutoSaved(); }
    } catch(_){}
  }
  /* 启动后 30 秒兜底，再每 30 秒一次（首次延迟启动，避免打开即闪） */
  window._startAutoSave=function(){
    if(_autoSaveTimer)clearInterval(_autoSaveTimer);
    _autoSaveTimer=setInterval(autoSaveTick, AUTO_SAVE_MS);
    _pausableTimers.push(_autoSaveTimer);
  };
  window._startAutoSave();
})();

document.addEventListener('visibilitychange',function(){
  if(document.hidden){_pausableTimers.forEach(function(id){clearInterval(id);});_pausableTimers=[];_todoRefreshTimer=null;_autoSaveTimer=null;}
  else{startTodoRefresh();if(window._startAutoSave)window._startAutoSave();}
});

