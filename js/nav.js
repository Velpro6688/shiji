/* ============ 导航 ============ */
function go(tab){
  if(window.HabitUI)window.HabitUI.beforeNavigate();
  document.body.classList.toggle('hb-on-today',tab==='today');    
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const map={today:'page-today',stat:'page-stat',todo:'page-todo',memo:'page-memo',mine:'page-mine'};
  const target=document.getElementById(map[tab]);if(!target)return;
  target.classList.add('active');
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.tab===tab));
  if(tab==='stat'){if(statDirty){renderStat();statDirty=false;}}
  else if(tab==='todo'){if(typeof todoPageDirty!=='undefined'&&todoPageDirty&&typeof renderTodoPage==='function'){renderTodoPage();todoPageDirty=false;}}
  else if(tab==='mine'&&mineDirty){renderMine();mineDirty=false;}
  else if(tab==='today'&&activeTimer())updateTimerPanels(); /* 切回今日时补一次面板秒数，避免显示滞后 */
  if(tab==='mine'){refreshStartup();if(window.syncRestoreSwitch)window.syncRestoreSwitch();}
  if(window.HabitUI)window.HabitUI.afterNavigate(tab);
  else document.getElementById('scroll').scrollTop=0;
  if(typeof hbLayoutSync==='function')hbLayoutSync();    
}



(function(){
  var nav=document.querySelector('#page-today .date-nav');
  var appEl=document.getElementById('app');
  if(nav&&appEl&&nav.parentElement!==appEl)appEl.appendChild(nav);
})();



function hbSyncTodayGate(){
  try{
    var on=document.querySelector('#page-today.active');
    document.body.classList.toggle('hb-on-today',!!on);
  }catch(_){}
}
function hbMeasureTopbar(){
  try{
    var tb=document.querySelector('.topbar');
    if(!tb)return;
    /* 用「底边到视口顶的距离」而不是自身高度：顶栏在宽窗带 1px 上边框，
       量高度会少算这 1px，日期条就会压住内容 1px。 */
    var bot=Math.round(tb.getBoundingClientRect().bottom);
    if(bot>0)document.documentElement.style.setProperty('--hb-topbar-h',bot+'px');
    if(innerWidth>=1000){
      var page=document.getElementById('page-today'),pr=page&&page.getBoundingClientRect();
      if(pr&&pr.width>0){
        document.documentElement.style.setProperty('--hb-content-left',pr.left+'px');
        document.documentElement.style.setProperty('--hb-content-width',pr.width+'px');
      }
    }
    /* 日期条自身净高也量出来，供 #page-today 的让位 padding 使用（--hb-nav-h） */
    var nv=document.querySelector('.date-nav');
    var nh2=nv?Math.round(nv.getBoundingClientRect().height):0;
    if(nh2>0)document.documentElement.style.setProperty('--hb-nav-h',nh2+'px');
  }catch(_){}
}
function hbLayoutSync(){hbSyncTodayGate();hbMeasureTopbar();}
hbLayoutSync();
window.addEventListener('resize',hbMeasureTopbar);
if(window.ResizeObserver){
  try{new ResizeObserver(hbMeasureTopbar).observe(document.querySelector('.topbar'));}catch(_){}
}
window.hbSyncTodayGate=hbSyncTodayGate; window.hbMeasureTopbar=hbMeasureTopbar; window.hbLayoutSync=hbLayoutSync;
/* ============ 习惯管理面板（原「习惯」tab，改为从今日页「管理」进入） ============ */
function habitManagerOpen(){ const p=document.getElementById('habitManager'); return !!p&&p.classList.contains('is-open'); }
function openHabitManager(){
  const p=document.getElementById('habitManager'), m=document.getElementById('habitManagerMask');
  if(!p)return;
  if(!p.querySelector('.hm-close')){   /* 关闭按钮注入到面板标题行（sticky，故绝对定位有参照） */
    const x=document.createElement('button');
    x.type='button'; x.className='hm-close'; x.textContent='✕';
    x.title=T('hm_close'); x.setAttribute('aria-label',T('hm_close')); x.onclick=closeHabitManager;
    const st=p.querySelector('.sec-title'); if(st)st.appendChild(x);
  }
  if(m)m.classList.add('is-open');
  p.classList.add('is-open');
  document.body.classList.add('hm-open');    
  try{ renderHabits(); habitDirty=false; p.querySelector('.hm-body').scrollTop=0; }catch(e){}
  enhanceKeyboardTargets();
  if(window.HabitUI)window.HabitUI.managerOpened();
}
function closeHabitManager(){
  const p=document.getElementById('habitManager'), m=document.getElementById('habitManagerMask');
  if(p)p.classList.remove('is-open');
  if(m)m.classList.remove('is-open');
  document.body.classList.remove('hm-open');
  if(window.HabitUI)window.HabitUI.managerClosed();
}
window.openHabitManager=openHabitManager; window.closeHabitManager=closeHabitManager; window.habitManagerOpen=habitManagerOpen;

function moveMemoToPage(){
  const page=document.getElementById('page-memo');
  /* v2.3.1：原实现靠构建平台残留的 [data-page-node-id="memoSecTitle01"/"memoCard01"] 定位，
     残留属性清除后一律查不到（便签盒不再搬进编辑页）——改为按结构定位：#memoBox → 所在 .card → 前置的 sec-title */
  const box=document.getElementById('memoBox');
  const card=box?box.closest('.card'):null;
  const title=card&&card.previousElementSibling&&card.previousElementSibling.classList.contains('sec-title')?card.previousElementSibling:null;
  

  const ed=document.getElementById('memoEditor');
  const appEl=document.getElementById('app');
  if(ed&&appEl&&ed.parentNode!==appEl)appEl.appendChild(ed);
  if(page&&title)page.insertBefore(title,page.firstChild);
  if(ed&&box)ed.appendChild(box);
  if(card)card.remove();
}

