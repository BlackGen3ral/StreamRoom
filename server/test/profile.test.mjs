import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validAvatar, validName } from '../src/profile.ts';
import { boundedVideoSize } from '../../src/StreamRoom.App/Web/stream-viewport.mjs';
import {readFileSync} from 'node:fs';
const animated=readFileSync(new URL('../../tests/fixtures/animated-avatar.txt',import.meta.url),'utf8').trim();
test('animated avatars validate the complete bounded GIF structure',()=>{
  assert.equal(validAvatar(animated),true);
  const bytes=Buffer.from(animated.slice(22),'base64');
  for(const bad of [bytes.subarray(0,-1),Buffer.concat([bytes,Buffer.from([0])]),Buffer.from(bytes)]){
    if(bad.length===bytes.length)bad.writeUInt16LE(2048,6);
    assert.equal(validAvatar('data:image/gif;base64,'+bad.toString('base64')),false);
  }
  assert.equal(validAvatar('data:image/gif;base64,'+'A'.repeat(12000)),false);
});

test('profile images reject URLs, SVG, oversized payloads and oversized JPEG dimensions', () => {
  for (const value of ['https://example.com/image.jpg','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,'+'A'.repeat(8192),{},'data:image/jpeg;base64,abc?']) assert.equal(validAvatar(value),false);
  const header = size => 'data:image/jpeg;base64,' + Buffer.from([255,216,255,192,0,8,8,0,size,0,size,3,255,217]).toString('base64');
  assert.equal(validAvatar(header(96)),true);
  assert.equal(validAvatar(header(129)),false);
  assert.equal(validAvatar(null),true);
  assert.equal(validAvatar(undefined),true);
  assert.equal(validName('  Amigo  '),true);
  for (const name of ['', '  ', 'a'.repeat(33),'a\u0000b',null]) assert.equal(validName(name),false);
});

test('video resizing clamps to the available width while allowing independent height', () => {
  assert.deepEqual(boundedVideoSize(1400,900,900),{width:900,height:900});
  assert.deepEqual(boundedVideoSize(640,340,1200),{width:640,height:340});
  assert.deepEqual(boundedVideoSize(-30,-1,700),{width:280,height:160});
  assert.deepEqual(boundedVideoSize(800,5000,200),{width:200,height:2160});
  assert.deepEqual(boundedVideoSize(640,900,1200,430),{width:640,height:430});
});
