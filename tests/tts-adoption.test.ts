import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,confirmPreview,updateShot} from '../packages/core/project.ts';
import * as ledger from '../packages/providers/ledger.ts';
import {addAudioTrack,removeAudioTrack,validateAudioTracks} from '../packages/core/audio.ts';
function setup(){const p=seedProject();confirmPreview(p,p.revision);ledger.setProviderBudget(p,1000000,p.revision);return p;}
function generated(p:ReturnType<typeof setup>,durationMs=1000){
 const q=ledger.makeQuote(p,p.shots[0].id,{provider:'aliyun',kind:'audio',model:'xiaoyun',size:'tts',upperMicros:15000,pricingVersion:'fixture'},100);
 ledger.reserveProvider(p,q,crypto.randomUUID(),p.revision,101);const j=p.provider!.jobs.at(-1)!;
 const claim=ledger.claimProvider(p,j.id,102)!;
 ledger.applyProvider(p,j.id,claim.generation,{state:'succeeded',audio:'/api/assets/'+'a'.repeat(64)+'.wav',durationMs},103);return j;
}
test('TTS completion saves a candidate without changing the arrangement',()=>{const p=setup();const j=generated(p);assert.ok(j.resultAudio);assert.equal(p.audioTracks?.length??0,0);});
test('explicit TTS adoption replaces same-shot voice, preserves unrelated audio and reservations',()=>{
 const p=setup();addAudioTrack(p,{name:'music',audio:'/api/assets/'+'b'.repeat(64)+'.wav',durationMs:1000,offsetMs:0,volume:20,kind:'music',rights:'owned'},p.revision);const music=p.audioTracks![0];
 const a=generated(p);ledger.adoptProviderAudio(p,a.id,p.revision);const b=generated(p);assert.equal(p.audioTracks!.length,2);
 ledger.adoptProviderAudio(p,b.id,p.revision);assert.equal(p.audioTracks!.length,2);assert.deepEqual(p.audioTracks![0],music);assert.equal(p.audioTracks![1].id,b.id);assert.equal(ledger.providerTotals(p).reservedMicros,30000);
 assert.throws(()=>ledger.adoptProviderAudio(p,b.id,p.revision-1));
});
test('TTS adoption replaces an overlapping imported dialogue but keeps other shots and music',()=>{
 const p=setup();
 addAudioTrack(p,{name:'old owned voice',audio:'/api/assets/'+'b'.repeat(64)+'.wav',durationMs:2000,offsetMs:0,volume:70,kind:'dialogue',rights:'owned'},p.revision);
 const old=p.audioTracks![0];
 addAudioTrack(p,{name:'later voice',audio:'/api/assets/'+'c'.repeat(64)+'.wav',durationMs:1000,offsetMs:5000,volume:70,kind:'dialogue',rights:'owned'},p.revision);
 const later=p.audioTracks![1];
 addAudioTrack(p,{name:'music',audio:'/api/assets/'+'d'.repeat(64)+'.wav',durationMs:1000,offsetMs:0,volume:20,kind:'music',rights:'owned'},p.revision);
 const music=p.audioTracks![2];
 const job=generated(p);ledger.adoptProviderAudio(p,job.id,p.revision);
 assert.deepEqual(p.audioTracks?.map(t=>t.id),[later.id,music.id,job.id]);
 assert.ok(!p.audioTracks?.some(t=>t.id===old.id));
 assert.doesNotThrow(()=>validateAudioTracks(p,true));
});
test('TTS adoption refuses to discard an imported voice spanning shot boundaries',()=>{
 const p=setup();addAudioTrack(p,{name:'cross-shot voice',audio:'/api/assets/'+'b'.repeat(64)+'.wav',durationMs:6000,offsetMs:0,volume:70,kind:'dialogue',rights:'owned'},p.revision);
 const before=p.audioTracks![0];const job=generated(p);
 assert.throws(()=>ledger.adoptProviderAudio(p,job.id,p.revision),/跨越此镜头边界/);
 assert.deepEqual(p.audioTracks,[before]);assert.ok(job.resultAudio);
});
test('re-adopting a candidate repairs legacy duplicate same-shot voices',()=>{
 const p=setup();const a=generated(p),b=generated(p);ledger.adoptProviderAudio(p,a.id,p.revision);p.audioTracks!.push({...p.audioTracks![0],id:b.id});
 assert.throws(()=>validateAudioTracks(p,true));ledger.adoptProviderAudio(p,a.id,p.revision);assert.equal(p.audioTracks!.length,1);assert.doesNotThrow(()=>validateAudioTracks(p,true));
});
test('a kept candidate can be adopted after capacity is freed without another generation',()=>{
 const p=setup();for(let i=0;i<12;i++)addAudioTrack(p,{name:'owned',audio:'/api/assets/'+'b'.repeat(64)+'.wav',durationMs:1000,offsetMs:5000,volume:20,kind:'dialogue',rights:'owned'},p.revision);
 const j=generated(p);assert.throws(()=>ledger.adoptProviderAudio(p,j.id,p.revision));removeAudioTrack(p,p.audioTracks![0].id,p.revision);ledger.adoptProviderAudio(p,j.id,p.revision);
 assert.equal(p.audioTracks!.length,12);assert.equal(p.provider!.jobs.length,1);assert.equal(ledger.providerTotals(p).reservedMicros,15000);
});
test('editing dialogue after adoption blocks mixing outdated voice',()=>{
 const p=setup();const j=generated(p);ledger.adoptProviderAudio(p,j.id,p.revision);updateShot(p,p.shots[0].id,{dialogue:'new dialogue'},p.revision);assert.throws(()=>validateAudioTracks(p,true));
});
test('stale dialogue and shot overflow cannot be adopted; generated result is retained',()=>{
 const p=setup();const j=generated(p,6000);assert.throws(()=>ledger.adoptProviderAudio(p,j.id,p.revision));assert.ok(j.resultAudio);
 const q=setup();const a=generated(q);updateShot(q,q.shots[0].id,{dialogue:'changed'},q.revision);assert.throws(()=>ledger.adoptProviderAudio(q,a.id,q.revision));assert.equal(q.audioTracks?.length??0,0);
});
