/* ============ 键盘操作：Esc 关当前弹层、1-4 切页 ============ */
/* 键盘可达：打卡杯子、底部 tab、心情、头像这些是 div，原生不可 tab 也不可回车 —— 补齐 */
function enhanceKeyboardTargets(){
  try{
    document.querySelectorAll('.tab,.cup,.mood-pick,.tb-ava,.rtag-rw,.rtag-done,.ring-todo-chip,.menu-item[onclick],[data-dbedit],.memo-note,.icon-opt,.type-opt,.td-main,.td-check,.td-pin,.td-group-title.td-done-title').forEach(function(el){
      if(el.closest('.readonly')&&!el.hasAttribute('onclick'))return;
      if(el.matches('button,a[href],input,select,textarea'))return;
      if(!el.hasAttribute('tabindex'))el.setAttribute('tabindex','0');
      if(!el.hasAttribute('role'))el.setAttribute('role',el.classList.contains('tab')?'tab':'button');
    });
  }catch(_){}
}
/* 键盘排序（WCAG 2.1.1）：焦点落在习惯拖拽手柄或便签卡片时，Ctrl+↑/↓ 与相邻卡片换位。
   排序原本只有 HTML5 drag，键盘用户完全无法操作。换位复用拖动同一提交函数，落点反馈也一致。 */
function moveSortHandle(handle,dir){
  const card=handle.closest('.hcard,.memo-note');if(!card)return false;
  const parent=card.parentNode||{};
  const siblings=[].slice.call(parent.children||[]).filter(function(el){return el.classList&&(el.classList.contains('hcard')||el.classList.contains('memo-note'));});
  const idx=siblings.indexOf(card),to=idx+dir;
  if(idx<0||to<0||to>=siblings.length)return false;
  const target=siblings[to];
  if(card.classList.contains('hcard')){
    const k1=card.getAttribute('data-habit-key'),k2=target.getAttribute('data-habit-key');
    if(!k1||!k2)return false;
    reorderHabits(k1,k2,dir>0);
    setTimeout(function(){const c=document.querySelector('.hcard[data-habit-key="'+k1+'"] .habit-sort');if(c)c.focus();},0);
  }else{
    const n1=card.getAttribute('data-nid'),n2=target.getAttribute('data-nid');
    if(!n1||!n2)return false;
    reorderNotes(n1,n2,dir>0);
    setTimeout(function(){const c=document.querySelector('.memo-note[data-nid="'+n1+'"]');if(c)c.focus();},0);
  }
  return true;
}
document.addEventListener('keydown',function(e){
  try{
    if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
    if(e.key!=='ArrowUp'&&e.key!=='ArrowDown')return;
    const el=document.activeElement;
    if(!el||!el.classList||!(el.classList.contains('habit-sort')||el.classList.contains('memo-note')))return;
    if(moveSortHandle(el,e.key==='ArrowUp'?-1:1))e.preventDefault();
  }catch(_){}
});
document.addEventListener('keydown',function(e){
  try{
    if(e.key!=='Enter'&&e.key!==' ')return;
    const el=document.activeElement; if(!el||el===document.body)return;
    if(el.matches('button,a[href],input,select,textarea,[contenteditable="true"]'))return;   /* 原生已处理 */
    if(el.getAttribute('tabindex')!=='0')return;
    e.preventDefault();
    if(el.hasAttribute('data-dbedit')){   /* 图标格：回车=编辑该习惯（等价于双击） */
      const card=el.closest('.hcard'); const k=card&&card.getAttribute('data-habit-key');
      if(k&&typeof openEdit==='function')openEdit(k);
      return;
    }
    if(el.hasAttribute('onkeydown'))return;   /* 内联处理器已自行 this.click()，全局再 click 一次会让开关 toggles 两次等于没切 */
    el.click();
  }catch(_){}
});
document.addEventListener('keydown',function(e){
  try{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='Escape'){
      // 只关闭最上层弹窗；捕获阶段结束事件，避免一次 Esc 连续关闭两层。
      const top=window.HabitUI&&window.HabitUI.currentDialog();
      if(top){
        if(top.id==='cropOverlay')closeMemoCrop();
        else if(top.id==='confirmMask')hideConfirm();
        else if(top.id==='dayNoteMask')hideDayNote();
        else if(top.id==='rewardMask')rwCloseCard();
        else if(top.id==='focusOverlay')hideFocusOverlay();
        else if(top.id==='guideMask'){const skip=top.querySelector('#guideSkip');if(skip)skip.click();}
        else if(top.id==='habitManager')closeHabitManager();
        else if(top.classList.contains('sheet'))closeSheet();
        e.preventDefault();e.stopImmediatePropagation();return;
      }
      if(IS_EDITOR_WIN||document.querySelector('.memo-more[open]'))return;
      if(document.body.classList.contains('memo-editor-open')&&!document.body.classList.contains('app-locked')){
        if(typeof flushPendingMemoSave==='function')flushPendingMemoSave();
        openMemoList();e.preventDefault();
      }
      return;
    }
    if(IS_EDITOR_WIN)return;
    const t=e.target;
    if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'||t.isContentEditable))return;
    if(e.key>='1'&&e.key<='5'){
      if(document.body.classList.contains('app-locked')||document.body.classList.contains('sticky-sticker'))return;
      if(document.querySelector('.sheet.show')||rwMaskOpen()||habitManagerOpen()||['confirmMask','dayNoteMask','cropOverlay','focusOverlay'].some(function(id){var node=document.getElementById(id);return node&&node.classList.contains('show');}))return;
      const tab=['today','stat','todo','memo','mine'][Number(e.key)-1];
      if(tab){go(tab);e.preventDefault();}
    }
  }catch(_){}
},true);

/* ============ shell 模式（AHK 无边框便签壳）：置唯一窗口标题供壳定位，避免误伤普通 Chrome ============ */
(function(){if((location.search||'').indexOf('shell=1')>=0){document.title='时迹';}})();

 
(function(){
  if(!IS_EDITOR_WIN)return;
  document.title='便签';
  document.body.classList.add('editor-window');
  /* 贴纸形态（从锁定态弹出的编辑窗，main.js 会带 ?sticky=1）：
     加 sticky-sticker 极简类 → CSS 隐藏 me-top/工具栏/角标，只留正文 + 悬浮操作钮 */
  if(/[?&]sticky=1/.test(location.search||''))document.body.classList.add('sticky-sticker');
  /* v2.1：旧 hb_editor_open 心跳退役——便签保存走 hb-data:save（字段属主提交），beforeunload 仍兜底 flush */
  window.addEventListener('beforeunload',function(){try{flushPendingMemoSave(true);}catch(_){}});   
  /* 定位要编辑的便签：URL note 参数优先，否则取最近一条 */
  var qm=(location.search||'').match(/[?&]note=([^&]+)/);
  var nid=qm?decodeURIComponent(qm[1]):null;
  var ns=getNotes();
  /* 优先打开最近一条非空便签：避免历史遗留的空白便签挡在最新位 */
  var nonEmpty=notesSorted().filter(function(n){return (n.text||'').trim()||(n.html||'').trim();});
  if(!(nid&&ns.some(function(n){return n.id===nid;})))nid=nonEmpty.length?nonEmpty[0].id:(ns.length?notesSorted()[0].id:null);
  function boot(){
    if(nid)openNote(nid);
    else newNote();
    if(window.applyStickyMode)window.applyStickyMode();   /* 编辑窗同样支持 便签/今日进度 形态 */
    /* 贴纸（?sticky=1）首次打开且用户没有记忆过尺寸时，按当前形态内容贴合高度（不显得"太大"） */
    if(/[?&]sticky=1/.test(location.search||'')){
      const rm=window.stickyRememberedSize?window.stickyRememberedSize():null;
      if(!rm)setTimeout(function(){
        try{
          if(window.hbShell&&window.hbShell.fitSelf){
            const isToday=document.body.classList.contains('m-sticky-today');
            const isTodo=document.body.classList.contains('m-sticky-todo');
            const el=document.getElementById(isToday?'stickyToday':(isTodo?'stickyTodo':'memoInput'));
            const inner=(isToday&&el)?el.querySelector('.st-today'):((isTodo&&el)?el.querySelector('.st-todo'):null);   /* 今日卡/待办卡量内容固有高度 */
            const base=(inner&&inner.offsetHeight)?inner.offsetHeight:((el&&el.scrollHeight)?el.scrollHeight:0);
            let h=base?base+24:0;
            if(h<200)h=200; if(h>860)h=860;
            window.hbShell.fitSelf(h);
          }
        }catch(_){}
      },450);
    }
    setTimeout(function(){var el=document.getElementById('memoInput');if(el)el.focus();},250);
  }
  if(document.readyState==='complete')boot();
  else window.addEventListener('load',boot);
})();

