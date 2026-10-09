import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/supabase.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
let instance=0;
async function api(){return import(`data:text/javascript;base64,${Buffer.from(js+`\n// instance ${++instance}`).toString('base64')}`)}
function storage(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)}}
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const session={access_token:'token',refresh_token:'refresh',expires_in:3600};
test('parallel household reads share one sign-in and persist token expiry',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage=storage();let signups=0;
 globalThis.fetch=async url=>{if(url.includes('/signup')){signups++;return response(session)}return response([])};
 try{const a=await api();await Promise.all([a.householdApi.motions(),a.householdApi.rhythms()]);assert.equal(signups,1);assert.ok(JSON.parse(localStorage.getItem('motions-supabase-auth')).expires_at>Math.floor(Date.now()/1000))}
 finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage}
});
test('an expired session refreshes once for concurrent requests',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage=storage();let refreshes=0;
 localStorage.setItem('motions-supabase-auth',JSON.stringify({...session,expires_at:1}));
 globalThis.fetch=async url=>{if(url.includes('/token?')){refreshes++;return response(session)}assert.ok(!url.includes('/signup'));return response([])};
 try{const a=await api();await Promise.all([a.householdApi.motions(),a.householdApi.rhythms()]);assert.equal(refreshes,1)}
 finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage}
});
test('failed token refresh preserves identity and does not silently sign up as a different household',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage=storage();localStorage.setItem('motions-supabase-auth',JSON.stringify({...session,expires_at:1}));
 globalThis.fetch=async url=>{assert.ok(!url.includes('/signup'));return response({},400)};
 try{const a=await api();await assert.rejects(a.householdApi.motions(),/session expired/);assert.ok(localStorage.getItem('motions-supabase-auth'))}
 finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage}
});
test('a rejected access token gets refreshed and the RPC is retried',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage=storage();localStorage.setItem('motions-supabase-auth',JSON.stringify({...session,expires_at:Math.floor(Date.now()/1000)+3600}));let calls=0;
 globalThis.fetch=async url=>{if(url.includes('/token?'))return response({...session,access_token:'renewed'});return ++calls===1?response({},401):response([])};
 try{const a=await api();assert.deepEqual(await a.householdApi.motions(),[]);assert.equal(calls,2)}
 finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage}
});
test('a temporary refresh outage retains the session and is distinguished from an expired login',async()=>{
 const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage;globalThis.localStorage=storage();localStorage.setItem('motions-supabase-auth',JSON.stringify({...session,expires_at:1}));
 globalThis.fetch=async()=>response({},503);
 try{const a=await api();await assert.rejects(a.householdApi.motions(),a.HouseholdConnectionError);assert.ok(localStorage.getItem('motions-supabase-auth'))}
 finally{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage}
});
