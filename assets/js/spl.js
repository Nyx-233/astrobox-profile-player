/**
 * SPL line timing and translation recognition.
 * https://moriafly.com/standards/spl.html
 * Word timestamps are stripped for line display; word-by-word highlighting is not implemented.
 */
const TIME = '(\\d{1,3}):(\\d{1,2})(?:\\.(\\d{1,6}))?';
const leadingTimestamp = new RegExp('^\\[' + TIME + '\\]');
const inlineTimestamp = new RegExp('[\\[<]' + TIME + '[\\]>]', 'g');
const endingTimestamp = new RegExp('\\[' + TIME + '\\]\\s*$');
const micros = m => Number(m[1]) * 60000000 + Number(m[2]) * 1000000 + Number((m[3] || '').padEnd(6, '0'));
const plainText = text => text.replace(inlineTimestamp, '').trim();

export function parseSPL(source) {
  const text = source.replace(/^\uFEFF/, '');
  const offset = Number(text.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im)?.[1] || 0) * 1000;
  const groups = new Map();
  const endMarkers = [];
  let previous = [];

  for (const raw of text.split(/\r?\n/)) {
    let rest = raw.trim();
    if (!rest || /^\[[a-z][a-z0-9_-]*:/i.test(rest)) {
      previous = [];
      continue;
    }
    const starts = [];
    let match;
    while ((match = rest.match(leadingTimestamp))) {
      starts.push(micros(match));
      rest = rest.slice(match[0].length).trimStart();
    }
    if (!starts.length) {
      // Untimed text belongs only to the immediately preceding lyric group(s).
      // Malformed timestamp rows must not become a translation.
      if (rest.startsWith('[')) { previous = []; continue; }
      const translation = plainText(rest);
      if (translation) for (const group of previous) group.translations.push(translation);
      continue;
    }
    const content = plainText(rest);
    if (!content) {
      // A timestamp-only row ends a lyric; it is never a translation or new lyric.
      endMarkers.push(...starts);
      previous = [];
      continue;
    }
    const endMatch = rest.match(endingTimestamp);
    previous = [];
    for (const start of starts) {
      let group = groups.get(start);
      if (group) {
        group.translations.push(content);
      } else {
        const explicitEnd = endMatch && micros(endMatch) > start ? micros(endMatch) : null;
        group = { start, original: content, translations: [], explicitEnd };
        groups.set(start, group);
      }
      previous.push(group);
    }
  }
  const ordered = [...groups.values()].sort((a, b) => a.start - b.start);
  endMarkers.sort((a, b) => a - b);
  return ordered.map((group, i) => {
    const marker = endMarkers.find(end => end > group.start);
    const end = group.explicitEnd ?? Math.min(ordered[i + 1]?.start ?? Infinity, marker ?? Infinity);
    return {
      time: Math.max(0, (group.start - offset) / 1000000),
      end: Number.isFinite(end) ? Math.max(0, (end - offset) / 1000000) : Infinity,
      original: group.original,
      translations: group.translations,
    };
  });
}
