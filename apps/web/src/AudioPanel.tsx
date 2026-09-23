import {useEffect,useRef,useState} from 'react';
import type {Project} from '../../../packages/contracts/index.ts';
export function AudioPanel({project,lang,request,onChange}:{project:Project;lang:string;request:(path:string,body?:unknown)=>Promise<any>;onChange:(p:Project)=>void}){
 const t=(zh:string,en:string)=>lang==='zh'?zh:en;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const live=useRef(true);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function change(route:string,body:Record<string,unknown>){setBusy(true);setError('');try{const p=await request(route,{...body,revision:project.revision});if(live.current)onChange(p);}catch(e){if(live.current)setError((e as Error).message);}finally{if(live.current)setBusy(false);}}
 return <section className="audio-panel">
  <h3>{t('声音素材','Sound library')} · {project.audioTracks?.length??0}/10</h3>
  <p className="fine">{t('导入你有权使用的配音、音乐或音效。WAV / MP3，单段 0.1–30 秒、10 MB 内。最多 8 段配音、1 段音乐和 1 段音效。','Import voice, music or effects you may use. WAV / MP3, 0.1–30 seconds and up to 10 MB each. Up to 8 voice clips, 1 music track and 1 effect.')}</p>
  <form className="audio-form" onSubmit={async e=>{
   e.preventDefault();const data=new FormData(e.currentTarget),file=data.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024){setError(t('请选择 10 MB 内的音频文件','Choose an audio file up to 10 MB'));return;}
   setBusy(true);setError('');try{const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error(t('文件读取失败','File read failed')));reader.readAsDataURL(file);});await change('audio',{name:file.name.slice(0,80),data:encoded,kind:data.get('kind'),rights:data.get('rights'),offsetMs:Math.round(Number(data.get('offset'))*1000),volume:Number(data.get('volume'))});}catch(e){if(live.current){setError((e as Error).message);setBusy(false);}}
  }}>
   <label>{t('音频文件','Audio file')}<input type="file" name="file" accept=".wav,.mp3,audio/wav,audio/mpeg" required disabled={busy}/></label>
   <label>{t('声音用途','Track type')}<select name="kind" disabled={busy}><option value="dialogue">{t('配音','Voice')}</option><option value="music">{t('背景音乐','Music')}</option><option value="effect">{t('音效','Effect')}</option></select></label>
   <label>{t('使用权声明','Usage rights')}<select name="rights" defaultValue="" required disabled={busy}><option value="" disabled>{t('请选择来源','Choose rights')}</option><option value="owned">{t('我拥有权利','I own the rights')}</option><option value="licensed">{t('已获授权','Licensed')}</option><option value="generated">{t('合法生成素材','Generated with usage rights')}</option></select></label>
   <label>{t('起始秒数','Start, seconds')}<input name="offset" type="number" min="0" max="30" step="0.1" defaultValue="0" required disabled={busy}/></label>
   <label>{t('音量 %','Volume %')}<input name="volume" type="number" min="0" max="100" step="1" defaultValue="70" required disabled={busy}/></label>
   <button className="secondary" disabled={busy}>{busy?t('正在处理…','Working…'):t('导入声音','Import audio')}</button>
  </form>
  {error&&<p role="alert" className="inline-error">{error}</p>}
  {(project.audioTracks??[]).map(track=><div className="audio-track" key={track.id}>
   <strong>{track.name}</strong><p className="fine">{t(track.kind==='dialogue'?'配音':track.kind==='music'?'背景音乐':'音效',track.kind)} · {(track.durationMs/1000).toFixed(2)}s</p>
   <audio controls preload="metadata" src={track.audio} aria-label={t('试听 ','Preview ')+track.name}/>
   <form className="audio-form" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void change('audio-track',{id:track.id,offsetMs:Math.round(Number(data.get('offset'))*1000),volume:Number(data.get('volume'))});}}>
    <label>{t('起始秒数','Start, seconds')}<input name="offset" type="number" min="0" max="30" step="0.1" defaultValue={track.offsetMs/1000} required disabled={busy}/></label>
    <label>{t('音量 %','Volume %')}<input name="volume" type="number" min="0" max="100" step="1" defaultValue={track.volume} required disabled={busy}/></label>
    <button className="secondary" disabled={busy}>{t('保存编排','Save arrangement')}</button>
    <button type="button" className="secondary" disabled={busy} onClick={()=>void change('audio-remove',{id:track.id})}>{t('移出编排','Remove from arrangement')}</button>
   </form>
  </div>)}
  <p className="fine">{t('选择“混合导入声音”后才用于成片；该模式不叠加原视频声音。音频超出时间线会阻止导出，请先调整。','Choose “Mix imported audio” to use these tracks. That mode excludes source video audio. Resolve any timeline overflow before exporting.')}</p>
 </section>;
}
