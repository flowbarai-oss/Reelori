import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,adopt,confirmPreview} from '../packages/core/project.ts';
import {reorderShots,trimShot} from '../packages/core/timeline.ts';
import {setSubtitles} from '../packages/core/subtitles.ts';
import {validateProject} from '../packages/storage-local/validate-project.ts';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ffmpeg} from '../packages/media/runtime.ts';
import {saveVideo} from '../packages/media/video.ts';
import {renderAnimatic} from '../packages/media/render.ts';
import {createDelivery} from '../packages/media/delivery.ts';
import {execFileSync} from 'node:child_process';
import * as ledger from '../packages/providers/ledger.ts';
import {Store} from '../packages/storage-local/store.ts';
import {createApi} from '../apps/local-service/server.ts';
import {client} from './http-helper.ts';

test('reorder preserves shot identity and adoption while shifting shot-bound audio',()=>{
 const p=seedProject();
 for(const s of p.shots){s.candidates.push({id:'candidate-'+s.id,image:s.image,createdAt:1,inputRevision:s.revision,mode:'sample'});adopt(p,s.id,'candidate-'+s.id,p.revision);}
 const ids=p.shots.map(s=>s.id),before=p.inputRevision;
 reorderShots(p,[ids[2],ids[0],ids[1]],p.revision);
 assert.deepEqual(p.shots.map(s=>s.id),[ids[2],ids[0],ids[1]]);
 assert.equal(p.shots[0].review,'accepted');
 assert.equal(p.shots[0].revision,1);
 assert.equal(p.inputRevision,before+1);
 assert.deepEqual(p.preview,null);
 validateProject(p);
});

test('trim keeps adopted source revision and records exact source interval',()=>{
 const p=seedProject();const s=p.shots[0];
 s.candidates.push({id:'candidate',image:s.image,video:'/api/assets/'+'a'.repeat(64)+'.mp4',createdAt:1,inputRevision:s.revision,mode:'provider'});adopt(p,s.id,'candidate',p.revision);
 trimShot(p,s.id,1,4,p.revision);
 assert.equal(p.shots[0].seconds,3);
 assert.equal(p.shots[0].clipStartSeconds,1);
 assert.equal(p.shots[0].sourceSeconds,5);
 assert.equal(p.shots[0].review,'accepted');
 assert.equal(p.shots[0].revision,1);
 assert.throws(()=>trimShot(p,s.id,3,6,p.revision));
 validateProject(p);
});

test('switching to another candidate clears the old source cut and expires preview',()=>{
 const p=seedProject(),s=p.shots[0];
 for(const id of ['a','b'])s.candidates.push({id,image:s.image,video:'/api/assets/'+id.repeat(64)+'.mp4',createdAt:1,inputRevision:s.revision,mode:'provider'});
 adopt(p,s.id,'a',p.revision);trimShot(p,s.id,1,4,p.revision);
 const oldInput=p.inputRevision;
 adopt(p,s.id,'b',p.revision);
 assert.equal(p.shots[0].sourceSeconds,undefined);
 assert.equal(p.shots[0].clipStartSeconds,undefined);
 assert.equal(p.shots[0].seconds,3);
 assert.equal(p.inputRevision,oldInput+1);
});

test('shot-bound captions follow order and trim rejects cues that would be lost',()=>{
 const p=seedProject(),ids=p.shots.map(s=>s.id);
 setSubtitles(p,[{startMs:500,endMs:1500,text:'first'},{startMs:5500,endMs:6500,text:'second'}],p.revision);
 reorderShots(p,[ids[1],ids[0],ids[2]],p.revision);
 assert.deepEqual(p.subtitleCues?.map(c=>c.text),['second','first']);
 assert.deepEqual(p.subtitleCues?.map(c=>c.startMs),[500,5500]);
 const shot=p.shots[1];shot.candidates.push({id:'video',image:shot.image,video:'/api/assets/'+'a'.repeat(64)+'.mp4',createdAt:1,inputRevision:shot.revision,mode:'provider'});adopt(p,shot.id,'video',p.revision);
 const before=structuredClone(p);
 assert.throws(()=>trimShot(p,shot.id,1,4,p.revision),/字幕/);
 assert.deepEqual(p,before);
});

test('generated voice moves with its shot and incompatible cuts leave the project intact',()=>{
 const p=seedProject();confirmPreview(p,p.revision);ledger.setProviderBudget(p,100000,p.revision);
 const second=p.shots[1],q=ledger.makeQuote(p,second.id,{provider:'aliyun',kind:'audio',model:'xiaoyun',size:'tts',upperMicros:15000,pricingVersion:'fixture'},100);
 ledger.reserveProvider(p,q,crypto.randomUUID(),p.revision,101);const j=p.provider!.jobs.at(-1)!;
 const claim=ledger.claimProvider(p,j.id,102)!;
 ledger.applyProvider(p,j.id,claim.generation,{state:'succeeded',audio:'/api/assets/'+'a'.repeat(64)+'.wav',durationMs:1000},103);
 ledger.adoptProviderAudio(p,j.id,p.revision);
 assert.equal(p.audioTracks![0].offsetMs,5000);
 const ids=p.shots.map(s=>s.id);reorderShots(p,[ids[1],ids[0],ids[2]],p.revision);
 assert.equal(p.audioTracks![0].offsetMs,0);
 assert.equal(p.audioRevision,2);
 const moved=p.shots[0];moved.candidates.push({id:'video',image:moved.image,video:'/api/assets/'+'b'.repeat(64)+'.mp4',createdAt:1,inputRevision:moved.revision,mode:'provider'});adopt(p,moved.id,'video',p.revision);
 const before=structuredClone(p);
 assert.throws(()=>trimShot(p,moved.id,1,4,p.revision),/配音/);
 assert.deepEqual(p,before);
 validateProject(p);
});

test('local API accepts order and cut with version conflicts',async()=>{
 const store=new Store(':memory:'),dir=mkdtempSync(path.join(tmpdir(),'reelori-timeline-api-'));
 const server=createApi(store,4311,5178,path.join(dir,'exports'));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const request=client(server);
 try{
  await request('/api/session');
  const p=store.get(),ids=p.shots.map(s=>s.id);
  const changed=await request('/api/shot-order',{ids:[ids[1],ids[0],ids[2]],revision:p.revision});
  assert.equal(changed.status,200);
  assert.equal(changed.data.shots[0].id,ids[1]);
  assert.equal((await request('/api/shot-order',{ids,revision:p.revision})).status,409);
  assert.equal((await request('/api/shot-trim',{id:ids[1],start:1,end:4,revision:changed.data.revision})).status,409);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('source video and audio obey selected in/out frames in a real local render',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-trim-render-'));
 try{
  const source=path.join(dir,'source.mp4');
  await ffmpeg(['-f','lavfi','-i','testsrc2=size=320x568:rate=24','-f','lavfi','-i','sine=frequency=440:duration=5','-t','5','-c:v','libx264','-threads','1','-c:a','aac','-y',source]);
  const saved=await saveVideo(readFileSync(source),path.join(dir,'assets'),5);
  const p=seedProject();
  for(const s of p.shots){s.candidates.push({id:'candidate-'+s.id,image:s.id===p.shots[0].id?saved.image:s.image,video:s.id===p.shots[0].id?saved.video:undefined,createdAt:1,inputRevision:s.revision,mode:'provider'});adopt(p,s.id,'candidate-'+s.id,p.revision);}
  trimShot(p,p.shots[0].id,1,4,p.revision);
  const result=await renderAnimatic(p,path.join(dir,'exports'),{audioMode:'source'});
  const m=JSON.parse(readFileSync(result.manifestFile,'utf8'));
  assert.equal(m.durationSeconds,13);
  assert.equal(m.verification.frames,312);
  assert.equal(m.shots[0].clipStartSeconds,1);
  assert.equal(m.shots[0].sourceSeconds,5);
  assert.equal(m.verification.audio,true);
  const delivery=await createDelivery(result.id,p.id,path.join(dir,'exports'),path.join(dir,'assets'));
  const delivered=JSON.parse(execFileSync('python',['-c',"import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(json.loads(z.read('storyboard.json').decode('utf-8')),ensure_ascii=True))",delivery.file],{encoding:'utf8'}));
  assert.equal(delivered.shots[0].clipStartSeconds,1);
  assert.equal(delivered.shots[0].sourceSeconds,5);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
