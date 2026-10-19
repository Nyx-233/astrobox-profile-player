/** Read optional ID3v1 and ID3v2.2/2.3/2.4 metadata without coupling playback to tags. */
const ascii = bytes => new TextDecoder('iso-8859-1').decode(bytes);
const uint32 = bytes => bytes[0] * 16777216 + bytes[1] * 65536 + bytes[2] * 256 + bytes[3];
const syncsafe = bytes => {
  if (bytes.length !== 4 || bytes.some(value => value > 127)) throw new Error('Invalid ID3 size');
  return bytes.reduce((size, value) => size * 128 + value, 0);
};
function deunsync(bytes) {
  const result = [];
  for (let i = 0; i < bytes.length; i++) {
    result.push(bytes[i]);
    if (bytes[i] === 255 && bytes[i + 1] === 0) i++;
  }
  return Uint8Array.from(result);
}
function decode(bytes, encoding, fallback = 'utf-16le') {
  let name = ['iso-8859-1', fallback, 'utf-16be', 'utf-8'][encoding];
  if (!name) throw new Error('Unsupported ID3 text encoding');
  if (encoding === 1 && bytes[0] === 254 && bytes[1] === 255) name = 'utf-16be';
  if (encoding === 1 && bytes[0] === 255 && bytes[1] === 254) name = 'utf-16le';
  return new TextDecoder(name).decode(bytes).replace(/^\uFEFF/, '').replace(/\0+$/, '');
}
function field(bytes, offset, encoding) {
  const width = encoding === 1 || encoding === 2 ? 2 : 1;
  let end = offset;
  while (end < bytes.length) {
    if (bytes[end] === 0 && (width === 1 || bytes[end + 1] === 0)) break;
    end += width;
  }
  return { bytes: bytes.slice(offset, end), next: Math.min(bytes.length, end + width) };
}
function header(bytes) {
  if (bytes.length < 10 || ascii(bytes.slice(0, 3)) !== 'ID3') throw new Error('MP3 has no leading ID3v2 tag');
  if (![2,3,4].includes(bytes[3])) throw new Error('Unsupported ID3v2 version');
  const size = syncsafe(bytes.slice(6, 10));
  if (size > 16 * 1024 * 1024) throw new Error('ID3 tag is too large');
  return { version: bytes[3], flags: bytes[5], size };
}
function artworkMime(bytes, declared) {
  const label = declared.split(';', 1)[0].trim().toLowerCase();
  // APIC also allows an external URL; this player reads embedded images only.
  if (label === '-->' || !bytes.length) return '';
  const starts = signature => signature.every((value, i) => bytes[i] === value);
  const textAt = (offset, text) => ascii(bytes.subarray(offset, offset + text.length)) === text;
  // Prefer the payload over a missing, abbreviated or incorrectly written MIME.
  if (starts([255,216,255])) return 'image/jpeg';
  if (starts([137,80,78,71,13,10,26,10])) return 'image/png';
  if (textAt(0,'GIF87a') || textAt(0,'GIF89a')) return 'image/gif';
  if (textAt(0,'RIFF') && textAt(8,'WEBP') && textAt(12,'VP')) return 'image/webp';
  if (textAt(0,'BM')) return 'image/bmp';
  if (starts([0,0,1,0]) || starts([0,0,2,0])) return 'image/x-icon';
  if (starts([73,73,42,0]) || starts([77,77,0,42]) || starts([73,73,43,0]) || starts([77,77,0,43])) return 'image/tiff';
  if (starts([255,10]) || starts([0,0,0,12,74,88,76,32,13,10,135,10])) return 'image/jxl';
  if (starts([0,0,0,12,106,80,32,32,13,10,135,10])) return 'image/jp2';
  // ISO-BMFF images identify their codec through major/compatible brands.
  if (bytes.length >= 16 && textAt(4,'ftyp')) {
    const end = Math.min(uint32(bytes.subarray(0,4)), bytes.length, 4096);
    const brands = [ascii(bytes.subarray(8,12))];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(bytes.subarray(i,i+4)));
    if (brands.some(brand => brand === 'avif' || brand === 'avis')) return 'image/avif';
    if (brands.some(brand => brand === 'hevc' || brand === 'hevx')) return 'image/heic-sequence';
    if (brands.some(brand => brand === 'heic' || brand === 'heix')) return 'image/heic';
    if (brands.includes('msf1')) return 'image/heif-sequence';
    if (brands.includes('mif1')) return 'image/heif';
  }
  const encoding = starts([255,254]) ? 'utf-16le' : starts([254,255]) ? 'utf-16be' : 'utf-8';
  const xml = new TextDecoder(encoding).decode(bytes.subarray(0,4096)).replace(/^\uFEFF/, '')
    .replace(/^\s*(?:<\?xml[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\s+svg[^>]*>\s*)*/i, '');
  if (/^<svg(?:\s|>)/i.test(xml)) return 'image/svg+xml';
  const aliases = {
    jpg:'image/jpeg', jpeg:'image/jpeg', 'image/jpg':'image/jpeg', 'image/pjpeg':'image/jpeg', 'image/jfif':'image/jpeg',
    png:'image/png', 'image/x-png':'image/png', gif:'image/gif', webp:'image/webp',
    bmp:'image/bmp', 'image/x-bmp':'image/bmp', 'image/x-ms-bmp':'image/bmp',
    ico:'image/x-icon', 'image/ico':'image/x-icon', 'image/vnd.microsoft.icon':'image/x-icon',
    svg:'image/svg+xml', 'image/svg':'image/svg+xml', avif:'image/avif',
    tif:'image/tiff', tiff:'image/tiff', 'image/tif':'image/tiff',
    heic:'image/heic', heif:'image/heif', jxl:'image/jxl',
  };
  // Do not hard-code a codec whitelist: let the browser decode other image/*
  // formats it supports. Recognition does not imply a built-in image decoder.
  const alias = Object.prototype.hasOwnProperty.call(aliases, label) ? aliases[label] : '';
  return alias || (/^image\/[a-z0-9][a-z0-9.+_-]*$/.test(label) ? label : '');
}
function lyricLanguage(bytes) {
  const language = ascii(bytes).trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(language)) return 'und';
  try { return Intl.getCanonicalLocales(language)[0]; } catch { return 'und'; }
}
export function parseID3(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const result = { title: '', lyrics: '', lyricsLanguage: 'und', artwork: null };
  const tail = bytes.subarray(Math.max(0,bytes.length-128));
  if (tail.length === 128 && ascii(tail.subarray(0,3)) === 'TAG') {
    result.title = ascii(tail.subarray(3,33)).split('\0')[0].trim();
  }
  // An MP3 does not need ID3 metadata to be a playable audio file.
  if (bytes.length < 3 || ascii(bytes.subarray(0,3)) !== 'ID3') return result;
  if (bytes.length >= 4 && ![2,3,4].includes(bytes[3])) return result;
  const { version, flags, size } = header(bytes);
  if (bytes.length < size + 10) throw new Error('Incomplete ID3 tag');
  if (version === 2 && flags & 0x40) return result;
  let body = bytes.slice(10,10+size);
  if (version < 4 && flags & 0x80) body = deunsync(body);
  let offset = 0;
  if (version > 2 && flags & 0x40) offset = version === 3 ? uint32(body.slice(0,4))+4 : syncsafe(body.slice(0,4));
  const lyricCandidates = [];
  const legacy = version === 2;
  const frameHeader = legacy ? 6 : 10;
  const aliases = {TT2:'TIT2',ULT:'USLT',TXX:'TXXX',PIC:'APIC'};
  while (offset + frameHeader <= body.length) {
    const rawId = ascii(body.slice(offset,offset+(legacy ? 3 : 4)));
    if (!(legacy ? /^[A-Z0-9]{3}$/ : /^[A-Z0-9]{4}$/).test(rawId)) break;
    const id = legacy ? (aliases[rawId] || rawId) : rawId;
    const length = legacy ? body[offset+3]*65536+body[offset+4]*256+body[offset+5]
      : version === 3 ? uint32(body.slice(offset+4,offset+8)) : syncsafe(body.slice(offset+4,offset+8));
    const format = legacy ? 0 : body[offset+9];
    if (offset + frameHeader + length > body.length) break;
    let data = body.slice(offset+frameHeader,offset+frameHeader+length);
    offset += frameHeader+length;
    if (version === 3 && format & 0xc0 || version === 4 && format & 0x0c) continue;
    if (version === 4 && (format & 0x02 || flags & 0x80)) data = deunsync(data);
    if (version === 3 && format & 0x20 || version === 4 && format & 0x40) data = data.slice(1);
    if (version === 4 && format & 0x01) data = data.slice(4);
    if (!data.length) continue;
    const encoding = data[0];
    // One malformed optional text field must not hide valid artwork or lyrics.
    try {
      if (id === 'TIT2') result.title = decode(data.slice(1),encoding).trim() || result.title;
      if (id === 'USLT' && data.length > 4) {
        const description = field(data,4,encoding);
        const endian = description.bytes[0] === 254 && description.bytes[1] === 255 ? 'utf-16be' : 'utf-16le';
        lyricCandidates.push({text:decode(data.slice(description.next),encoding,endian), language:lyricLanguage(data.slice(1,4))});
      }
      if (id === 'TXXX') {
        const description = field(data,1,encoding);
        if (/^(LYRICS|UNSYNCEDLYRICS|UNSYNCHRONIZED LYRICS)$/i.test(decode(description.bytes,encoding))) {
          lyricCandidates.push({text:decode(data.slice(description.next),encoding),language:'und'});
        }
      }
      if (id === 'APIC' && data.length > 4) {
        const mimeField = legacy ? {bytes:data.slice(1,4),next:4} : field(data,1,0);
        const type = data[mimeField.next];
        const description = field(data,mimeField.next+1,encoding);
        const picture = data.slice(description.next);
        const mime = artworkMime(picture,ascii(mimeField.bytes));
        if (mime && picture.length && (!result.artwork || type === 3 && result.artwork.type !== 3)) {
          result.artwork = {mime,type,bytes:picture};
        }
      }
    } catch { /* Leave unsupported optional fields unset. Audio remains usable. */ }
  }
  const lyrics = lyricCandidates.find(item => /\[\d{1,3}:\d{1,2}/.test(item.text)) || lyricCandidates.find(item => item.text.trim());
  if (lyrics) { result.lyrics=lyrics.text; result.lyricsLanguage=lyrics.language; }
  return result;
}
export async function readID3(url, request = fetch) {
  const initial = await request(url,{headers:{Range:'bytes=0-9'}});
  if (!initial.ok) throw new Error('Audio metadata HTTP '+initial.status);
  let bytes = new Uint8Array(await initial.arrayBuffer());
  if (initial.status === 200) return parseID3(bytes);
  if (ascii(bytes.slice(0,3)) === 'ID3' && [2,3,4].includes(bytes[3])) {
    const {size} = header(bytes);
    if (bytes.length >= 10+size) return parseID3(bytes);
    const response = await request(url,{headers:{Range:'bytes=0-'+(size+9)}});
    if (!response.ok) throw new Error('Audio metadata HTTP '+response.status);
    return parseID3(await response.arrayBuffer());
  }
  // Without a leading tag, the full response can still contain ID3v1 at the end.
  const response = await request(url);
  if (!response.ok) throw new Error('Audio metadata HTTP '+response.status);
  return parseID3(await response.arrayBuffer());
}
/** Adapt thin-space inline translations; an explicit empty separator disables it. */
export function normalizeEmbeddedLyrics(text, separator = '\u2009') {
  if (!separator) return text;
  return text.split(/\r?\n/).map(line => {
    const match = line.match(/^((?:\[\d{1,3}:\d{1,2}(?:\.\d{1,6})?\])+)(.*)$/);
    if (!match || !match[2].includes(separator)) return line;
    return match[2].split(separator).map(part => match[1]+part.trim()).join('\n');
  }).join('\n');
}
