import {ProviderError} from './flowbar.ts';
export async function boundedText(response:Response,max:number,code:string){
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw new ProviderError(code);}
 if(!response.body)return '';
 const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>max)throw new ProviderError(code);chunks.push(item.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
