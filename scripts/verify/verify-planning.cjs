'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const R=require('../../habit-rules');
const {createReminders}=require('../../reminders');
const steps=[];
function check(label,fn){fn();steps.push(label);console.log('PASS '+label);}
const h={key:'h',type:'bool',createdAt:'2026-10-01'};
check('calendar rejects impossible dates and shifts month boundaries',()=>{assert(!R.validDate('2026-02-30'));assert.equal(R.shift('2026-10-01',-1),'2026-09-30');});
check('legacy habits remain daily',()=>assert.equal(R.stats(h,'2026-10-05','2026-10-11',{}).expected,7));
const weekdays={...h,scheduleHistory:[{from:'2026-10-05',rule:{mode:'weekdays',days:[1,3,5]}}]};
check('schedule changes do not reinterpret preceding dates',()=>{assert(R.eligible(weekdays,'2026-10-04'));assert(!R.eligible(weekdays,'2026-10-06'));assert.equal(R.stats(weekdays,'2026-10-05','2026-10-11',{}).expected,3);});
const paused={...weekdays,pauseRanges:[{from:'2026-10-07',to:'2026-10-09',kind:'leave'}]};
check('leave excludes obligations and preserves a scheduled streak',()=>{const s=R.stats(paused,'2026-10-05','2026-10-12',{'2026-10-05':{h:true},'2026-10-12':{h:true}});assert.equal(s.expected,2);assert.equal(s.done,2);assert.equal(R.streak(paused,'2026-10-05','2026-10-12',{'2026-10-05':{h:true},'2026-10-12':{h:true}},false),2);});
const weekly={...h,schedule:{mode:'weekly',times:3}},days={'2026-10-05':{h:true},'2026-10-07':{h:true},'2026-10-09':{h:true}};
check('weekly quota counts distinct completed days and stops new obligations',()=>{assert.equal(R.stats(weekly,'2026-10-05','2026-10-11',days).done,3);assert(!R.due(weekly,'2026-10-10',days));assert(R.due(weekly,'2026-10-09',days));});
check('unfinished current week does not break achieved weeks',()=>assert.equal(R.streak(weekly,'2026-10-05','2026-10-14',days,false),1));
check('one Monday check-in does not complete a three-times weekly streak',()=>{const d={...days,'2026-10-12':{h:true}};assert.equal(R.streak(weekly,'2026-10-05','2026-10-12',d,false,true),1);assert.equal(R.streak(weekly,'2026-10-05','2026-10-12',d,true,true),1);});
check('missed closed week breaks the streak',()=>assert.equal(R.streak(weekly,'2026-10-05','2026-10-20',days,false),0));
check('partial periods cap quotas to available days',()=>assert.equal(R.stats({...weekly,schedule:{mode:'weekly',times:5}},'2026-10-10','2026-10-11',{}).expected,2));
check('archiving stops future obligations without removing history',()=>assert.equal(R.stats({...h,archivedAt:'2026-10-08'},'2026-10-05','2026-10-11',{}).expected,3));
const reminder=createReminders({getDoc:()=>null,stateFile:path.join(__dirname,'profiles','planning-reminders.json')});
check('reminders exclude leave, rest days and completed weekly quotas',()=>{
 const habits=[{...paused,remindAt:'08:00'},{...weekly,key:'w',remindAt:'08:00'}];
 const doc={habits,settings:{remind:true},days:{'2026-10-05':{w:true},'2026-10-06':{w:true},'2026-10-07':{w:true}}};
 const due=reminder.computeDue(doc,{},new Date('2026-10-07T20:00:00'));assert.equal(due.undone,0);assert.equal(due.perHabits.length,0);
});
const out=path.join(__dirname,'results');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verify-planning-result.json'),JSON.stringify({ok:true,steps,errs:[],ts:new Date().toISOString()},null,2));
