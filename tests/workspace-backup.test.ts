import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../packages/storage-local/store.ts';
import {confirmPreview,queueSample,tick,adopt,seedProject} from '../packages/core/project.ts';
import {renderAnimatic,listRenders} from '../packages/media/render.ts';
import {createWorkspaceArchive,inspectWorkspaceArchive,restoreWorkspaceArchive} from '../packages/storage-local/workspace-backup.ts';
import {createApi} from '../apps/local-service/server.ts';
import {client} from './http-helper.ts';
import * as ledger from '../packages/providers/ledger.ts';
import {validateProject} from '../packages/storage-local/validate-project.ts';

test('pre-TTS provider jobs with both audio result fields absent remain valid',()=>{
 const p=seedProject();confirmPreview(p,p.revision);ledger.setProviderBudget(p,100000,p.revision);
 const quote=ledger.makeQuote(p,p.shots[0].id,{kind:'image',model:'fixture',size:'portrait',upperMicros:10000,pricingVersion:'fixture'},100);
 ledger.reserveProvider(p,quote,crypto.randomUUID(),p.revision,101);
 const job=p.provider!.jobs[0];delete (job as Partial<typeof job>).resultAudio;delete (job as Partial<typeof job>).resultDurationMs;
 assert.doesNotThrow(()=>validateProject(p));
 job.resultDurationMs=500;
 assert.throws(()=>validateProject(p));
});

test('one archive restores all projects, histories and rendered outputs into a paused new workspace',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-workspace-backup-'));
 const sourceDir=path.join(dir,'source');mkdirSync(sourceDir);
 const store=new Store(path.join(sourceDir,'studio.sqlite'));
 try{
  const other=store.create({title:'Second project',story:'An independent story.'});
  store.transact(p=>{confirmPreview(p,p.revision);queueSample(p,p.shots.map(s=>s.id),'workspace-fixture',p.revision,100);for(const n of [100,4000,8000,12000])tick(p,n);for(const s of p.shots)adopt(p,s.id,s.candidates[0].id,p.revision);});
  const output=await renderAnimatic(store.get(),path.join(sourceDir,'exports'));
  const before=readFileSync(output.file);
  const archive=await createWorkspaceArchive(store,sourceDir);
  const summary=await inspectWorkspaceArchive(archive);
  assert.equal(summary.projects,2);
  assert.equal(summary.renders,1);
  const restored=await restoreWorkspaceArchive(archive,path.join(dir,'restored'));
  const copy=new Store(path.join(restored.path,'studio.sqlite'));
  try{
   assert.equal(copy.list().length,2);
   assert.equal(copy.get('sample').paused,true);
   assert.equal(copy.get(other.id).paused,true);
   assert.ok(copy.history('sample').length>store.history('sample').length);
   assert.deepEqual(readFileSync(path.join(restored.path,'exports',path.basename(output.file))),before);
   assert.equal((await listRenders(path.join(restored.path,'exports'),'sample')).length,1);
  }finally{copy.close();}
  const tampered=structuredClone(archive),movie=tampered.files.find(f=>f.path.endsWith('.mp4'));assert.ok(movie);movie.data='AAAA';
  const count=readdirSync(path.join(dir,'restored')).length;
  await assert.rejects(()=>restoreWorkspaceArchive(tampered,path.join(dir,'restored')));
  assert.equal(readdirSync(path.join(dir,'restored')).length,count);
  assert.ok(existsSync(path.join(sourceDir,'studio.sqlite')));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('workspace HTTP flow inspects exact uploaded bytes and restores without touching the active store',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-workspace-api-'));const store=new Store(path.join(dir,'studio.sqlite'));
 const server=createApi(store,4311,5178,path.join(dir,'exports'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const request=client(server);
 try{
  await request('/api/session');
  store.create({title:'A second story',story:'Second story text.'});
  store.transact(p=>{confirmPreview(p,p.revision);ledger.setProviderBudget(p,100000,p.revision);const quote=ledger.makeQuote(p,p.shots[0].id,{kind:'image',model:'fixture',size:'portrait',upperMicros:10000,pricingVersion:'fixture'},100);ledger.reserveProvider(p,quote,crypto.randomUUID(),p.revision,101);const job=p.provider!.jobs[0];delete (job as Partial<typeof job>).resultAudio;delete (job as Partial<typeof job>).resultDurationMs;});
  const made=await request('/api/workspace-backup',{});assert.equal(made.status,200,JSON.stringify(made.data));assert.equal(made.data.projects,2);
  const listed=await request('/api/workspace-backups');assert.equal(listed.data[0].id,made.data.id);
  const download=await request(made.data.download);assert.equal(download.status,200);
  const archive=download.data;
  const checked=await request('/api/workspace-inspect',{archive});assert.equal(checked.status,200);assert.equal(checked.data.projects,2);
  const changed=structuredClone(archive);changed.createdAt='2000-01-01T00:00:00.000Z';
  assert.equal((await request('/api/workspace-restore',{archive:changed,...checked.data.confirmation})).status,400);
  const restored=await request('/api/workspace-restore',{archive,...checked.data.confirmation});assert.equal(restored.status,201,JSON.stringify(restored.data));
  assert.equal(store.list().length,2);
  const copy=new Store(path.join(restored.data.path,'studio.sqlite'));try{assert.equal(copy.list().length,2);const project=copy.get('sample');assert.equal(project.paused,true);assert.equal(project.provider?.jobs[0].recoveryBlocked,true);assert.equal(project.provider?.jobs[0].state,'unknown');assert.equal(project.provider?.jobs[0].reservedMicros,10000);}finally{copy.close();}
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}
});
