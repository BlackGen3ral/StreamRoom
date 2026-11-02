import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewerNotifications, createUiSounds } from '../../src/StreamRoom.App/Web/ui-sounds.mjs';
test('viewer cues track people per stream, ignore reconnections/profile changes and reset silently',()=>{
  const heard=[],cues=createViewerNotifications(type=>heard.push(type));
  const watch=(viewerId,streamId='screen')=>({viewerId,streamId});
  cues.update([watch('friend')]);assert.deepEqual(heard,[]);
  cues.capture('screen');cues.update([watch('friend')]);
  cues.update([{...watch('friend'),subscriptionId:'reconnected',name:'changed'}]);
  cues.update([watch('friend'),watch('other')]);cues.update([watch('other')]);
  cues.capture(null);cues.update([]);cues.reset();
  assert.deepEqual(heard,['share','join','join','leave','stop']);
});
test('disabled app sounds do not create an output context or request media devices',()=>{
  const previous=globalThis.document;let contexts=0;
  globalThis.document={addEventListener(){},removeEventListener(){}};
  globalThis.AudioContext=class{constructor(){contexts++;}};
  try{const sounds=createUiSounds(()=>false);sounds.play('share');sounds.refresh();sounds.dispose();assert.equal(contexts,0);}
  finally{globalThis.document=previous;delete globalThis.AudioContext;}
});
