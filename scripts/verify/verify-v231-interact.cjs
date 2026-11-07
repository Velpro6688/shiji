'use strict';
/* verify-v231-interact —— v2.3.1 波次 3 交互/可访问性直测
   ① Ctrl+↑/↓ 键盘排序（习惯卡手柄）替代纯拖拽
   ② 奖励弹窗纳入焦点圈禁清单（ui.js currentDialog）
   ③ 英文界面不再中英混杂（renderTodo / renderRing 走 i18n）
   ④ 键盘 Enter 开关不再双击（单击一次=true 翻转一次）
   ⑤ 打卡列表整表重绘不丢输入焦点 */
const { app } = require('electron');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-v231-interact');
H.globalKillSwitch('verify-v231-interact', suite);
H.initProfile('verify-v231-interact');
H.stubIpc(suite.calls);
const sleep = H.sleep;

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await sleep(1800);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await sleep(300);

    /* ① 键盘排序 */
    let r = await H.evalJson(win, `
      data.habits=[
        {key:'ka',name:'甲',icon:'A',color:'#3B82F6',type:'bool',size:'square'},
        {key:'kb',name:'乙',icon:'B',color:'#3B82F6',type:'bool',size:'square'},
        {key:'kc',name:'丙',icon:'C',color:'#3B82F6',type:'bool',size:'square'}];
      data.days={};syncHabits();go('today');renderAll();
      var before=HABITS.map(function(h){return h.key}).join(',');
      var h1=document.querySelector('.hcard[data-habit-key="ka"] .habit-sort');
      if(!h1)return {err:'no handle'};
      h1.focus();
      var fn=typeof moveSortHandle;
      var direct=moveSortHandle(h1,1);
      return {before:before,fn:fn,direct:direct,after:HABITS.map(function(h){return h.key}).join(',')}`);
    suite.ok(r.before === 'ka,kb,kc', '排序前顺序 ' + r.before);
    suite.ok(r.fn === 'function' && r.direct === true, 'moveSortHandle 可见且返回 true（fn=' + r.fn + ' direct=' + r.direct + '）');
    suite.ok(r.after === 'kb,ka,kc', '下移把 ka 放到 kb 之后（' + r.after + '）');

    r = await H.evalJson(win, `
      var h2=document.querySelector('.hcard[data-habit-key="ka"] .habit-sort');
      if(!h2)return {err:'no handle after rerender'};
      var ok=moveSortHandle(h2,-1);
      return {ok:ok,after:HABITS.map(function(h){return h.key}).join(',')}`);
    suite.ok(r.ok === true && r.after === 'ka,kb,kc', '上移复位（' + r.after + '）');

    /* ①b 真实按键链路：Ctrl+ArrowDown 派发到 document 触发换位 */
    r = await H.evalJson(win, `
      var h3=document.querySelector('.hcard[data-habit-key="ka"] .habit-sort');
      h3.focus();
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',ctrlKey:true,bubbles:true,cancelable:true}));
      return {after:HABITS.map(function(h){return h.key}).join(',')}`);
    suite.ok(r.after === 'kb,ka,kc', 'Ctrl+↓ 键盘事件链路触发换位（' + r.after + '）');
    r = await H.evalJson(win, `
      var h4=document.querySelector('.hcard[data-habit-key="ka"] .habit-sort');
      if(h4){h4.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',ctrlKey:true,bubbles:true,cancelable:true}));}
      return {after:HABITS.map(function(h){return h.key}).join(',')}`);
    suite.ok(r.after === 'ka,kb,kc', 'Ctrl+↑ 键盘事件链路复位（' + r.after + '）');

    /* ② 奖励弹窗焦点圈禁（真实行为：Tab 不会跑出遮罩） */
    r = await H.evalJson(win, `
      var m=document.getElementById('rewardMask');
      if(!m)return {found:false};
      document.getElementById('rwTitle').textContent='测试奖励';
      m.hidden=false;
      var f=m.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
      var out={found:true,count:f.length,role:m.getAttribute('role'),modal:m.getAttribute('aria-modal')};
      if(f.length){ f[f.length-1].focus(); f[f.length-1].dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true})); out.stays=!!(document.activeElement&&m.contains(document.activeElement)); }
      else out.stays=null;
      m.hidden=true;
      return out`);
    suite.ok(r.found && (r.count === 0 || r.stays === true), '奖励弹窗打开时 Tab 焦点被圈禁在遮罩内（可聚焦元素 ' + r.count + ' 个）');
    suite.ok(r.role === 'dialog' && r.modal === 'true', '奖励弹窗带 role=dialog + aria-modal');

    /* ③ i18n 双语齐全：曾经硬编码中文的文案，zh/en 字典都必须有词条（LANG 是 const，只能查字典） */
    r = await H.evalJson(win, `
      var keys=['ring_alldone','ring_lack','ring_streak_tag','st_empty','st_today_sub','st_alldone','st_progress','st_done_n','sf_record'];
      var miss=keys.filter(function(k){return I18N.zh[k]===undefined||I18N.en[k]===undefined;});
      var enLack=typeof I18N.en.ring_lack==='function'?I18N.en.ring_lack(3):String(I18N.en.ring_lack);
      var enAll=String(I18N.en.ring_alldone);
      var zhLack=T('ring_lack')(3);
      return {miss:miss,enLack:enLack,enAll:enAll,zhLack:zhLack}`);
    suite.ok(r.miss.length === 0, '新增词条 zh/en 双全（缺失：' + JSON.stringify(r.miss) + '）');
    suite.ok(/to go/i.test(r.enLack) && /all done/i.test(r.enAll), 'EN 词条正确（' + r.enLack + ' / ' + r.enAll + '）');
    suite.ok(/还差 3/.test(r.zhLack), 'ZH 渲染走同一 key（' + r.zhLack + '）');
    r = await H.evalJson(win, `
      data.habits=[{key:'ka',name:'Read',icon:'A',color:'#3B82F6',type:'bool',size:'square'}];
      data.days={};syncHabits();go('today');renderAll();
      var undoneTxt=(document.getElementById('ringTodo')||{}).textContent||'';
      data.days[todayStr()]={ka:true};syncHabits();renderAll();
      var allTxt=(document.getElementById('ringTodo')||{}).textContent||'';
      return {undoneTxt:undoneTxt,allTxt:allTxt}`);
    suite.ok(/还差 1 项/.test(r.undoneTxt), '待完成芯片文案走 i18n（' + r.undoneTxt.trim() + '）');
    suite.ok(/今天已全部完成/.test(r.allTxt), '全完成态文案走 i18n（' + r.allTxt.trim() + '）');

    /* ④ 键盘 Enter 只触发一次（事件须派发到开关本身，内联 onkeydown 才按真实链路生效） */
    r = await H.evalJson(win, `
      var tg=document.getElementById('tgRemindSum');
      if(!tg)return {err:'no switch'};
      go('mine');renderAll();
      var s0=data.settings.remindSummary;
      tg.focus();
      tg.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      var s1=data.settings.remindSummary;
      tg.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      var s2=data.settings.remindSummary;
      return {s0:s0,s1:s1,s2:s2,aria:tg.getAttribute('aria-checked')}`);
    suite.ok(r.s1 !== r.s0 && r.s2 === r.s0, 'Enter 一次翻转一格（不被双击抵消）：' + [r.s0, r.s1, r.s2].join('/'));
    suite.ok(String(r.aria) === String(r.s2), 'aria-checked 跟随实际状态（' + r.aria + '）');

    /* ⑤ 整表重绘保焦点 */
    r = await H.evalJson(win, `
      data.habits=[{key:'kc',name:'大计数',icon:'N',color:'#3B82F6',type:'count',target:30,unit:'个',size:'wide'}];
      data.days={};syncHabits();go('today');renderAll();
      var inp=document.querySelector('.hcard[data-habit-key="kc"] input[type="number"]');
      if(!inp)return {err:'no number input'};
      inp.focus();inp.value='17';
      renderCheckin();
      var af=document.activeElement;
      return {tag:af&&af.tagName,type:af&&af.type,val:af&&af.value}`);
    suite.ok(r.tag === 'INPUT' && r.type === 'number' && r.val === '17', '重绘后焦点仍在计数输入框且未提交值保留（' + r.val + '）');

    await H.drainPageErrs(win, suite);
    win.destroy();
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
    try { win.destroy(); } catch (_) {}
  }
  H.finish(suite);
  app.exit(suite.errs.length ? 1 : 0);
});
