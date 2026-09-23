import {randomUUID} from 'node:crypto';
import type {Project,AudioTrack} from '../contracts/index.ts';
import {DomainError} from './project.ts';
const fail=(message='音频编排数据无效'):never=>{throw new DomainError(message,409);};
export function validateAudioTracks(p:Project,timeline=false){
 const tracks=p.audioTracks??[];
 if(!Array.isArray(tracks)||tracks.length>10)fail('最多支持 8 段配音、1 段音乐和 1 段音效');
 if(p.audioRevision!==undefined&&(!Number.isSafeInteger(p.audioRevision)||p.audioRevision<0))fail();
 const ids=new Set<string>(),counts={dialogue:0,music:0,effect:0};
 const voiceShots=new Set<string>();
 for(const t of tracks){
  if(!t||Object.keys(t).some(k=>!['id','name','audio','durationMs','offsetMs','volume','kind','rights','createdAt'].includes(k)))fail();
  if(typeof t.id!=='string'||!/^[a-f0-9-]{36}$/.test(t.id)||ids.has(t.id))fail();ids.add(t.id);
  if(typeof t.name!=='string'||!t.name.trim()||t.name.length>80||t.name.includes('\0')||typeof t.audio!=='string'||!/^\/api\/assets\/[a-f0-9]{64}\.wav$/.test(t.audio))fail();
  if(!['dialogue','music','effect'].includes(t.kind)||!['owned','licensed','generated'].includes(t.rights))fail('请声明音频来源与使用权');
  counts[t.kind]++;
  if(!Number.isSafeInteger(t.durationMs)||t.durationMs<100||t.durationMs>30000||!Number.isSafeInteger(t.offsetMs)||t.offsetMs<0||t.offsetMs>30000||!Number.isSafeInteger(t.volume)||t.volume<0||t.volume>100||!Number.isSafeInteger(t.createdAt)||t.createdAt<0)fail();
  if(timeline&&t.offsetMs+t.durationMs>p.shots.reduce((n,s)=>n+s.seconds*1000,0))fail('音频超出成片时长，请调整起始时间、镜头时长或换用较短音频；不会自动截断');
  if(timeline){
   const job=p.provider?.jobs.find(j=>j.id===t.id&&j.quote.input.kind==='audio');
   if(job){
    const index=p.shots.findIndex(s=>s.id===job.quote.input.shotId),shot=p.shots[index];
    if(!shot||shot.revision!==job.quote.input.shotRevision||shot.dialogue!==job.quote.input.prompt)fail('已采用配音对应旧对白或镜头版本，请移出或重新生成后采用');
    if(voiceShots.has(shot.id))fail('同一镜头存在多段生成配音，请明确采用其中一段');
    voiceShots.add(shot.id);
    const start=p.shots.slice(0,index).reduce((n,s)=>n+s.seconds*1000,0);
    if(t.offsetMs<start||t.offsetMs+t.durationMs>start+shot.seconds*1000)fail('生成配音超出对应镜头时段，请调整编排');
   }
  }
 }
 if(counts.dialogue>8||counts.music>1||counts.effect>1)fail('最多支持 8 段配音、1 段音乐和 1 段音效');
}
function change(p:Project,tracks:AudioTrack[],revision:number){
 if(p.revision!==revision)fail('项目版本已变化');
 const next={...p,audioTracks:tracks,audioRevision:(p.audioRevision??0)+1};validateAudioTracks(next);
 p.audioTracks=tracks;p.audioRevision=next.audioRevision;p.revision++;
}
export function addAudioTrack(p:Project,input:unknown,revision:number){
 if(!input||typeof input!=='object'||Array.isArray(input))fail();
 const x=input as Record<string,unknown>;
 const track={id:randomUUID(),createdAt:Date.now(),name:x.name,audio:x.audio,durationMs:x.durationMs,offsetMs:x.offsetMs,volume:x.volume,kind:x.kind,rights:x.rights} as AudioTrack;
 validateAudioTracks({...p,audioTracks:[track]},true);
 change(p,[...(p.audioTracks??[]),track],revision);
}
export function editAudioTrack(p:Project,id:string,patch:{offsetMs:number;volume:number},revision:number){
 if(!p.audioTracks?.some(t=>t.id===id))fail('音轨不存在');
 validateAudioTracks({...p,audioTracks:p.audioTracks!.filter(t=>t.id===id).map(t=>({...t,offsetMs:patch.offsetMs,volume:patch.volume}))},true);
 change(p,p.audioTracks!.map(t=>t.id===id?{...t,offsetMs:patch.offsetMs,volume:patch.volume}:t),revision);
}
export function removeAudioTrack(p:Project,id:string,revision:number){
 if(!p.audioTracks?.some(t=>t.id===id))fail('音轨不存在');
 change(p,p.audioTracks!.filter(t=>t.id!==id),revision);
}
