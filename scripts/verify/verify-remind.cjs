/* verify-remind —— 提醒调度直测（v2.1 任务 5 新增）
   reminders.js 全依赖注入（getDoc/nowFn/notify/banner/stateFile），纯逻辑断言：
   重复规则匹配 / 到点判定 / 完成跳过 / per-habit-per-day 去重 / 重启不重复弹（补弹语义）/
   20 点汇总每天一次 / 拆分开关 remindPerHabit+remindSummary（老总闸 remind 回落）/ 批量合并 / 状态瘦身。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { createReminders } = require(path.join(__dirname, '..', '..', 'reminders.js'));

const NAME = 'verify-remind';
const suite = H_NOOP();
function H_NOOP() {
  return {
    errs: [], steps: [], metrics: {},
    ok(c, m) { if (c) this.steps.push('ok: ' + String(m).slice(0, 140)); else this.errs.push('断言失败: ' + String(m).slice(0, 400)); },
    metric(k, v) { this.metrics[k] = v; }
  };
}
const PROF = path.join(__dirname, 'profiles', NAME, 'scheduler-'+Date.now());
const H = require('./_harness.js');
H.initProfile(NAME);
suite.metric('build', H.BUILD);

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(PROF, { recursive: true });
    const D = '2026-09-25';   // 周五
    const doc = {
      settings: { remind: true },
      days: { [D]: { water: 3, early: true } },   /* water: count target 8 未完成; early: bool 已完成 */
      habits: [
        { key: 'water', name: '喝水', icon: '💧', type: 'count', target: 8, remindAt: '08:00', remindDays: 'all' },
        { key: 'early', name: '早睡', icon: '🌅', type: 'bool', remindAt: '21:00', remindDays: 'all' },
        { key: 'run', name: '跑步', icon: '🏃', type: 'bool', remindAt: '08:00', remindDays: 'weekends' },
        { key: 'read', name: '阅读', icon: '📖', type: 'bool', remindAt: '09:00', remindDays: '1,2,3,4,5' },
        { key: 'off', name: '未设时间', icon: '🧩', type: 'bool' }
      ]
    };

    /* —— 1) dayMatches —— */
    let rm = createReminders({ getDoc: () => doc, userDataDir: PROF, notify: () => {}, banner: () => {} });
    suite.ok(rm.dayMatches('all', D) === true, 'dayMatches all');
    suite.ok(rm.dayMatches('weekdays', D) === true && rm.dayMatches('weekends', D) === false, 'dayMatches 周五=工作日');
    suite.ok(rm.dayMatches('1,5', D) === true && rm.dayMatches('0,6', D) === false, 'dayMatches 自定义星期 1,5 命中周五');
    suite.ok(rm.dayMatches('weekends', '2026-09-26') === true, 'dayMatches 周六=周末');
    suite.ok(rm.isDoneMain(doc.habits[0], doc.days[D]) === false && rm.isDoneMain(doc.habits[1], doc.days[D]) === true, 'isDoneMain：count 未达标 / bool 已完成');

    /* —— 2) computeDue：到点/未到点/已完成/重复规则 —— */
    function mk(state, hm) {
      return createReminders({
        getDoc: () => doc, userDataDir: PROF,
        stateFile: path.join(PROF, 'state.json'),
        nowFn: () => new Date(D + 'T' + hm + ':00'),
        notify: () => {}, banner: () => {}
      }).computeDue(doc, state, new Date(D + 'T' + hm + ':00'));
    }
    let due = mk({}, '07:59');
    suite.ok(due.perHabits.length === 0 && due.summaryNeeded === false, '07:59：全部未到点不触发');
    due = mk({}, '08:00');
    suite.ok(due.perHabits.length === 1 && due.perHabits[0].key === 'water', '08:00：water 到点（run 周末规则排除/off 未设时间排除）');
    due = mk({}, '21:00');
    suite.ok(due.perHabits.some(h => h.key === 'early') === false, '21:00：early 已完成不再提醒');
    due = mk({}, '09:00');
    suite.ok(due.perHabits.some(h => h.key === 'read') === true, '09:00：read 自定义星期命中周五');
    suite.ok(due.undone === 4, '未完成计数正确（' + due.undone + '）');

    /* —— 3) check：触发 + 去重 + 重启不重复弹 —— */
    const stateFile = path.join(PROF, 'state.json');
    const fired = [];
    let inst = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date(D + 'T' + '08:05:00'),
      notify: n => fired.push('N:' + n.key), banner: n => fired.push('B:' + n.key)
    });
    let n1 = inst.check();
    suite.ok(n1 === 1 && fired.indexOf('N:water') >= 0, 'check：water 触发（系统通知+横幅）');
    let n2 = inst.check();
    suite.ok(n2 === 0, 'check：同日同习惯去重，二次不弹');
    /* 重启（新实例同状态文件）：已弹过的不重复 */
    inst = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date(D + 'T' + '08:40:00'),
      notify: n => fired.push('N2:' + n.key), banner: () => {}
    });
    suite.ok(inst.check() === 0, '重启后同日已弹习惯不重复弹');
    /* 重启补弹：新到点且未弹过的照常弹 */
    inst = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date(D + 'T' + '09:10:00'),
      notify: n => fired.push('N3:' + n.key), banner: () => {}
    });
    suite.ok(inst.check() === 1, '重启后新到点习惯补弹（read）');

    /* —— 4) 20 点汇总：每天一次、重启不重复 —— */
    const fired2 = [];
    inst = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date(D + 'T' + '20:30:00'),
      notify: n => fired2.push('N:' + n.key), banner: n => fired2.push('B:' + n.key)
    });
    const s1 = inst.check();
    suite.ok(s1 === 1 && fired2.some(x => x.indexOf('N:__summary__') === 0), '20 点汇总触发一次（含未完成清单）');
    suite.ok(inst.check() === 0, '20 点汇总同日去重');
    inst = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date(D + 'T' + '21:30:00'),
      notify: () => {}, banner: () => {}
    });
    suite.ok(inst.check() === 0, '20 点汇总重启后同日不重复');
    /* 次日汇总重新可用（date 变化） */
    due = createReminders({
      getDoc: () => doc, userDataDir: PROF, stateFile,
      nowFn: () => new Date('2026-09-26T20:30:00'),
      notify: () => {}, banner: () => {}
    }).computeDue(doc, inst.loadState(), new Date('2026-09-26T20:30:00'));
    suite.ok(due.summaryNeeded === true, '次日汇总重新待触发');

    /* —— 5) 总开关 settings.remind=false —— */
    const docOff = JSON.parse(JSON.stringify(doc)); docOff.settings.remind = false;
    inst = createReminders({
      getDoc: () => docOff, userDataDir: PROF, stateFile: path.join(PROF, 'state-off.json'),
      nowFn: () => new Date(D + 'T' + '21:00:00'),
      notify: () => fired2.push('OFF'), banner: () => {}
    });
    suite.ok(inst.check() === 0, '总开关关闭：全部提醒静默');

    /* —— 5b) 拆分开关：只开汇总 → 单习惯静默、20 点汇总照发 —— */
    const docSumOnly = JSON.parse(JSON.stringify(doc)); docSumOnly.settings = { remindPerHabit: false, remindSummary: true };
    inst = createReminders({
      getDoc: () => docSumOnly, userDataDir: PROF, stateFile: path.join(PROF, 'state-sumonly.json'),
      nowFn: () => new Date(D + 'T' + '20:30:00'),
      notify: n => fired2.push('SUM:' + n.key), banner: () => {}
    });
    const sumOnlyN = inst.check();
    suite.ok(sumOnlyN === 1 && fired2.some(x => x === 'SUM:__summary__') && !fired2.some(x => x === 'SUM:water'), '只开汇总开关：单习惯到点静默、汇总照发');

    /* —— 5c) 拆分开关：只开单习惯 → 到点照发、汇总静默 —— */
    const docPerOnly = JSON.parse(JSON.stringify(doc)); docPerOnly.settings = { remindPerHabit: true, remindSummary: false };
    let perBatch = [];
    inst = createReminders({
      getDoc: () => docPerOnly, userDataDir: PROF, stateFile: path.join(PROF, 'state-peronly.json'),
      nowFn: () => new Date(D + 'T' + '21:00:00'),
      notify: n => perBatch.push(n.key), banner: () => {}
    });
    inst.check();
    suite.ok(perBatch.indexOf('__summary__') < 0 && perBatch.some(k => k === 'water' || k === '__batch__'), '只开单习惯开关：到点照发、20 点汇总静默');

    /* —— 6) 批量合并（>3 条）—— */
    const docMany = JSON.parse(JSON.stringify(doc));
    docMany.habits = ['a', 'b', 'c', 'd', 'e'].map(k => ({ key: k, name: '习惯' + k, icon: '•', type: 'bool', remindAt: '08:00', remindDays: 'all' }));
    const batch = [];
    inst = createReminders({
      getDoc: () => docMany, userDataDir: PROF, stateFile: path.join(PROF, 'state-batch.json'),
      nowFn: () => new Date(D + 'T' + '08:30:00'),
      notify: n => batch.push(n), banner: () => {}
    });
    suite.ok(inst.check() === 5 && batch.length === 1 && batch[0].body.indexOf('5 项') >= 0, '5 条到点合并为 1 条汇总通知（5 条去重标记齐记）');

    /* —— 7) 状态瘦身：3 天前标记被清理 —— */
    const st = inst.loadState();
    st.fired['x|2026-09-20'] = 1;
    inst.saveState(st);
    inst.check();
    suite.ok(inst.loadState().fired['x|2026-09-20'] === undefined, '状态瘦身：3 天前的去重标记被清理');
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try {
      fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'results', NAME + '-result.json'),
        JSON.stringify({ name: NAME, ok: suite.errs.length === 0, errs: suite.errs, steps: suite.steps, metrics: suite.metrics, ts: new Date().toISOString() }, null, 2), 'utf8');
    } catch (_) {}
    console.log((suite.errs.length === 0 ? 'PASS ' : 'FAIL ') + NAME + ' errs=' + suite.errs.length + ' steps=' + suite.steps.length);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
