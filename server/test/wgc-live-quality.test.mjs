import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WgcStream } from '../../src/StreamRoom.App/Web/wgc-stream.mjs';

test('native bridge updates its active session without replacing the stream and preserves options on failure', async () => {
  const previous = globalThis.window;
  globalThis.window = { chrome: { webview: { addEventListener() {}, removeEventListener() {} } } };
  try {
    const requests = []; let fail = false;
    const bridge = new WgcStream(async (type, payload) => { if (fail) throw Error('session closed'); requests.push({type,payload}); }, () => {});
    bridge.active = true; bridge.session = 'capture-session'; bridge.options = {quality:720,fps:30}; bridge.stream = {};
    const stream = bridge.stream;
    await bridge.configure({quality:1080,fps:60});
    assert.equal(bridge.stream,stream);assert.equal(bridge.session,'capture-session');
    assert.deepEqual(requests,[{type:'nativeCaptureConfigure',payload:{session:'capture-session',quality:1080,fps:60}}]);
    fail = true; await assert.rejects(bridge.configure({quality:480,fps:30}),/closed/);
    assert.equal(bridge.options.quality,1080); assert.equal(bridge.options.fps,60);
  } finally { globalThis.window = previous; }
});
