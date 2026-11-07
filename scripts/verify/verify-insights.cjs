'use strict';
const {app}=require('electron');
const fs=require('fs'),path=require('path'),H=require('./_harness');
const suite=H.makeSuite('verify-insights');H.globalKillSwitch(suite.name,suite);H.initProfile(suite.name);H.stubIpc(suite.calls);
app.whenReady().then(async()=>{
 const win=H.makeWin(suite,{width:520,height:1200,frame:false});
 const out=path.join(H.ROOT,'artifacts/ui-'+require('../../package.json').version);fs.mkdirSync(out,{recursive:true});
 try{
  await H.loadPage(win);await H.bootWait(win);win.showInactive();await H.sleep(2200);
  await H.evalJson(win,'var g=document.getElementById("guideSkip");if(g)g.click();hideConfirm();data.settings.sound=false;data.habits=[{key:"learn",name:"学习",icon:"📖"},{key:"water",name:"喝水",icon:"💧"},{key:"sleep",name:"按时睡觉",icon:"😴"},{key:"meditate",name:"冥想",icon:"🧘"},{key:"early",name:"早起",icon:"🌅"},{key:"sport",name:"运动",icon:"🏃"}].map(h=>({...h,type:"bool",color:"#0071e3",createdAt:daysAgoStr(13)}));data.days={};data.meta={};syncHabits();var amounts=[0,3,5,4,4,4];HABITS.forEach((h,i)=>{for(var n=0;n<amounts[i];n++){var ds=daysAgoStr(n);if(!data.days[ds])data.days[ds]={};data.days[ds][h.key]=true;}});insightMode="month";statSelectedMonth=todayStr().slice(0,7);go("stat");renderStat();return true');
  for(const width of [320,365,520,1200]){
   await H.resizeWindow(win,width,1200);
   for(const theme of ['light','dark']){
    await H.evalJson(win,'data.settings.theme='+JSON.stringify(theme)+';applyTheme();renderInsights();return true');await H.sleep(100);
    const v=await H.evalJson(win,'var host=document.getElementById("insightReport"),rows=insightRows(insightRange(insightMode,false)),total=insightTotals(rows),ring=host.querySelector(".insight-ring"),bars=[...host.querySelectorAll(".insight-progress")];return {fits:host.scrollWidth<=host.clientWidth+1&&[...host.querySelectorAll("*")].every(n=>n.getBoundingClientRect().right<=innerWidth+1),square:Math.abs(ring.offsetWidth-ring.offsetHeight)<1,total:total.rate,ring:Number(host.querySelector(".insight-ring-fill").getAttribute("stroke-dasharray").split(" ")[0]),rates:bars.map(n=>Number(n.getAttribute("aria-valuenow"))),expected:rows.map(r=>r.rate),widths:bars.map(n=>n.firstChild.getBoundingClientRect().width/Math.max(1,n.getBoundingClientRect().width)*100)}');
    suite.ok(v.fits&&v.square,width+'/'+theme+' report fits and donut is circular');
    suite.ok(v.ring===v.total&&JSON.stringify(v.rates)===JSON.stringify(v.expected)&&v.widths.every((n,i)=>Math.abs(n-v.rates[i])<1),width+'/'+theme+' visual progress matches calendar totals');
    fs.writeFileSync(path.join(out,'review-'+width+'-'+theme+'.png'),await H.capturePng(win));
   }
  }
  let v=await H.evalJson(win,'document.querySelector(".insight-habit").click();return document.getElementById("insightDatesTitle").textContent.includes("学习")&&document.querySelectorAll("#insightDateList button").length>0');suite.ok(v,'habit card opens actual period records');
  v=await H.evalJson(win,'document.querySelector("#insightDateList button").click();return document.getElementById("page-today").classList.contains("active")');suite.ok(v,'period record navigates to the daily page');
  v=await H.evalJson(win,'go("stat");data.days={};renderInsights();return document.querySelector(".insight-ring-fill").getAttribute("stroke-dasharray")==="0 100"&&document.querySelector(".insight-highlights").textContent.includes("等待首次完成")');suite.ok(v,'zero completions render zero progress without praising an uncompleted habit');
  v=await H.evalJson(win,'data.habits=[];syncHabits();renderInsights();return document.querySelector(".insight-empty").textContent.includes("暂无执行计划")&&document.querySelector(".insight-ring strong").textContent==="—"');suite.ok(v,'no plans display distinct empty state');
  for(const width of [320,1200,320,520,320]){
  await H.resizeWindow(win,width,1200);
  v=await H.evalJson(win,'data.habits=[{key:"full",name:"已完成的长名称习惯用于检查文字自动换行与布局",icon:"✓",type:"bool",createdAt:todayStr()}];syncHabits();data.days[todayStr()]={full:true};renderInsights();return {ring:document.querySelector(".insight-ring-fill").getAttribute("stroke-dasharray"),completed:document.querySelector(".insight-highlights").textContent.includes("计划全部完成"),scroll:document.getElementById("insightReport").scrollWidth,client:document.getElementById("insightReport").clientWidth}');suite.ok(v.ring==='100 100'&&v.completed&&v.scroll<=v.client+1,width+' completed plan after resize '+JSON.stringify(v));
  }
  await H.drainPageErrs(win,suite);
 }catch(e){suite.errs.push(e.stack);}finally{win.destroy();H.finish(suite);app.exit(suite.errs.length?1:0);}
});
