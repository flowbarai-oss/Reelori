import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,writeFile,rename,rm,unlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DomainError} from '../core/project.ts';
import {Store} from './store.ts';
import {validateProject} from './validate-project.ts';

export const MAX_WORKSPACE_BYTES=256*1024*1024;
const MAX_FILE_BYTES=96*1024*1024;
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
type FileEntry={path:string;length:number;sha256:string;data:string};
export type WorkspaceArchive={format:'reelori-workspace';version:1;createdAt:string;database:FileEntry;files:FileEntry[]};
const assetName=/^assets\/[a-f0-9]{64}\.(png|jpg|mp4|wav)$/;
const exportName=/^exports\/[a-f0-9-]{36}\.(json|mp4|srt|vtt|zip|backup|backup-index\.json)$/;
function bad(message:string):never{throw new DomainError(message,409);}
function entry(name:string,bytes:Buffer):FileEntry{return {path:name,length:bytes.length,sha256:digest(bytes),data:bytes.toString('base64')};}
function decode(value:unknown,name:string){
 if(!value||typeof value!=='object'||Array.isArray(value))bad('工作区备份文件条目无效');
 const v=value as FileEntry;
 if(Object.keys(v).some(k=>!['path','length','sha256','data'].includes(k))||v.path!==name||!Number.isSafeInteger(v.length)||v.length<0||v.length>MAX_FILE_BYTES||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256)||typeof v.data!=='string'||v.data.length>Math.ceil(MAX_FILE_BYTES/3)*4||v.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(v.data))bad('工作区备份文件条目无效');
 const bytes=Buffer.from(v.data,'base64');
 if(bytes.length!==v.length||digest(bytes)!==v.sha256)bad('工作区备份文件摘要不一致');
 return bytes;
}
async function collect(directory:string,kind:'assets'|'exports'){
 const rows=await readdir(path.join(directory,kind),{withFileTypes:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
 const result:FileEntry[]=[];
 for(const row of rows){
  if(!row.isFile())continue;
  const name=kind+'/'+row.name;
  if(row.name.endsWith('.tmp')||row.name.endsWith('.partial.mp4'))continue;
  if(!(kind==='assets'?assetName:exportName).test(name))bad('工作区包含不支持的已完成素材或成果文件：'+row.name);
  const bytes=await readFile(path.join(directory,kind,row.name));
  if(bytes.length>MAX_FILE_BYTES)throw new DomainError('单个工作区文件超过 96 MiB 上限',413);
  if(kind==='assets'&&digest(bytes)!==row.name.split('.')[0])bad('素材文件摘要与文件名不一致');
  result.push(entry(name,bytes));
 }
 return result;
}
export async function createWorkspaceArchive(store:Store,dataDir:string):Promise<WorkspaceArchive>{
 const scratch=await mkdtemp(path.join(tmpdir(),'reelori-workspace-snapshot-'));
 try{
  const db=path.join(scratch,'studio.sqlite');
  store.db.prepare('VACUUM INTO ?').run(db);
  const snapshot=await readFile(db);
  const files=[...await collect(dataDir,'assets'),...await collect(dataDir,'exports')];
  const archive:WorkspaceArchive={format:'reelori-workspace',version:1,createdAt:new Date().toISOString(),database:entry('studio.sqlite',snapshot),files};
  await inspectWorkspaceArchive(archive);
  return archive;
 }finally{await rm(scratch,{recursive:true,force:true});}
}
function mediaRefs(value:unknown,result:Set<string>){
 if(!value||typeof value!=='object')return;
 for(const [key,item] of Object.entries(value)){
  if(['image','video','resultImage','resultVideo','audio','resultAudio'].includes(key)&&typeof item==='string'&&item.startsWith('/api/assets/'))result.add('assets/'+item.slice('/api/assets/'.length));
  else if(typeof item==='object')mediaRefs(item,result);
 }
}
export async function inspectWorkspaceArchive(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))bad('工作区备份格式无效');
 const a=value as WorkspaceArchive;
 if(Object.keys(a).some(k=>!['format','version','createdAt','database','files'].includes(k))||a.format!=='reelori-workspace'||a.version!==1||typeof a.createdAt!=='string'||!Number.isFinite(Date.parse(a.createdAt))||!Array.isArray(a.files)||a.files.length>1000||Buffer.byteLength(JSON.stringify(a))>MAX_WORKSPACE_BYTES)throw new DomainError('工作区备份格式无效或超过 256 MiB 上限',413);
 const db=decode(a.database,'studio.sqlite');
 if(!db.subarray(0,16).equals(Buffer.from('SQLite format 3\0')))bad('工作区数据库格式无效');
 const found=new Set<string>(),files=new Map<string,Buffer>();let bytes=db.length;
 for(const item of a.files){
  const name=item?.path;
  if(typeof name!=='string'||!(assetName.test(name)||exportName.test(name))||found.has(name))bad('工作区文件路径无效或重复');
  const content=decode(item,name);
  if(name.startsWith('assets/')&&digest(content)!==name.slice(7).split('.')[0])bad('工作区素材摘要与文件名不符');
  found.add(name);files.set(name,content);bytes+=content.length;
 }
 const scratch=await mkdtemp(path.join(tmpdir(),'reelori-workspace-inspect-'));
 let reader:Store|undefined;
 try{
  const file=path.join(scratch,'studio.sqlite');await writeFile(file,db,{flag:'wx'});
  reader=new Store(file);
  const projects=reader.list();if(!projects.length||projects.length>100)bad('工作区项目数量无效');
  const refs=new Set<string>();
  for(const item of projects){const current=reader.get(item.id),history=reader.history(item.id);validateProject(current);if(!history.length||history.at(-1)?.revision!==current.revision)bad('工作区历史版本不完整');for(const p of history){validateProject(p);mediaRefs(p,refs);}mediaRefs(current,refs);}
  for(const ref of refs)if(!found.has(ref))bad('工作区缺少被项目引用的素材');
  for(const [name,content] of files)if(name.endsWith('.json')&&name.startsWith('exports/')){
   let m:any;try{m=JSON.parse(content.toString('utf8'));}catch{bad('成果清单 JSON 无效');}
   if(m?.kind==='mixed-media-animatic'||m?.kind==='still-image-animatic'){
    const prefix=name.slice(0,-5);if(!['.mp4','.srt','.vtt'].every(ext=>found.has(prefix+ext)))bad('工作区成片文件不完整');
   }
  }
  return {projects:projects.length,renders:[...found].filter(n=>n.endsWith('.mp4')&&n.startsWith('exports/')).length,assets:[...found].filter(n=>n.startsWith('assets/')).length,files:found.size,bytes,createdAt:a.createdAt};
 }finally{reader?.close();await rm(scratch,{recursive:true,force:true});}
}
export async function restoreWorkspaceArchive(value:unknown,base:string){
 const details=await inspectWorkspaceArchive(value);
 const a=value as WorkspaceArchive;
 const root=path.resolve(base),id=randomUUID(),final=path.join(root,id),partial=path.join(root,id+'.partial');
 if(path.dirname(path.resolve(partial))!==root||path.dirname(path.resolve(final))!==root)bad('恢复目录无效');
 await mkdir(root,{recursive:true});await mkdir(partial,{recursive:false});
 let restored:Store|undefined;
 try{
  await writeFile(path.join(partial,'studio.sqlite'),decode(a.database,'studio.sqlite'),{flag:'wx'});
  for(const item of a.files){const target=path.resolve(partial,item.path);if(!target.startsWith(path.resolve(partial)+path.sep))bad('恢复文件路径越界');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,decode(item,item.path),{flag:'wx'});}
  restored=new Store(path.join(partial,'studio.sqlite'));
  for(const row of restored.list())restored.transact(p=>{
   p.paused=true;p.revision++;
   for(const j of p.provider?.jobs??[]){j.recoveryBlocked=true;j.leaseUntil=0;j.generation++;if(!['succeeded','failed'].includes(j.state))j.state='unknown';}
   for(const j of p.jobs)if(['queued','running'].includes(j.status))j.status='unknown';
   p.events.push({id:(p.events.at(-1)?.id??0)+1,text:'工作区已从备份恢复；任务已暂停，费用待核对',at:Date.now()});p.events=p.events.slice(-100);
  },row.id);
  restored.close();restored=undefined;
  await rename(partial,final);
  return {id,path:final,...details,paused:true};
 }catch(e){restored?.close();await rm(partial,{recursive:true,force:true});throw e;}
}
export async function saveWorkspaceArchive(store:Store,dataDir:string){
 const archive=await createWorkspaceArchive(store,dataDir),details=await inspectWorkspaceArchive(archive);
 const id=randomUUID(),dir=path.join(dataDir,'workspace-backups'),file=path.join(dir,id+'.workspace'),index=path.join(dir,id+'.workspace-index.json');
 const record={id,...details,download:`/api/workspace-download?id=${id}`};
 await mkdir(dir,{recursive:true});
 try{
  await writeFile(file+'.tmp',JSON.stringify(archive),'utf8');await rename(file+'.tmp',file);
  await writeFile(index+'.tmp',JSON.stringify(record),'utf8');await rename(index+'.tmp',index);
  return record;
 }catch(e){for(const target of [file+'.tmp',index+'.tmp',file,index])await unlink(target).catch(()=>{});throw e;}
}
export async function listWorkspaceArchives(dataDir:string){
 const dir=path.join(dataDir,'workspace-backups'),names=await readdir(dir).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return [];throw e;});
 const result=[];
 for(const name of names){if(!/^[a-f0-9-]{36}\.workspace-index\.json$/.test(name))continue;
  try{const record=JSON.parse(await readFile(path.join(dir,name),'utf8'));if(record.id+'.workspace-index.json'===name){await access(path.join(dir,record.id+'.workspace'));result.push(record);}}catch{}
 }
 return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
