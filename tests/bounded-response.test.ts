import test from 'node:test';
import assert from 'node:assert/strict';
import {createAliyunToken} from '../packages/providers/aliyun-token.ts';
test('oversized token response cancels the stream before consuming the full body',async()=>{
 let pulled=0,cancelled=false;
 const stream=new ReadableStream({pull(c){pulled++;if(pulled>100)c.close();else c.enqueue(new Uint8Array(4096));},cancel(){cancelled=true;}});
 await assert.rejects(()=>createAliyunToken('fixture','fixture',async()=>new Response(stream)),/too_large/);
 assert.ok(cancelled);assert.ok(pulled<10);
});
