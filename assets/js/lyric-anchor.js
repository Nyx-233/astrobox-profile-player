/** Use the original text as the visual anchor, not the original+translation block. */
export function originalOf(row) {
  return row?.querySelector('.original') || row;
}

/** A continuous focus derived from available scroll space on BOTH sides. */
export function layoutFocus(viewport) {
  const height = viewport.clientHeight;
  const range = Math.max(0, viewport.scrollHeight - height);
  const position = Math.max(0, Math.min(viewport.scrollTop, range));
  const before = Math.min(position, height / 2);
  const after = Math.min(range - position, height / 2);
  return height * before / Math.max(Number.EPSILON, before + after);
}

export function captureAnchor(viewport, rows) {
  const bounds = viewport.getBoundingClientRect();
  const focus = layoutFocus(viewport);
  const visible = rows.map((row, index) => {
    const element = originalOf(row);
    const rect = element.getBoundingClientRect();
    const offset = rect.top - bounds.top;
    return { element, index, offset, height: rect.height };
  }).filter(item => item.offset + item.height > 0 && item.offset < viewport.clientHeight);
  // The same calculation naturally approaches the first/last visible original
  // at either boundary and the visual middle when both sides have room.
  // Playback state and lyric indices have no role in selecting the anchor.
  return visible.reduce((best, item) => {
    const distance = Math.abs(item.offset + item.height / 2 - focus);
    return !best || distance < Math.abs(best.offset + best.height / 2 - focus) ? item : best;
  }, null);
}

export function restoreAnchor(viewport, anchor, list) {
  if (!anchor) return;
  const offset = anchor.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  let target = viewport.scrollTop + offset - anchor.offset;
  if (list) {
    const headroom = Number.parseFloat(list.style.getPropertyValue('--lyric-headroom')) || 0;
    const withoutHeadroom = target - headroom;
    const nextHeadroom = Math.max(0, -withoutHeadroom);
    // scrollTop cannot be negative. At the start of the list, reserve exactly
    // the missing space so collapsing above the middle cannot pin the first row.
    // Reclaim this space as rows expand again; never accumulate it per frame.
    if (Math.abs(nextHeadroom - headroom) > .01) {
      list.style.setProperty('--lyric-headroom', nextHeadroom + 'px');
    }
    target = withoutHeadroom + nextHeadroom;
    const tailroom = Number.parseFloat(list.style.getPropertyValue('--lyric-tailroom')) || 0;
    const maxWithoutTailroom = viewport.scrollHeight - tailroom - viewport.clientHeight;
    const nextTailroom = Math.max(0, target - maxWithoutTailroom);
    if (Math.abs(nextTailroom - tailroom) > .01) {
      list.style.setProperty('--lyric-tailroom', nextTailroom + 'px');
    }
  }
  viewport.scrollTop = Math.max(0, Math.min(target, viewport.scrollHeight - viewport.clientHeight));
}
