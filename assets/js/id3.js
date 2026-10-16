/** Read leading ID3v2.3/2.4 title, artwork and unsynchronised lyric text. */
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
  if (bytes[3] !== 3 && bytes[3] !== 4) throw new Error('Only ID3v2.3 and ID3v2.4 are supported');
  const size = syncsafe(bytes.slice(6, 10));
  if (size > 16 * 1024 * 1024) throw new Error('ID3 tag is too large');
  return { version: bytes[3], flags: bytes[5], size };
}
export function parseID3(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { version, flags, size } = header(bytes);
  if (bytes.length < size + 10) throw new Error('Incomplete ID3 tag');
  let body = bytes.slice(10, 10 + size);
  if (version === 3 && flags & 0x80) body = deunsync(body);
  let offset = 0;
  if (flags & 0x40) offset = version === 3 ? uint32(body.slice(0, 4)) + 4 : syncsafe(body.slice(0, 4));
  const result = { title: '', lyrics: '', artwork: null };
  const lyricCandidates = [];
  while (offset + 10 <= body.length) {
    const id = ascii(body.slice(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const length = version === 3 ? uint32(body.slice(offset + 4, offset + 8)) : syncsafe(body.slice(offset + 4, offset + 8));
    const format = body[offset + 9];
    if (!length || offset + 10 + length > body.length) break;
    let data = body.slice(offset + 10, offset + 10 + length);
    offset += 10 + length;
    // Compressed/encrypted frames are not interpreted as plain metadata.
    if (version === 3 && format & 0xc0 || version === 4 && format & 0x0c) continue;
    if (version === 4 && (format & 0x02 || flags & 0x80)) data = deunsync(data);
    if (version === 3 && format & 0x20 || version === 4 && format & 0x40) data = data.slice(1);
    if (version === 4 && format & 0x01) data = data.slice(4);
    if (!data.length) continue;
    const encoding = data[0];
    if (id === 'TIT2') result.title = decode(data.slice(1), encoding).trim();
    if (id === 'USLT' && data.length > 4) {
      const description = field(data, 4, encoding);
      const endian = description.bytes[0] === 254 && description.bytes[1] === 255 ? 'utf-16be' : 'utf-16le';
      lyricCandidates.push(decode(data.slice(description.next), encoding, endian));
    }
    if (id === 'TXXX') {
      const description = field(data, 1, encoding);
      if (/^(LYRICS|UNSYNCEDLYRICS|UNSYNCHRONIZED LYRICS)$/i.test(decode(description.bytes, encoding))) {
        lyricCandidates.push(decode(data.slice(description.next), encoding));
      }
    }
    if (id === 'APIC' && data.length > 4) {
      const mimeField = field(data, 1, 0);
      const mime = ascii(mimeField.bytes).toLowerCase();
      const type = data[mimeField.next];
      const description = field(data, mimeField.next + 1, encoding);
      if (/^image\/(jpeg|png|webp|gif)$/.test(mime) && description.next < data.length && (!result.artwork || type === 3 && result.artwork.type !== 3)) {
        result.artwork = { mime, type, bytes: data.slice(description.next) };
      }
    }
  }
  result.lyrics = lyricCandidates.find(text => /\[\d{1,3}:\d{1,2}/.test(text)) || lyricCandidates[0] || '';
  return result;
}
export async function readID3(url, request = fetch) {
  // Prefer just the metadata range. Servers that ignore Range can return the full MP3.
  const initial = await request(url, { headers: { Range: 'bytes=0-9' } });
  if (!initial.ok) throw new Error('Audio metadata HTTP ' + initial.status);
  let bytes = new Uint8Array(await initial.arrayBuffer());
  const { size } = header(bytes);
  if (bytes.length < 10 + size) {
    const response = await request(url, { headers: { Range: 'bytes=0-' + (size + 9) } });
    if (!response.ok) throw new Error('Audio metadata HTTP ' + response.status);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  return parseID3(bytes);
}
/** Compatibility for this song's embedded U+2009 bilingual separator, in memory only. */
export function normalizeEmbeddedLyrics(text) {
  return text.split(/\r?\n/).map(line => {
    const match = line.match(/^((?:\[\d{1,3}:\d{1,2}(?:\.\d{1,6})?\])+)(.*)$/);
    if (!match || !match[2].includes('\u2009')) return line;
    return match[2].split('\u2009').map(part => match[1] + part.trim()).join('\n');
  }).join('\n');
}
