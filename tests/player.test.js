import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

class Element {
  constructor() {
    this.events = {}; this.children = []; this.attributes = {}; this.classes = new Set();
    this.classList = { toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name), remove: name => this.classes.delete(name) };
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
    this.dataset = {}; this.value = '0'; this.max = '93.022041'; this.textContent = '';
    this.scrollTop = 0; this.clientHeight = 246; this.offsetHeight = 75; this.scrollHeight = 480;
    this.currentTime = 0; this.duration = 93.022041; this.paused = true; this.ended = false; this.disabled = false;
  }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  async emit(name, event = {}) { for (const fn of this.events[name] || []) await fn(event); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  append(el) { this.children.push(el); }
  replaceChildren() { this.children = []; }
  getBoundingClientRect() { return { height: 480, top: 0 }; }
  scrollTo(options) { this.scrollTop = options.top; }
  async play() { this.paused = false; await this.emit('play'); }
  pause() { this.paused = true; this.emit('pause'); }
}

test('SPL loading, toggle, iframe protocol and existing playback behaviors', async () => {
  const elements = Object.fromEntries(['audio','player','cover','seek','lyrics','lyric-list','status','elapsed','duration','title','translation-toggle','artwork'].map(id => [id,new Element()]));
  elements.title.textContent = '雑踏、僕らの街 (OP)';
  const baseURI = 'https://nyx-233.github.io/astrobox-profile-player/';
  elements.audio.src = baseURI + 'assets/audio/track.mp3';
  const root = new Element(); const body = new Element(); const win = new Element();
  const messages = []; win.parent = { postMessage: message => messages.push(message) };
  const frames = new Map(); let frameId = 0;
  const stored = new Map();
  Object.assign(globalThis, {
    window: win,
    document: { documentElement: root, body, baseURI, getElementById: id => elements[id], createElement: () => new Element(), addEventListener() {} },
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: fn => { frames.set(++frameId,fn); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: key => stored.get(key), setItem: (key,value) => stored.set(key,value) },
    fetch: async (path, options = {}) => {
      const relative = new URL(path,baseURI).pathname.replace('/astrobox-profile-player/', '');
      const file = new URL('../' + relative,import.meta.url);
      const full = readFileSync(file);
      const range = options.headers?.Range?.match(/bytes=(\d+)-(\d+)/);
      const bytes = range ? full.subarray(Number(range[1]), Number(range[2]) + 1) : full;
      return { ok: true, status: range ? 206 : 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
  });
  const { ready } = await import('../assets/js/player.js'); await ready;
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  flush();
  const rows = elements['lyric-list'].children;
  assert.equal(elements.title.textContent,'雑踏、僕らの街 (OP)');
  assert(elements.artwork.src.startsWith('blob:'));
  assert.equal(rows.length,26); assert.equal(rows[4].children.length,2);
  assert.equal(elements['translation-toggle'].disabled,false);
  assert.equal(elements['translation-toggle'].attributes['aria-pressed'],'true');
  assert(!rows.some(row => row.classes.has('active')));
  assert.equal(elements.lyrics.scrollTop,0);
  assert(messages.some(message => message.type === 'ready'));
  assert(messages.some(message => message.type === 'resize'));
  const config = {namespace:'astrobox.profile-iframe',version:1,type:'config',theme:'dark',transparent:true,requestResize:true};
  await win.emit('message',{source:{},data:config}); assert.equal(root.dataset.astroboxTheme,undefined);
  await win.emit('message',{source:win.parent,data:config}); flush(); assert.equal(root.dataset.astroboxTheme,'dark');
  const count = messages.length; await win.emit('message',{source:win.parent,data:config}); flush(); assert.equal(messages.length,count+1);

  await rows[4].emit('click'); assert.equal(elements.audio.currentTime,11);
  assert(elements.audio.paused); assert(!rows.some(row => row.classes.has('active')));
  await elements.cover.emit('click'); await elements.audio.emit('playing'); assert(rows[4].classes.has('active'));
  await elements['translation-toggle'].emit('click'); flush();
  assert(elements.player.classes.has('hide-translations'));
  assert.equal(elements['translation-toggle'].attributes['aria-pressed'],'false');
  assert(!rows[4].attributes['aria-label'].includes('一切'));
  assert.equal(elements.audio.currentTime,11); assert(!elements.audio.paused);
  assert.equal(stored.get('astrobox-profile-player:translation'),'off');
  await elements['translation-toggle'].emit('click'); flush();
  assert(!elements.player.classes.has('hide-translations')); assert(rows[4].attributes['aria-label'].includes('一切'));
  // Storage failure must not break the toggle (e.g. a sandboxed iframe).
  globalThis.localStorage.setItem = () => { throw new Error('Storage blocked'); };
  await elements['translation-toggle'].emit('click'); assert(elements.player.classes.has('hide-translations'));
  await elements['translation-toggle'].emit('click');

  elements.audio.currentTime = 19.4; await elements.audio.emit('timeupdate');
  assert(!rows[4].classes.has('active')); assert(rows[5].classes.has('active'));
  assert.equal(rows.filter(row => row.classes.has('active')).length,1);
  await elements.seek.emit('pointerdown'); elements.seek.value = '50'; await elements.seek.emit('input');
  assert.equal(elements.audio.currentTime,19.4); assert(!elements.audio.paused); assert(rows[5].classes.has('active'));
  assert.equal(elements.elapsed.textContent,'00:50');
  await win.emit('pointerup'); assert.equal(elements.audio.currentTime,50); assert(!elements.audio.paused);
  await elements.cover.emit('click'); assert(elements.audio.paused);
  await elements.seek.emit('pointerdown'); elements.seek.value = '70'; await elements.seek.emit('input');
  assert.equal(elements.audio.currentTime,50); await win.emit('pointerup'); assert.equal(elements.audio.currentTime,70); assert(elements.audio.paused);
  await elements.seek.emit('pointerdown'); elements.seek.value = '5'; await elements.seek.emit('input');
  await win.emit('pointercancel'); assert.equal(elements.audio.currentTime,70); assert.equal(Number(elements.seek.value),70);
  elements.seek.value = '71'; await elements.seek.emit('input'); assert.equal(elements.audio.currentTime,71);
});

test('all HTML asset paths exist and the page has no embedded audio or navigation UI', () => {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const css = readFileSync(new URL('../assets/css/player.css',import.meta.url),'utf8');
  assert(!html.includes('data:audio')); assert(!html.includes('repo-link')); assert(!/<a\s/i.test(html));
  assert(!css.includes('.line:hover')); assert(/\.lyric-list\s*\{\s*padding:6px 3px 108px;/.test(css));
  for (const match of html.matchAll(/(?:src|href)="(assets\/[^\"]+)"/g)) assert(existsSync(new URL('../'+match[1],import.meta.url)),match[1]);
});
