import {test} from 'node:test';import assert from 'node:assert/strict';
import {RtcRoom} from '../../src/StreamRoom.App/Web/rtc-room.mjs';
test('muting outgoing audio retains the tracks, source and connection objects',async()=>{
 const room=new RtcRoom(async()=>{}),audio={kind:'audio',enabled:true},video={kind:'video',enabled:true};
 const stream={getAudioTracks:()=>[audio],getTracks:()=>[audio,video]};room.localStream=stream;
 room.setCaptureAudioMuted(true);assert.equal(audio.enabled,false);assert.equal(video.enabled,true);assert.equal(room.localStream,stream);
 room.setCaptureAudioMuted(false);assert.equal(audio.enabled,true);clearInterval(room.timer);
 room.localStream={getAudioTracks:()=>[]};assert.throws(()=>room.setCaptureAudioMuted(true),/sem áudio/);
});
