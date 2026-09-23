import type {Project,Shot,SubtitleCue,AudioTrack} from '../contracts/index.ts';
import {DomainError} from './project.ts';
import {validateAudioTracks} from './audio.ts';
import {validateSubtitles} from './subtitles.ts';

function fail(message:string):never{throw new DomainError(message,409);}
function windows(shots:Shot[]){
 let start=0;const result=new Map<string,{start:number;end:number;shot:Shot}>();
 for(const shot of shots){const end=start+shot.seconds*1000;result.set(shot.id,{start,end,shot});start=end;}
 return result;
}
function updateTimeline(p:Project,nextShots:Shot[]){
 const old=windows(p.shots),next=windows(nextShots);
 const cues:SubtitleCue[]|undefined=p.subtitleCues?.map(c=>{
  const original=[...old.values()].find(w=>c.startMs>=w.start&&c.endMs<=w.end);
  if(!original)fail('跨镜头字幕无法自动调整，请先拆分或移除后再修改时间线');
  const target=next.get(original.shot.id)!;
  const oldClip=(original.shot.clipStartSeconds??0)*1000,newClip=(target.shot.clipStartSeconds??0)*1000;
  const sourceStart=c.startMs-original.start+oldClip,sourceEnd=c.endMs-original.start+oldClip;
  if(sourceStart<newClip||sourceEnd>newClip+target.shot.seconds*1000)fail('字幕超出新裁剪范围，请先调整字幕');
  return {startMs:target.start+sourceStart-newClip,endMs:target.start+sourceEnd-newClip,text:c.text};
 }).sort((a,b)=>a.startMs-b.startMs);
 let movedAudio=false;
 const tracks:AudioTrack[]|undefined=p.audioTracks?.map(t=>{
  const job=p.provider?.jobs.find(j=>j.id===t.id&&j.quote.input.kind==='audio');
  if(!job)return t;
  const shotId=job.quote.input.shotId,from=old.get(shotId),to=next.get(shotId);
  if(!from||!to)fail('配音对应镜头不存在');
  const oldClip=(from.shot.clipStartSeconds??0)*1000,newClip=(to.shot.clipStartSeconds??0)*1000;
  const sourceOffset=t.offsetMs-from.start+oldClip;
  if(sourceOffset<newClip||sourceOffset+t.durationMs>newClip+to.shot.seconds*1000)fail('已采用配音超出新裁剪范围，请先调整或移除配音');
  const offsetMs=to.start+sourceOffset-newClip;
  if(offsetMs!==t.offsetMs)movedAudio=true;
  return {...t,offsetMs};
 });
 const draft={...p,shots:nextShots,subtitleCues:cues,audioTracks:tracks};
 validateSubtitles(draft,true);
 validateAudioTracks(draft,true);
 p.shots=nextShots;
 if(cues!==undefined){p.subtitleCues=cues;p.subtitleRevision=(p.subtitleRevision??0)+1;}
 if(tracks!==undefined){p.audioTracks=tracks;if(movedAudio)p.audioRevision=(p.audioRevision??0)+1;}
 p.inputRevision++;p.revision++;
 p.events.push({id:(p.events.at(-1)?.id??0)+1,text:'成片时间线已调整，请重新确认预演',at:Date.now()});
 if(p.events.length>100)p.events.shift();
}
export function reorderShots(p:Project,ids:unknown,revision:number){
 if(p.revision!==revision)fail('项目版本已变化');
 if(!Array.isArray(ids)||ids.length!==p.shots.length||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length||ids.some(id=>!p.shots.some(s=>s.id===id)))fail('请提供完整且不重复的镜头顺序');
 if(ids.every((id,i)=>id===p.shots[i].id))return;
 updateTimeline(p,ids.map(id=>p.shots.find(s=>s.id===id)!));
}
export function trimShot(p:Project,id:string,start:number,end:number,revision:number){
 if(p.revision!==revision)fail('项目版本已变化');
 const shot=p.shots.find(s=>s.id===id);
 if(!shot)fail('镜头不存在');
 const candidate=shot.candidates.find(c=>c.id===shot.adoptedId&&c.inputRevision===shot.revision);
 if(!candidate?.video||shot.review!=='accepted')fail('请先采用可剪裁的视频镜头');
 const source=shot.sourceSeconds??shot.seconds;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>source||end-start<2||end-start>10)fail('剪裁范围须为素材内的整秒区间，成片长度为 2–10 秒');
 if(start===(shot.clipStartSeconds??0)&&end===start+shot.seconds)return;
 const nextShots=p.shots.map(s=>s.id===id?{...s,seconds:end-start,clipStartSeconds:start,sourceSeconds:source}:s);
 updateTimeline(p,nextShots);
}
