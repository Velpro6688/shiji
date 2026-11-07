#!/usr/bin/env node
/**
 * check-inline-js.cjs —— HTML 内联脚本 + 独立 JS 文件的语法校验器
 *
 * 背景：Electron 渲染进程的 SyntaxError 只会以 "Uncaught SyntaxError: Unexpected token ':'"
 * 吐进 app.log，没有行列号。本工具把每个 <script> 块抽出来用 V8 编译，拿到精确的行:列，
 * 再换算回 HTML 的真实行号。
 *
 * 关键点（踩过的坑）：
 *  1) 不要用 /<script[^>]*>([\s\S]*?)<\/script>/ 这种非贪婪正则 —— HTML 里可能出现
 *     JS 字符串/注释中的 "<script>" 字面量（例如导出独立 HTML 的模板），会让块数错乱。
 *     正确做法：先 /<script\b[^>]*>/g 找开标签，再用 indexOf('</script>') 找配对（浏览器就是这样解析的）。
 *  2) 不要用 new Function(code) —— 它不给行列号，且语义是函数体而非脚本。
 *     用 new vm.Script(code,{filename}) ：V8 的报错栈首行就是 "文件:行号" + 源码行 + 插入符。
 *  3) 不要 spawn 子进程跑 node --check —— 沙箱里 spawn 同一个 node.exe 会 EBUSY（且 NODE_OPTIONS 被注入 shim）。
 *     进程内 vm.Script 既快又稳。
 *
 * 用法：
 *   node scripts/verify/check-inline-js.cjs                  # 默认校验 habit.html + 主进程 js
 *   node scripts/verify/check-inline-js.cjs <file...>        # 指定文件（.html 走内联块解析，.js 整体校验）
 *
 * 退出码：0 = 全部通过；1 = 存在语法错误。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** 按 HTML 语义切出所有内联 <script> 块（跳过带 src 的外链块） */
function collectInlineBlocks(html) {
  const toLine = lineIndex(html);
  const blocks = [];
  const openRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = openRe.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;              // 外链脚本，跳过
    const bodyStart = m.index + m[0].length;
    const endIdx = html.indexOf('</script>', bodyStart);
    if (endIdx < 0) {
      blocks.push({ bodyStart, bodyEnd: html.length, startLine: toLine(bodyStart), endLine: null });
      break;
    }
    blocks.push({
      bodyStart, bodyEnd: endIdx,
      startLine: toLine(bodyStart),
      endLine: toLine(endIdx)
    });
    openRe.lastIndex = endIdx + '</script>'.length;
  }
  return blocks;
}

/**
 * 用 V8 编译一段代码，返回 { ok, line, col, msg, snippet }
 * 无行列信息时 line/col 为 0。
 */
function compileCheck(code, filename) {
  try {
    new vm.Script(code, { filename });          // 只编译不执行
    return { ok: true };
  } catch (e) {
    const stack = String(e.stack || '');
    const lines = stack.split(/\r?\n/);
    // 栈首行形如： filename:LINE
    let line = 0, col = 0;
    const head = lines[0] || '';
    const loc = head.lastIndexOf(':');
    if (loc > 0 && /^\d+$/.test(head.slice(loc + 1).trim())) {
      line = parseInt(head.slice(loc + 1).trim(), 10);
    }
    // 紧随其后的 caret 行给出列号
    const caretIdx = lines.findIndex((l, i) => i > 0 && /^\s*\^\s*$/.test(l));
    if (caretIdx > 0) col = lines[caretIdx].indexOf('^') + 1;
    const snippet = line ? lines.slice(0, caretIdx > 0 ? caretIdx + 1 : 3).join('\n') : '';
    return { ok: false, line, col, msg: (e.name || 'SyntaxError') + ': ' + e.message, snippet };
  }
}

function checkHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  const blocks = collectInlineBlocks(html);
  const rel = path.relative(ROOT, file) || file;
  console.log('\n=== ' + rel + '  (' + html.length + ' 字符, ' + blocks.length + ' 个内联 script 块) ===');
  let bad = 0;
  blocks.forEach((b, i) => {
    const code = html.slice(b.bodyStart, b.bodyEnd);
    const r = compileCheck(code, 'block' + (i + 1) + '.js');
    const head = '  块#' + (i + 1) + '  html 行 ' + b.startLine + '~' + (b.endLine || '?') + '  (' + code.length + ' 字符)';
    if (r.ok) {
      console.log(head + '  [OK]');
    } else {
      bad++;
      const htmlLine = r.line ? b.startLine + (r.line - 1) : b.startLine;
      console.log(head + '  [错误] ' + r.msg);
      console.log('     js 第 ' + r.line + ' 行 / 第 ' + r.col + ' 列  =>  html 第 ' + htmlLine + ' 行');
      if (r.snippet) r.snippet.split(/\r?\n/).forEach(l => console.log('     | ' + l));
    }
  });
  return bad;
}

function checkJs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file) || file;
  const r = compileCheck(src, path.basename(file));
  if (r.ok) { console.log('\n=== ' + rel + '  [OK]'); return 0; }
  console.log('\n=== ' + rel + '  [错误] ' + r.msg);
  console.log('     第 ' + r.line + ' 行 / 第 ' + r.col + ' 列');
  if (r.snippet) r.snippet.split(/\r?\n/).forEach(l => console.log('     | ' + l));
  return 1;
}

// ---- main ----
const args = process.argv.slice(2);
let targets;
if (args.length) {
  targets = [];
  for (const a of args) {
    const abs = path.isAbsolute(a) ? a : path.resolve(process.cwd(), a);
    /* 目录参数展开为目录下全部 .js（js/ 渲染层模块目录，P2-A 起） */
    try {
      if (fs.statSync(abs).isDirectory()) {
        for (const f of fs.readdirSync(abs).sort()) if (/\.js$/i.test(f)) targets.push(path.join(abs, f));
        continue;
      }
    } catch (_) {}
    targets.push(abs);
  }
} else {
  targets = ['habit.html', 'main.js', 'preload.js', 'store.js', 'reminders.js']
    .map(f => path.join(ROOT, f))
    .filter(f => fs.existsSync(f));
}

let bad = 0;
for (const t of targets) {
  if (/\.html?$/i.test(t)) bad += checkHtml(t);
  else bad += checkJs(t);
}

console.log('\n----------------------------------------');
console.log(bad === 0 ? '[PASS] 全部通过，未发现语法错误' : '[FAIL] 共发现 ' + bad + ' 处语法错误');
process.exit(bad === 0 ? 0 : 1);
