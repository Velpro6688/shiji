'use strict';
/* verify-startup-decide —— 开机自启 heal 判定的纯函数单测（普通 node，不启动 Electron）
   为什么不直接在真机上跑 heal：heal 会写 HKCU\Software\Microsoft\Windows\CurrentVersion\Run，
   在开发态（electron .）下 startupPath 是 node_modules\electron\dist\electron.exe，
   一旦写进去就等于把用户的开机自启静默改坏。所以判定逻辑抽成纯函数在这里测，
   main.js 侧另有一道 devStartupBlocked 护栏（见 verify-startup-decide 最后一组断言）。 */
const path = require('path');
const fs = require('fs');
const { normExe, sameExePath, decideStartupWrite, decideWantEnabled, isEphemeralExe } = require(path.join(__dirname, '..', '..', 'startup-decide.js'));

const errs = [], steps = [];
function ok(cond, msg) { (cond ? steps : errs).push((cond ? 'ok: ' : '断言失败: ') + msg); }

/* —— 路径归一：注册表存的是带引号的路径 —— */
const P = 'C:\\Users\\X\\AppData\\Local\\Programs\\时迹\\时迹.exe';
ok(normExe('"' + P + '"') === P.toLowerCase(), '带引号的注册表值能剥掉引号');
ok(sameExePath('"' + P + '"', P), 'sameExePath("C:\\...exe") == 未加引号的同一路径（否则会每次启动都重写注册表）');
ok(sameExePath('"c:\\users\\x\\a\\时迹.exe"', 'C:\\Users\\X\\A\\时迹.EXE'), '大小写不敏感');
ok(sameExePath('C:/Users/X/A/时迹.exe', 'C:\\Users\\X\\A\\时迹.exe'), '正斜杠与反斜杠等价');
ok(!sameExePath('', P), '空值判不等（缺值要走补写分支）');
ok(!sameExePath('"C:\\旧版\\HabitLab\\养成实验室.exe"', P), '指向旧安装路径判不等（正是要修的情形）');
ok(!sameExePath('"C:\\...\\electron.exe"', P) === true, '指向 electron.exe 判不等');

/* —— 该不该写 —— */
ok(decideStartupWrite({ wantEnabled: false, inRegistry: true, pathMatches: false }).write === false,
  '用户没开自启：即使值指向别处也不写（不能替用户打开自启）');
const missing = decideStartupWrite({ wantEnabled: true, inRegistry: false, pathMatches: false });
ok(missing.write === true && missing.reason === 'missing', '说开了但注册表没值 → 补写（reason=missing）');
const stale = decideStartupWrite({ wantEnabled: true, inRegistry: true, pathMatches: false });
ok(stale.write === true && stale.reason === 'stale-path', '值指向旧 exe → 改写为当前程序（reason=stale-path）');
const good = decideStartupWrite({ wantEnabled: true, inRegistry: true, pathMatches: true });
ok(good.write === false && good.reason === 'ok', '值存在且指向当前程序 → 不动（幂等，不每启动重写一遍）');

/* —— wantEnabled 取法与 main.js 原实现逐字等价 —— */
[[undefined, false, false], [undefined, true, true], [true, false, true], [false, true, true], [false, false, false]]
  .forEach(function (t) {
    const got = decideWantEnabled(t[0], t[1]);
    const legacy = (!!t[0]) || !!t[1];
    ok(got === legacy, 'decideWantEnabled(marker=' + t[0] + ', inRegistry=' + t[1] + ') 与旧写法一致 → ' + got);
  });

/* —— 临时位置判定：安装包端到端验证会装到 %TEMP%\shiji-verify 并在那里启动一次 —— */
const ENV = { TEMP: 'C:\\Users\\ExampleUser\\AppData\\Local\\Temp', TMP: 'C:\\Users\\ExampleUser\\AppData\\Local\\Temp', LOCALAPPDATA: 'C:\\Users\\ExampleUser\\AppData\\Local' };
ok(isEphemeralExe('C:\\Users\\ExampleUser\\AppData\\Local\\Temp\\shiji-verify\\时迹.exe', ENV) === true, '临时目录里的实例判为 ephemeral');
ok(isEphemeralExe('"C:\\Users\\ExampleUser\\AppData\\Local\\Temp\\shiji-verify\\时迹.exe"', ENV) === true, '带引号的临时路径同样判得出来（注册表值就是带引号的）');
ok(isEphemeralExe('C:\\Users\\ExampleUser\\Desktop\\时迹\\node_modules\\electron\\dist\\electron.exe', ENV) === true, '开发态 electron.exe 判 ephemeral');
ok(isEphemeralExe('C:\\Users\\ExampleUser\\AppData\\Local\\Programs\\时迹\\时迹.exe', ENV) === false, '正常安装路径不算临时');
ok(isEphemeralExe('D:\\时迹\\时迹-便携版-2.3.1.exe', ENV) === false, '用户自己放的便携包不算临时（确实可以登记自启）');
ok(isEphemeralExe('', ENV) === false, '空路径不作 ephemeral 判断（交给 missing 分支）');
const eph = decideStartupWrite({ wantEnabled: true, inRegistry: true, pathMatches: false, ephemeral: true });
ok(eph.write === false && eph.reason === 'ephemeral', '临时实例即使路径不一致也不写注册表（否则自启指向将被删除的临时目录）');
const normal = decideStartupWrite({ wantEnabled: true, inRegistry: true, pathMatches: false, ephemeral: false });
ok(normal.write === true && normal.reason === 'stale-path', '非临时实例仍会修 stale-path（护栏没有把主功能一起关掉）');

/* —— main.js 侧护栏：开发态绝不写注册表 —— */
const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
ok(/function devStartupBlocked\(\)\s*\{[\s\S]{0,120}!app\.isPackaged[\s\S]{0,120}PORTABLE_EXECUTABLE_FILE/.test(mainSrc),
  'devStartupBlocked 以「未打包且未显式声明便携运行」为准');
ok(/adoptStartupState\(\)\s*\{[\s\S]{0,160}devStartupBlocked\(\)/.test(mainSrc), 'adoptStartupState 已挂开发态护栏（不再把 electron.exe 记成基准）');
ok(/healStartupPaths\(\)\s*\{[\s\S]{0,200}devStartupBlocked\(\)/.test(mainSrc), 'healStartupPaths 已挂开发态护栏（npm start 不会重写自启项）');
ok(/require\('\.\/startup-decide\.js'\)/.test(mainSrc), 'main.js 确实引用了 startup-decide.js');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
ok(pkg.build.files.indexOf('startup-decide.js') >= 0, 'startup-decide.js 已进打包白名单（漏了会让 asar 里 require 直接失败）');

fs.mkdirSync(path.join(__dirname, 'results'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'results', 'verify-startup-decide-result.json'), JSON.stringify({
  name: 'verify-startup-decide', ok: errs.length === 0, errs: errs, steps: steps,
  metrics: { build: (mainSrc.match(/APP_BUILD\s*=\s*'([^']+)'/) || [])[1] || '', node: true }, ts: new Date().toISOString()
}, null, 2), 'utf8');
console.log((errs.length ? 'FAIL ' : 'PASS ') + 'verify-startup-decide errs=' + errs.length + ' steps=' + steps.length);
errs.forEach(function (e) { console.log('  ' + e); });
process.exit(errs.length ? 1 : 0);
