import {test} from 'node:test';import assert from 'node:assert/strict';
import {RtcRoom} from '../../src/StreamRoom.App/Web/rtc-room.mjs';
test('muting outgoing audio retains the tracks, source and connection objects',async()=>{
 const room=new RtcRoom(async()=>{}),audio={kind:'audio',enabled:true},video={kind:'video',enabled:true};
 const stream={getAudioTracks:()=>[audio],getTracks:()=>[audio,video]};room.localStream=stream;
 room.setCaptureAudioMuted(true);assert.equal(audio.enabled,false);assert.equal(video.enabled,true);assert.equal(room.localStream,stream);
 room.setCaptureAudioMuted(false);assert.equal(audio.enabled,true);clearInterval(room.timer);
 room.localStream={getAudioTracks:()=>[]};assert.throws(()=>room.setCaptureAudioMuted(true),/sem áudio/);
});
test('adding audio mid-stream replaces reserved audio senders while video and incoming peers stay intact',async()=>{
 const calls=[],room=new RtcRoom(async(type)=>{calls.push(type);});
 const video={kind:'video'},audio={kind:'audio',enabled:true,stop(){this.stopped=true;}},tracks=[video];
 const stream={getTracks:()=>tracks,getAudioTracks:()=>tracks.filter(t=>t.kind==='audio'),addTrack:t=>tracks.push(t),removeTrack:t=>tracks.splice(tracks.indexOf(t),1)};
 room.localStream=stream;room.localId='live';room.run=1;
 const replacements=[],incoming={direction:'receive',pc:{}},sender={direction:'send',pc:{},audioSender:{async replaceTrack(t){replacements.push(t);}}};
 room.peers.set('out',sender);room.peers.set('in',incoming);room.validPeer=()=>true;
 room.startSystemAudio=async(s)=>s.addTrack(audio);
 await room.enableCaptureAudio();assert.equal(room.localStream,stream);assert.equal(room.peers.get('in'),incoming);assert.equal(room.peers.get('out'),sender);assert.deepEqual(replacements,[audio]);
 assert.deepEqual(calls,[]);assert.equal(tracks[0],video);assert.equal(room.captureAudioMuted,false);
 room.setCaptureAudioMuted(true);assert.equal(audio.enabled,false);await room.enableCaptureAudio();assert.equal(audio.enabled,true);assert.deepEqual(calls,[]);clearInterval(room.timer);
});
test('audio starts directly once from the explicit live audio action, without another prompt',async()=>{
 const calls=[],room=new RtcRoom(async(type)=>{calls.push(type);});let track;
 room.localStream={getAudioTracks:()=>track?[track]:[]};let starts=0;
 room.startSystemAudio=async()=>{starts++;await Promise.resolve();track={enabled:true};};
 await Promise.all([room.enableCaptureAudio(),room.enableCaptureAudio()]);
 assert.equal(starts,1);assert.deepEqual(calls,[]);clearInterval(room.timer);
});
