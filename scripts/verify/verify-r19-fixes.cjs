'use strict';
/* verify-r19-fixes.cjs —— r19 全面审查修复的永久回归套件（Electron + _harness.js）
 *
 * 覆盖 r19 对 habit.html / preload.js / main.js 的修复：
 *   A1  连续天数缓存真生效（原先 _streakCacheDirty 永不为 false，r11 缓存是死代码）+ 反例证明会失效
 *   A2  聚合记忆化（totalCheckins/maxStreakAll/moodCount/recordCount/hasPerfectDay）同周期不重复扫描 + renderAll 后失效
 *   A3  esc() 三边界（0 / false / null-undefined 不得被吞成空串）
 *   A4  csvCell()（逗号/引号转义 + CSV 公式注入防护 + null/undefined）
 *   A5  clearHabitHistory 必须连 _ts 一起删（原先漏删 → 「最佳时段」与 CSV 把已清除记录算进去）
 *   A6  Esc 在输入框/contenteditable 里可用（原先输入框守卫在 Escape 分支之前，纯键盘关不掉浮层）
 *   A7  翻日期不再全量重绘（原先 shiftViewDate 走 renderAll() 全量 → 连带 renderMine()→refreshBackupState() 发 IPC）
 *   A8  daysAgoStr 日历减法正确（DST 安全）
 *   A9  onDataRejected 接线存在（preload 新通道 + 页面订阅）
 *   A10 源码级回归：main.js 必须解构导入 Notification（原先漏导入 → 用户从未收到任何系统提醒）+ powerMonitor resume 监听
 *   A11 html.dark 下 renderAll 不崩
 *   A12 全程用 H.drainPageErrs 收集页面错误，末尾 H.finish
 *
 * 运行（本机必须 env -u ELECTRON_RUN_AS_NODE，否则 electron 退化成纯 node）：
 *   cd /c/Users/ExampleUser/Desktop/时迹
 *   timeout 200 env -u ELECTRON_RUN_AS_NODE ./node_modules/electron/dist/electron.exe scripts/verify/verify-r19-fixes.cjs
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-r19-fixes';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

/* 轮询等待页面内表达式为真（照 verify-dark.cjs:51-58 的 waitFor 模式） */


app.whenReady().then(async () => {
  let win = null;
  try {
    /* ================= A10：main.js 源码级回归 ================= */
    suite.step('A10 main.js 源码级回归（Notification 导入 / powerMonitor resume）');
    const mainSrc = H.checkMainJsSyntax(suite); /* 顺带 vm.Script 编译断言 */
    const notifRe = /const\s*\{[^}]*\bNotification\b[^}]*\}\s*=\s*require\('electron'\)/;
    const mNotif = notifRe.exec(mainSrc);
    suite.ok(!!mNotif,
      'A10 main.js 的 require(\'electron\') 解构里包含 Notification（实测匹配：' +
      (mNotif ? JSON.stringify(mNotif[0].slice(0, 120)) : 'null') + '）');
    suite.ok(/Notification\.isSupported/.test(mainSrc),
      'A10 main.js 存在 Notification.isSupported 兜底判断（实测命中 ' +
      (mainSrc.match(/Notification\.isSupported/g) || []).length + ' 次）');
    suite.ok(/new\s+Notification\s*\(/.test(mainSrc),
      'A10 main.js 存在 new Notification(...) 实际构造（实测命中 ' +
      (mainSrc.match(/new\s+Notification\s*\(/g) || []).length + ' 次）');
    suite.ok(/powerMonitor/.test(mainSrc),
      'A10 main.js 存在 powerMonitor（实测命中 ' + (mainSrc.match(/powerMonitor/g) || []).length + ' 次）');
    const resumeRe = /powerMonitor\.on\(\s*'resume'/;
    suite.ok(resumeRe.test(mainSrc),
      "A10 main.js 注册了 powerMonitor.on('resume'（实测 " +
      (resumeRe.test(mainSrc) ? '命中' : '未命中') + '）');

    /* ================= A9：preload / 页面 onDataRejected 接线 ================= */
    suite.step('A9 onDataRejected 接线（preload 源码 + 页面桥）');
    const preloadSrc = fs.readFileSync(path.join(H.ROOT, 'preload.js'), 'utf8');
    suite.ok(/hb-data-rejected/.test(preloadSrc),
      'A9 preload.js 源码含 hb-data-rejected（实测命中 ' + (preloadSrc.match(/hb-data-rejected/g) || []).length + ' 次）');
    suite.ok(/onDataRejected/.test(preloadSrc),
      'A9 preload.js 源码含 onDataRejected（实测命中 ' + (preloadSrc.match(/onDataRejected/g) || []).length + ' 次）');
    const habitSrc = fs.readFileSync(path.join(H.ROOT, 'habit.html'), 'utf8');
    suite.ok(/onDataRejected/.test(habitSrc),
      'A9 habit.html 源码订阅了 onDataRejected（实测命中 ' + (habitSrc.match(/onDataRejected/g) || []).length + ' 次）');

    /* ================= 起窗口 ================= */
    win = H.makeWin(suite, { show: true, width: 520, height: 720 });
    await H.loadPage(win);
    await H.bootWait(win);
    await H.sleep(2200); /* 等 1800ms 的新手引导落地（guideMask 存在会让 Escape 分支提前 return 并点 skip） */
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await H.sleep(300);

    suite.ok(true, 'A0 页面就绪（data.meta 存在，示例引导已关闭）');

    /* 页面桥：hbShell.onDataRejected 必须是函数 */
    const bridge = await H.evalJson(win,
      'return {rej:typeof (window.hbShell&&window.hbShell.onDataRejected),'
      + ' chg:typeof (window.hbShell&&window.hbShell.onDataChanged),'
      + ' shell:typeof window.hbShell};');
    suite.ok(bridge.rej === 'function',
      'A9 window.hbShell.onDataRejected 是函数（实测 typeof=' + bridge.rej + '，hbShell=' + bridge.shell + '）');

    /* ================= 统一造数据（profile 有播种示例数据，必须先整体重置） ================= */
    const setup = await H.evalJson(win,
      'data.days={};'
      + 'data.habits=[{key:"water",name:"喝水",type:"count",target:8,icon:"💧",color:"#7FA0B4",size:"wide",createdAt:Date.now(),archived:false}];'
      + 'syncHabits();'
      + 'renderAll();'
      + 'return {habits:HABITS.length,hmap:Object.keys(HMAP),days:Object.keys(data.days).length,'
      + ' streakDirty:_streakCacheDirty,aggDirty:_aggCacheDirty};');
    suite.ok(setup.habits === 1 && setup.hmap.length === 1,
      'A0 造数据：HABITS 重置为 1 项（实测 ' + JSON.stringify(setup.hmap) + '）');
    suite.ok(setup.days === 0, 'A0 造数据：data.days 已整体重置（实测键数 ' + setup.days + '）');

    /* ================= A1：连续天数缓存 ================= */
    suite.step('A1 streakOf 缓存真生效 + 反例证明会失效');
    suite.ok(setup.streakDirty === false && setup.aggDirty === false,
      'A1 renderAll() 后 _streakCacheDirty===false 且 _aggCacheDirty===false（实测 ' +
      setup.streakDirty + ' / ' + setup.aggDirty + '）');

    const a1 = await H.evalJson(win,
      'data.days={};'
      + 'data.days[todayStr()]={water:8};'
      + 'renderAll();'
      + 'delete _streakCache["cur|water|"];'
      + 'var calls=0;var orig=window.isDone;'
      + 'window.isDone=function(k,d){calls++;return orig(k,d);};'
      + 'var s1=streakOf("water");var c1=calls;'
      + 'var s2=streakOf("water");var c2=calls;'
      + 'window.isDone=orig;'
      + 'return {s1:s1,s2:s2,c1:c1,c2:c2,dirty:_streakCacheDirty};');
    suite.ok(a1.c1 > 0,
      'A1 首次 streakOf 真实扫描（实测 isDone 调用 ' + a1.c1 + ' 次，streak=' + a1.s1 + '）');
    suite.ok(a1.c2 === a1.c1,
      'A1 第二次 streakOf 命中缓存、不再调 isDone（实测增量 ' + (a1.c2 - a1.c1) + ' 次，streak=' + a1.s2 + '）');
    suite.ok(a1.s1 === 1 && a1.s2 === 1,
      'A1 缓存值正确 streak=1（实测 ' + a1.s1 + ' / ' + a1.s2 + '）');

    const a1b = await H.evalJson(win,
      'data.days={};'
      + 'data.days[todayStr()]={water:8};'
      + 'data.days[daysAgoStr(1)]={water:8};'
      + 'renderAll();'
      + 'var s2=streakOf("water");'
      + 'delete data.days[daysAgoStr(1)];'
      + 'renderAll();'
      + 'var s1=streakOf("water");'
      + 'return {s2:s2,s1:s1,dirty:_streakCacheDirty};');
    suite.ok(a1b.s2 === 2,
      'A1 反例准备：两天连续 streak=2（实测 ' + a1b.s2 + '）');
    suite.ok(a1b.s1 === 1,
      'A1 反例：改 data.days 后 renderAll() 必须让缓存失效并反映新值 1（实测 ' + a1b.s1 +
      '，若为 2 则是永久缓存导致脏数据）');

    /* ================= A2：聚合记忆化 ================= */
    suite.step('A2 聚合记忆化（同周期不重复扫描 + renderAll 后失效）');
    const a2a = await H.evalJson(win,
      'data.days={};data.days[todayStr()]={water:8};'
      + 'renderAll();'
      + 'delete _aggCache["totalCheckins"];delete _aggCache["maxStreakAll"];delete _aggCache["hasPerfectDay"];'
      + 'delete _streakCache["best|water"];' /* maxStreakAll→bestStreakOf 还有一层 _streakCache，两层都要清才能观测到真实扫描 */
      + 'var calls=0;var orig=window.isDone;'
      + 'window.isDone=function(k,d){calls++;return orig(k,d);};'
      + 'var t1=totalCheckins();var c1=calls;'
      + 'var t2=totalCheckins();var c2=calls;'
      + 'var m1=maxStreakAll();var c3=calls;'
      + 'var m2=maxStreakAll();var c4=calls;'
      + 'var h1=hasPerfectDay();var c5=calls;'
      + 'var h2=hasPerfectDay();var c6=calls;'
      + 'window.isDone=orig;'
      + 'return {t1:t1,t2:t2,c1:c1,c2:c2,m1:m1,m2:m2,c3:c3,c4:c4,h1:h1,h2:h2,c5:c5,c6:c6};');
    suite.ok(a2a.c1 > 0 && a2a.c2 === a2a.c1,
      'A2 totalCheckins 首次扫描 ' + a2a.c1 + ' 次、二次增 ' + (a2a.c2 - a2a.c1) + ' 次（值 ' + a2a.t1 + '）');
    suite.ok(a2a.c3 > a2a.c2 && a2a.c4 === a2a.c3,
      'A2 maxStreakAll 首次扫描 ' + (a2a.c3 - a2a.c2) + ' 次、二次增 ' + (a2a.c4 - a2a.c3) + ' 次（值 ' + a2a.m1 + '）');
    suite.ok(a2a.c5 > a2a.c4 && a2a.c6 === a2a.c5,
      'A2 hasPerfectDay 首次扫描 ' + (a2a.c5 - a2a.c4) + ' 次、二次增 ' + (a2a.c6 - a2a.c5) + ' 次（值 ' + a2a.h1 + '）');
    suite.ok(a2a.t1 === a2a.t2 && a2a.m1 === a2a.m2 && a2a.h1 === a2a.h2,
      'A2 记忆化不改变返回值（实测 ' + JSON.stringify([a2a.t1, a2a.t2, a2a.m1, a2a.m2, a2a.h1, a2a.h2]) + '）');

    const a2b = await H.evalJson(win,
      'data.days={};data.days[todayStr()]={water:8};'
      + 'renderAll();'
      + 'var base={r:recordCount(),mo:moodCount(),tc:totalCheckins(),hp:hasPerfectDay()};'
      + 'data.days["2099-01-01"]={water:8};'
      + 'var stale={r:recordCount(),mo:moodCount(),tc:totalCheckins(),hp:hasPerfectDay()};'
      + 'renderAll();'
      + 'var fresh={r:recordCount(),mo:moodCount(),tc:totalCheckins(),hp:hasPerfectDay()};'
      + 'data.days["2099-01-01"].mood="happy";'
      + 'var stale2={mo:moodCount()};'
      + 'renderAll();'
      + 'var fresh2={mo:moodCount()};'
      + 'delete data.days["2099-01-01"];'
      + 'renderAll();'
      + 'return {base:base,stale:stale,fresh:fresh,stale2:stale2,fresh2:fresh2};');
    suite.ok(a2b.stale.r === a2b.base.r && a2b.fresh.r === a2b.base.r + 1,
      'A2 recordCount 同周期冻结（' + a2b.base.r + '→' + a2b.stale.r + '）、renderAll 后失效（→' + a2b.fresh.r + '）');
    suite.ok(a2b.stale.tc === a2b.base.tc && a2b.fresh.tc === a2b.base.tc + 1,
      'A2 totalCheckins 同周期冻结（' + a2b.base.tc + '→' + a2b.stale.tc + '）、renderAll 后失效（→' + a2b.fresh.tc + '）');
    suite.ok(a2b.stale.hp === a2b.base.hp && a2b.fresh.hp === true,
      'A2 hasPerfectDay 同周期冻结（' + a2b.base.hp + '→' + a2b.stale.hp + '）、renderAll 后失效（→' + a2b.fresh.hp + '）');
    suite.ok(a2b.stale.mo === a2b.base.mo && a2b.stale2.mo === a2b.base.mo && a2b.fresh2.mo === a2b.base.mo + 1,
      'A2 moodCount 同周期冻结（' + a2b.base.mo + '→' + a2b.stale.mo + '→' + a2b.stale2.mo +
      '）、renderAll 后失效（→' + a2b.fresh2.mo + '）');

    /* ================= A3：esc() ================= */
    suite.step('A3 esc() 边界');
    const a3 = await H.evalJson(win,
      'return {zero:esc(0),f:esc(false),nul:esc(null),und:esc(undefined),'
      + ' quote:esc("a\'b"),tag:esc("<img>"),amp:esc("a&b")};');
    suite.ok(a3.zero === '0', "A3 esc(0)==='0'（实测 " + JSON.stringify(a3.zero) + '）');
    suite.ok(a3.f === 'false', "A3 esc(false)==='false'（实测 " + JSON.stringify(a3.f) + '）');
    suite.ok(a3.nul === '', "A3 esc(null)===''（实测 " + JSON.stringify(a3.nul) + '）');
    suite.ok(a3.und === '', "A3 esc(undefined)===''（实测 " + JSON.stringify(a3.und) + '）');
    suite.ok(a3.quote === 'a&#39;b', "A3 esc(\"a'b\")==='a&#39;b'（实测 " + JSON.stringify(a3.quote) + '）');
    suite.ok(a3.tag === '&lt;img&gt;', "A3 esc('<img>')==='&lt;img&gt;'（实测 " + JSON.stringify(a3.tag) + '）');
    suite.ok(a3.amp === 'a&amp;b', "A3 esc('a&b')==='a&amp;b'（实测 " + JSON.stringify(a3.amp) + '）');

    /* ================= A4：csvCell() ================= */
    suite.step('A4 csvCell() 转义与公式注入防护');
    const a4 = await H.evalJson(win,
      'return {comma:csvCell("a,b"),quote:csvCell("a\\"b"),eq:csvCell("=1+1"),at:csvCell("@x"),'
      + ' nul:csvCell(null),und:csvCell(undefined),nl:csvCell("a\\nb"),plus:csvCell("+1"),minus:csvCell("-1"),'
      + ' plain:csvCell("abc")};');
    suite.ok(a4.comma === '"a,b"', "A4 csvCell('a,b')==='\"a,b\"'（实测 " + JSON.stringify(a4.comma) + '）');
    suite.ok(a4.quote === '"a""b"', "A4 csvCell('a\"b')==='\"a\"\"b\"'（实测 " + JSON.stringify(a4.quote) + '）');
    suite.ok(a4.eq === "'=1+1", "A4 csvCell('=1+1')===\"'=1+1\"（实测 " + JSON.stringify(a4.eq) + '）');
    suite.ok(a4.at === "'@x", "A4 csvCell('@x')===\"'@x\"（实测 " + JSON.stringify(a4.at) + '）');
    suite.ok(a4.nul === '', "A4 csvCell(null)===''（实测 " + JSON.stringify(a4.nul) + '）');
    suite.ok(a4.und === '', "A4 csvCell(undefined)===''（实测 " + JSON.stringify(a4.und) + '）');
    suite.ok(/^"[\s\S]*"$/.test(a4.nl), "A4 csvCell('a\\nb') 被引号包住（实测 " + JSON.stringify(a4.nl) + '）');
    suite.ok(a4.plus === "'+1", "A4 csvCell('+1')===\"'+1\"（实测 " + JSON.stringify(a4.plus) + '）');
    suite.ok(a4.minus === "'-1", "A4 csvCell('-1')===\"'-1\"（实测 " + JSON.stringify(a4.minus) + '）');
    suite.ok(a4.plain === 'abc', "A4 csvCell('abc')==='abc' 普通值不加引号（实测 " + JSON.stringify(a4.plain) + '）');

    /* ================= A5：clearHabitHistory 必须删 _ts ================= */
    suite.step('A5 clearHabitHistory 连 _ts 一起删');
    const a5 = await H.evalJson(win,
      'data.days={};var T=todayStr();'
      + 'data.days[T]={water:1,water_ts:111,water_t:2,water_s:1,water_e:2,mood:"happy"};'
      + 'var cleared=clearHabitHistory("water");'
      + 'var day=data.days[T]||{};'
      + 'return {cleared:cleared,'
      + ' hasTs:Object.prototype.hasOwnProperty.call(day,"water_ts"),'
      + ' hasT:Object.prototype.hasOwnProperty.call(day,"water_t"),'
      + ' hasS:Object.prototype.hasOwnProperty.call(day,"water_s"),'
      + ' hasE:Object.prototype.hasOwnProperty.call(day,"water_e"),'
      + ' hasKey:Object.prototype.hasOwnProperty.call(day,"water"),'
      + ' mood:day.mood,keys:Object.keys(day)};');
    suite.ok(a5.cleared === 1, 'A5 clearHabitHistory 返回清除天数 1（实测 ' + a5.cleared + '）');
    suite.ok(a5.hasTs === false,
      'A5 关键：water_ts 已被删除（实测 hasOwnProperty=' + a5.hasTs + '，残留键 ' + JSON.stringify(a5.keys) + '）');
    suite.ok(a5.hasT === false && a5.hasS === false && a5.hasE === false && a5.hasKey === false,
      'A5 water/water_t/water_s/water_e 均已删除（实测 ' + JSON.stringify(a5.keys) + '）');
    suite.ok(a5.mood === 'happy',
      'A5 其它字段（mood）未被误删（实测 ' + JSON.stringify(a5.mood) + '）');

    /* ================= A8：daysAgoStr 日历减法 ================= */
    suite.step('A8 daysAgoStr 日历减法');
    const a8 = await H.evalJson(win,
      'var t0=todayStr();var y=daysAgoStr(1);var y7=daysAgoStr(7);'
      + 'var a=new Date(y+"T12:00:00"),b=new Date(t0+"T12:00:00");'
      + 'var a7=new Date(y7+"T12:00:00");'
      + 'return {t0:t0,y:y,y7:y7,diff:b.getTime()-a.getTime(),diff7:b.getTime()-a7.getTime(),'
      + ' same:y===t0,same0:daysAgoStr(0)===t0};');
    suite.ok(a8.same0 === true, 'A8 daysAgoStr(0)===todayStr()（实测 ' + a8.t0 + ' / ' + a8.same0 + '）');
    suite.ok(a8.diff === 86400000,
      'A8 daysAgoStr(1) 与今天 12:00 相差恰好 86400000ms（实测 ' + a8.diff + 'ms，日期 ' + a8.y + '）');
    suite.ok(a8.same === false, 'A8 daysAgoStr(1) 不等于今天（实测 ' + a8.y + ' vs ' + a8.t0 + '）');
    suite.ok(a8.diff7 === 7 * 86400000,
      'A8 daysAgoStr(7) 相差恰好 7×86400000ms（实测 ' + a8.diff7 + 'ms，日期 ' + a8.y7 + '）');

    /* ================= A6：Esc 在输入框里可用 ================= */
    suite.step('A6 Esc 在输入框/contenteditable 里可用（含反向对照）');
    const a6prep = await H.evalJson(win,
      'var g=document.getElementById("guideMask");if(g)g.remove();'
      + 'go("today");'
      + 'return {guide:!!document.getElementById("guideMask"),tab:document.querySelector(".page.active").id};');
    suite.ok(a6prep.guide === false, 'A6 前置：guideMask 已移除（实测存在=' + a6prep.guide + '）');

    /* A6-1 日期备注弹层：焦点在 input 上按 Escape */
    await H.evalJson(win, 'setDayNote();return 1');
    await H.sleep(150); /* setDayNote 内 setTimeout(...,80) 才 focus+select */
    const a6a = await H.evalJson(win,
      'var inp=document.getElementById("dayNoteInput");inp.focus();'
      + 'var mask=document.getElementById("dayNoteMask");'
      + 'var shown=!!mask&&mask.classList.contains("show");'
      + 'var focused=document.activeElement===inp;'
      + 'inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));'
      + 'return {shown:shown,focused:focused,'
      + ' after:!!mask&&mask.classList.contains("show"),key:document.activeElement?document.activeElement.id:null};');
    suite.ok(a6a.shown === true, 'A6-1 setDayNote() 打开后 #dayNoteMask 有 show 类（实测 ' + a6a.shown + '）');
    suite.ok(a6a.focused === true,
      'A6-1 事件目标确实是 #dayNoteInput（实测 activeElement 命中=' + a6a.focused + '，key=' + a6a.key + '）');
    suite.ok(a6a.after === false,
      'A6-1 在 input 上按 Escape 后 #dayNoteMask 不再有 show（实测 ' + a6a.after + '）');

    /* A6-2 便签编辑器：contenteditable 上按 Escape（r19 核心修复点） */
    const a6b = await H.evalJson(win,
      'document.body.classList.add("memo-editor-open");'
      + 'var mi=document.getElementById("memoInput");'
      + 'var opened=document.body.classList.contains("memo-editor-open");'
      + 'mi.focus();'
      + 'var focused=document.activeElement===mi;'
      + 'var ce=!!mi.isContentEditable;'
      + 'mi.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));'
      + 'return {opened:opened,focused:focused,ce:ce,'
      + ' after:document.body.classList.contains("memo-editor-open")};');
    suite.ok(a6b.opened === true, 'A6-2 前置：body 已加 memo-editor-open（实测 ' + a6b.opened + '）');
    suite.ok(a6b.ce === true && a6b.focused === true,
      'A6-2 事件目标是 contenteditable 的 #memoInput（实测 isContentEditable=' + a6b.ce + ' focused=' + a6b.focused + '）');
    suite.ok(a6b.after === false,
      'A6-2 关键：在 contenteditable 上按 Escape 后 memo-editor-open 被移除（实测 ' + a6b.after +
      '，r19 前输入框守卫会 return 导致关不掉）');

    /* A6-3 反向对照：输入框里按数字键不得切页 */
    const a6c = await H.evalJson(win,
      'var before=document.querySelector(".page.active").id;'
      + 'var inp=document.getElementById("dayNoteInput");inp.focus();'
      + 'inp.dispatchEvent(new KeyboardEvent("keydown",{key:"2",bubbles:true}));'
      + 'var inInput=document.querySelector(".page.active").id;'
      + 'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"2",bubbles:true}));'
      + 'var onBody=document.querySelector(".page.active").id;'
      + 'document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"1",bubbles:true}));'
      + 'var back=document.querySelector(".page.active").id;'
      + 'return {before:before,inInput:inInput,onBody:onBody,back:back};');
    suite.ok(a6c.before === 'page-today' && a6c.inInput === 'page-today',
      'A6-3 反向对照：输入框里按 2 不切页（实测 ' + a6c.before + '→' + a6c.inInput + '，输入框守卫仍生效）');
    suite.ok(a6c.onBody === 'page-stat',
      'A6-3 正向对照：body 上按 2 确实切到 page-stat（实测 ' + a6c.onBody + '，证明数字键处理本身可用）');
    suite.ok(a6c.back === 'page-today', 'A6-3 复位：body 上按 1 回到 page-today（实测 ' + a6c.back + '）');

    /* ================= A7：翻日期不再全量重绘 ================= */
    suite.step('A7 shiftViewDate / resetViewDate 不再全量重绘');
    const a7 = await H.evalJson(win,
      'data.days={};data.days[todayStr()]={water:8};data.days[daysAgoStr(1)]={};'
      + 'viewDate=todayStr();viewDateLabel();renderAll();'
      + 'go("today");'
      + 'var calls=0;var orig=window.renderMine;'
      + 'window.renderMine=function(){calls++;return orig.apply(this,arguments);};'
      + 'var label0=document.getElementById("viewDateLabel").textContent;'
      + 'var done0=document.querySelectorAll("#checkinList .hcard.done").length;'
      + 'var cards0=document.querySelectorAll("#checkinList .hcard").length;'
      + 'shiftViewDate(-1);'
      + 'var afterShift=calls;'
      + 'var label1=document.getElementById("viewDateLabel").textContent;'
      + 'var done1=document.querySelectorAll("#checkinList .hcard.done").length;'
      + 'var cards1=document.querySelectorAll("#checkinList .hcard").length;'
      + 'resetViewDate();'
      + 'var afterReset=calls;'
      + 'var label2=document.getElementById("viewDateLabel").textContent;'
      + 'var done2=document.querySelectorAll("#checkinList .hcard.done").length;'
      + 'window.renderMine=orig;'
      + 'return {afterShift:afterShift,afterReset:afterReset,'
      + ' label0:label0,label1:label1,label2:label2,'
      + ' done0:done0,done1:done1,done2:done2,cards0:cards0,cards1:cards1,'
      + ' view:viewDate,today:todayStr()};');
    suite.ok(a7.afterShift === 0,
      'A7 关键：shiftViewDate(-1) 未调用 renderMine（实测调用 ' + a7.afterShift +
      ' 次；r19 前走 renderAll() 全量会连带 renderMine→refreshBackupState 发 IPC）');
    suite.ok(a7.afterReset === 0,
      'A7 resetViewDate() 同样未调用 renderMine（实测累计 ' + a7.afterReset + ' 次）');
    suite.ok(a7.label1 !== a7.label0,
      'A7 翻日期后 #viewDateLabel 文本已变（实测 ' + JSON.stringify(a7.label0) + '→' + JSON.stringify(a7.label1) + '）');
    /* ui-1 起星期七色封面退出主视觉，`#checkinList` 不再带 dow-N 类 →
       旧的「星期类变化」代理信号已失效。改用仍然存在的真实信号：同一批习惯在
       「今天（已完成）」与「昨天（未完成）」下渲染出的已完成卡片数必须不同。 */
    suite.ok(a7.done1 !== a7.done0,
      'A7 #checkinList 已按新日期重绘（今日已完成 ' + a7.done0 + ' 张 → 昨天 ' + a7.done1 + ' 张）');
    suite.ok(a7.cards1 > 0,
      'A7 翻到昨天后 #checkinList 仍有卡片（实测 ' + a7.cards1 + ' 张，今天 ' + a7.cards0 + ' 张）');
    suite.ok(a7.label2 === a7.label0 && a7.done2 === a7.done0 && a7.view === a7.today,
      'A7 resetViewDate() 回到今天（实测 label ' + JSON.stringify(a7.label2) + '，已完成 ' + a7.done2 + ' 张，viewDate=' + a7.view + '）');

    /* ================= A11：html.dark 下不崩 ================= */
    suite.step('A11 html.dark 下 renderAll 不崩');
    const a11 = await H.evalJson(win,
      'data.settings=data.settings||{};data.settings.theme="dark";applyTheme();'
      + 'data.days={};data.days[todayStr()]={water:8};'
      + 'viewDate=todayStr();viewDateLabel();renderAll();'
      + 'var el=document.querySelector("#checkinList .hcard");'
      + 'var cs=el?getComputedStyle(el):null;'
      + 'return {dark:document.documentElement.classList.contains("dark"),'
      + ' theme:(data.settings||{}).theme,'
      + ' cards:document.querySelectorAll("#checkinList .hcard").length,'
      + ' bg:cs?cs.backgroundColor:null,'
      + ' tab:document.querySelector(".page.active").id};');
    suite.ok(a11.dark === true,
      'A11 html 元素带 dark 类（实测 ' + a11.dark + '，theme=' + a11.theme + '）');
    suite.ok(a11.cards > 0,
      'A11 深色下 #checkinList 仍有卡片（实测 ' + a11.cards + ' 张）');
    suite.ok(!!a11.bg,
      'A11 深色下卡片 computedStyle 可读（实测 backgroundColor=' + JSON.stringify(a11.bg) + '）');
    await H.drainPageErrs(win, suite);
    const a11err = await H.evalJson(win, 'return {n:(window.__hbErrs||[]).length};');
    suite.ok(a11err.n === 0,
      'A11 深色 renderAll 后页面无未收集错误（实测 __hbErrs 剩余 ' + a11err.n + ' 条）');

    /* 恢复浅色，避免影响后续（若有）断言 */
    await H.evalJson(win, 'data.settings.theme="light";applyTheme();renderAll();return 1');

    /* ================= A12：页面错误收集 ================= */
    suite.step('A12 页面错误收集');
    await H.drainPageErrs(win, suite);
    const errLeft = await H.evalJson(win, 'return {n:(window.__hbErrs||[]).length};');
    suite.ok(errLeft.n === 0,
      'A12 全程页面错误已清空（实测 __hbErrs 剩余 ' + errLeft.n + ' 条；历史错误已计入 suite.errs）');

    suite.metric('a1_streakCalls', a1.c1 + '→' + a1.c2);
    suite.metric('a2_aggCalls', a2a.c1 + '→' + a2a.c2);
    suite.metric('a7_renderMineCalls', 'shift=' + a7.afterShift + ' reset=' + a7.afterReset);
    suite.metric('a8_diff1_ms', a8.diff);
    suite.metric('a11_cards', a11.cards);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { await H.drainPageErrs(win, suite); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
