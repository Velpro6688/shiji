'use strict';
/* verify-v231-honesty —— v2.3.1 诚实性修复直测（波次 0）
   ① 提醒开关迁移：老总闸 remind → remindPerHabit/remindSummary 语义保真
   ② 类型切换冻结历史判定：count→bool 后历史不被重解释（含「未完成也冻结」防 !!3 误判）
   ③ createdAt 兜底推导 + 完成率分母按创建日起算
   ④ 完美一天按当日有记录的习惯判定：新建习惯不再让历史完美天消失 */
const { app } = require('electron');
const H = require('./_harness.js');
const suite = H.makeSuite('verify-v231-honesty');
H.globalKillSwitch('verify-v231-honesty', suite);
H.initProfile('verify-v231-honesty');
H.stubIpc(suite.calls);
const sleep = H.sleep;

app.whenReady().then(async () => {
  const win = H.makeWin(suite, { show: true, width: 780, height: 900 });
  try {
    await H.loadPage(win); await H.bootWait(win);
    await sleep(1800);
    await H.evalJson(win, 'var b=document.getElementById("guideSkip");if(b)b.click();return 1');
    await sleep(200);

    /* ① 提醒开关迁移 */
    let r = await H.evalJson(win, `
      var a=migrateRemindSettings({remind:false});
      var b=migrateRemindSettings({remind:true});
      var c=migrateRemindSettings({});
      var d=migrateRemindSettings({remind:false,remindSummary:true});
      return {a:a,b:b,c:c,d:d}`);
    suite.ok(r.a.remindPerHabit === false && r.a.remindSummary === false && r.a.remind === undefined, '迁移：remind:false → 双关且老字段删除');
    suite.ok(r.b.remindPerHabit === true && r.b.remindSummary === true, '迁移：remind:true → 双开');
    suite.ok(r.c.remindPerHabit === true && r.c.remindSummary === true, '迁移：缺省 → 双开（与旧默认一致）');
    suite.ok(r.d.remindPerHabit === false && r.d.remindSummary === true, '迁移：已部分迁移的字段不被老 remind 覆盖');

    /* ② 类型切换冻结历史判定 */
    r = await H.evalJson(win, `
      data.habits=[{key:'hf1',name:'喝水',icon:'💧',color:'#3B82F6',type:'count',target:8,unit:'杯',size:'wide'}];
      data.days={'2026-10-01':{hf1:8},'2026-10-02':{hf1:3}};
      syncHabits();
      var doneBefore1=isDone('hf1',data.days['2026-10-01']);
      var doneBefore2=isDone('hf1',data.days['2026-10-02']);
      var frozen=freezeHabitHistory('hf1');
      HMAP['hf1'].type='bool';   /* 模拟 doSaveHabit 改型 */
      var doneAfter1=isDone('hf1',data.days['2026-10-01']);
      var doneAfter2=isDone('hf1',data.days['2026-10-02']);
      delete data.days['2026-10-02']['hf1_done'];   /* 用户主动编辑该天 → 解冻回到实时判定 */
      var liveAfterEdit=isDone('hf1',data.days['2026-10-02']);
      return {doneBefore1:doneBefore1,doneBefore2:doneBefore2,frozen:frozen,doneAfter1:doneAfter1,doneAfter2:doneAfter2,liveAfterEdit:liveAfterEdit,mark1:data.days['2026-10-01'].hf1_done,mark0:'hf1_done' in data.days['2026-10-02']}`);
    suite.ok(r.doneBefore1 === true && r.doneBefore2 === false, '冻结前：8/8 完成、3/8 未完成');
    suite.ok(r.frozen === 2 && r.mark1 === 1, '冻结：2 天写入标记，完成天标 1');
    suite.ok(r.doneAfter1 === true && r.doneAfter2 === false, '改型 bool 后：历史判定不变（3 不被 !!3 误判为完成）');
    suite.ok(r.liveAfterEdit === true && r.mark0 === false, '解冻后按新类型实时判定（bool 下 3→完成）');

    /* ③ createdAt 兜底 + 完成率分母 */
    r = await H.evalJson(win, `
      data.habits=[{key:'hf2',name:'阅读',icon:'📖',color:'#3B82F6',type:'bool',size:'square'}];
      data.days={'2026-10-05':{hf2:true},'2026-10-06':{}};
      syncHabits();
      var ca=habitCreatedAt(HMAP['hf2']);
      var rate=completionRate('hf2');
      var span=dateSpanDays(ca,todayStr());
      var expect=Math.round(1/span*100);
      return {ca:ca,rate:rate,span:span,expect:expect}`);
    suite.ok(r.ca === '2026-10-05', 'createdAt 兜底推导为该习惯最早记录日（' + r.ca + '）');
    suite.ok(r.rate === r.expect, '完成率分母=创建日至今历天数（' + r.rate + '% = 1/' + r.span + '）');

    /* ④ 完美一天：新建习惯不影响历史 */
    r = await H.evalJson(win, `
      data.habits=[{key:'p1',name:'冥想',icon:'🧘',color:'#3B82F6',type:'bool',size:'square'}];
      data.days={'2026-10-08':{p1:true}};
      syncHabits();
      var before=hasPerfectDay();
      data.habits.push({key:'p2',name:'新习惯',icon:'🆕',color:'#3B82F6',type:'bool',size:'square',createdAt:todayStr()});
      syncHabits();
      streakCacheReset();
      var after=hasPerfectDay();
      return {before:before,after:after}`);
    suite.ok(r.before === true && r.after === true, '新建习惯后历史完美一天不消失（' + r.before + '→' + r.after + '）');

    await H.drainPageErrs(win, suite);
    win.destroy();
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
    try { win.destroy(); } catch (_) {}
  }
  H.finish(suite);
  app.exit(suite.errs.length ? 1 : 0);
});
