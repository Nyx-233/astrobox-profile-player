import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSPL } from '../assets/js/spl.js';
import { parseID3, normalizeEmbeddedLyrics } from '../assets/js/id3.js';

test('same timestamp: first text is original; later nonadjacent texts are translations', () => {
  const lines = parseSPL('[00:01.2]原文\n[00:02]次句\n[0:1.200000]译文\n[00:01.20]Translation');
  assert.deepEqual(lines[0], { time: 1.2, end: 2, original: '原文', translations: ['译文', 'Translation'] });
});
test('consecutive untimed translations attach to preceding original', () => {
  const lines = parseSPL('[01:00]原文\n中文\nEnglish\n[01:03]次句\n另一条');
  assert.deepEqual(lines[0].translations, ['中文', 'English']);
  assert.deepEqual(lines[1].translations, ['另一条']);
});
test('end-only rows never become originals or translations', () => {
  const lines = parseSPL('[00:01]第一句\n[00:03]\n[00:03]第二句\n[00:03]Second\n[00:05]');
  assert.equal(lines.length, 2);
  assert.equal(lines[0].end, 3);
  assert.equal(lines[1].original, '第二句');
  assert.deepEqual(lines[1].translations, ['Second']);
  assert.equal(lines[1].end, 5);
});
test('an end-only row breaks an untimed translation attachment', () => {
  const lines = parseSPL('[00:01]第一句\n[00:03]\nThis must not be a translation');
  assert.deepEqual(lines[0].translations, []);
});
test('repeated timestamps and following translations apply to both repeats', () => {
  const lines = parseSPL('[00:01][00:05]原文\n译文');
  assert.deepEqual(lines.map(x => x.time), [1, 5]);
  assert.deepEqual(lines.map(x => x.translations), [['译文'], ['译文']]);
});
test('explicit ending, implicit ending and offsets', () => {
  const lines = parseSPL('[offset:100]\n[00:01]A[00:02]\n[00:03]B\n[00:05]C');
  assert.equal(lines[0].time, 0.9);assert.equal(lines[0].end, 1.9);
  assert.equal(lines[1].end, 4.9);
});
test('one to six decimal places and one to three minute digits', () => {
  assert.equal(parseSPL('[103:3.405123]A')[0].time, 6183.405123);
  assert.equal(parseSPL('[3:12.5]A')[0].time, 192.5);
  assert.equal(parseSPL('[00:01.02]A')[0].time, 1.02);
  assert.equal(parseSPL('[0000:01]A').length, 0);
});
test('line display strips word stamps without treating them as repeated lyrics', () => {
  const lines = parseSPL('[00:01]<00:02>你[00:03]好[00:04]\nHello');
  assert.equal(lines.length, 1);assert.equal(lines[0].original, '你好');
  assert.equal(lines[0].end, 4);assert.deepEqual(lines[0].translations, ['Hello']);
});
test('bundled song has 26 bilingual lyric groups, preserving supplied text', () => {
  const source = normalizeEmbeddedLyrics(parseID3(readFileSync(new URL('../assets/audio/track.mp3', import.meta.url))).lyrics);
  const lines = parseSPL(source).filter(x => !/^(作词|作曲)\s*:/.test(x.original));
  assert.equal(lines.length, 26);
  assert(lines.every(line => line.translations.length === 1));
  assert.equal(lines[4].time, 11);
  assert.equal(lines[4].original, '変わらないはずはないよ 手を伸ばして');
  assert.equal(lines[4].translations[0], '一切并非无法改变 伸出手吧');
});
