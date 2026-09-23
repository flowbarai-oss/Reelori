import {useEffect,useState} from 'react';
import type {Project,Shot} from '../../../packages/contracts/index.ts';

export function TimelineControls({project,shot,index,lang,busy,submit}:{project:Project;shot:Shot;index:number;lang:string;busy:boolean;submit:(path:string,body:object)=>Promise<boolean>}){
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 const [start,setStart]=useState(shot.clipStartSeconds??0),[end,setEnd]=useState((shot.clipStartSeconds??0)+shot.seconds);
 useEffect(()=>{setStart(shot.clipStartSeconds??0);setEnd((shot.clipStartSeconds??0)+shot.seconds);},[shot.clipStartSeconds,shot.seconds]);
 const video=shot.candidates.some(c=>c.id===shot.adoptedId&&c.inputRevision===shot.revision&&!!c.video)&&shot.review==='accepted';
 const move=(delta:number)=>{const ids=project.shots.map(s=>s.id);[ids[index],ids[index+delta]]=[ids[index+delta],ids[index]];void submit('shot-order',{ids});};
 return <div className="timeline-controls">
  <button className="secondary" aria-label={t(`将 ${shot.title} 上移`,`Move ${shot.title} up`)} disabled={busy||index===0} onClick={()=>move(-1)}>↑</button>
  <button className="secondary" aria-label={t(`将 ${shot.title} 下移`,`Move ${shot.title} down`)} disabled={busy||index===project.shots.length-1} onClick={()=>move(1)}>↓</button>
  {video&&<details className="shot-trim"><summary>{t('剪裁视频','Trim video')} · {shot.clipStartSeconds??0}–{(shot.clipStartSeconds??0)+shot.seconds}s</summary>
   <div className="shot-trim-form">
    <label>{t('入点（秒）','In (seconds)')}<input type="number" min="0" max={shot.sourceSeconds??shot.seconds} step="1" value={start} disabled={busy} onChange={e=>setStart(Number(e.target.value))}/></label>
    <label>{t('出点（秒）','Out (seconds)')}<input type="number" min="0" max={shot.sourceSeconds??shot.seconds} step="1" value={end} disabled={busy} onChange={e=>setEnd(Number(e.target.value))}/></label>
    <button className="secondary" disabled={busy||!Number.isInteger(start)||!Number.isInteger(end)||end-start<2||end>(shot.sourceSeconds??shot.seconds)} onClick={()=>void submit('shot-trim',{id:shot.id,start,end})}>{t('应用剪裁','Apply trim')}</button>
   </div>
  </details>}
 </div>;
}
