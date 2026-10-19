import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { makeMP3 } from './fixtures.js';

class Element {
  constructor() {
    this.events = {}; this.children = []; this.attributes = {}; this.classes = new Set();
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
    this.style = { getPropertyValue: key => this.style[key] || '', setProperty: (key, value) => { this.style[key] = value; } };
    this.dataset = {}; this.value = '0'; this.max = '180'; this.textContent = '';
    this.scrollTop = 0; this.clientHeight = 246; this.offsetHeight = 75; this.scrollHeight = 480;
    this.readyState = 1; this.currentTime = 0; this.duration = 180; this.paused = true; this.ended = false; this.disabled = false;
  }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  async emit(name, event = {}) { for (const fn of this.events[name] || []) await fn(event); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(el) { this.children.push(el); }
  replaceChildren() { this.children = []; }
  querySelector(selector) { return this.children.find(child => child.className === selector.slice(1)); }
  getBoundingClientRect() { return { height: 480, top: 0 }; }
  scrollTo(options) { this.scrollTop = options.top; }
  load() { this.loadCount = (this.loadCount || 0) + 1; }
  async play() { this.paused = false; await this.emit('play'); }
  pause() { this.paused = true; this.emit('pause'); }
}

test('SPL loading, toggle, iframe protocol and existing playback behaviors', async t => {
  const elements = Object.fromEntries(['audio','player','cover','seek','lyrics','lyric-list','status','elapsed','duration','title','translation-toggle','translation-toolbar','artwork'].map(id => [id,new Element()]));
  elements.title.textContent = '正在载入音频…';
  const baseURI = 'https://example.test/player/';
  elements.audio.dataset.src = 'assets/audio/track.mp3';
  elements.audio.duration = NaN;
  elements.audio.readyState = 0;
  const root = new Element(); const body = new Element(); const win = new Element();
  const messages = []; win.parent = { postMessage: message => messages.push(message) };
  const frames = new Map(); let frameId = 0;
  const stored = new Map();
  const motionPreference = { matches: false };
  const timers = new Map(); let timerId = 0; let now = 0;
  const observers = [];
  const listObservers = [];
  const originalGlobals = { performance, setTimeout, clearTimeout };
  t.after(() => Object.assign(globalThis, originalGlobals));
  Object.assign(globalThis, {
    window: win,
    document: { documentElement: root, body, baseURI, getElementById: id => elements[id], createElement: () => new Element(), addEventListener() {} },
    performance: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    ResizeObserver: class { constructor(fn) { this.fn = fn; observers.push(fn); } observe(element) { if (element === elements['lyric-list']) listObservers.push(this.fn); } },
    requestAnimationFrame: fn => { frames.set(++frameId,fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => motionPreference,
    localStorage: { getItem: key => stored.get(key), setItem: (key,value) => stored.set(key,value) },
    fetch: async (_path, options = {}) => {
      const full = makeMP3();
      const range = options.headers?.Range?.match(/bytes=(\d+)-(\d+)/);
      const bytes = range ? full.subarray(Number(range[1]),Number(range[2])+1) : full;
      return {ok:true,status:range?206:200,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
    },
  });
  const { ready } = await import('../assets/js/player.js'); await ready;
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); };
  const advance = ms => {
    const end=now+ms;
    // Advance real animation frames, including timers during a longer spring.
    do {
      now=Math.min(end,now+16);
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(id); timer.fn(); }
      }
      flush();
    } while (now<end);
  };
  flush();
  const rows = elements['lyric-list'].children;
  // Initial first-line highlighting must not activate forced centering.
  // Model the actual mobile layout so an unwanted top padding is visible.
  const startupSpacing=key=>parseFloat(elements['lyric-list'].style.getPropertyValue(key))||0;
  const startupHeights=()=>rows.map(row=>56+parseFloat(row.querySelector('.translations').style.height));
  elements.lyrics.getBoundingClientRect=()=>({top:0,height:246});
  Object.defineProperty(elements.lyrics,'scrollHeight',{configurable:true,get:()=>startupSpacing('--lyric-headroom')+startupHeights().reduce((a,b)=>a+b,0)+108+startupSpacing('--lyric-tailroom')});
  rows.forEach((row,i)=>{
    const wrapper=row.querySelector('.translations');
    wrapper.style.height='25px';
    wrapper.querySelector('.translation-content').getBoundingClientRect=()=>({top:0,height:25});
    row.querySelector('.original').getBoundingClientRect=()=>({top:startupSpacing('--lyric-headroom')+startupHeights().slice(0,i).reduce((a,b)=>a+b,0)+11-elements.lyrics.scrollTop,height:34});
  });
  const startupTop=rows[0].querySelector('.original').getBoundingClientRect().top;
  const assertStartupPosition=()=>{
    assert(Math.abs(rows[0].querySelector('.original').getBoundingClientRect().top-startupTop)<.02);
    assert.equal(startupSpacing('--lyric-headroom'),0);
    assert(rows[0].classes.has('active'));
    assert(elements.audio.paused);
    assert(!elements.lyrics.classes.has('is-browsing'));
    assert.equal(timers.size,0);
  };
  for (let toggle=0;toggle<2;toggle++) {
    await elements['translation-toggle'].emit('click');
    for(let tick=0;tick<125;tick++){advance(8);assertStartupPosition();}
  }
  // Reduced motion and reversal before a transition finishes preserve it too.
  await elements['translation-toggle'].emit('click');advance(300);assertStartupPosition();
  await elements['translation-toggle'].emit('click');advance(1200);assertStartupPosition();
  motionPreference.matches=true;
  await elements['translation-toggle'].emit('click');assertStartupPosition();
  await elements['translation-toggle'].emit('click');assertStartupPosition();
  motionPreference.matches=false;
  assert.equal(elements.title.textContent,'Fixture track');
  assert.equal(rows[0].querySelector('.original').lang,'en');
  assert.equal(rows[0].querySelector('.translations').children[0].children[0].lang,'und');
  assert(elements.artwork.src.startsWith('blob:'));
  assert(elements.audio.src.startsWith('blob:'));
  assert.equal(elements.audio.loadCount,1);
  const playbackSource = elements.audio.src;
  assert.equal(elements.cover.disabled,false);
  assert.equal(rows.length,30); assert.equal(rows[4].children.length,2);
  assert.equal(elements['translation-toggle'].disabled,false);
  assert.equal(elements['translation-toggle'].hidden,false);
  assert.equal(elements['translation-toolbar'].hidden,false);
  assert.equal(elements['translation-toggle'].attributes['aria-pressed'],'true');
  assert(rows[0].classes.has('active'));
  assert.equal(rows[0].attributes['aria-current'],'true');
  assert.equal(rows.filter(row=>row.classes.has('active')).length,1);
  assert(elements.audio.paused);
  assert.equal(elements.lyrics.scrollTop,0);
  assert(!elements.lyrics.classes.has('is-browsing'));
  assert(messages.some(message => message.type === 'ready'));
  assert(messages.some(message => message.type === 'resize'));
  const config = {namespace:'astrobox.profile-iframe',version:1,type:'config',theme:'dark',transparent:true,requestResize:true};
  await win.emit('message',{source:{},data:config}); assert.equal(root.dataset.astroboxTheme,undefined);
  await win.emit('message',{source:win.parent,data:config}); flush(); assert.equal(root.dataset.astroboxTheme,'dark');
  const count = messages.length; await win.emit('message',{source:win.parent,data:config}); flush(); assert.equal(messages.length,count+1);

  // ID3 lyrics can arrive before the browser knows the media duration.
  // Remember the latest request without assigning currentTime = 0.
  elements.audio.currentTime = 7;
  await rows[4].emit('click'); assert.equal(elements.audio.currentTime,7);
  assert(rows[4].classes.has('active'));assert(!rows[0].classes.has('active'));
  await rows[5].emit('click'); assert.equal(elements.audio.currentTime,7);
  assert(rows[5].classes.has('active'));assert(!rows[4].classes.has('active'));
  await elements.audio.emit('timeupdate');
  assert(rows[5].classes.has('active'));assert(elements.audio.paused);
  elements.audio.readyState = 1;
  elements.audio.duration = Infinity;
  await elements.audio.emit('loadedmetadata');
  assert.equal(elements.audio.currentTime,25);
  assert(elements.audio.paused);
  assert(rows[5].classes.has('active'));
  elements.audio.duration = 180;
  await elements.audio.emit('durationchange');
  assert.equal(elements.audio.currentTime,25);

  await rows[4].emit('click'); assert.equal(elements.audio.currentTime,20);
  assert(elements.audio.paused); assert(rows[4].classes.has('active'));
  await elements.cover.emit('click'); await elements.audio.emit('playing'); assert(rows[4].classes.has('active'));
  // Buffering while playing must preserve playback and the requested timestamp.
  elements.audio.readyState = 0;
  await rows[5].emit('click'); assert.equal(elements.audio.currentTime,20);
  assert(!elements.audio.paused);
  elements.audio.readyState = 1; elements.audio.duration = NaN;
  await elements.audio.emit('canplay');
  assert.equal(elements.audio.currentTime,25); assert(!elements.audio.paused);
  assert.equal(elements.status.textContent,'');
  elements.audio.duration = 180;
  await rows[4].emit('click'); assert.equal(elements.audio.currentTime,20);
  // A later canplay must not replay an already consumed request.
  elements.audio.currentTime = 12; await elements.audio.emit('canplay');
  assert.equal(elements.audio.currentTime,12);
  await rows[4].emit('click');

  const translatedRow=rows[4].querySelector('.translations');
  const expandedTranslationHeight=translatedRow.style.height;
  await elements['translation-toggle'].emit('click'); flush();
  assert(elements.player.classes.has('hide-translations'));
  assert.equal(elements['translation-toggle'].attributes['aria-pressed'],'false');
  assert(!rows[4].attributes['aria-label'].includes('Translation 5'));
  assert.equal(elements.audio.currentTime,20); assert(!elements.audio.paused);
  assert.equal(stored.get('astrobox-profile-player:translation'),'off');
  advance(110);
  assert.equal(translatedRow.style.height,expandedTranslationHeight);
  assert(Number(translatedRow.style.opacity)>0 && Number(translatedRow.style.opacity)<1);
  advance(110);
  assert.equal(translatedRow.style.height,expandedTranslationHeight);
  assert.equal(Number(translatedRow.style.opacity),0);
  advance(160);
  assert(parseFloat(translatedRow.style.height)>0 && parseFloat(translatedRow.style.height)<parseFloat(expandedTranslationHeight));
  assert.equal(Number(translatedRow.style.opacity),0);
  advance(600);assert.equal(parseFloat(translatedRow.style.height),0);
  await elements['translation-toggle'].emit('click'); flush();
  assert(!elements.player.classes.has('hide-translations')); assert(rows[4].attributes['aria-label'].includes('Translation 5'));
  advance(180);
  assert(parseFloat(translatedRow.style.height)>0 && parseFloat(translatedRow.style.height)<parseFloat(expandedTranslationHeight));
  assert(Number(translatedRow.style.opacity)>0 && Number(translatedRow.style.opacity)<1);
  advance(180);
  assert(Math.abs(parseFloat(translatedRow.style.height)/parseFloat(expandedTranslationHeight)-1)<.06);
  assert.equal(Number(translatedRow.style.opacity),1);
  advance(540);
  assert.equal(translatedRow.style.height,expandedTranslationHeight);
  assert.equal(Number(translatedRow.style.opacity),1);
  // Storage failure must not break the toggle (e.g. a sandboxed iframe).
  globalThis.localStorage.setItem = () => { throw new Error('Storage blocked'); };
  await elements['translation-toggle'].emit('click'); assert(elements.player.classes.has('hide-translations'));
  await elements['translation-toggle'].emit('click');

  elements.audio.currentTime = 25; await elements.audio.emit('timeupdate');
  assert(!rows[4].classes.has('active')); assert(rows[5].classes.has('active'));
  assert.equal(rows.filter(row => row.classes.has('active')).length,1);
  await elements.seek.emit('pointerdown'); elements.seek.value = '50'; await elements.seek.emit('input');
  assert.equal(elements.audio.currentTime,25); assert(!elements.audio.paused); assert(rows[5].classes.has('active'));
  assert.equal(elements.elapsed.textContent,'00:50');
  await win.emit('pointerup'); assert.equal(elements.audio.currentTime,50); assert(!elements.audio.paused);
  await elements.cover.emit('click'); assert(elements.audio.paused);
  await elements.seek.emit('pointerdown'); elements.seek.value = '70'; await elements.seek.emit('input');
  assert.equal(elements.audio.currentTime,50); await win.emit('pointerup'); assert.equal(elements.audio.currentTime,70); assert(elements.audio.paused);
  await elements.seek.emit('pointerdown'); elements.seek.value = '5'; await elements.seek.emit('input');
  await win.emit('pointercancel'); assert.equal(elements.audio.currentTime,70); assert.equal(Number(elements.seek.value),70);
  elements.seek.value = '71'; await elements.seek.emit('input'); assert.equal(elements.audio.currentTime,71);

  // Realistic row geometry: following clicks ease to the selected row right
  // away, while manual browsing keeps its position until the idle delay.
  advance(1000);
  const spacing = key => parseFloat(elements['lyric-list'].style.getPropertyValue(key)) || 0;
  elements['lyric-list'].style.setProperty('--lyric-headroom','0px');
  elements['lyric-list'].style.setProperty('--lyric-tailroom','0px');
  Object.defineProperty(elements.lyrics,'scrollHeight',{configurable:true,get:()=>2200+spacing('--lyric-headroom')+spacing('--lyric-tailroom')});
  let rowStride = 75;
  rows.forEach((row, i) => {
    row.getBoundingClientRect = () => ({ top: spacing('--lyric-headroom') + i * rowStride - elements.lyrics.scrollTop, height: rowStride });
    row.querySelector('.original').getBoundingClientRect = () => ({ top: spacing('--lyric-headroom') + i * rowStride + 11 - elements.lyrics.scrollTop, height: 34 });
  });
  const centeredTop = index => spacing('--lyric-headroom') + index * rowStride + 11 - (246 - 34) / 2;
  const assertCentered = index => assert(Math.abs(rows[index].querySelector('.original').getBoundingClientRect().top - (246-34)/2)<.02);
  elements.lyrics.scrollTop = centeredTop(14);
  const followingStart = elements.lyrics.scrollTop;
  await elements.lyrics.emit('pointerdown');
  assert(!elements.lyrics.classes.has('is-browsing'));
  await rows[8].emit('click');
  assert.equal(elements.audio.currentTime,40);
  assert.equal(elements.lyrics.scrollTop,followingStart);
  advance(260);
  assert(elements.lyrics.scrollTop < followingStart && elements.lyrics.scrollTop > centeredTop(8));
  advance(1400); assert.equal(elements.lyrics.scrollTop,centeredTop(8));
  // A second tap redirects an unfinished transition from its current position.
  await rows[10].emit('click'); advance(100);
  const redirectedStart = elements.lyrics.scrollTop;
  await elements.lyrics.emit('pointerdown');
  await rows[12].emit('click');
  assert.equal(elements.lyrics.scrollTop,redirectedStart);
  advance(260);
  assert(elements.lyrics.scrollTop > redirectedStart && elements.lyrics.scrollTop < centeredTop(12));
  advance(1400); assert.equal(elements.lyrics.scrollTop,centeredTop(12));
  // Returning to the playing row's center resumes immediate tap-to-center,
  // even if the previous manual-scroll idle timer has not expired yet.
  await elements.lyrics.emit('touchmove');
  assert(elements.lyrics.classes.has('is-browsing'));
  elements.lyrics.scrollTop = centeredTop(12);
  await rows[10].emit('click');
  assert(!elements.lyrics.classes.has('is-browsing'));
  advance(260); assert(elements.lyrics.scrollTop > centeredTop(10));
  advance(1400); assert.equal(elements.lyrics.scrollTop,centeredTop(10));

  elements.lyrics.scrollTop = 180;
  await elements.lyrics.emit('touchmove');
  await rows[8].emit('click');
  assert.equal(elements.audio.paused, true);
  assert(elements.lyrics.classes.has('is-browsing'));
  const clickedTime = elements.audio.currentTime;
  observers.forEach(fn => fn()); flush();
  advance(2000); assert.equal(elements.lyrics.scrollTop,180);
  // Native momentum can outlast touchmove; every manual scroll extends the hold.
  await elements.lyrics.emit('scroll');
  advance(2000); assert.equal(elements.lyrics.scrollTop,180);
  assert(elements.lyrics.classes.has('is-browsing'));
  // Clicking again restarts the hold.
  await rows[10].emit('click');
  assert.notEqual(elements.audio.currentTime,clickedTime);
  advance(1500); assert.equal(elements.lyrics.scrollTop,180);
  assert(elements.lyrics.classes.has('is-browsing'));
  // Toggling preserves browsing, blur and the exact pre-existing idle deadline.
  const beforeToggle = elements.lyrics.scrollTop;
  const timersBeforeToggle = [...timers.entries()];
  await elements['translation-toggle'].emit('click');
  assert.deepEqual([...timers.entries()],timersBeforeToggle);
  assert(elements.lyrics.classes.has('is-browsing'));
  assert.equal(rows[10].querySelector('.translations').attributes['aria-hidden'],'true');
  assert.equal(elements.lyrics.scrollTop,beforeToggle);
  observers.forEach(fn => fn()); advance(100);
  assert.equal(elements.lyrics.scrollTop,beforeToggle);
  elements.audio.currentTime += 3; await elements.audio.emit('timeupdate');
  advance(300);
  assert.equal(elements.lyrics.scrollTop,beforeToggle);
  assert(elements.lyrics.classes.has('is-browsing'));
  advance(1099);assert(elements.lyrics.classes.has('is-browsing'));
  advance(1);assert(!elements.lyrics.classes.has('is-browsing'));
  advance(1400);assertCentered(10);
  // A manual gesture interrupts an in-flight scroll, then schedules a new hold.
  await rows[17].emit('click'); advance(100);
  await elements.lyrics.emit('wheel');
  assert(elements.lyrics.classes.has('is-browsing'));
  const interrupted = elements.lyrics.scrollTop;
  advance(1000); assert.equal(elements.lyrics.scrollTop,interrupted);
  assert(elements.lyrics.classes.has('is-browsing'));

  // Opening/closing translation keeps the original text anchored throughout
  // the animated layout, with no follow-up drift after the last frame.
  advance(2000); advance(1400);
  assert(!elements.lyrics.classes.has('is-browsing'));
  const original = rows[17].querySelector('.original');
  const baseline = original.getBoundingClientRect().top;
  assert.equal(baseline, (246 - 34) / 2);
  await elements['translation-toggle'].emit('click');
  assert(!elements.lyrics.classes.has('is-browsing'));
  for (const stride of [80, 88, 96, 103]) {
    rowStride = stride;
    observers.forEach(fn => fn()); advance(100);
    assert.equal(original.getBoundingClientRect().top,baseline);
  }
  advance(600); observers.forEach(fn => fn()); advance(520);
  assert.equal(original.getBoundingClientRect().top,baseline);
  await elements['translation-toggle'].emit('click');
  rowStride = 90; advance(440);
  assert.equal(original.getBoundingClientRect().top,baseline);
  // Reversing an unfinished transition captures the current position.
  await elements['translation-toggle'].emit('click');
  rowStride = 97; advance(100);
  assert.equal(original.getBoundingClientRect().top,baseline);
  rowStride = 103; advance(300);
  assert.equal(original.getBoundingClientRect().top,baseline);
  // Manual scrolling takes over immediately and is not undone by the anchor.
  await elements['translation-toggle'].emit('click');
  await elements.lyrics.emit('touchmove');
  elements.lyrics.scrollTop -= 24;
  const manualPosition = elements.lyrics.scrollTop;
  rowStride = 75; advance(400);
  assert.equal(elements.lyrics.scrollTop,manualPosition);

  advance(3000); advance(1400);
  motionPreference.matches = true;
  await rows[20].emit('click');
  const beforeReduced = elements.lyrics.scrollTop;
  assert.equal(beforeReduced,centeredTop(20));
  advance(520); assert.equal(elements.lyrics.scrollTop,beforeReduced);
  motionPreference.matches = false;
  // Toggling during an unfinished click animation keeps returning to playback.
  await rows[22].emit('click');
  advance(260);
  const duringClick = elements.lyrics.scrollTop;
  await elements['translation-toggle'].emit('click');
  advance(200); assert(elements.lyrics.scrollTop>duringClick);
  advance(200); advance(1400);assertCentered(22);

  // While browsing, layout anchors the visible original even across playback
  // timestamps and reversals. Layout-generated scrolls cannot reset the timer.
  elements.audio.currentTime = 0; await elements.audio.emit('timeupdate');
  elements.lyrics.scrollTop = centeredTop(17);
  await elements.lyrics.emit('touchmove');
  const browsedPosition=elements.lyrics.scrollTop;
  const browsedOriginal=rows[17].querySelector('.original');
  const browsedOffset=browsedOriginal.getBoundingClientRect().top;
  await elements['translation-toggle'].emit('click');
  assert.equal(elements.lyrics.scrollTop,browsedPosition);
  advance(100);
  assert.equal(elements.lyrics.scrollTop,browsedPosition);
  rowStride=80;listObservers.forEach(fn=>fn());
  advance(100);
  assert.equal(browsedOriginal.getBoundingClientRect().top,browsedOffset);
  elements.audio.currentTime = 20; await elements.audio.emit('timeupdate');
  advance(100);
  assert.equal(browsedOriginal.getBoundingClientRect().top,browsedOffset);
  advance(2500);
  const originalTimers=[...timers.entries()];
  await elements.lyrics.emit('scroll');
  assert.deepEqual([...timers.entries()],originalTimers);
  await elements['translation-toggle'].emit('click');
  assert.deepEqual([...timers.entries()],originalTimers);
  rowStride=75;
  advance(100);
  assert.equal(browsedOriginal.getBoundingClientRect().top,browsedOffset);
  await elements.lyrics.emit('scroll');
  assert.deepEqual([...timers.entries()],originalTimers);
  elements.audio.currentTime = 50; await elements.audio.emit('timeupdate');
  advance(99);
  assert.equal(browsedOriginal.getBoundingClientRect().top,browsedOffset);
  assert(elements.lyrics.classes.has('is-browsing'));
  // The original idle deadline can expire DURING the translation animation.
  advance(1);assert(!elements.lyrics.classes.has('is-browsing'));
  advance(100);assert(elements.lyrics.scrollTop<browsedPosition);
  advance(800);advance(1400);assertCentered(10);
  // After the idle return, the very next lyric follows normally.
  elements.audio.currentTime = 55; await elements.audio.emit('timeupdate');
  advance(100);assert(elements.lyrics.scrollTop>centeredTop(10));
  advance(1400);assertCentered(11);

  // Every toggle, including rapid reversals and reduced motion, centers at the
  // first/last rows too. These bounds use the same padding/anchor solver.
  elements.audio.currentTime = 0; await elements.audio.emit('timeupdate');
  elements.lyrics.scrollTop = 0;
  await elements['translation-toggle'].emit('click');
  advance(100);
  await elements['translation-toggle'].emit('click');advance(100);
  await elements['translation-toggle'].emit('click');advance(400);advance(1400);
  assertCentered(0);
  listObservers.forEach(fn=>fn());advance(100);assertCentered(0);
  elements.audio.currentTime=145;await elements.audio.emit('timeupdate');
  await elements['translation-toggle'].emit('click');advance(400);advance(1400);
  assertCentered(29);
  motionPreference.matches=true;
  elements.audio.currentTime=70;await elements.audio.emit('timeupdate');
  await elements.lyrics.emit('touchmove');elements.lyrics.scrollTop=180;
  advance(2000);
  await elements['translation-toggle'].emit('click');
  assert.equal(elements.lyrics.scrollTop,180);
  assert(elements.lyrics.classes.has('is-browsing'));
  advance(999);assert.equal(elements.lyrics.scrollTop,180);
  advance(1);assertCentered(14);
  assert(!elements.lyrics.classes.has('is-browsing'));
  motionPreference.matches=false;

  // Playback changes cannot restore blur while the reader is browsing.
  await elements.lyrics.emit('keydown', {key:'PageDown'});
  elements.audio.currentTime=75;await elements.audio.emit('timeupdate');
  assert(elements.lyrics.classes.has('is-browsing'));
  advance(2999);assert(elements.lyrics.classes.has('is-browsing'));
  advance(1);assert(!elements.lyrics.classes.has('is-browsing'));
  await elements.lyrics.emit('touchmove');
  await elements.seek.emit('pointerdown');
  assert(!elements.lyrics.classes.has('is-browsing'));
  await win.emit('pointercancel');

  assert.equal(elements.audio.loadCount,1);
  assert.equal(elements.audio.src,playbackSource);

  // Metadata absence is ordinary: filenames/placeholders and plain lyrics work
  // without requiring a particular title, language, image or tagged lyric format.
  const scenarios=[
    {title:null,lyrics:'[00:01]Only original',artwork:null},
    {title:null,lyrics:'Plain first line\nPlain second line',artwork:null},
    {title:null,lyrics:null,artwork:null},
    {tagged:false},
    {tagged:false,v1Title:'Legacy title'},
  ];
  for (let i=0;i<scenarios.length;i++) {
    const bytes=makeMP3(scenarios[i]);
    globalThis.fetch=async()=>({ok:true,status:200,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});
    elements.audio.dataset.src='assets/audio/untitled%20file.mp3';
    elements['translation-toggle']=new Element(); elements['translation-toggle'].hidden=true;
    elements['translation-toolbar']=new Element(); elements['translation-toolbar'].hidden=true;
    const {ready}=await import('../assets/js/player.js?scenario='+i);await ready;
    assert.equal(elements['translation-toggle'].hidden,true);
    assert.equal(elements['translation-toolbar'].hidden,true);
    assert.equal(elements.title.textContent,i===4?'Legacy title':'untitled file');
    assert(elements.artwork.src.endsWith('cover-placeholder.svg'));
    assert.equal(elements.cover.disabled,false);
    if (i===1) {
      const plain=elements['lyric-list'].children;
      assert.equal(plain.length,2);assert(plain.every(row=>row.disabled));
      const before=elements.audio.currentTime;await plain[0].emit('click');
      assert.equal(elements.audio.currentTime,before);
      assert.equal(elements.lyrics.hidden,false);
    }
    if (i>=2) assert.equal(elements.lyrics.hidden,true);
  }

  // Inline translations must expose the same button as standard SPL lyrics.
  const inline=makeMP3({lyrics:'[00:01]First original\u2009First translation\n[00:05]Second original\u2009Second translation'});
  globalThis.fetch=async()=>({ok:true,status:200,arrayBuffer:async()=>inline.buffer.slice(inline.byteOffset,inline.byteOffset+inline.byteLength)});
  elements['translation-toggle']=new Element(); elements['translation-toggle'].hidden=true;
  elements['translation-toolbar']=new Element(); elements['translation-toolbar'].hidden=true;
  delete elements.audio.dataset.lyricSeparator;
  const inlinePlayer=await import('../assets/js/player.js?inline-translations');await inlinePlayer.ready;
  assert.equal(elements['translation-toggle'].hidden,false);
  assert.equal(elements['translation-toolbar'].hidden,false);
  assert.equal(elements['translation-toggle'].disabled,false);
  assert.equal(elements['lyric-list'].children[0].querySelector('.original').textContent,'First original');
  assert.equal(elements['lyric-list'].children[0].querySelector('.translations').children[0].children[0].textContent,'First translation');
  const pressed=elements['translation-toggle'].attributes['aria-pressed'];
  await elements['translation-toggle'].emit('click');advance(400);
  assert.notEqual(elements['translation-toggle'].attributes['aria-pressed'],pressed);

});

test('all HTML asset paths exist and the page has no embedded audio or navigation UI', () => {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css = readFileSync(new URL('../assets/css/player.css',import.meta.url),'utf8');
  assert(!html.includes('data:audio')); assert(!html.includes('repo-link')); assert(!/<a\s/i.test(html));
  assert(html.includes('id="translation-toolbar" aria-label="歌词显示设置" hidden'));
  assert(html.includes('id="translation-toggle"') && html.includes('hidden disabled'));
  assert(!css.includes('.line:hover')); assert(css.includes('padding:calc(6px + var(--lyric-headroom,0px)) 3px calc(108px + var(--lyric-tailroom,0px));'));
  for (const match of html.matchAll(/\s(?:src|href)="(assets\/[^\"]+)"/g)) assert(existsSync(new URL('../'+match[1].split('?')[0],import.meta.url)),match[1]);
});
