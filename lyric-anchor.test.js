import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnchor, restoreAnchor, layoutFocus } from '../assets/js/lyric-anchor.js';

function layout(scrollTop = 0) {
  let stride = 80;
  const properties = new Map();
  const list = { style: {
    getPropertyValue: name => properties.get(name) || '',
    setProperty: (name, value) => properties.set(name, value),
  } };
  const space = () => parseFloat(properties.get('--lyric-headroom')) || 0;
  const viewport = {
    scrollTop, clientHeight: 246,
    get scrollHeight() { return 30 * stride + space() + (parseFloat(properties.get('--lyric-tailroom')) || 0) + 108; },
    getBoundingClientRect: () => ({top: 400, height: 246}),
  };
  const rows = Array.from({length: 30}, (_, index) => {
    const original = { getBoundingClientRect: () => ({
      top: 400 + 17 + index * stride + space() - viewport.scrollTop,
      height: 30,
    }) };
    return {querySelector: () => original};
  });
  return {viewport, rows, list, space, setStride: value => { stride = value; }};
}

test('mobile viewport selects its middle row even when the first row is playing', () => {
  const {viewport, rows} = layout(160);
  // Passing the old active argument must no longer make row zero the anchor.
  const anchor = captureAnchor(viewport, rows, 0);
  assert.equal(anchor.index, 3);
  assert.equal(anchor.offset, 97);
});

test('the common position solver reclaims space as layout expands and contracts', () => {
  const {viewport, rows, list, space, setStride} = layout(160);
  const anchor = captureAnchor(viewport, rows);
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const stride of [78, 70, 50, 30, 20, 30, 50, 80]) {
      setStride(stride);
      restoreAnchor(viewport, anchor, list);
      assert.equal(anchor.element.getBoundingClientRect().top - 400,97);
      assert.equal(viewport.scrollTop,Math.max(0,3*stride-80));
      assert.equal(space(),Math.max(0,80-3*stride));
    }
    assert.equal(space(),0);
  }
});

test('when scrolled, middle-row compensation uses scrollTop without adding space', () => {
  const {viewport, rows, list, space, setStride} = layout(320);
  const anchor = captureAnchor(viewport, rows);
  assert.equal(anchor.index,5);
  for (const stride of [70, 60, 50, 80]) {
    setStride(stride);
    restoreAnchor(viewport, anchor, list);
    assert.equal(anchor.element.getBoundingClientRect().top - 400,97);
    assert.equal(space(),0);
  }
  assert.equal(viewport.scrollTop,320);
});


test('one focus calculation handles the entire scroll range continuously', () => {
  const {viewport} = layout();
  const range = viewport.scrollHeight - viewport.clientHeight;
  let previous = -1;
  for (const position of [0,.1,.5,1,2,10,30,60,100,123,160,320,range-100,range-20,range]) {
    viewport.scrollTop = position;
    const focus = layoutFocus(viewport);
    assert(focus>=previous);
    assert(focus>=0 && focus<=viewport.clientHeight);
    previous=focus;
  }
  viewport.scrollTop=0;
  assert.equal(layoutFocus(viewport),0);
  viewport.scrollTop=320;
  assert.equal(layoutFocus(viewport),viewport.clientHeight/2);
  viewport.scrollTop=range;
  assert.equal(layoutFocus(viewport),viewport.clientHeight);
  // There is no separate 1px/2px switching threshold.
  viewport.scrollTop=.99; const before = layoutFocus(viewport);
  viewport.scrollTop=1.01; const after = layoutFocus(viewport);
  assert(after-before<.05);
});

test('geometry naturally anchors the first and last visible rows at the bounds', () => {
  const {viewport,rows} = layout();
  for (const position of [0,.5,1,2,10]) {
    viewport.scrollTop=position;
    assert.equal(captureAnchor(viewport,rows).index,0);
  }
  viewport.scrollTop=viewport.scrollHeight-viewport.clientHeight;
  assert.equal(captureAnchor(viewport,rows).index,rows.length-1);
});
