import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {seedProject} from '../packages/core/project.ts';
import {addAudioTrack,editAudioTrack,removeAudioTrack,validateAudioTracks} from '../packages/core/audio.ts';
import {saveAudio} from '../packages/media/audio.ts';
import {ffmpeg} from '../packages/media/runtime.ts';
const source={audio:'/api/assets/'+'a'.repeat(64)+'.wav',durationMs:1000};
test('audio arrangement validates rights, limits, revision and refuses silent timeline truncation',()=>{
 const p=seedProject();const original=p.shots[0].revision;
 addAudioTrack(p,{...source,name:'Voice',kind:'dialogue',rights:'owned',offsetMs:0,volume:80},p.revision);
 assert.equal(p.shots[0].revision,original);assert.equal(p.audioRevision,1);
 const track=p.audioTracks![0];assert.throws(()=>editAudioTrack(p,track.id,{offsetMs:30000,volume:80},p.revision));
 assert.throws(()=>addAudioTrack(p,{...source,name:'Bad rights',kind:'music',rights:'unknown',offsetMs:0,volume:50},p.revision));
 addAudioTrack(p,{...source,name:'Music',kind:'music',rights:'licensed',offsetMs:0,volume:20},p.revision);
 assert.throws(()=>addAudioTrack(p,{...source,name:'Duplicate music',kind:'music',rights:'owned',offsetMs:0,volume:20},p.revision));
 assert.throws(()=>editAudioTrack(p,track.id,{offsetMs:0,volume:200},p.revision));
 p.audioTracks![0].offsetMs=30000;assert.throws(()=>validateAudioTracks(p,true));p.audioTracks![0].offsetMs=0;
 removeAudioTrack(p,track.id,p.revision);assert.equal(p.audioTracks!.length,1);
});
test('audio ingest normalizes bounded real audio and rejects fake containers',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-audio-'));
 try{const file=path.join(dir,'tone.wav');await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=1','-y',file]);
 const saved=await saveAudio(readFileSync(file),dir);assert.equal(saved.durationMs,1000);assert.match(saved.audio,/\.wav$/);
 const again=await saveAudio(readFileSync(path.join(dir,saved.audio.split('/').at(-1)!)),dir);assert.deepEqual(again,saved);
 await assert.rejects(()=>saveAudio(Buffer.from('not audio'),dir));
 await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=31','-y',file]);
 const long=await saveAudio(readFileSync(file),dir);assert.equal(long.durationMs,31000);
 const project=seedProject();assert.throws(()=>addAudioTrack(project,{...long,name:'Too long for dialogue',kind:'dialogue',rights:'owned',offsetMs:0,volume:80},project.revision));
 await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=61','-c:a','libmp3lame','-y',path.join(dir,'too-long.mp3')]);
 await assert.rejects(()=>saveAudio(readFileSync(path.join(dir,'too-long.mp3')),dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
