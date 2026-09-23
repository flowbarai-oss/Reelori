import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyRenderMetadata} from '../packages/media/verify-output.ts';
const metadata='Duration: 00:00:05.00\nStream #0:0: Video: h264, yuv420p, 1080x1920, 24 fps, 24 tbr\nStream #0:1: Audio: aac, 48000 Hz\nStream #0:2: Subtitle: mov_text';
test('render gate rejects truncated frames and missing expected streams',()=>{
 assert.doesNotThrow(()=>verifyRenderMetadata(metadata,'frame=120\nprogress=end',5,true,true));
 assert.throws(()=>verifyRenderMetadata(metadata,'frame=119\nprogress=end',5,true,true));
 assert.throws(()=>verifyRenderMetadata(metadata.replace('Audio:','Missing:'),'frame=120',5,true,true));
 assert.throws(()=>verifyRenderMetadata(metadata.replace('1080x1920','720x1280'),'frame=120',5,true,true));
 assert.throws(()=>verifyRenderMetadata(metadata.replace('05.00','04.50'),'frame=120',5,true,true));
});
