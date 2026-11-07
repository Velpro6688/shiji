

'use strict';
const fs = require('fs');
const path = require('path');
const rules = require('./habit-rules');

function pad2(n) { return String(n).padStart(2, '0'); }

function createReminders(opts) {
  const getDoc = opts.getDoc;                 // () => doc（store.js 内存档，可能为 null）
  const notify = opts.notify || function () {};// ({title, body, key}) Electron 系统通知
  const banner = opts.banner || function () {};// ({title, body, key}) 应用内横幅（渲染层 toast-like）
  const stateFile = opts.stateFile || path.join(opts.userDataDir || '.', 'reminder-state.json');
  const log = opts.log || function () {};
  const nowFn = opts.nowFn || (() => new Date());
  const maxPerBatch = opts.maxPerBatch || 3;   // 补弹超过 3 条合并为一条汇总，避免轰炸
   
  const maxNotifyAttempts = Math.max(1, Number(opts.maxNotifyAttempts) || 3);

  function loadState() {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return (s && typeof s === 'object') ? s : {};
    } catch (_) { return {}; }
  }
  function saveState(s) {
     
    try {
      const tmp = stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
      fs.renameSync(tmp, stateFile);
    } catch (e) {
      try { fs.writeFileSync(stateFile, JSON.stringify(s, null, 2)); } catch (e2) { log('[remind] state write failed: ' + e2.message); }
    }
  }

  function dateStr(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function hmStr(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dowOf(ds) { const d = new Date(ds + 'T12:00:00'); return d.getDay(); }   // 0=周日
  

  function shiftDate(ds, delta) {
    const d = new Date(ds + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    return dateStr(d);
  }

  /* 重复规则匹配：'all' | 'weekdays' | 'weekends' | '0,1,5'（0=周日..6=周六） */
  function dayMatches(rule, ds) {
    const dow = dowOf(ds);
    if (!rule || rule === 'all') return true;
    if (rule === 'weekdays') return dow >= 1 && dow <= 5;
    if (rule === 'weekends') return dow === 0 || dow === 6;
    const list = String(rule).split(/[,，\s]+/).map(Number).filter(n => n >= 0 && n <= 6);
    if (!list.length) return true;   /* 无法解析的自定义串按每天处理，宁多勿漏 */
    return list.indexOf(dow) >= 0;
  }

  /* 主进程侧的「当天已完成」判定（与渲染层 isDone 同口径，缺 _t 冻结目标时用 habit.target） */
  function isDoneMain(h, day) {
    if (!day) return false;
    const fz = day[h.key + '_done'];
    if (fz !== undefined) return fz === 1 || fz === true;   /* 类型切换冻结的历史判定（与渲染层 isDone 同口径） */
    const target = Math.max(0.1, Number(day[h.key + '_t']) || Number(h.target) || 1);
    

    if (h.type === 'bool') return !!day[h.key];
    return (Number(day[h.key]) || 0) >= target;
  }

  /* 拆分开关判定：新字段缺失时回落老的总闸 settings.remind（渲染层加载即迁移，主进程可能先跑） */
  function flagOn(s, key) {
    if (!s) return false;
    if (s[key] !== undefined) return s[key] === true;
    return s.remind === true;
  }

  /* 汇总当前应触发集合（纯函数，便于测试）：{perHabits:[h], summaryNeeded:bool, undone:number, todoDue, todoOverdue} */
  function computeDue(doc, state, now) {
    const res = { perHabits: [], summaryNeeded: false, undone: 0, todoDue: 0, todoOverdue: 0, date: dateStr(now), hm: hmStr(now) };
    if (!doc || !doc.settings) return res;
    const perOn = flagOn(doc.settings, 'remindPerHabit');
    const sumOn = flagOn(doc.settings, 'remindSummary');
    if (!perOn && !sumOn) return res;
    const today = res.date;
    const day = doc.days && doc.days[today];
    const habits = (Array.isArray(doc.habits) ? doc.habits : []).filter(h => h && !h.archived && !h.deleted && rules.due(h,today,doc.days||{}));
    const nowHM = res.hm;
    for (const h of habits) {
      const done = isDoneMain(h, day);
      if (!done) res.undone++;
      if (!perOn) continue;                                    /* 单习惯提醒关：只计未完成数供汇总用 */
      const at = (typeof h.remindAt === 'string') ? h.remindAt : '';
      if (!/^\d{2}:\d{2}$/.test(at)) continue;               /* 未设时间 = 关闭单习惯提醒 */
      if (nowHM < at) continue;                              /* 未到点 */
      if (done) continue;                                    /* 已完成不再打扰 */
      if (!dayMatches(h.remindDays, today)) continue;        /* 重复规则不符 */
      const mark = h.key + '|' + today;
      if (state.fired && state.fired[mark]) continue;        /* 今天已弹过 */
      res.perHabits.push(h);
    }
    /* 待办（3.1.0）：当日到期 + 过期未完成计数（YYYY-MM-DD 字典序即时间序） */
    const todos = Array.isArray(doc.todos) ? doc.todos : [];
    for (const t of todos) {
      if (!t || t.done || typeof t.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) continue;
      if (t.due === today) res.todoDue++;
      else if (t.due < today) res.todoOverdue++;
    }
    /* 20 点汇总：当天未完成 ≥1 且过了 20:00 且今天没发过汇总 */
    if (sumOn && res.undone > 0 && now.getHours() >= 20 && state.lastSummary !== today) {
      res.summaryNeeded = true;
    }
    return res;
  }

  /* 触发一轮检查：去重落盘 + 系统通知 + 应用内横幅。返回本轮实际触发数（测试用）。 */
  function check() {
    const state = loadState();
    if (!state.fired) state.fired = {};
    if (!state.attempts) state.attempts = {};
    const now = nowFn();
    const due = computeDue(getDoc(), state, now);
    let fired = 0;
    

    const notifyOk = function (key, title, body) {
      let ok = true;
      try { ok = notify({ key, title, body }) !== false; } catch (_) { ok = false; }
      const ak = key + '|' + due.date;
      if (ok) { delete state.attempts[ak]; return true; }
      const n = (state.attempts[ak] || 0) + 1;
      state.attempts[ak] = n;
      if (n >= maxNotifyAttempts) {
        log('[remind] notify 连续失败 ' + n + ' 次，放弃重试并记为已提醒: ' + key);
        delete state.attempts[ak];
        return true;   /* 放弃重试 = 允许写去重标记，否则会无限刷 */
      }
      log('[remind] notify 失败（第 ' + n + '/' + maxNotifyAttempts + ' 次），稍后重试: ' + key);
      return false;
    };
    const done = function (key, title, body, inapp) {
      const sent = notifyOk(key, title, body);
      /* 只有系统通知确实送出（或已放弃重试）才记去重标记——失败则本轮不记，下个 tick 再试 */
      if (sent) state.fired[key + '|' + due.date] = 1;
      fired++;
      if (inapp !== false) { try { banner({ key, title, body }); } catch (_) {} }
    };
    if (due.perHabits.length === 1) {
      const h = due.perHabits[0];
      done(h.key, (h.icon ? h.icon + ' ' : '') + h.name, '到点了，别忘了「' + h.name + '」');
    } else if (due.perHabits.length > 1) {
      if (due.perHabits.length <= maxPerBatch) {
        due.perHabits.forEach(h => done(h.key, (h.icon ? h.icon + ' ' : '') + h.name, '到点了，别忘了「' + h.name + '」'));
      } else {
        /* 批量合并为一条汇总：同样只在系统通知真送出后才逐条记去重标记。
           fired 仍按条数累加（返回值语义 = 本轮涉及的到点习惯数，既有测试依赖）。 */
        const sent = notifyOk('__batch__', '时迹 · 提醒', '有 ' + due.perHabits.length + ' 项习惯到点了：' + due.perHabits.slice(0, 3).map(h => h.name).join('、') + (due.perHabits.length > 3 ? ' 等' : ''));
        if (sent) due.perHabits.forEach(h => { state.fired[h.key + '|' + due.date] = 1; });
        fired += due.perHabits.length;
        try { banner({ key: '__batch__', title: '习惯提醒', body: '有 ' + due.perHabits.length + ' 项习惯到点了，记得完成哦' }); } catch (_) {}
      }
    }
    /* 待办提醒（3.1.0）：settings.remindTodo 独立闸（默认开，不回落老总闸——老存档没这个键），
       当日到期 + 过期未完成 ≥1 且过了 20:00 提醒，与习惯汇总同节奏。
       汇总也发时并入汇总正文（同一条系统通知，避免同刻两条轰炸）；汇总关时独立发，独立去重 lastTodoSummary。
       ★ 独立分支同样受 20:00 闸约束：否则习惯全部完成（undone=0）时 summaryNeeded 恒 false，
         零点后第一个 tick 就会弹独立待办提醒（自查审查发现的时序缺口）。 */
    const docForTodo = getDoc();
    const todoOn = !!(docForTodo && docForTodo.settings && docForTodo.settings.remindTodo !== false);
    const todoTotal = (due.todoDue || 0) + (due.todoOverdue || 0);
    const todoPart = (todoOn && todoTotal > 0) ? (function () {
      const items = (Array.isArray(docForTodo.todos) ? docForTodo.todos : [])
        .filter(t => t && !t.done && typeof t.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.due) && t.due <= due.date && t.text)
        .sort((a, b) => (a.due < b.due ? -1 : 1))
        .slice(0, 3).map(t => t.text);
      const label = due.todoOverdue
        ? ('待办逾期 ' + due.todoOverdue + ' 项' + (due.todoDue ? '、今日到期 ' + due.todoDue + ' 项' : ''))
        : ('待办今日到期 ' + due.todoDue + ' 项');
      return label + (items.length ? '：' + items.join('、') + (todoTotal > 3 ? ' 等' : '') : '');
    })() : '';
    if (due.summaryNeeded) {
      const undoneNames = (function () {
        const doc = getDoc();
        const day = doc && doc.days && doc.days[due.date];
        return (doc && Array.isArray(doc.habits) ? doc.habits : [])
          .filter(h => h && !h.archived && !h.deleted && rules.due(h,due.date,doc.days||{}) && !isDoneMain(h, day)).slice(0, 3)
          .map(h => h.name).join('、');
      })();
      const sumBody = undoneNames ? (undoneNames + (due.undone > 3 ? ' 等' : '')) : '坚持就是胜利，去打个卡吧';
      /* 同样：通知没送出去就不写 lastSummary/lastTodoSummary，下个 tick 重试（notifyOk 内部封顶次数） */
      const sent = notifyOk('__summary__', '时迹 · 今日还有 ' + due.undone + ' 项未完成', todoPart ? (sumBody + '；' + todoPart) : sumBody);
      if (sent) { state.lastSummary = due.date; if (todoPart) state.lastTodoSummary = due.date; }
      try { banner({ key: '__summary__', title: '今日还有 ' + due.undone + ' 项未完成', body: todoPart ? (sumBody + '；' + todoPart) : sumBody }); } catch (_) {}
      fired++;
    }
    /* 汇总关/已发过但待办还有未提醒的：单独发一条待办提醒（同样只在 20:00 后） */
    if (todoPart && !due.summaryNeeded && now.getHours() >= 20 && state.lastTodoSummary !== due.date) {
      const sent = notifyOk('__todo__', '时迹 · 待办提醒', todoPart);
      if (sent) state.lastTodoSummary = due.date;
      try { banner({ key: '__todo__', title: '待办提醒', body: todoPart }); } catch (_) {}
      fired++;
    }
     
    const keep = new Set([due.date, shiftDate(due.date, -1), shiftDate(due.date, -2)]);
    let slimmed = 0;
    for (const k of Object.keys(state.fired)) {
      const d = k.split('|')[1];
      if (d && !keep.has(d)) { delete state.fired[k]; slimmed++; }
    }
    for (const k of Object.keys(state.attempts)) {
      const d = k.split('|')[1];
      if (d && !keep.has(d)) delete state.attempts[k];
    }
    

    if (fired) { saveState(state); log('[remind] fired ' + fired + ' at ' + due.hm); }
    else if (slimmed > 0) saveState(state);

    return fired;
  }

  

  function carryoverCheck() {
    try {
      const now = nowFn();
      const today = dateStr(now);
      const state = loadState();
      if (state.lastCarry === today) return 0;
      const doc = getDoc();
      /* 单习惯提醒开关关掉也算「今天处理过了」，避免每 30s 反复进来空转（补提属单习惯提醒语义） */
      if (!doc || !doc.settings || !flagOn(doc.settings, 'remindPerHabit')) { state.lastCarry = today; saveState(state); return 0; }
      const y = shiftDate(today, -1);    
      if (y >= today) { state.lastCarry = today; saveState(state); return 0; }
      const yd = doc.days && doc.days[y];
      const miss = (Array.isArray(doc.habits) ? doc.habits : []).filter(function (h) {
        return h && !h.archived && !h.deleted && rules.due(h,y,doc.days||{}) && /^\d{2}:\d{2}$/.test(String(h.remindAt || '')) && !isDoneMain(h, yd);
      });
      if (!miss.length) { state.lastCarry = today; saveState(state); return 0; }
      const names = miss.slice(0, 3).map(function (h) { return h.name; }).join('、') + (miss.length > 3 ? ' 等' : '');
      

      let ok = true;
      try { ok = notify({ key: '__carry__', title: '昨天还有 ' + miss.length + ' 项未完成', body: names }) !== false; } catch (_) { ok = false; }
      try { banner({ key: '__carry__', title: '昨天还有 ' + miss.length + ' 项未完成', body: names + '——今天补上就好' }); } catch (_) {}
      if (!ok) { log('[remind] carryover 系统通知失败，留待重试（昨天 ' + miss.length + ' 项）'); return 0; }
      state.lastCarry = today;
      log('[remind] carryover ' + miss.length + ' from ' + y);
      saveState(state);
      return miss.length;
    } catch (_) { return 0; }
  }
  return { check, carryoverCheck, computeDue, dayMatches, isDoneMain, loadState, saveState, _dateStr: dateStr, _shiftDate: shiftDate };
}

module.exports = { createReminders };
