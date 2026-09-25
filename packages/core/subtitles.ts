import type {Project,SubtitleCue} from '../contracts/index.ts';
import {DomainError} from './project.ts';
import { MAX_FILM_SECONDS } from './film-limits.ts';
export function validateSubtitles(p:Project,timeline=false){
 if(p.subtitleRevision!==undefined&&(!Number.isSafeInteger(p.subtitleRevision)||p.subtitleRevision<0))throw new DomainError('字幕版本无效',409);
 if(p.subtitleCues===undefined)return;
 if(!Array.isArray(p.subtitleCues)||p.subtitleCues.length>60)throw new DomainError('字幕最多支持 60 条',409);
 let end=0;const total=p.shots.reduce((n,s)=>n+s.seconds*1000,0);
 for(const c of p.subtitleCues){
  if(!c||Object.keys(c).some(k=>!['startMs','endMs','text'].includes(k))||!Number.isSafeInteger(c.startMs)||!Number.isSafeInteger(c.endMs)||c.startMs<end||c.endMs<=c.startMs||c.endMs>MAX_FILM_SECONDS*1000||typeof c.text!=='string'||!c.text.trim()||c.text.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c.text))throw new DomainError('字幕时间或文本无效，字幕不可重叠',409);
  if(timeline&&c.endMs>total)throw new DomainError('字幕超出成片时长，请先调整字幕时间',409);
  end=c.endMs;
 }
}
export function subtitleCues(p:Project):SubtitleCue[]{
 validateSubtitles(p,true);if(p.subtitleCues!==undefined)return structuredClone(p.subtitleCues);
 let start=0;return p.shots.map(s=>{const c={startMs:start,endMs:start+s.seconds*1000,text:s.dialogue.trim()};start=c.endMs;return c;}).filter(c=>c.text);
}
export function setSubtitles(p:Project,cues:unknown,revision:number){
 if(p.revision!==revision)throw new DomainError('项目版本已变化',409);
 if(cues!==null&&!Array.isArray(cues))throw new DomainError('请提供字幕列表，或明确选择恢复对白',400);
 const next={...p,subtitleCues:cues===null?undefined:cues as SubtitleCue[]};validateSubtitles(next,true);
 if(cues===null)delete p.subtitleCues;else p.subtitleCues=structuredClone(next.subtitleCues);
 p.subtitleRevision=(p.subtitleRevision??0)+1;p.revision++;
}
