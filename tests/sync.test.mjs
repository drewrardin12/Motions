import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../app/sync.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {HouseholdSync, normalizeMotion, taskKey, taskIndex, visibleProgress} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const day='day:2026-10-09';
const motion=normalizeMotion({id:'morning',title:'Morning',tasks:['Same','Same'],label:'',time:'',image:'',accent:'#d6a443',message:'Done'});
const rhythm={id:'water',title:'Water',recurrence:'daily',category:'Personal',assignee:'Everyone',days:[],dayOfMonth:1,intervalDays:1,startDate:'2026-10-09'};
const clone=x=>structuredClone(x);
function fixture(){
  const data={motions:[clone(motion)],rhythms:[clone(rhythm)],progress:[]};
  const entries=new Map();const storage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v)};
  const api={motions:async()=>clone(data.motions),rhythms:async()=>clone(data.rhythms),progress:async keys=>clone(data.progress.filter(r=>keys.includes(r.period_key))),
    saveMotions:async(_,items)=>{data.motions=clone(items);return true},saveRhythms:async(_,items)=>{data.rhythms=clone(items);return true},
    setProgress:async(member,period,type,id,completed)=>{data.progress=data.progress.filter(r=>!(r.period_key===period&&r.item_type===type&&r.item_id===id));data.progress.push({period_key:period,item_type:type,item_id:id,completed,updated_by_name:member,updated_at:new Date().toISOString()});return true}};
  const make=(key='house-1',member='andrew')=>new HouseholdSync(api,storage,key,member,{motions:[clone(motion)],rhythms:[clone(rhythm)]});
  return {data,storage,api,make};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
test('legacy completion identity survives reorder, rename, duplicate titles and removal',()=>{
 const m={...motion,tasks:['Renamed','Same'],taskIds:['1','0']};
 assert.equal(taskKey(m,0),'morning:1');assert.equal(taskIndex(m,'morning:0'),1);
 assert.notEqual(taskKey(m,0),taskKey(m,1));
 assert.equal(taskIndex({...m,tasks:['Renamed'],taskIds:['1']},'morning:0'),-1);
});
test('failed writes survive polling, reload and reconnection',async()=>{
 const f=fixture(),s=f.make();await s.cycle([day]);
 f.api.setProgress=async()=>{throw new Error('network down')};
 s.complete(day,'motion','morning:0',true,'Andrew');await s.cycle([day]);
 assert.equal(s.status,'error');assert.equal(visibleProgress(s.snapshot,[day])[0].completed,true);
 const reloaded=f.make();assert.equal(reloaded.pending,true);
 f.api.setProgress=async(_,period,type,id,completed)=>{f.data.progress=[{period_key:period,item_type:type,item_id:id,completed,updated_at:'2026-10-09',updated_by_name:'Andrew'}];return true};
 await reloaded.cycle([day]);assert.equal(reloaded.status,'synced');assert.equal(reloaded.pending,false);
});
test('later toggle survives acknowledgement of an in-flight toggle',async()=>{
 const f=fixture(),s=f.make(),pause=deferred(),started=deferred(),save=f.api.setProgress;
 f.api.setProgress=async(...args)=>{started.resolve();await pause.promise;return save(...args)};
 s.complete(day,'motion','morning:0',true,'Andrew');const flight=s.cycle([day]);await started.promise;
 s.complete(day,'motion','morning:0',false,'Andrew');pause.resolve();await flight;
 assert.equal(s.pending,true);assert.equal(visibleProgress(s.snapshot,[day])[0].completed,false);
 f.api.setProgress=save;await s.cycle([day]);assert.equal(f.data.progress[0].completed,false);
});
test('later library edits survive delayed save and merge unrelated remote changes',async()=>{
 const f=fixture(),s=f.make(),pause=deferred(),started=deferred(),save=f.api.saveMotions;
 f.api.saveMotions=async(...args)=>{started.resolve();await pause.promise;return save(...args)};
 s.editMotions([{...motion,title:'First edit'}]);const flight=s.cycle([day]);await started.promise;
 s.editMotions([{...motion,title:'Second edit'}]);pause.resolve();await flight;
 assert.equal(s.snapshot.motions[0].title,'Second edit');assert.equal(s.pending,true);
 f.api.saveMotions=save;f.data.motions.push({...motion,id:'dinner',title:'Added on another phone'});
 await s.cycle([day]);assert.deepEqual(f.data.motions.map(m=>m.title),['Second edit','Added on another phone']);
});
test('deleting final Motion and Rhythm remains empty across a second phone and reload',async()=>{
 const f=fixture(),a=f.make(),b=f.make('phone-b','abby');await a.cycle([day]);await b.cycle([day]);
 a.editMotions([]);a.editRhythms([]);await a.cycle([day]);await b.cycle([day]);
 assert.deepEqual(b.snapshot.motions,[]);assert.deepEqual(b.snapshot.rhythms,[]);
 const reload=f.make('phone-b');await reload.cycle([day]);assert.deepEqual(reload.snapshot.rhythms,[]);
});
test('two phones receive shared completion and caches are isolated by household',async()=>{
 const f=fixture(),a=f.make(),b=f.make('phone-b','abby');a.complete(day,'motion','morning:1',true,'Andrew');await a.cycle([day]);await b.cycle([day]);
 assert.equal(visibleProgress(b.snapshot,[day])[0].item_id,'morning:1');
 assert.equal(f.make('other-house').snapshot.progress.length,0);
});
test('offline edits remain queued and stale periods do not appear as today',async()=>{
 const f=fixture(),s=f.make();s.complete('day:2026-10-08','motion','morning:0',true,'Andrew');s.editRhythms([]);
 await s.cycle([day],false);assert.equal(s.status,'offline');assert.equal(s.pending,true);assert.deepEqual(visibleProgress(s.snapshot,[day]),[]);
 await s.cycle([day]);assert.equal(s.pending,false);assert.equal(f.data.rhythms.length,0);
});
test('a false save result retains pending changes',async()=>{
 const f=fixture(),s=f.make();f.api.saveRhythms=async()=>false;s.editRhythms([]);await s.cycle([day]);
 assert.equal(s.status,'error');assert.equal(s.pending,true);assert.equal(f.make().pending,true);
});
test('backend dropping stable step IDs is reported and retains local edits',async()=>{
 const f=fixture(),s=f.make();f.api.saveMotions=async(_,items)=>{f.data.motions=items.map(m=>{const saved={...m};delete saved.taskIds;return saved});return true};
 s.editMotions([{...motion,title:'Edited'}]);await s.cycle([day]);assert.equal(s.status,'error');assert.match(s.error,/identity update/);assert.equal(s.pending,true);
});
test('a server that reports success without storing deletions leaves them queued',async()=>{
 const f=fixture(),s=f.make();f.api.saveRhythms=async()=>true;s.editRhythms([]);await s.cycle([day]);
 assert.equal(s.status,'error');assert.equal(s.pending,true);assert.deepEqual(s.snapshot.rhythms,[]);
});
test('new checklist IDs are never mistaken for a removed legacy completion',()=>{
 const added={...motion,tasks:['New task'],taskIds:['step-new']};assert.equal(taskIndex(added,'morning:0'),-1);assert.equal(taskKey(added,0),'morning:step-new');
});
test('a concurrent library write is rejected, then a fresh retry merges both phones’ independent edits',async()=>{
 const f=fixture();f.data.motions.push({...motion,id:'dinner',title:'Dinner'});
 const a=f.make(),b=f.make('phone-b','abby');await a.cycle([day]);await b.cycle([day]);
 const pause=deferred(),started=deferred();let hold=true;
 f.api.saveMotions=async(member,items,expected)=>{
  if(member==='andrew'&&hold){started.resolve();await pause.promise}
  if(JSON.stringify(f.data.motions)!==JSON.stringify(expected))return false;
  f.data.motions=clone(items);return true;
 };
 a.editMotions(a.snapshot.motions.map(m=>m.id==='morning'?{...m,title:'Andrew edit'}:m));
 const flight=a.cycle([day]);await started.promise;
 b.editMotions(b.snapshot.motions.map(m=>m.id==='dinner'?{...m,title:'Abby edit'}:m));await b.cycle([day]);
 pause.resolve();await flight;assert.equal(a.status,'error');assert.equal(a.pending,true);
 hold=false;await a.cycle([day]);assert.deepEqual(f.data.motions.map(m=>m.title),['Andrew edit','Abby edit']);assert.equal(a.pending,false);
});
