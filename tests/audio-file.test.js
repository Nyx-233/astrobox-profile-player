import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMP3 } from './fixtures.js';
import { loadAudioFile } from '../assets/js/audio-file.js';

const mp3 = makeMP3();
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const response = (bytes, status = 200, range = null) => ({
  ok: true, status, headers: { get: () => range }, arrayBuffer: async () => buffer(bytes),
});

test('one complete request creates an audio/mpeg Blob with the original MP3 bytes', async () => {
  const calls = [];
  const result = await loadAudioFile('track.mp3', async (...args) => {
    calls.push(args);
    // A server without Range support can still serve this playback source.
    return response(mp3);
  });
  try {
    assert.deepEqual(calls, [['track.mp3', { cache: 'no-store' }]]);
    assert(result.url.startsWith('blob:'));
    const blob = await fetch(result.url);
    assert.equal(blob.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), mp3);
    assert.deepEqual(Buffer.from(result.bytes), mp3);
  } finally { URL.revokeObjectURL(result.url); }
});

test('metadata-only or incomplete 206 responses cannot be used for playback', async () => {
  for (const range of ['bytes 0-9/1611757', 'bytes 10-19/20', null]) {
    await assert.rejects(loadAudioFile('track.mp3', async () => response(mp3.subarray(0,10),206,range)), /Incomplete/);
  }
});

test('a complete 206 response is accepted; empty and HTTP error responses fail', async () => {
  const full = await loadAudioFile('track.mp3', async () => response(mp3,206,`bytes 0-${mp3.length-1}/${mp3.length}`));
  URL.revokeObjectURL(full.url);
  await assert.rejects(loadAudioFile('track.mp3', async () => response(Buffer.alloc(0))), /Empty/);
  await assert.rejects(loadAudioFile('track.mp3', async () => ({ok:false,status:404})), /404/);
});
