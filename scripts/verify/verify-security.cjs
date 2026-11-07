/* verify-security —— XSS/注入防护（沿用原套件 4 步口径并扩展）：
   sanitizeMemoHtml 直接断言（script 摘除 / on* 摘除 / src 白名单 / style 黑名单 / 长度上限）
   + DOM 级（习惯名转义 / 便签正文不执行脚本）+ 导入清洗剥离非安全值 + main.js 语法 */
'use strict';
const { app } = require('electron');
const H = require('./_harness.js');

const NAME = 'verify-security';
const suite = H.makeSuite(NAME);
H.globalKillSwitch(NAME, suite);
H.initProfile(NAME);
H.stubIpc(suite.calls);

app.whenReady().then(async () => {
  const win = H.makeWin(suite);
  try {
    await H.loadPage(win);
    await H.bootWait(win);

    /* —— 1. sanitizeMemoHtml：<script> 整块摘除 —— */
    let r = await H.evalJson(win, 'var out=sanitizeMemoHtml("<script>window.__sx=1<\\/script><p>正文</p>");return {noScript:out.indexOf("<script")<0&&out.indexOf("__sx")<0,keepP:out.indexOf("<p>")>=0}');
    suite.ok(r.noScript === true, 'sanitize：script 标签整块摘除');
    suite.ok(r.keepP === true, 'sanitize：白名单标签 p 保留');

    /* —— 2. on* 事件属性全清 —— */
    r = await H.evalJson(win, 'var out=sanitizeMemoHtml("<p onclick=\\"window.__sx=1\\" onmouseover=\\"x()\\">a</p><img src=\\"x\\" onerror=\\"y()\\">");return {noOn:out.indexOf("onclick")<0&&out.indexOf("onmouseover")<0&&out.indexOf("onerror")<0}');
    suite.ok(r.noOn === true, 'sanitize：onclick/onmouseover/onerror 全部摘除');

    /* —— 3. src 白名单：javascript: 拒绝，data:image / https 放行 —— */
    r = await H.evalJson(win, 'var out=sanitizeMemoHtml("<img src=\\"javascript:alert(1)\\"><img src=\\"data:image/png;base64,iVBOR\\"><img src=\\"https://e.com/a.png\\">");return {noJs:out.indexOf("javascript:")<0,hasData:out.indexOf("data:image/png;base64,iVBOR")>=0,hasHttps:out.indexOf("https://e.com/a.png")>=0}');
    suite.ok(r.noJs === true, 'sanitize：javascript: src 被拒');
    suite.ok(r.hasData === true && r.hasHttps === true, 'sanitize：data:image 与 https src 放行');

    /* —— 4. style 黑名单过滤（position:fixed 等危险样式）—— */
    r = await H.evalJson(win, 'var out=sanitizeMemoHtml("<p style=\\"position:fixed;top:0;color:red\\">a</p>");return {noFixed:out.indexOf("position:fixed")<0,keepColor:out.indexOf("color")>=0}');
    suite.ok(r.noFixed === true, 'sanitize：style 黑名单（position:fixed）被滤除');
    suite.ok(r.keepColor === true, 'sanitize：无害样式保留');

    /* —— 5. 长度上限 2MB —— */
    r = await H.evalJson(win, 'var big="<p>"+new Array(2.5*1024*1024+1).join("A")+"</p>";var out=sanitizeMemoHtml(big);return {len:out.length}');
    suite.ok(r.len <= 2 * 1024 * 1024 + 64, 'sanitize：超 2MB 输入被截到上限（len=' + r.len + '）');

    /* —— 6. DOM 级：习惯名 <img onmouseover> + <script> → 仅作纯文本渲染 ——
       r24：改为「全量渲染 + 直接断言 xss1 卡片自身文本」的自包含口径。
       原口径查 body 文本是否含「早起」，有两个漏洞：①样例数据的同名习惯会让它假通过；
       ②开局无样例（存档残留 / 沙箱环境下清档受限）时假失败。断言目标本来就是
       「这张卡把 XSS 载荷转义成了可读文本」。 */
    await H.evalJson(win, 'data.habits.push({key:"xss1",name:"<img src=x onmouseover=\\"window.__pwn=1\\"><scr"+"ipt>window.__pwn=1<\\/script>早起",icon:"🌅",type:"bool",color:"#D69B72",size:"wide"});syncHabits();save();renderAll();return true');
    r = await H.evalJson(win, 'var card=document.querySelector("#checkinList .hcard[data-habit-key=\\"xss1\\"]");var txt=card?card.textContent:"";return {pwn:!!window.__pwn,imgInj:!!document.querySelector("img[onmouseover]"),cardShown:!!card,textEscaped:txt.indexOf("<img src=x")>=0&&txt.indexOf("早起")>=0}');
    suite.ok(r.pwn === false && r.imgInj === false, '习惯名含 XSS 载荷：DOM 无 img[onmouseover]、脚本未执行（pwn=0）');
    suite.ok(r.cardShown === true && r.textEscaped === true, 'XSS 载荷被转义为可读文本（xss1 卡片以纯文本呈现载荷）');

    /* —— 7. DOM 级：便签正文带 script 不执行 —— */
    await H.evalJson(win, 'data.memoNotes=[{id:"nx",ts:Date.now(),html:"<scr"+"ipt>window.__mp=1<\\/script><p>安全正文</p>",text:"安全正文",title:""}];data.memo=data.memoNotes[0];renderMemoList();return true');
    r = await H.evalJson(win, 'return {mp:!!window.__mp,body:document.body.textContent.indexOf("安全正文")>=0}');
    suite.ok(r.mp === false, '便签正文 script 未执行（__mp=0）');
    suite.ok(r.body === true, '便签正文以纯文本安全呈现');
    await H.drainPageErrs(win, suite);

    /* —— 8. 导入清洗：透传白名单键保留 / 非常规键剥离 / 超深值按深度上限截断 —— */
    r = await H.evalJson(win, [
      'var env={schema:"habit-memo-shell",version:1,data:{days:{"2026-09-01":{water:2,mood:"happy"}},',
      'habits:[{key:"ok1",name:"正常",icon:"💧",type:"count",target:2,ok_ext:"keep","bad-key":"drop",deep:{a:{b:{c:{d:1}}}}}]}};',
      'var norm=normalizeImported(env);',
      'var h=norm.habits[0];',
      'return {ok:!!norm,keyOk:h.key==="ok1",extKept:h.ok_ext==="keep",badDropped:h["bad-key"]===undefined,deepTrimmed:!(h.deep&&h.deep.a&&h.deep.a.b&&h.deep.a.b.c&&h.deep.a.b.c.d)}'
    ].join(''));
    suite.ok(r.ok === true && r.keyOk === true && r.extKept === true && r.badDropped === true && r.deepTrimmed === true,
      '导入清洗：透传白名单键保留 / 非常规键剥离 / 超深值截断（ok=' + JSON.stringify(r) + '）');
    await H.drainPageErrs(win, suite);

    /* —— 9. main.js 语法编译（主进程源码完整性）—— */
    H.checkMainJsSyntax(suite);

    /* —— 10. r23 P3：CSP meta 存在且含关键指令 —— */
    const fs = require('fs'), path = require('path');
    const htmlSrc = fs.readFileSync(path.join(H.ROOT, 'habit.html'), 'utf8');
    suite.ok(/Content-Security-Policy/.test(htmlSrc) && /object-src 'none'/.test(htmlSrc) && /form-action 'none'/.test(htmlSrc) && /img-src 'self' hbimg: data: https:/.test(htmlSrc),
      'P3：CSP meta 存在（object-src/form-action 为 none；img-src 与 sanitize 口径一致放行 https 外链图）');

    /* —— 11. r23 P3：权限请求/检查一律拒绝 —— */
    const mainSrc = fs.readFileSync(path.join(H.ROOT, 'main.js'), 'utf8');
    suite.ok(/setPermissionRequestHandler\(function \(wc, perm, cb\) \{[^}]*cb\(false\)/.test(mainSrc.replace(/\s+/g, ' ')) && /setPermissionCheckHandler\(function \(\) \{ return false; \}\)/.test(mainSrc.replace(/\s+/g, ' ')),
      'P3：setPermissionRequestHandler/setPermissionCheckHandler 全拒已挂载');

    /* —— 12. r23 P3：openExternal 全部走 openExternalSafe 白名单收口 —— */
    const bareOpen = mainSrc.split('\n').filter(l => l.indexOf('shell.openExternal(') >= 0 && l.indexOf('openExternalSafe') < 0 && !/^\s*\/\//.test(l) && !/function openExternalSafe/.test(l) && !/shell\.openExternal\(String\(url\)\)/.test(l));
    suite.ok(bareOpen.length === 0 && /function openExternalSafe/.test(mainSrc) && /proto !== 'https:' && proto !== 'http:' && proto !== 'mailto:'/.test(mainSrc),
      'P3：openExternal 协议白名单收口（裸调用 ' + bareOpen.length + ' 处）');

    /* —— 13. r23 P3：habit.html 已无内联 <script>（CSP script-src 收紧前置）—— */
    const inlineScripts = htmlSrc.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || [];
    suite.ok(inlineScripts.length === 0, 'P3：habit.html 无内联 script 块（实得 ' + inlineScripts.length + '）');
  } catch (e) {
    suite.errs.push('套件异常: ' + String((e && e.message) || e).slice(0, 400));
  } finally {
    try { win.destroy(); } catch (_) {}
    H.finish(suite);
    app.exit(suite.errs.length ? 1 : 0);
  }
});
