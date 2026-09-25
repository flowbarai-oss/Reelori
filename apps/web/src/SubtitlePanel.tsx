import {useEffect,useRef,useState} from 'react';
import type {Project,SubtitleCue} from '../../../packages/contracts/index.ts';
function initial(p:Project):SubtitleCue[]{if(p.subtitleCues!==undefined)return structuredClone(p.subtitleCues);let start=0;return p.shots.map(s=>{const cue={startMs:start,endMs:start+s.seconds*1000,text:s.dialogue};start=cue.endMs;return cue;}).filter(c=>c.text.trim());}
export function SubtitlePanel({project,lang,request,onChange,onDirty}:{project:Project;lang:string;request:(path:string,body?:unknown)=>Promise<any>;onChange:(p:Project)=>void;onDirty:(dirty:boolean)=>void}){
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 const filmSeconds=project.shots.reduce((total,shot)=>total+shot.seconds,0);
 const [cues,setCues]=useState(()=>initial(project)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[dirty,setDirty]=useState(false);
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const draftRevision=useRef(project.revision);
 useEffect(()=>{if(!dirty)setCues(initial(project));},[project.subtitleRevision,project.inputRevision]);
 useEffect(()=>{onDirty(dirty||busy);},[dirty,busy,onDirty]);
 function markDirty(){if(!dirty)draftRevision.current=project.revision;setDirty(true);}
 async function save(value:SubtitleCue[]|null){setBusy(true);setError('');try{const p=await request('subtitles',{cues:value,revision:value===null?project.revision:draftRevision.current});if(live.current){onChange(p);setCues(initial(p));setDirty(false);}}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
 function edit(i:number,patch:Partial<SubtitleCue>){setCues(old=>old.map((c,n)=>n===i?{...c,...patch}:c));markDirty();}
 return <details className="audio-panel"><summary>{t('字幕文本与时间','Subtitle text and timing')}</summary>
  <p className="fine">{t('独立修改字幕，不改对白或调用模型。保存后重新本地合成；旧成片保留原字幕。时间以整片秒数计，不可重叠。','Edit subtitles without changing dialogue or calling a model. Save and render locally; existing films stay unchanged. Times are seconds from the film start; cues cannot overlap.')}</p>
  {cues.map((c,i)=><div className="audio-track" key={i}><div className="audio-form">
   <label>{t('开始秒数','Start seconds')}<input type="number" min="0" max={filmSeconds} step="0.001" value={c.startMs/1000} disabled={busy} onChange={e=>edit(i,{startMs:Math.round(Number(e.target.value)*1000)})}/></label>
   <label>{t('结束秒数','End seconds')}<input type="number" min="0" max={filmSeconds} step="0.001" value={c.endMs/1000} disabled={busy} onChange={e=>edit(i,{endMs:Math.round(Number(e.target.value)*1000)})}/></label>
   <label>{t('字幕','Subtitle')} {i+1}<textarea maxLength={1000} value={c.text} disabled={busy} onChange={e=>edit(i,{text:e.target.value})}/></label>
   <button className="secondary" disabled={busy} onClick={()=>{setCues(old=>old.filter((_,n)=>n!==i));markDirty();}}>{t('移除此条','Remove cue')}</button>
  </div></div>)}
  <button className="secondary" disabled={busy||cues.length>=60||(cues.at(-1)?.endMs??0)>=filmSeconds*1000} onClick={()=>{const end=cues.at(-1)?.endMs??0;setCues([...cues,{startMs:end,endMs:Math.min(filmSeconds*1000,end+1000),text:''}]);markDirty();}}>{t('添加字幕','Add cue')}</button>
  <button className="secondary" disabled={busy||!dirty} onClick={()=>void save(cues)}>{t('保存字幕','Save subtitles')}</button>
  <button className="secondary" disabled={busy} onClick={()=>void save(null)}>{t('恢复跟随对白','Reset to dialogue')}</button>
  {dirty&&<button className="secondary" disabled={busy} onClick={()=>{setCues(initial(project));setDirty(false);setError('');}}>{t('放弃修改并重载','Discard edits and reload')}</button>}
  {dirty&&<p role="status">{t('字幕有未保存修改，请保存后再合成。','Unsaved subtitle edits. Save before rendering.')}</p>}
  {error&&<p role="alert" className="inline-error">{error}</p>}
 </details>;
}
