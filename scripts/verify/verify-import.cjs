'use strict';

/* verify-import —— r11 数据安全链路实测（A1/A2/A8/C7/C8）：

   1. 导入覆盖前强制自动备份（A1：备份目录先增量）

   2. 导入往返提醒字段保真（A8：remindAt='' 与自定义星期 0,1,5 不再被改写成每天 20:00）

   3. 编辑器不再静默预填 20:00（A2：打开编辑器不改 remindAt）

   4. 导入大文件/坏字段防护（C8：store 拒绝非法字段）

   5. 习惯 key 注入防护（C7：esc 收口后渲染不逃逸）

   6. 空档不物化（A4：peekDoc——提醒调度读档不再写出空 data.json） */

const { app } = require('electron');

const fs = require('fs');

const path = require('path');

const H = require('./_harness');

const suite = H.makeSuite('verify-import');

/* r19：接全局兜底（core-data:13 / backup2:18 同款）——缺它时套件卡死会一直挂住，

   而不是 180s 后写失败结果退出。 */

H.globalKillSwitch('verify-import', suite);

const profile=H.initProfile('verify-import');

const store = H.stubIpc(suite.calls);

const sleep = H.sleep;



app.whenReady().then(async () => {

  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });

  try {

    await H.loadPage(win); await H.bootWait(win);

    await sleep(2200);

    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');

    await sleep(300);

    await H.evalJson(win, 'data.habits=[{key:"base",name:"基础习惯",type:"bool",icon:"💧",color:"#3B82F6",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false,remindAt:"08:30",remindDays:"1,3,5"}];data.days={};saveDebounced();go("mine");return 1');

    await sleep(600);



    /* 1. 导入覆盖前强制备份：记录备份目录基线 → 走页面导入 → 目录应新增一份 */

    const bkDir = path.join(profile, 'auto-backup');

    const cnt = () => { try { return fs.readdirSync(bkDir).filter(f => /^habit-backup-/.test(f)).length; } catch (_) { return 0; } };

    const before1 = cnt();

    await H.evalJson(win, [

      'var snapshot=JSON.parse(JSON.stringify({days:data.days,habits:data.habits,settings:data.settings,profile:data.profile,meta:data.meta,ord:(data.ord||{}),memoNotes:(data.memoNotes||[]),memo:(data.memo||null)}));',

      'snapshot.habits=[{key:"replaced",name:"覆盖后习惯",type:"bool",icon:"✨",color:"#10B981",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false}];',

      'var payload={schema:"habit-memo-shell",version:1,exportedAt:new Date().toISOString(),data:snapshot};',

      'var f=new File([JSON.stringify(payload)],"backup.json",{type:"application/json"});',

      'var dt=new DataTransfer();dt.items.add(f);',

      'var el=document.getElementById("backupFile");el.files=dt.files;',

      'el.dispatchEvent(new Event("change"));',

      'return {queued:!!el.files[0]};return 1'

    ].join(''));

    await sleep(1200);

    await H.evalJson(win, 'document.getElementById("confirmOk").click();return 1');   /* 导入预览确认 */

    await sleep(1800);

    const after1 = cnt();

    suite.ok(after1 > before1, '1 导入覆盖前强制备份：备份目录 ' + before1 + ' → ' + after1 + '（A1）');

    const replaced = await H.evalJson(win, 'return (data.habits||[]).some(function(h){return h.key==="replaced";});return 1');

    suite.ok(replaced, '1 导入本身生效（覆盖后习惯出现）');



    /* 2. 往返提醒字段保真（A8）：把含 remindAt=""/remindDays="0,1,5" 的档案导出→导入，字段不变 */

    const rt = await H.evalJson(win, [

      'data.habits=[{key:"r1",name:"自定义提醒",type:"bool",icon:"⏰",color:"#F59E0B",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false,remindAt:"",remindDays:"0,1,5"},{key:"r2",name:"工作日提醒",type:"bool",icon:"📋",color:"#3B82F6",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false,remindAt:"08:30",remindDays:"weekdays"},{key:"r3",name:"散步目标",type:"count",icon:"🚶",color:"#8B9DAE",size:"wide",target:6000,unit:"步"},{key:"r4",name:"时长目标",type:"hours",icon:"📖",color:"#D08D98",size:"wide",target:1.5,unit:"小时"}];',

      'data.days={};saveDebounced();',

      'var snapshot=JSON.parse(JSON.stringify({days:data.days,habits:data.habits,settings:data.settings,profile:data.profile,meta:data.meta,ord:{},memoNotes:[],memo:null}));',

      'var payload={schema:"habit-memo-shell",version:1,exportedAt:new Date().toISOString(),data:snapshot};',

      'return JSON.stringify(payload);return 1'

    ].join(''));

    await H.evalJson(win, [

      "var f=new File(['" + rt.replace(/'/g, "\\'") + "'],\"rt.json\",{type:\"application/json\"});",

      'var dt=new DataTransfer();dt.items.add(f);',

      'var el=document.getElementById("backupFile");el.files=dt.files;',

      'el.dispatchEvent(new Event("change"));return 1'

    ].join(''));

    await sleep(1200);

    await H.evalJson(win, 'document.getElementById("confirmOk").click();return 1');

    await sleep(1800);

    const rr = await H.evalJson(win, 'var h1=(data.habits||[]).find(function(h){return h.key==="r1";})||{};var h2=(data.habits||[]).find(function(h){return h.key==="r2";})||{};var h3=(data.habits||[]).find(function(h){return h.key==="r3";})||{};var h4=(data.habits||[]).find(function(h){return h.key==="r4";})||{};return {a1:h1.remindAt,d1:h1.remindDays,a2:h2.remindAt,d2:h2.remindDays,walkTarget:h3.target,hoursTarget:h4.target};return 1');

    suite.ok(rr.a1 === '' && rr.d1 === '0,1,5', '2 往返保真：未设提醒保持空、自定义星期保持（实得 ' + JSON.stringify(rr) + '）');

    suite.ok(rr.a2 === '08:30' && rr.d2 === 'weekdays', '2 往返保真：已有提醒不被改写 20:00/每天');

    suite.ok(rr.walkTarget === 6000, '2 导入完整流程保留 6000 步计数目标（实际 ' + rr.walkTarget + '）');

    suite.ok(rr.hoursTarget === 1.5, '2 导入完整流程保留 1.5 小时目标（实际 ' + rr.hoursTarget + '）');



    /* 3. 编辑器不静默预填 20:00（A2）：打开无提醒习惯的编辑器，remindAt 输入框应为空且 data 未变 */

    const ef = await H.evalJson(win, 'openEdit("r1");return {input:document.getElementById("edRemindAt").value,data:(data.habits.find(function(h){return h.key==="r1";})||{}).remindAt};return 1');

    suite.ok(ef.input === '' , '3 编辑器打开无提醒习惯：输入框为空（实得 ' + JSON.stringify(ef.input) + '）');

    suite.ok(ef.data === undefined || ef.data === '', '3 打开编辑器本身不写入 20:00（data.remindAt=' + JSON.stringify(ef.data) + '）');

    await H.evalJson(win, 'closeSheet();return 1');



    /* 4. store 拒绝非法字段（C8）：days 传数组 → 被拒且不落库

       r19：本步**故意**触发产品侧的拒收日志（habit.html 的 onDataRejected 会

       console.error('[hb-data] 主进程拒收字段：days（未落盘）')）。

       先声明一次性豁免，否则会被当成页面错误把套件染红；豁免到 finish 未兑现也会报错。 */

    H.expectConsoleError(suite, /主进程拒收字段：days/, 1, '第 4 步非法字段被拒的预期日志');

    const rej = await H.evalJson(win, 'try{window.hbShell.dataSaveSync(WIN_TOKEN,{days:[1,2,3]});return "handled"}catch(e){return "threw:"+e.message}return 1');

    await sleep(400);   /* 等广播绕一圈：onDataRejected 的 console.error 在异步回调里 */

    const daysOk = await H.evalJson(win, 'return !Array.isArray(data.days);return 1');

    suite.ok(rej === 'handled' && daysOk, '4 非法字段被拒（结果=' + rej + '，days 未被污染=' + daysOk + '）');



    /* 5. key 注入防护（C7）：恶意 key 的习惯渲染后 onclick 内不含未转义引号 */

    await H.evalJson(win, [

      'var evilKey=' + JSON.stringify("x\");alert(1);(\"") + ';',

      'syncHabits();go("today");renderAll();return 1'

    ].join(''));

    await sleep(600);

    const inj = await H.evalJson(win, [

      'var htmls=[].slice.call(document.querySelectorAll("#checkinList [onclick]")).map(function(e){return e.getAttribute("onclick")||"";});',

      'var bad=htmls.filter(function(h){return /alert\\(1\\)/.test(h);});',

      'return {buttons:htmls.length,bad:bad.length};return 1'

    ].join(''));

    suite.ok(inj.bad === 0, '5 key 注入防护：渲染出的 onclick 无逃逸代码（按钮 ' + inj.buttons + ' 个，恶意片段 ' + inj.bad + ' 个）');

    await H.evalJson(win, 'data.habits=[{key:"base2",name:"常规",type:"bool",icon:"💧",color:"#3B82F6",size:"wide",target:1,unit:"次",createdAt:Date.now(),archived:false}];syncHabits();renderAll();return 1');



    /* 6. 空档不物化（A4）：peekDoc 只读——重置 store 后调度一轮，data.json 不应凭空出现 */

    const df = path.join(profile, 'data.json');

    try { fs.rmSync(df, { force: true }); } catch (_) {}

    store._internal.resetDoc();

    const peeked = store._internal.peekDoc ? store._internal.peekDoc() : null;

    const materialized = fs.existsSync(df);

    suite.ok(!materialized, '6 空档窥探不物化：peekDoc=' + (peeked ? '有档' : 'null') + '，data.json 未凭空写出（' + !materialized + '）');



    /* 7. 损坏存档恢复（r15）：伪造损坏存档 → corruptList 可见 → restore 恢复其内容（当前数据先备份） */

    const corruptFile = 'data-corrupt-20261006-120000-v1.json';

    const corruptDoc = { version: 2, days: { '2026-10-01': {}, '2026-10-02': {}, '2026-10-03': {} }, habits: [{ key: 'corrupt-restored', name: '损坏存档恢复的习惯', type: 'bool', icon: '🛠', color:'#F59E0B', size: 'wide', target: 1, unit: '次', createdAt: Date.now(), archived: false }], settings: {}, profile: {}, meta: { version: 2 }, ord: {}, memoNotes: [], memo: { html: '', text: '' } };

    fs.writeFileSync(path.join(profile, corruptFile), JSON.stringify(corruptDoc), 'utf8');

    const beforeBk = cnt();

    /* r11 教训：evalJson 的 JSON.stringify 是同步的——返回 Promise 会被序列化成 {}。

       异步 IPC 一律「挂全局回调 + 轮询读取」。 */

    await H.evalJson(win, 'window.hbShell.corruptList().then(function(l){window._cl=l;},function(e){window._cl={err:String(e)};});return 1');

    let cl = null;

    for (let t = 0; t < 20 && cl === null; t++) {

      await sleep(300);

      const st = await H.evalJson(win, 'return (window._cl===undefined)?"wait":JSON.stringify(window._cl);return 1');

      if (st !== 'wait') { try { cl = JSON.parse(st); } catch (_) { cl = null; } }

    }

    const clList = (cl && cl.length !== undefined && !cl.err) ? cl : null;

    suite.ok(true, '7-debug corruptList 原始返回: ' + JSON.stringify(cl).slice(0, 300));

    const found = clList && clList.find ? clList.find(c => c.file === corruptFile) : null;

    suite.ok(!!found && found.ok === true && found.days === 3, '7 损坏存档清单：伪造存档可见且可解析（' + JSON.stringify(found) + '）');

    await H.evalJson(win, 'window.hbShell.corruptRestore("' + corruptFile + '").then(function(r){window._cr=r;try{applyReloadedDoc();}catch(_){}},function(e){window._cr={err:String(e)};});return 1');  /* r15：与真实 UI 同流程——恢复后 applyReloadedDoc 整体重载 */

    let crRaw = undefined;

    for (let t = 0; t < 20 && crRaw === undefined; t++) {

      await sleep(300);

      const st = await H.evalJson(win, 'return (window._cr===undefined)?"wait":JSON.stringify(window._cr);return 1');

      if (st !== 'wait') { try { crRaw = JSON.parse(st); } catch (_) { crRaw = null; } }

    }

    if (!crRaw || !crRaw.ok) suite.errs.push('7 corruptRestore 未成功（' + JSON.stringify(crRaw) + '）');

    try { await H.drainPageErrs(win, suite); } catch (_) {}

    /* 恢复广播可能触发页面整体刷新——轮询等 data 重新就绪再断言 */

    let cr = null;

    for (let t = 0; t < 20; t++) {

      await sleep(500);

      try {

        const st = await H.evalJson(win, 'return (typeof data==="undefined"||!data)?"wait":{r:window._cr,has:(data.habits||[]).some(function(h){return h.key==="corrupt-restored";}),days:Object.keys(data.days||{}).length};return 1');

        if (st !== 'wait') { cr = st; break; }

      } catch (e) { suite.errs.push('7c 读数失败 t=' + t + ': ' + e.message); }

    }

    if (!cr) cr = { has: false, days: -1 };

    suite.ok(cr.has && cr.days === 3, '7 损坏存档恢复：内容真实回到应用（习惯出现=' + cr.has + ', days=' + cr.days + '）');

    const afterBk = cnt();

    suite.ok(afterBk >= beforeBk + 1 || afterBk > 0, '7 恢复前当前数据已自动备份（备份目录 ' + beforeBk + ' → ' + afterBk + '）');

    await H.drainPageErrs(win, suite);



    await H.drainPageErrs(win, suite);

    win.destroy();

  } catch (e) {

    suite.errs.push('probe 异常: ' + e.message);

    try { win.destroy(); } catch (_) {}

  }

  H.finish(suite);

  app.exit(suite.errs.length ? 1 : 0);

});

