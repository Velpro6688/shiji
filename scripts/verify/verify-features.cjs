/* verify-features —— 功能全链路：三种打卡类型 + 心情 + 奖励 + 管理员模式拦截 + IPC 通道面
   （合并原 verify-functionality / verify-reward / verify-admin / verify-controls 的可隔离口径） */
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const H = require('./_harness.js');

const NAME = 'verify-features';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  const main = H.makeWin(suite);
  try {
    await H.loadPage(main);
    await H.bootWait(main);
    /* 示例数据在「今天」可能已带打卡/心情值，先清空今天的 day 记录，保证用例从干净状态起测 */
    await H.evalJson(main, 'localStorage.setItem("hb_admin_mode","0");delete data.days[todayStr()];save();return true');

    /* —— bool：完成 → 取消被闸拦截 → 管理员放行 —— */
    let r = await H.evalJson(main, 'toggleBool("early",null);save();return {v:!!((data.days[todayStr()]||{}).early)}');
    suite.ok(r.v === true, 'bool 打卡完成（early）');
    await H.evalJson(main, 'toggleBool("early",null);return true');   /* admin 关：adminGate 弹窗拦截 */
    r = await H.evalJson(main, 'return {mask:document.getElementById("confirmMask").classList.contains("show"),v:!!((data.days[todayStr()]||{}).early)}');
    suite.ok(r.mask === true && r.v === true, '管理员关闭：取消打卡被拦截（弹窗出现+值不变）');
    await H.closeMask(main);
    await H.evalJson(main, 'localStorage.setItem("hb_admin_mode","1");toggleBool("early",null);save();return true');
    r = await H.evalJson(main, 'return {v:!!((data.days[todayStr()]||{}).early)}');
    suite.ok(r.v === false, '管理员开启：取消打卡放行（true→false）');

    /* —— count：累加钳制 / 清零闸 ——（先把 bool 段开着的管理员复位，才能测到闸） */
    await H.evalJson(main, 'localStorage.setItem("hb_admin_mode","0");return true');
    r = await H.evalJson(main, 'addCount("water",8,null);addCount("water",1,null);save();return {v:(data.days[todayStr()]||{}).water}');
    suite.ok(r.v === 8, 'count 累加并钳制到 target=8（实际 ' + r.v + '）');
    await H.evalJson(main, 'setCount("water",7,null);return true');   /* 点当前格=清零，需过闸 */
    r = await H.evalJson(main, 'return {mask:document.getElementById("confirmMask").classList.contains("show"),v:(data.days[todayStr()]||{}).water}');
    suite.ok(r.mask === true && r.v === 8, 'count 清零被闸拦截（值保持 8）');
    await H.closeMask(main);
    await H.evalJson(main, 'localStorage.setItem("hb_admin_mode","1");setCount("water",7,null);save();return true');
    r = await H.evalJson(main, 'return {v:(data.days[todayStr()]||{}).water}');
    suite.ok(r.v === 0, 'count 清零管理员放行（8→0）');
    await H.evalJson(main, 'localStorage.setItem("hb_admin_mode","0");return true');

    /* —— range：起止时间 → 时长 —— */
    r = await H.evalJson(main, 'setRange("sleep","s","23:00",null);setRange("sleep","e","07:00",null);save();return {v:(data.days[todayStr()]||{}).sleep}');
    suite.ok(r.v === 8, 'range 打卡：23:00-07:00 → 8 小时（实际 ' + r.v + '）');

    /* —— hours：手动补录 + 往期只读守卫 —— */
    r = await H.evalJson(main, 'addHoursManually("reading",0.5,null);save();return {v:(data.days[todayStr()]||{}).reading}');
    suite.ok(r.v === 0.5, 'hours 手动补录 +0.5h');
    r = await H.evalJson(main, 'var t=viewDate;viewDate="2020-01-01";addHoursManually("reading",1,null);var blocked=!((data.days["2020-01-01"]||{}).reading);viewDate=t;return {blocked:blocked}');
    suite.ok(r.blocked === true, 'hours 往期只读守卫（2020-01-01 未写入）');

    /* —— mood：设置 / 再点取消 —— */
    r = await H.evalJson(main, 'setMood("happy",null);save();return {m:(data.days[todayStr()]||{}).mood}');
    suite.ok(r.m === 'happy', '心情写入 happy');
    r = await H.evalJson(main, 'setMood("happy",null);save();return {m:(data.days[todayStr()]||{}).mood||null}');
    suite.ok(!r.m, '再点同一心情 = 取消');
    await H.drainPageErrs(main, suite);

    /* —— 奖励全链路：配置 → 完成 → 弹窗 → 领取落 meta —— */
    await H.evalJson(main, 'data.habits=data.habits.filter(function(h){return h.key!=="rwd"});data.habits.push({key:"rwd",name:"奖励测试",icon:"🎁",type:"bool",color:"#7FA0B4",size:"wide",reward:{text:"休息5分钟",per:"check",minutes:5}});syncHabits();save();return true');
    r = await H.evalJson(main, 'toggleBool("rwd",null);save();return {shown:!!(rwMask()&&!rwMask().hidden)}');
    suite.ok(r.shown === true, '配置奖励的习惯完成 → 奖励弹窗出现');
    r = await H.evalJson(main, 'claimReward({clientX:10,clientY:10,stopPropagation:function(){},target:document.body},"rwd");return {state:!!(data.meta.rewardRun||(data.meta.rewardLedger&&Object.keys(data.meta.rewardLedger).length)||(data.meta.rewardQueue&&data.meta.rewardQueue.length))}');
    suite.ok(r.state === true, '领取奖励 → 奖励状态落 meta（rewardRun/Ledger/Queue 任一）');
    await H.drainPageErrs(main, suite);

    /* —— IPC 通道面：preload 暴露的每个通道在 main.js 都有真实注册 ——
       r19：原判据是 mainSrc.indexOf("'"+c+"'") >= 0（源码里出现过这个字符串就算落地），
       通道名只出现在注释/被注释掉的代码/其它字符串里时同样通过 → 假绿。改为匹配真实注册点
       ipcMain.handle('x' / ipcMain.on('x'，并用 ^[ \t]* + m 锚定到行首，使「被 // 或块注释
       包住的注册」也算缺失（实测：任务给定无锚定正则仍会漏掉被注释掉的注册，见报告）。
       （hb-data:* / hb-config:* 由 store.js:registerIpc 用局部别名 ipc 注册，不在 main.js；
       本正则 [\w-]+ 不含冒号，故 chans 恰为 main.js 这 20 条。） */
    const mainSrc = H.checkMainJsSyntax(suite);
    const preSrc = fs.readFileSync(path.join(H.ROOT, 'preload.js'), 'utf8');
    const chans = [];
    let m;
    const re = /ipcRenderer\.(?:invoke|send)\('([\w-]+)'/g;
    while ((m = re.exec(preSrc))) chans.push(m[1]);
    const missing = chans.filter(c => !new RegExp("^[ \\t]*ipcMain\\.(?:handle|on)\\(\\s*'" + c + "'", 'm').test(mainSrc));
    suite.ok(chans.length >= 15 && missing.length === 0,
      'IPC 通道面完整：preload ' + chans.length + ' 通道全部在 main.js 注册' + (missing.length ? '（缺: ' + missing.join(',') + '）' : ''));
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { main.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
