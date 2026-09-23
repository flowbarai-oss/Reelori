import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../packages/storage-local/store.ts';
import {adopt} from '../packages/core/project.ts';
import {addAudioTrack} from '../packages/core/audio.ts';
import {ffmpeg} from '../packages/media/runtime.ts';
import {saveAudio} from '../packages/media/audio.ts';
import {renderAnimatic} from '../packages/media/render.ts';
import {createBackup,restoreBackup} from '../packages/storage-local/backup.ts';
import {createDelivery} from '../packages/media/delivery.ts';
test('owned audio offset survives rendering, backup and delivery without silently cropping voice',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-audio-mix-')),store=new Store(':memory:');
 try{
 const tone=path.join(dir,'tone.wav');await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=1','-y',tone]);const audio=await saveAudio(readFileSync(tone),path.join(dir,'assets'));
 store.transact(p=>{p.shots=p.shots.slice(0,2);for(const s of p.shots){s.seconds=2;s.candidates.push({id:s.id+'-candidate',image:s.image,createdAt:Date.now(),inputRevision:s.revision,mode:'sample'});adopt(p,s.id,s.candidates[0].id,p.revision);}addAudioTrack(p,{...audio,name:'Owned voice',kind:'dialogue',rights:'owned',offsetMs:1000,volume:50},p.revision);});
 const archive=await createBackup(store,'sample',path.join(dir,'assets'));const restored=await restoreBackup(store,archive,path.join(dir,'assets'));assert.equal(restored.audioTracks![0].offsetMs,1000);
 const rendered=await renderAnimatic(restored,path.join(dir,'exports'),{audioMode:'mix'});
 const pcm=path.join(dir,'decoded.pcm');await ffmpeg(['-i',rendered.file,'-map','0:a:0','-ar','48000','-ac','1','-f','s16le','-y',pcm]);const bytes=readFileSync(pcm);
 const rms=(start:number)=>{let sum=0;for(let i=start*48000;i<(start+0.25)*48000;i++)sum+=bytes.readInt16LE(i*2)**2;return Math.sqrt(sum/12000);};
 assert.ok(rms(0.25)<10);assert.ok(rms(1.25)>100);assert.ok(rms(2.5)<10);
 const m=JSON.parse(readFileSync(rendered.manifestFile,'utf8'));assert.equal(m.audio,'mix');assert.equal(m.audioTracks[0].offsetMs,1000);
 const delivery=await createDelivery(rendered.id,restored.id,path.join(dir,'exports'),path.join(dir,'assets'));assert.ok(readFileSync(delivery.file).includes(Buffer.from('audio/track-01.wav')));
 restored.shots[0].seconds=0;restored.shots[1].seconds=1;await assert.rejects(()=>renderAnimatic(restored,path.join(dir,'exports'),{audioMode:'mix'}));
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
