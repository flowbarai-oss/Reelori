import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {seedProject,adopt} from '../packages/core/project.ts';
import {addAudioTrack} from '../packages/core/audio.ts';
import {saveAudio} from '../packages/media/audio.ts';
import {saveVideo} from '../packages/media/video.ts';
import {ffmpeg,ffmpegPath,runFile} from '../packages/media/runtime.ts';
import {renderAnimatic} from '../packages/media/render.ts';
test('30 second capacity: six video sources, eight voices, one music and one effect',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'reelori-capacity-'));
 try{
  const p=seedProject();p.shots=Array.from({length:6},(_,i)=>({...structuredClone(p.shots[i%3]),id:'shot-'+i,candidates:[],seconds:5,adoptedId:null,review:'pending' as const}));
  for(let i=0;i<6;i++){const file=path.join(dir,'v'+i+'.mp4');await ffmpeg(['-f','lavfi','-i',`testsrc2=size=320x568:rate=24, hue=h=${i*30}`,'-t','5','-c:v','libx264','-threads','1','-y',file]);const saved=await saveVideo(readFileSync(file),path.join(dir,'assets'),5);const s=p.shots[i];s.candidates.push({id:'candidate-'+i,image:saved.image,video:saved.video,createdAt:Date.now(),inputRevision:s.revision,mode:'provider'});adopt(p,s.id,'candidate-'+i,p.revision);}
  const voiceFile=path.join(dir,'voice.wav');await ffmpeg(['-f','lavfi','-i','sine=frequency=440:duration=2','-y',voiceFile]);const voice=await saveAudio(readFileSync(voiceFile),path.join(dir,'assets'));
  for(let i=0;i<8;i++)addAudioTrack(p,{...voice,name:'Voice '+i,kind:'dialogue',rights:'generated',offsetMs:i*3000,volume:30},p.revision);
  const musicFile=path.join(dir,'music.wav');await ffmpeg(['-f','lavfi','-i','sine=frequency=220:duration=30','-y',musicFile]);const music=await saveAudio(readFileSync(musicFile),path.join(dir,'assets'));addAudioTrack(p,{...music,name:'Music',kind:'music',rights:'generated',offsetMs:0,volume:10},p.revision);
  addAudioTrack(p,{...voice,name:'Effect',kind:'effect',rights:'generated',offsetMs:27000,volume:20},p.revision);
  const result=await renderAnimatic(p,path.join(dir,'exports'),{audioMode:'mix'});const checked=await runFile(ffmpegPath(),['-hide_banner','-i',result.file,'-f','null','-'],{windowsHide:true,timeout:120000,maxBuffer:2000000});
  assert.match(checked.stderr.split('Stream mapping:')[0],/1080x1920[^\r\n]* 24 fps,/);assert.match(checked.stderr,/Duration: 00:00:30.00/);assert.equal(Number([...checked.stderr.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]),720);
  const m=JSON.parse(readFileSync(result.manifestFile,'utf8'));assert.equal(m.audioTracks.length,10);assert.equal(m.shots.length,6);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
