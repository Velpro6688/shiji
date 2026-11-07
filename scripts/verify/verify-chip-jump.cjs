'use strict';
/* verify-chip-jump —— 「习惯芯片点击跳转」回归套件（2026-10-12 r24 修复配套）
   背景：进度环上的两组芯片——「还差 N 项」（.ring-todo-chip）与「已连续」（.rtag-done）。
   r24 前：① .rtag-done 从未绑定 onclick（点了必然无反应）；② jumpToHabit 找不到卡片时静默 return。
   本套件断言：
   ① 每个 .rtag-done 都带 onclick=jumpToHabit(key)，.rtag-group 分组标题不可点；
   ② 点击 .rtag-done → 目标 .hcard 获得 .flash（跳转生效），无 JS 错误；
   ③ 键盘可达：.rtag-done 有 tabindex=0，Enter 触发同一跳转；
   ④ 「还差」芯片点击跳转无回归；
   ⑤ 从「统计」页触发也能切回今日页并高亮；
   ⑥ 目标卡片缺失时不再静默：toast 明确反馈（ring_jump_missing 文案）。 */
const { app } = require('electron');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-chip-jump');
H.globalKillSwitch('verify-chip-jump', suite);
H.initProfile('verify-chip-jump');
H.stubIpc(suite.calls);
const sleep = H.sleep;

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await sleep(1500);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await sleep(300);

    /* 造数（走应用自身函数）：ka 今天已完成（连续 1 天 → 生成「已连续」芯片）；
       kb/kc 未完成（「还差」芯片）。 */
    await H.evalJson(win, `
      data.habits=[
        {key:'ka',name:'甲',icon:'A',color:'#3B82F6',type:'bool',size:'square'},
        {key:'kb',name:'乙',icon:'B',color:'#3B82F6',type:'bool',size:'square'},
        {key:'kc',name:'丙',icon:'C',color:'#3B82F6',type:'bool',size:'square'}];
      data.days={};
      data.days[todayStr()]={ka:true};
      syncHabits();go('today');renderAll();
      return 1;`);
    suite.step('造数：ka 已完成（rtag-done），kb/kc 未完成（todo chip）');

    /* ① 结构：所有 .rtag-done 均带 onclick；.rtag-group 不带 */
    let r = await H.evalJson(win, `
      var done=[].slice.call(document.querySelectorAll('#ringTags .rtag-done'));
      var withAttr=done.filter(function(c){return /jumpToHabit\\('([^']+)'\\)/.test(c.getAttribute('onclick')||'');});
      var key0=withAttr.length?((withAttr[0].getAttribute('onclick')||'').match(/jumpToHabit\\('([^']+)'\\)/)||[])[1]:null;
      var grp=document.querySelector('#ringTags .rtag-group');
      return {total:done.length,withAttr:withAttr.length,key0:key0,
              grp:!!grp,grpOnclick:grp?grp.hasAttribute('onclick'):null};`);
    suite.ok(r.total === 1 && r.withAttr === 1, '「已连续」芯片 1 个且都带 onclick（' + r.withAttr + '/' + r.total + '）');
    suite.ok(r.key0 === 'ka', 'onclick 的 key 指向已完成习惯（' + r.key0 + '）');
    suite.ok(r.grp === true && r.grpOnclick === false, '.rtag-group 分组标题存在且不可点（无 onclick）');

    /* ② 点击 .rtag-done → 目标卡片 flash；无未捕获错误 */
    r = await H.evalJson(win, `
      window.__err=null;
      window.addEventListener('error',function(e){window.__err=String(e.message||e.error);},{once:true});
      var c=document.querySelector('.hcard[data-habit-key="ka"]');if(c)c.classList.remove('flash');
      var chip=document.querySelector('#ringTags .rtag-done');
      var thrown=null;try{chip.click();}catch(e){thrown=String(e&&e.message||e);}
      return {thrown:thrown};`);
    await sleep(250);
    let r2 = await H.evalJson(win, `
      var card=document.querySelector('.hcard[data-habit-key="ka"]');
      return {err:window.__err,flashed:card?card.classList.contains('flash'):null,exists:!!card};`);
    suite.ok(r.thrown === null && r2.err === null, '点击无 JS 错误（thrown=' + JSON.stringify(r.thrown) + ' err=' + JSON.stringify(r2.err) + '）');
    suite.ok(r2.exists === true && r2.flashed === true, '点击后目标卡片存在并 flash（跳转生效）');

    /* ③ 键盘可达：tabindex=0 + Enter 触发同一跳转 */
    r = await H.evalJson(win, `
      var c=document.querySelector('.hcard[data-habit-key="ka"]');if(c)c.classList.remove('flash');
      var chip=document.querySelector('#ringTags .rtag-done');
      var ti=chip?chip.tabIndex:null, role=chip?(chip.tagName==='BUTTON'?'button':chip.getAttribute('role')):null;
      if(chip)chip.focus();
      var active=(document.activeElement===chip);
      return {ti:ti,role:role,active:active};`);
    win.webContents.focus();
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
    win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
    await sleep(250);
    r2 = await H.evalJson(win, `
      var card=document.querySelector('.hcard[data-habit-key="ka"]');
      return {flashed:card?card.classList.contains('flash'):null};`);
    suite.ok(r.ti === 0 && r.role === 'button', '.rtag-done 纳入键盘可达（tabindex=' + r.ti + ' role=' + r.role + '）');
    suite.ok(r.active === true, '芯片可获得焦点（activeElement）');
    suite.ok(r2.flashed === true, 'Enter 触发跳转（卡片 flash）');

    /* ④ 「还差」芯片跳转无回归（按 onclick 里的真实 key 断言） */
    r = await H.evalJson(win, `
      var chip=document.querySelector('#ringTodo .ring-todo-chip[onclick]');
      var m=chip?((chip.getAttribute('onclick')||'').match(/jumpToHabit\\('([^']+)'\\)/)):null;
      var k=m?m[1]:null;
      var c=k?document.querySelector('.hcard[data-habit-key="'+k+'"]'):null;
      if(c)c.classList.remove('flash');
      var thrown=null;try{chip.click();}catch(e){thrown=String(e&&e.message||e);}
      return {k:k,thrown:thrown};`);
    await sleep(250);
    r2 = await H.evalJson(win, `
      var card=document.querySelector('.hcard[data-habit-key=${JSON.stringify(r.k)}]');
      return {flashed:card?card.classList.contains('flash'):null};`);
    suite.ok(r.k === 'kb' && r.thrown === null, '「还差」芯片可点（key=' + r.k + ' thrown=' + JSON.stringify(r.thrown) + '）');
    suite.ok(r2.flashed === true, '「还差」芯片点击跳转无回归（flash 生效）');

    /* ④b 【跳转必须真的滚动到卡片】r25 回归：定位滚动曾在 go()→afterNavigate 的 rAF
       滚动还原里被整帧撤销（flash 有、位置不动），旧断言只看 flash 所以放跑了它。 */
    r = await H.evalJson(win, `
      var s=document.getElementById('scroll'); s.scrollTop=0;
      var chip=null; [].slice.call(document.querySelectorAll('#ringTodo .ring-todo-chip')).forEach(function(x){
        var m=(x.getAttribute('onclick')||'').match(/jumpToHabit\\('([^']+)'\\)/); if(m&&m[1]==='kc')chip=x;});
      if(!chip) return {miss:true};
      chip.click(); return {miss:false};`);
    suite.ok(r.miss === false, '存在 kc 芯片（跳转滚动用例前置）');
    await sleep(800);
    r2 = await H.evalJson(win, `
      var s=document.getElementById('scroll');
      var card=document.querySelector('.hcard[data-habit-key="kc"]');
      var rect=card?card.getBoundingClientRect():null;
      return {st:Math.round(s.scrollTop), flashed:card?card.classList.contains('flash'):null,
              inView:rect?(rect.top>=-2&&rect.bottom<=window.innerHeight+2):null};`);
    suite.ok(r2.st > 0, '点击后页面确实滚动（scrollTop=' + r2.st + ' >0）');
    suite.ok(r2.inView === true && r2.flashed === true, '目标卡片滚入视口并 flash（inView=' + r2.inView + ' flash=' + r2.flashed + '）');

    /* ⑤ 从「统计」页触发：切回今日页并高亮（覆盖“不在今日页”路径；同时覆盖
       「同一张卡 1.5s 内重复定位」——旧摘除计时器曾把新闪 102ms 后秒杀）。 */
    r = await H.evalJson(win, `
      var c=document.querySelector('.hcard[data-habit-key="ka"]');if(c)c.classList.remove('flash');
      go('stat');
      var wasStat=document.getElementById('page-stat').classList.contains('active');
      document.querySelector('#ringTags .rtag-done').click();
      var backToday=document.getElementById('page-today').classList.contains('active');
      return {wasStat:wasStat,backToday:backToday};`);
    await sleep(600);
    r2 = await H.evalJson(win, `
      var card=document.querySelector('.hcard[data-habit-key="ka"]');
      var s=document.getElementById('scroll');
      return {flashed:card?card.classList.contains('flash'):null, hasCard:!!card, st:Math.round(s.scrollTop)};`);
    suite.ok(r.wasStat === true && r.backToday === true, '从统计页触发后切回今日页（wasStat=' + r.wasStat + ' backToday=' + r.backToday + '）');
    suite.ok(r2.flashed === true, '切页后目标卡片 flash（跨页跳转生效；@600ms=' + JSON.stringify(r2) + '）');

    /* ⑥ 目标缺失 → toast 反馈（原为静默 return） */
    r = await H.evalJson(win, `
      window.__err=null;
      window.addEventListener('error',function(e){window.__err=String(e.message||e.error);},{once:true});
      var n0=document.querySelectorAll('#toastWrap .toast').length;
      jumpToHabit('__no_such_key__');
      return {n0:n0};`);
    await sleep(400);
    r2 = await H.evalJson(win, `
      var list=document.querySelectorAll('#toastWrap .toast');
      var last=list[list.length-1];
      return {err:window.__err,n:list.length,text:last?last.textContent:null};`);
    suite.ok(r2.n === r.n0 + 1, '找不到卡片时出现 toast（不再静默：' + r.n0 + '→' + r2.n + '）');
    suite.ok(/没找到对应的习惯卡片/.test(r2.text || ''), 'toast 文案取自 ring_jump_missing（' + r2.text + '）');
    suite.ok(r2.err === null, '缺失路径无 JS 错误（err=' + JSON.stringify(r2.err) + '）');

    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
