import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../packages/storage-local/store.ts';
import {createApi} from '../apps/local-service/server.ts';
import {client} from './http-helper.ts';
import {ffmpeg} from '../packages/media/runtime.ts';
test('local audio API imports, revises and removes arrangement with rights and revision protection',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-audio-api-')),store=new Store(':memory:');
 const server=createApi(store,4311,5178,path.join(dir,'exports'),{config:{enabled:false,routes:[]},key:''});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const request=client(server);
 try{
  await request('/api/session');const file=path.join(dir,'tone.wav');await ffmpeg(['-f','lavfi','-i','sine=frequency=330:duration=1','-y',file]);
  const body={data:readFileSync(file).toString('base64'),name:'test tone',kind:'music',rights:'generated',offsetMs:0,volume:20,revision:1};
  assert.equal((await request('/api/audio',{...body,rights:'unknown'})).status,409);
  const result=await request('/api/audio',body);assert.equal(result.status,200);const p=result.data,track=p.audioTracks[0];assert.equal(track.durationMs,1000);
  assert.equal((await request('/api/audio-track',{id:track.id,offsetMs:2000,volume:40,revision:1})).status,409);
  const edited=await request('/api/audio-track',{id:track.id,offsetMs:2000,volume:40,revision:p.revision});assert.equal(edited.status,200);assert.equal(edited.data.audioTracks[0].offsetMs,2000);
  assert.equal((await request('/api/audio-track',{id:track.id,offsetMs:30000,volume:40,revision:edited.data.revision})).status,409);
  const removed=await request('/api/audio-remove',{id:track.id,revision:edited.data.revision});assert.equal(removed.data.audioTracks.length,0);assert.ok(store.history('sample').some(p=>p.audioTracks?.length===1));
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(dir,{recursive:true,force:true});}
});
