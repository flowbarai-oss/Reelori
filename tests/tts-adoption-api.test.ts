import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../packages/storage-local/store.ts';
import {createApi} from '../apps/local-service/server.ts';
import {client} from './http-helper.ts';
import {confirmPreview} from '../packages/core/project.ts';
import {makeQuote,reserveProvider,claimProvider,applyProvider,setProviderBudget} from '../packages/providers/ledger.ts';
test('audio candidate adoption API is versioned and works without provider credentials or dispatch',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-adopt-api-'));const store=new Store(':memory:');
 store.transact(p=>{confirmPreview(p,p.revision);setProviderBudget(p,100000,p.revision);const q=makeQuote(p,p.shots[0].id,{kind:'audio',model:'voice',size:'tts',upperMicros:10000,pricingVersion:'fixture'},100);reserveProvider(p,q,'fixture-adoption',p.revision,101);const j=p.provider!.jobs[0];const c=claimProvider(p,j.id,102)!;applyProvider(p,j.id,c.generation,{state:'succeeded',audio:'/api/assets/'+'a'.repeat(64)+'.wav',durationMs:1000},103);});
 const server=createApi(store,4311,5178,path.join(dir,'exports'),{config:{enabled:false,routes:[]},key:''});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{const request=client(server);await request('/api/session');const p=store.get(),jobId=p.provider!.jobs[0].id;
 assert.equal((await request('/api/provider-audio-adopt',{jobId,revision:p.revision-1})).status,409);
 const result=await request('/api/provider-audio-adopt',{jobId,revision:p.revision});assert.equal(result.status,200);assert.equal(result.data.audioTracks.length,1);assert.equal(result.data.provider.jobs[0].reservedMicros,10000);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}
});
