import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject} from '../packages/core/project.ts';
import {subtitleCues,setSubtitles} from '../packages/core/subtitles.ts';
test('subtitle editing preserves dialogue and visual inputs, reset is explicit',()=>{
 const p=seedProject(),before=structuredClone(p);const cues=[{startMs:200,endMs:2200,text:'Edited subtitle'}];
 setSubtitles(p,cues,p.revision);assert.deepEqual(subtitleCues(p),cues);assert.deepEqual(p.shots,before.shots);assert.equal(p.inputRevision,before.inputRevision);assert.equal(p.subtitleRevision,1);
 assert.throws(()=>setSubtitles(p,[],before.revision));setSubtitles(p,null,p.revision);assert.equal(subtitleCues(p)[0].text,p.shots[0].dialogue);
});
test('subtitle timeline rejects reversed, overlapping, overflowing and malformed cues',()=>{
 const p=seedProject();for(const cues of [[{startMs:300,endMs:200,text:'x'}],[{startMs:0,endMs:16000,text:'x'}],[{startMs:0,endMs:2000,text:'x'},{startMs:1000,endMs:3000,text:'y'}],[{startMs:0,endMs:1000,text:'x',secret:'no'}]])assert.throws(()=>setSubtitles(p,cues,p.revision));
 setSubtitles(p,[],p.revision);assert.deepEqual(subtitleCues(p),[]);
 assert.throws(()=>setSubtitles(p,undefined,p.revision));
});
