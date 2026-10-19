import test from 'node:test';
import assert from 'node:assert/strict';
import { parseID3, readID3, normalizeEmbeddedLyrics } from '../assets/js/id3.js';
import { makeMP3, fixtureLyrics, tinyPNG } from './fixtures.js';
const mp3=makeMP3();
const buffer=bytes=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

test('metadata is read from generated v2.2/v2.3/v2.4 files without song-specific assumptions',()=>{
  for (const version of [2,3,4]) {
    const tags=parseID3(makeMP3({version,title:`Track ${version}`}));
    assert.equal(tags.title,`Track ${version}`);
    assert.equal(tags.lyrics,fixtureLyrics());
    assert.equal(tags.lyricsLanguage,'en');
    assert.equal(tags.artwork.mime,'image/png');
    assert.deepEqual(Buffer.from(tags.artwork.bytes),tinyPNG);
  }
});
test('range metadata requests use the actual tag size',async()=>{
  const ranges=[];
  const tags=await readID3('test.mp3',async(_,options)=>{
    const [,a,b]=options.headers.Range.match(/bytes=(\d+)-(\d+)/);
    ranges.push([Number(a),Number(b)]);
    return {ok:true,status:206,arrayBuffer:async()=>buffer(mp3.subarray(Number(a),Number(b)+1))};
  });
  const tagSize=mp3.subarray(6,10).reduce((n,b)=>n*128+b,0);
  assert.equal(tags.title,'Fixture track');
  assert.deepEqual(ranges,[[0,9],[0,tagSize+9]]);
});
test('servers ignoring Range are parsed after a single full response',async()=>{
  let calls=0;
  const tags=await readID3('test.mp3',async()=>{calls++;return {ok:true,status:200,arrayBuffer:async()=>buffer(mp3)};});
  assert.equal(calls,1);assert.equal(tags.title,'Fixture track');
});
test('untagged files and ID3v1-only files do not require ID3v2',async()=>{
  assert.equal(parseID3(makeMP3({tagged:false})).title,'');
  const bytes=makeMP3({tagged:false,v1Title:'Legacy title'});
  assert.equal(parseID3(bytes).title,'Legacy title');
  let calls=0;
  const tags=await readID3('legacy.mp3',async(_,options)=>{
    calls++;const data=options?.headers?bytes.subarray(0,10):bytes;
    return {ok:true,status:options?.headers?206:200,arrayBuffer:async()=>buffer(data)};
  });
  assert.equal(tags.title,'Legacy title');assert.equal(calls,2);
});
test('thin-space inline translations work without song-specific configuration',()=>{
  const lyrics='[00:01]Original\u2009Translation';
  assert.equal(normalizeEmbeddedLyrics(lyrics),'[00:01]Original\n[00:01]Translation');
  assert.equal(normalizeEmbeddedLyrics(lyrics,''),lyrics);
  assert.equal(normalizeEmbeddedLyrics('[00:01]An ordinary space'),'[00:01]An ordinary space');
  assert.equal(normalizeEmbeddedLyrics('Plain\u2009text'),'Plain\u2009text');
  assert.equal(normalizeEmbeddedLyrics('[00:01]A | B',' | '),'[00:01]A\n[00:01]B');
});
test('lyric language follows metadata instead of a fixed source/translation language',()=>{
  for (const [language,expected] of [['eng','en'],['fra','fr'],['jpn','ja'],['und','und']]) {
    assert.equal(parseID3(makeMP3({language})).lyricsLanguage,expected);
  }
});
test('truncated ID3 data fails clearly while missing tags are normal',()=>{
  assert.throws(()=>parseID3(mp3.subarray(0,20)),/Incomplete/);
  assert.equal(parseID3(Buffer.alloc(10)).artwork,null);
});

test('image/jpg APIC covers are recognized as JPEG, including picture type zero', () => {
  const picture=Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46]);
  const size=n=>Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]);
  for (const mime of ['image/jpg','IMAGE/JPG','image/jpeg']) {
    const data=Buffer.concat([Buffer.from([0]),Buffer.from(mime),Buffer.from([0,0,0]),picture]);
    const frameSize=Buffer.alloc(4);frameSize.writeUInt32BE(data.length);
    const content=Buffer.concat([Buffer.from('APIC'),frameSize,Buffer.from([0,0]),data]);
    const tags=parseID3(Buffer.concat([Buffer.from('ID3'),Buffer.from([3,0,0]),size(content.length),content]));
    assert.equal(tags.artwork.mime,'image/jpeg');
    assert.equal(tags.artwork.type,0);
    assert.deepEqual(Buffer.from(tags.artwork.bytes),picture);
  }
});

function pictureTag(pictures) {
  const size=n=>Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]);
  const frames=pictures.map(({mime='',bytes,type=0})=>{
    const data=Buffer.concat([Buffer.from([0]),Buffer.from(mime),Buffer.from([0,type,0]),bytes]);
    const length=Buffer.alloc(4);length.writeUInt32BE(data.length);
    return Buffer.concat([Buffer.from('APIC'),length,Buffer.from([0,0]),data]);
  });
  const content=Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'),Buffer.from([3,0,0]),size(content.length),content]);
}

test('recognize common image signatures even with missing or incorrect MIME labels', () => {
  const cases=[
    ['image/jpeg',Buffer.from([255,216,255,224])],
    ['image/png',Buffer.from([137,80,78,71,13,10,26,10])],
    ['image/gif',Buffer.from('GIF89a')],
    ['image/gif',Buffer.from('GIF87a')],
    ['image/webp',Buffer.from('RIFF\0\0\0\0WEBPVP8 ')],
    ['image/bmp',Buffer.from('BM\0\0')],
    ['image/x-icon',Buffer.from([0,0,1,0,1,0])],
    ['image/x-icon',Buffer.from([0,0,2,0,1,0])],
    ['image/tiff',Buffer.from([73,73,42,0])],
    ['image/tiff',Buffer.from([77,77,0,42])],
    ['image/jxl',Buffer.from([255,10])],
    ['image/jxl',Buffer.from([0,0,0,12,74,88,76,32,13,10,135,10])],
    ['image/jp2',Buffer.from([0,0,0,12,106,80,32,32,13,10,135,10])],
  ];
  for (const [expected,bytes] of cases) {
    for (const mime of ['', 'application/octet-stream', 'image/incorrect']) {
      const artwork=parseID3(pictureTag([{mime,bytes}])).artwork;
      assert.equal(artwork.mime,expected);
      assert.deepEqual(Buffer.from(artwork.bytes),bytes);
    }
  }
});

test('identify AVIF/HEIF codec brands rather than treating any ftyp file as an image', () => {
  for (const [brands,expected] of [
    [['avif'],'image/avif'],[['mif1','avif'],'image/avif'],[['avis'],'image/avif'],
    [['heic','mif1'],'image/heic'],[['hevc','msf1'],'image/heic-sequence'],
    [['mif1'],'image/heif'],[['msf1'],'image/heif-sequence'],[['isom','mp42'],null],
  ]) {
    const length=Buffer.alloc(4);length.writeUInt32BE(12+brands.length*4);
    const bytes=Buffer.concat([length,Buffer.from('ftyp'+brands[0]),Buffer.alloc(4),Buffer.from(brands.slice(1).join(''))]);
    const artwork=parseID3(pictureTag([{mime:'',bytes}])).artwork;
    assert.equal(artwork?.mime || null,expected);
  }
});

test('SVG signatures work with XML declarations, comments and Unicode byte order marks', () => {
  for (const bytes of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    Buffer.from('\uFEFF <?xml version="1.0"?>\n<!-- cover -->\n<svg></svg>'),
    Buffer.concat([Buffer.from([255,254]),Buffer.from('<svg></svg>','utf16le')]),
  ]) assert.equal(parseID3(pictureTag([{mime:'',bytes}])).artwork.mime,'image/svg+xml');
});

test('normalize aliases and allow other declared image formats without a codec whitelist', () => {
  const bytes=Buffer.from('future image payload');
  for (const [mime,expected] of [
    ['JPG','image/jpeg'],['image/pjpeg','image/jpeg'],[' image/x-png ','image/png'],
    ['image/x-ms-bmp','image/bmp'],['image/vnd.microsoft.icon','image/x-icon'],
    ['image/svg','image/svg+xml'],['IMAGE/VND.EXAMPLE+IMAGE; profile=test','image/vnd.example+image'],
    ['image/heic','image/heic'],['image/tiff','image/tiff'],
  ]) assert.equal(parseID3(pictureTag([{mime,bytes}])).artwork.mime,expected);
  for (const mime of ['text/html','application/octet-stream','constructor','__proto__','-->']) {
    assert.equal(parseID3(pictureTag([{mime,bytes}])).artwork,null);
  }
  assert.equal(parseID3(pictureTag([{mime:'image/png',bytes:Buffer.alloc(0)}])).artwork,null);
});

test('front cover remains preferred when several APIC formats are present', () => {
  const png=Buffer.from([137,80,78,71,13,10,26,10]);
  const jpg=Buffer.from([255,216,255,224]);
  const artwork=parseID3(pictureTag([
    {mime:'image/png',bytes:png,type:0},
    {mime:'image/jpg',bytes:jpg,type:3},
    {mime:'image/png',bytes:png,type:4},
  ])).artwork;
  assert.equal(artwork.mime,'image/jpeg');
  assert.equal(artwork.type,3);
  assert.deepEqual(Buffer.from(artwork.bytes),jpg);
});
