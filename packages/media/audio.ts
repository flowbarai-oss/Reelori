import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {ffmpeg} from './runtime.ts';
import {DomainError} from '../core/project.ts';
export async function saveAudio(bytes:Buffer,dir:string){
 const wav=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE';
 const mp3=bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
 if(bytes.length>16*1024*1024||bytes.length<12||(!wav&&!mp3))throw new DomainError('请使用 16 MB 内的 WAV 或 MP3 音频');
 await mkdir(dir,{recursive:true});const token=randomUUID(),input=path.join(dir,token+'.input'),raw=path.join(dir,token+'.pcm');
 try{
  await writeFile(input,bytes,{flag:'wx'});
  try{await ffmpeg(['-protocol_whitelist','file,pipe','-i',input,'-map','0:a:0','-vn','-t','61','-ar','48000','-ac','2','-c:a','pcm_s16le','-f','s16le','-y',raw],60000);}catch{throw new DomainError('无法解码音频；原文件未加入项目');}
  const pcm=await readFile(raw),durationMs=Math.ceil(pcm.length/192);
  if(durationMs<100||durationMs>60000||pcm.length%4)throw new DomainError('音频须为 0.1–60 秒；不会静默截断较长音频');
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(pcm.length+36,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(192000,28);header.writeUInt16LE(4,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
  const normalized=Buffer.concat([header,pcm]),name=createHash('sha256').update(normalized).digest('hex')+'.wav';await writeFile(path.join(dir,name),normalized);
  return {audio:'/api/assets/'+name,durationMs};
 }finally{await unlink(input).catch(()=>{});await unlink(raw).catch(()=>{});}
}
