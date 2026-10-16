import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseID3, readID3, normalizeEmbeddedLyrics } from '../assets/js/id3.js';
const mp3 = readFileSync(new URL('../assets/audio/track.mp3', import.meta.url));
const buffer = bytes => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test('read title, JPEG and bilingual lyric text directly from supplied MP3', () => {
  const tags = parseID3(mp3);
  assert.equal(tags.title, '雑踏、僕らの街 (OP)');
  assert.equal(tags.artwork.mime, 'image/jpeg');
  assert.equal(tags.artwork.bytes.length, 119836);
  assert.deepEqual([...tags.artwork.bytes.slice(0,2)], [255,216]);
  assert(tags.lyrics.includes('[00:11.00]変わらないはずはないよ 手を伸ばして\u2009一切并非无法改变 伸出手吧'));
});
test('fetch only ID3 header and metadata when server supports range requests', async () => {
  const ranges = [];
  const result = await readID3('track.mp3', async (_,options) => {
    const [,a,b] = options.headers.Range.match(/bytes=(\d+)-(\d+)/);
    ranges.push([Number(a),Number(b)]);
    return { ok:true, status:206, arrayBuffer:async()=>buffer(mp3.subarray(Number(a),Number(b)+1)) };
  });
  assert.equal(result.title, '雑踏、僕らの街 (OP)');
  assert.deepEqual(ranges, [[0,9],[0,122859]]);
});
test('server returning full MP3 is handled without a second fetch', async () => {
  let calls=0;
  const result=await readID3('track.mp3',async()=>{calls++;return{ok:true,status:200,arrayBuffer:async()=>buffer(mp3)}});
  assert.equal(calls,1);assert(result.lyrics.length>0);
});
test('legacy inline translation is normalized only in memory; SPL input remains unchanged', () => {
  assert.equal(normalizeEmbeddedLyrics('[00:01]原文\u2009译文'), '[00:01]原文\n[00:01]译文');
  const spl='[00:01]原文\n译文\n另一条译文';
  assert.equal(normalizeEmbeddedLyrics(spl), spl);
});
test('v2.4 UTF-8 fields and same-time SPL translations', () => {
  const size=n=>Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]);
  const frame=(id,data)=>Buffer.concat([Buffer.from(id),size(data.length),Buffer.from([0,0]),data]);
  const content=Buffer.concat([
    frame('TIT2',Buffer.concat([Buffer.from([3]),Buffer.from('测试歌曲')])),
    frame('USLT',Buffer.concat([Buffer.from([3]),Buffer.from('eng'),Buffer.from([0]),Buffer.from('[00:01]原文\n[00:01]译文')]))
  ]);
  const tags=parseID3(Buffer.concat([Buffer.from('ID3'),Buffer.from([4,0,0]),size(content.length),content]));
  assert.equal(tags.title,'测试歌曲');assert.equal(tags.lyrics,'[00:01]原文\n[00:01]译文');
});
test('truncated or unsupported tags fail clearly', () => {
  assert.throws(()=>parseID3(mp3.subarray(0,20)),/Incomplete/);
  assert.throws(()=>parseID3(Buffer.alloc(10)),/no leading/);
});
