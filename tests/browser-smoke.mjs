import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const url=process.env.MOTIONS_TEST_URL||'http://127.0.0.1:5173/';
const browser=await chromium.launch({headless:true,channel:process.env.MOTIONS_TEST_BROWSER});
const people=[{id:'andrew',name:'Andrew',is_admin:true},{id:'abby',name:'Abby',is_admin:false}];
const house={household_id:'test-house',household_name:'Our household',members:people};
let motions=[{id:'morning',title:'Before 7am',label:'Morning launch',time:'Before 7:00',accent:'#d6a443',image:'',message:'Morning is moving.',tasks:['Wake up','Get dressed']}];
let rhythms=[{id:'water',title:'Drink water',category:'Personal',assignee:'Everyone',recurrence:'daily',days:[],dayOfMonth:1,intervalDays:1,startDate:'2026-10-09'}];
let progress=[];
const errors=[];
async function phone(){
 const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 const device={joined:false,remembered:null,offline:false};
 await context.addInitScript(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>localStorage.getItem('test-offline')!=='yes'})});
 await context.route('https://vcqlmcamyblclgyvcaxu.supabase.co/**',async route=>{
  if(device.offline){await route.abort('internetdisconnected');return}
  const request=route.request(),name=new URL(request.url()).pathname.split('/').pop(),body=request.postDataJSON()||{};
  let data;
  if(name==='signup'||name==='token')data={access_token:'test-access',refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600};
  else if(name==='get_my_household')data=device.joined?{...house,remembered_member_id:device.remembered}:null;
  else if(name==='create_motions_household'){device.joined=true;data={household:house,join_code:'AB12-CD34'}}
  else if(name==='join_motions_household'){device.joined=true;data=house}
  else if(name==='remember_member'){data=body.p_pin===(body.p_member_id==='andrew'?'1234':'5678');if(data)device.remembered=body.p_member_id}
  else if(name==='get_household_motions')data=motions;
  else if(name==='get_household_rhythms')data=rhythms;
  else if(name==='save_household_motions_checked'){motions=body.p_motions;data=true}
  else if(name==='save_household_rhythms_checked'){rhythms=body.p_rhythms;data=true}
  else if(name==='get_household_progress')data=progress.filter(r=>body.p_period_keys.includes(r.period_key));
  else if(name==='set_household_progress'){
   progress=progress.filter(r=>!(r.period_key===body.p_period_key&&r.item_type===body.p_item_type&&r.item_id===body.p_item_id));
   progress.push({period_key:body.p_period_key,item_type:body.p_item_type,item_id:body.p_item_id,completed:body.p_completed,updated_by_name:body.p_member_id==='andrew'?'Andrew':'Abby',updated_at:new Date().toISOString()});data=true;
  }else throw new Error(`Unexpected RPC ${name}`);
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);return {context,page,device};
}
async function waitForText(page,text){await page.getByText(text,{exact:true}).waitFor({timeout:12000})}
async function unlock(page,name,pin){await page.getByRole('button',{name:new RegExp(name)}).click();await page.getByLabel('Four digit PIN').fill(pin);await page.getByRole('button',{name:'ENTER MOTIONS'}).click();await waitForText(page,'Shared household up to date')}
try{
 const a=await phone();await a.page.getByRole('button',{name:'CREATE OUR HOUSEHOLD'}).click();
 await a.page.getByLabel('ANDREW’S 4-DIGIT PIN').fill('1234');await a.page.getByLabel('ABBY’S 4-DIGIT PIN').fill('5678');
 await a.page.getByRole('button',{name:'CREATE HOUSEHOLD',exact:true}).click();await waitForText(a.page,'AB12-CD34');await unlock(a.page,'Andrew','1234');
 const b=await phone();await b.page.getByRole('button',{name:'JOIN WITH A SETUP CODE'}).click();await b.page.getByLabel('HOUSEHOLD SETUP CODE').fill('AB12-CD34');await b.page.getByRole('button',{name:'CONNECT THIS DEVICE'}).click();await unlock(b.page,'Abby','5678');
 await a.page.getByRole('button',{name:'OPEN MOTION'}).click();await a.page.locator('.tasks .motion-task').first().click();
 await b.page.getByRole('button',{name:'OPEN MOTION'}).click();await b.page.locator('.tasks .motion-task.done').waitFor({timeout:12000});assert.equal(await b.page.locator('.tasks .motion-task.done').count(),1);
 await a.page.locator('.list header .more-button').click();await a.page.getByRole('button',{name:'Edit motion',exact:true}).click();
 await a.page.getByLabel('Step 1',{exact:true}).fill('Wake up refreshed');await a.page.locator('.step-row').first().getByRole('button',{name:'DOWN',exact:true}).click();await a.page.getByRole('button',{name:'SAVE MOTION',exact:true}).click();
 await waitForText(a.page,'Shared household up to date');await b.page.getByText('Wake up refreshed',{exact:true}).waitFor({timeout:12000});
 assert.equal(await b.page.locator('.tasks .motion-task.done span').innerText(),'Wake up refreshed');
 // Simulate losing the household connection while keeping the local test app reachable for reload.
 b.device.offline=true;await b.page.evaluate(()=>{localStorage.setItem('test-offline','yes');window.dispatchEvent(new Event('offline'))});
 await b.page.locator('.tasks .motion-task').first().click();await b.page.reload();await waitForText(b.page,'Offline · changes saved on this phone');
 await b.page.getByRole('button',{name:'OPEN MOTION'}).click();
 // Completion screen is transient; cached completion still appears on the checklist after re-opening.
 assert.equal(await b.page.locator('.tasks .motion-task.done').count(),2);
 b.device.offline=false;await b.page.evaluate(()=>{localStorage.removeItem('test-offline');window.dispatchEvent(new Event('online'))});await waitForText(b.page,'Shared household up to date');
 await a.page.getByText('2 OF 2 COMPLETE',{exact:false}).first().waitFor({timeout:12000});await a.page.getByRole('button',{name:'ONE AT A TIME'}).click();await waitForText(a.page,'Morning is moving.');
 // A fully completed checklist must still offer an exit/reset in Focus Mode.
 await a.page.getByRole('button',{name:'RETURN TO TODAY'}).click();
 await a.page.getByRole('button',{name:'Rhythms',exact:true}).click();await a.page.getByRole('button',{name:'Manage Drink water',exact:true}).click();
 a.page.once('dialog',d=>d.accept());await a.page.getByRole('button',{name:'Delete rhythm',exact:true}).click();await waitForText(a.page,'No Rhythms yet');
 await b.page.locator('.list header button').first().click();await b.page.getByRole('button',{name:'Rhythms',exact:true}).click();await waitForText(b.page,'No Rhythms yet');await b.page.reload();await waitForText(b.page,'Shared household up to date');await b.page.getByRole('button',{name:'Rhythms',exact:true}).click();await waitForText(b.page,'No Rhythms yet');
 await a.page.getByRole('button',{name:'Household',exact:true}).click();await a.page.getByRole('button',{name:'SWITCH PERSON',exact:true}).click();await unlock(a.page,'Abby','5678');
 await a.page.getByRole('button',{name:'Motions',exact:true}).click();await a.page.getByRole('button',{name:'Manage Before 7am'}).click();a.page.once('dialog',d=>d.accept());await a.page.getByRole('button',{name:'Delete motion',exact:true}).click();await waitForText(a.page,'Shared household up to date');
 await b.page.getByRole('button',{name:'Today',exact:true}).click();await waitForText(b.page,'No Motions yet');await b.page.reload();await waitForText(b.page,'No Motions yet');
 assert.deepEqual(errors,[]);console.log('PASS: setup, join, profiles, two-phone completion, reorder/rename, offline reload/retry, final-item deletion');
 await a.context.close();await b.context.close();
}finally{await browser.close()}
