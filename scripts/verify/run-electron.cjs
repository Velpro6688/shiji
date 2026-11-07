'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const [, , scriptArg, reportArg, ...scriptArgs] = process.argv;

if (!scriptArg) {
  console.error('用法: node scripts/verify/run-electron.cjs <suite.cjs> [report.json]');
  process.exit(2);
}

const script = path.resolve(ROOT, scriptArg);
const rel = path.relative(ROOT, script);
if (!rel || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || !fs.existsSync(script)) {
  console.error('Electron suite 必须是项目内存在的文件: ' + scriptArg);
  process.exit(2);
}
if (!fs.existsSync(ELECTRON)) {
  console.error('Electron executable not found: ' + ELECTRON);
  process.exit(2);
}

const reportName = reportArg || path.basename(script, path.extname(script)) + '-result.json';
const report = path.resolve(ROOT, 'scripts', 'verify', 'results', reportName);
const reportRel = path.relative(path.join(ROOT, 'scripts', 'verify', 'results'), report);
if (reportRel.startsWith('..' + path.sep) || path.isAbsolute(reportRel)) {
  console.error('Result report must stay in scripts/verify/results.');
  process.exit(2);
}

const startTime = Date.now();
const mainSource = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const expectedBuild = (mainSource.match(/APP_BUILD\s*=\s*'([^']+)'/) || [])[1] || '';
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(ELECTRON, [script, ...scriptArgs], { cwd: ROOT, env, stdio: 'inherit', windowsHide: true });
let timedOut = false;
const timer = setTimeout(() => {
  timedOut = true;
  console.error('Electron suite exceeded 180 seconds; terminating it.');
  try { child.kill(); } catch (_) {}
}, 180000);

child.on('error', error => {
  clearTimeout(timer);
  console.error('Unable to start Electron suite: ' + error.message);
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
  clearTimeout(timer);
  if (timedOut) { process.exitCode = 124; return; }
  if (code !== 0) {
    console.error('Electron suite exited with code=' + code + ' signal=' + signal);
    process.exitCode = code || 1;
  }
  let result;
  try {
    const stat = fs.statSync(report);
    if (stat.mtimeMs < startTime - 1000) throw new Error('result report is stale');
    result = JSON.parse(fs.readFileSync(report, 'utf8'));
    if (!result.ts || Date.parse(result.ts) < startTime - 2000) throw new Error('result report timestamp is stale');
    if (!expectedBuild || !result.metrics || result.metrics.build !== expectedBuild) {
      throw new Error('result build does not match current source (' + (result.metrics && result.metrics.build || 'missing') + ' != ' + (expectedBuild || 'missing') + ')');
    }
  } catch (error) {
    console.error('Electron suite did not write a fresh result report: ' + error.message);
    process.exitCode = 1;
    return;
  }
  console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + ' errors=' + ((result.errs || []).length) + ' report=' + path.relative(ROOT, report));
  if (!result.ok) process.exitCode = 1;
});
