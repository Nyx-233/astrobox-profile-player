import test from 'node:test';
import assert from 'node:assert/strict';
import { captureAnchor, restoreAnchor } from '../assets/js/lyric-anchor.js';
import { measureTranslations, applyTranslationProgress, createTranslationTransition } from '../assets/js/translation-layout.js';

test('closing completely fades translations before their space contracts', () => {
  const motion=createTranslationTransition({height:1,opacity:1},false);
  let previousOpacity=1;
  for (const elapsed of [0,55,110,165,220]) {
    const state=motion.sample(elapsed);
    assert.equal(state.height,1);
    assert(state.opacity<=previousOpacity && state.opacity>=0);
    previousOpacity=state.opacity;
  }
  assert.equal(previousOpacity,0);
  let previousHeight=1;
  for (const elapsed of [260,300,340,380,420,460,500]) {
    const state=motion.sample(elapsed);
    assert.equal(state.opacity,0);
    assert(state.height<previousHeight && state.height>=0);
    previousHeight=state.height;
  }
  assert.deepEqual(motion.sample(motion.duration),{height:0,opacity:0});
});

test('main travel is slow, text is fully visible at first arrival and remains opaque through rebounds', () => {
  const opening=createTranslationTransition({height:0,opacity:0},true);
  assert.deepEqual(opening.sample(0),{height:0,opacity:0});
  assert(opening.sample(120).height<.1);
  assert(opening.sample(240).height>.2 && opening.sample(240).height<.5);
  for (const elapsed of [80,180,280]) {
    const state=opening.sample(elapsed);
    assert(state.height>0 && state.height<1);
    assert(state.opacity>0 && state.opacity<1);
  }
  let arrived=false;
  for (let elapsed=0;elapsed<=opening.duration;elapsed+=5) {
    const state=opening.sample(elapsed);
    if (state.height>=1) arrived=true;
    if (arrived) assert.equal(state.opacity,1);
  }
  assert(arrived);
  assert.equal(opening.sample(360).opacity,1);
  assert(opening.sample(620).height<1);
  assert.equal(opening.sample(620).opacity,1);
  assert.deepEqual(opening.sample(opening.duration),{height:1,opacity:1});
  const closing=createTranslationTransition({height:1,opacity:1},false);
  for (const elapsed of [0,100,220,420,590,744,862,980]) {
    const current=closing.sample(elapsed);
    const reversed=createTranslationTransition(current,true);
    assert.deepEqual(reversed.sample(0),current);
    const reopened=reversed.sample(reversed.duration/2);
    const closedAgain=createTranslationTransition(reopened,false);
    assert.deepEqual(closedAgain.sample(0),reopened);
    assert.deepEqual(closedAgain.sample(closedAgain.duration),{height:0,opacity:0});
  }
});

test('spring crosses the destination visibly, rebounds and quickly settles in both directions', () => {
  const opening=createTranslationTransition({height:0,opacity:0},true);
  const closing=createTranslationTransition({height:1,opacity:1},false);
  assert.equal(opening.duration,900);
  assert.equal(closing.duration,980);
  const offsets=[440,620,760,880].map(time=>opening.sample(time).height-1);
  assert(offsets[0]>.15 && offsets[0]<.2);
  assert(offsets[0]>0 && offsets[1]<0 && offsets[2]>0 && offsets[3]<0);
  assert(offsets.every((value,index)=>index===0 || Math.abs(value)<Math.abs(offsets[index-1])));
  const rebounds=[590,744,862,962].map(time=>closing.sample(time).height);
  assert(rebounds[0]<-.15 && rebounds[0]>-.2);
  assert(rebounds[0]<0 && rebounds[1]>0 && rebounds[2]<0 && rebounds[3]>0);
  assert(rebounds.every((value,index)=>index===0 || Math.abs(value)<Math.abs(rebounds[index-1])));
  for (const motion of [opening,closing]) {
    for (let elapsed=0;elapsed<=motion.duration;elapsed+=5) {
      const state=motion.sample(elapsed);
      assert(state.height>=-.25 && state.height<=1.25);
      assert(state.opacity>=0 && state.opacity<=1);
    }
  }
  // Reversing at the expansion peak must preserve the overshoot itself.
  const peak=opening.sample(440);
  assert.deepEqual(createTranslationTransition(peak,false).sample(0),peak);
  const wrapper={style:{}};
  applyTranslationProgress([{wrapper,height:30}],peak.height,peak.opacity);
  assert(parseFloat(wrapper.style.height)>30);
});

function scene(initialScroll = 0, count = 24) {
  const values = new Map();
  const list = {style: {
    getPropertyValue: key => values.get(key) || '',
    setProperty: (key, value) => values.set(key, value),
  }};
  const spacing = key => parseFloat(values.get(key)) || 0;
  const wrappers = Array.from({length: count}, (_, i) => ({
    style: {height: '0px', opacity: '0'},
    // Alternating single- and multi-line translations, including margin.
    querySelector: () => ({getBoundingClientRect: () => ({height: i % 3 ? 27 : 54})}),
  }));
  const heights = () => wrappers.map((wrapper, i) => 22 + (i % 4 ? 30 : 60) + parseFloat(wrapper.style.height));
  let position = initialScroll;
  const viewport = {
    clientHeight: 246,
    get scrollHeight() { return Math.max(246,spacing('--lyric-headroom') + heights().reduce((a,b) => a+b,0) + 108 + spacing('--lyric-tailroom')); },
    get scrollTop() { return position; },
    set scrollTop(value) { position = Math.max(0,Math.min(value,this.scrollHeight-this.clientHeight)); },
    getBoundingClientRect: () => ({top: 450,height: 246}),
  };
  const rows = wrappers.map((wrapper, i) => {
    let shift=0;
    const original = {getBoundingClientRect: () => ({
      top: 450 + spacing('--lyric-headroom') + heights().slice(0,i).reduce((a,b) => a+b,0) + 11 - viewport.scrollTop + shift,
      height: i % 4 ? 30 : 60,
    })};
    return {style:{setProperty: (name,value) => { if (name==='--translation-shift') shift=parseFloat(value); }},querySelector: name => name === '.original' ? original : wrapper};
  });
  const y = i => rows[i].querySelector('.original').getBoundingClientRect().top;
  return {viewport,list,rows,y,entries:measureTranslations(rows)};
}

test('collapsed overshoot moves entire rows, including rows without translations, while CSS height stays nonnegative', () => {
  const wrappers=[{style:{},querySelector:()=>({getBoundingClientRect:()=>({height:30})})},null,{style:{},querySelector:()=>({getBoundingClientRect:()=>({height:20})})}];
  const shifts=[];
  const rows=wrappers.map((wrapper,i)=>({style:{setProperty:(_name,value)=>shifts[i]=parseFloat(value)},querySelector:()=>wrapper}));
  applyTranslationProgress(measureTranslations(rows),-.18,0);
  assert.equal(shifts[0],0);
  assert(Math.abs(shifts[1]+5.4)<.001);
  assert.equal(shifts[2],shifts[1]);
  assert.equal(parseFloat(wrappers[0].style.height),0);
  assert.equal(parseFloat(wrappers[2].style.height),0);
});

test('actual spring frames hold the visible anchor at all scroll bounds, with visible movement past the final row position', () => {
  for (const offset of [0,530,1200]) {
    const view=scene(offset);
    const {viewport,list,rows,entries,y}=view;
    const anchor=captureAnchor(viewport,rows);
    const baseline=y(anchor.index);
    for (const visible of [true,false]) {
      const motion=createTranslationTransition({height:visible?0:1,opacity:visible?0:1},visible);
      for (let elapsed=0;elapsed<=motion.duration;elapsed+=8) {
        const state=motion.sample(elapsed);
        applyTranslationProgress(entries,state.height,state.opacity);
        restoreAnchor(viewport,anchor,list);
        assert(Math.abs(y(anchor.index)-baseline)<.02);
        assert(entries.every(entry=>parseFloat(entry.wrapper.style.height)>=0));
      }
      applyTranslationProgress(entries,visible?1:0,visible?1:0);restoreAnchor(viewport,anchor,list);
      if (anchor.index+1<rows.length) {
        const target=y(anchor.index+1);
        const peak=motion.sample(visible?440:590);
        applyTranslationProgress(entries,peak.height,peak.opacity);restoreAnchor(viewport,anchor,list);
        const overshoot=y(anchor.index+1)-target;
        assert(visible?overshoot>3:overshoot<-3);
      }
      applyTranslationProgress(entries,visible?1:0,visible?1:0);restoreAnchor(viewport,anchor,list);
    }
  }
});

function assertDirections(view, anchor, progress, expanding) {
  const {viewport,list,entries,y} = view;
  const middle = anchor.index;
  const baseline = y(middle);
  let above = y(middle-1), below = y(middle+1);
  for (const value of progress) {
    applyTranslationProgress(entries,value);
    restoreAnchor(viewport,anchor,list);
    assert(Math.abs(y(middle)-baseline) < .02,'middle original moved');
    assert(expanding ? y(middle-1) < above : y(middle-1) > above,'upper row moved in the wrong direction');
    assert(expanding ? y(middle+1) > below : y(middle+1) < below,'lower row moved in the wrong direction');
    above = y(middle-1); below = y(middle+1);
  }
}

test('translations expand upward above the visible middle and downward below it', () => {
  const view = scene(530);
  const anchor = captureAnchor(view.viewport,view.rows);
  assert(anchor.index > 5);
  assertDirections(view,anchor,[.1,.3,.6,1],true);
  assertDirections(view,anchor,[.8,.5,.2,0],false);
});

test('at the top, the first original stays fixed and all later rows expand down', () => {
  const view = scene();
  const {viewport,list,entries,y} = view;
  const anchor = captureAnchor(viewport,view.rows);
  assert.equal(anchor.index,0);
  const first = y(0);
  let second = y(1);
  for (const progress of [.1,.3,.6,1]) {
    applyTranslationProgress(entries,progress);
    restoreAnchor(viewport,anchor,list);
    assert.equal(y(0),first);
    assert(y(1)>second);
    assert.equal(viewport.scrollTop,0);
    second=y(1);
  }
  for (const progress of [.8,.5,.2,0]) {
    applyTranslationProgress(entries,progress);
    restoreAnchor(viewport,anchor,list);
    assert.equal(y(0),first);
    assert(y(1)<second);
    assert.equal(viewport.scrollTop,0);
    second=y(1);
  }
});

test('a partial animation can reverse without moving its middle original', () => {
  const view = scene(530);
  const anchor = captureAnchor(view.viewport,view.rows);
  assertDirections(view,anchor,[.1,.3,.6],true);
  const reversed = captureAnchor(view.viewport,view.rows);
  assert.equal(reversed.index,anchor.index);
  assertDirections(view,reversed,[.5,.2,0],false);
});

test('the same layout solver holds its chosen text across both edges and the middle', () => {
  for (const offset of [0,.5,2,12,40,80,123,530,1200,1290]) {
    const view = scene(offset);
    const {viewport,list,rows,entries,y} = view;
    viewport.scrollTop=offset;
    const anchor=captureAnchor(viewport,rows);
    const baseline=y(anchor.index);
    for (const progress of [.25,.8,1,.4,0,1,0]) {
      applyTranslationProgress(entries,progress);
      restoreAnchor(viewport,anchor,list);
      assert(Math.abs(y(anchor.index)-baseline)<.02,`anchor drifted at scroll ${offset}`);
      assert(viewport.scrollTop>=0 && viewport.scrollTop<=viewport.scrollHeight-viewport.clientHeight);
    }
  }
});


test('short lyrics use the same solver without needing scroll space', () => {
  const view=scene(0,2);
  const {viewport,list,rows,entries,y}=view;
  const anchor=captureAnchor(viewport,rows);
  const baseline=y(0);
  assert.equal(anchor.index,0);
  for (const progress of [.2,.8,1,.4,0]) {
    applyTranslationProgress(entries,progress);
    restoreAnchor(viewport,anchor,list);
    assert.equal(y(0),baseline);
    assert.equal(viewport.scrollTop,0);
  }
});
