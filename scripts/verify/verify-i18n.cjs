/* verify-i18n —— i18n 完整性核验（v2.1 任务 16 新增）
   1) 真实页面加载后对比 I18N.zh 与 I18N.en 的键集合（含嵌套对象递归）——必须完全一致；
   2) 抽查本次新增文案键在两语言下均为字符串/数组且非空；
   3) 固化 dompurify 结论：package.json 中已无该依赖、habit.html 中零引用。 */
'use strict';
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const H = require('./_harness.js');

const NAME = 'verify-i18n';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  const win = H.makeWin(suite);
  try {
    await H.loadPage(win);
    await H.bootWait(win);
    const r = await H.evalJson(win, [
      'function keys(o,pre){',
      '  var out=[];',
      '  Object.keys(o||{}).forEach(function(k){',
      '    var key=pre?pre+"."+k:k;',
      '    if(o[k]&&typeof o[k]==="object"&&!Array.isArray(o[k]))out=out.concat(keys(o[k],key));',
      '    else out.push(key);',
      '  });',
      '  return out.sort();',
      '}',
      'var zk=keys(I18N.zh),ek=keys(I18N.en);',
      'var missEn=zk.filter(function(k){return ek.indexOf(k)<0;});',
      'var missZh=ek.filter(function(k){return zk.indexOf(k)<0;});',
      'return {zh:zk.length,en:ek.length,missEn:missEn,missZh:missZh};'
    ].join(''));
    suite.ok(r.missEn.length === 0 && r.missZh.length === 0,
      'zh/en 键集合完全一致（zh=' + r.zh + ' en=' + r.en + (r.missEn.length ? ' 缺en:' + r.missEn.join(',') : '') + (r.missZh.length ? ' 缺zh:' + r.missZh.join(',') : '') + ')');

    /* 抽查 v2.1 新增键双语齐备 */
    const probes = await H.evalJson(win, [
      'return [' +
      '["backup_now",I18N.zh.backup_now,I18N.en.backup_now],' +
      '["backup_interval",I18N.zh.backup_interval,I18N.en.backup_interval],' +
      '["dir_title",I18N.zh.dir_title,I18N.en.dir_title],' +
      '["portable_title",I18N.zh.portable_title,I18N.en.portable_title],' +
      '["theme_title",I18N.zh.theme_title,I18N.en.theme_title],' +
      '["late_title",I18N.zh.late_title,I18N.en.late_title],' +
      '["note_title",I18N.zh.note_title,I18N.en.note_title],' +
      '["se_month_title",I18N.zh.se_month_title,I18N.en.se_month_title],' +
      '["se_weekdays",I18N.zh.se_weekdays,I18N.en.se_weekdays],' +
      '["gd1_t",I18N.zh.gd1_t,I18N.en.gd1_t]' +
      '].map(function(x){return {k:x[0],ok:!!x[1]&&!!x[2]};});'
    ].join(''));
    const bad = probes.filter(x => !x.ok).map(x => x.k);
    suite.ok(bad.length === 0, 'v2.1 新增键双语齐备' + (bad.length ? '（缺:' + bad.join(',') + '）' : '（' + probes.length + ' 键抽查）'));

    /* dompurify 结论固化 */
    const pkg = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'package.json'), 'utf8'));
    const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);
    suite.ok(deps.dompurify === undefined, 'dompurify 已从依赖移除（sanitizeMemoHtml 为手写白名单，0 引用）');
    const html = fs.readFileSync(path.join(H.ROOT, 'habit.html'), 'utf8');
    suite.ok(html.toLowerCase().indexOf('dompurify') < 0, 'habit.html 无 dompurify 引用残留');
    await H.drainPageErrs(win, suite);
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
