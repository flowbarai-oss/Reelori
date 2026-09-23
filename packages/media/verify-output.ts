import {DomainError} from '../core/project.ts';
import {ffmpegPath,runFile} from './runtime.ts';
export function verifyRenderMetadata(metadata:string,progress:string,seconds:number,audio:boolean,subtitles:boolean){
 const d=metadata.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
 const duration=d?Number(d[1])*3600+Number(d[2])*60+Number(d[3]):NaN;
 const frames=Number([...progress.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1]);
 const video=/Video:[^\r\n]*1080x1920[^\r\n]*\b24 fps\b/.test(metadata);
 if(!video||!Number.isFinite(duration)||Math.abs(duration-seconds)>0.12||frames!==Math.round(seconds*24)||audio!==/Audio:/.test(metadata)||subtitles!==/Subtitle: mov_text/.test(metadata))
  throw new DomainError('合成结果的画面、时长、帧数或音轨/字幕不符合计划，未发布此成片',503);
 return {width:1080,height:1920,fps:24,frames,durationSeconds:duration,audio,subtitles};
}
export async function verifyRenderedFile(file:string,seconds:number,audio:boolean,subtitles:boolean){
 const result=await runFile(ffmpegPath(),['-hide_banner','-nostdin','-xerror','-i',file,'-map','0:v:0','-map','0:a?','-progress','pipe:1','-f','null','-'],{windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});
 return verifyRenderMetadata(result.stderr.split('Stream mapping:')[0],result.stdout,seconds,audio,subtitles);
}
