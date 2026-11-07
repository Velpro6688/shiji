/* 独立便签编辑窗：首帧前打标记，编辑窗内不渲染主界面（防闪帧）。
   原内联在 <body> 标签后（P3 CSP 要求 script-src 无内联脚本，外置至此）。 */
try{if(/[?&]view=editor/.test(location.search))document.body.className+=" editor-window";}catch(_){}
