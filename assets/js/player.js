import { parseSPL } from './spl.js';
import { readID3, normalizeEmbeddedLyrics } from './id3.js';
import { reportHeight } from './astrobox.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
const player = $('player');
const cover = $('cover');
const seek = $('seek');
const viewport = $('lyrics');
const list = $('lyric-list');
const status = $('status');
const translationToggle = $('translation-toggle');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const preferenceKey = 'astrobox-profile-player:translation';
let metadata = {
  title: $('title').textContent,
  duration: 0,
  originalLanguage: 'ja',
  translationLanguage: 'zh-CN',
};
let lines = [];
let buttons = [];
let active = -2;
let frame = 0;
let dragging = false;
let manualUntil = 0;
let pendingPlay = false;
let hasStarted = false;
let resumeTimer;
let showTranslations = true;
try { showTranslations = localStorage.getItem(preferenceKey) !== 'off'; } catch { /* Opaque iframe storage may be unavailable. */ }

function format(time) {
  const seconds = Math.max(0, Math.floor(time || 0));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function duration() {
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : metadata.duration;
}
function center(smooth = true) {
  const button = buttons[active];
  if (!button || Date.now() < manualUntil) return;
  const top = button.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    + viewport.scrollTop - (viewport.clientHeight - button.offsetHeight) / 2;
  viewport.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion.matches ? 'smooth' : 'instant' });
}
function updateLyrics(time, force = false) {
  let index = -1;
  if (hasStarted) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time > time) break;
      if (time < lines[i].end) index = i;
    }
  }
  if (index === active && !force) return;
  active = index;
  buttons.forEach((button, i) => {
    button.classList.toggle('active', i === index);
    button.classList.toggle('near', Math.abs(i - index) === 1);
    if (i === index) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  center(!force);
}
function update() {
  // During a drag, only the thumb and displayed time preview the destination.
  // Audio and lyric highlighting continue from the real playback position.
  const time = dragging ? Number(seek.value) : audio.currentTime;
  const length = duration();
  seek.max = String(length || 1);
  seek.disabled = !length;
  if (!dragging) seek.value = String(time);
  seek.style.setProperty('--progress', Math.max(0, Math.min(1, time / (length || 1))) * 100 + '%');
  seek.setAttribute('aria-valuetext', format(time) + ' / ' + format(length));
  $('elapsed').textContent = format(time);
  $('duration').textContent = format(length);
  updateLyrics(audio.currentTime);
}
function tick() {
  update();
  if (!audio.paused && !audio.ended) frame = requestAnimationFrame(tick);
}
function syncPlayback() {
  const playing = !audio.paused && !audio.ended;
  player.classList.toggle('is-playing', playing);
  cover.setAttribute('aria-pressed', String(playing));
  cover.setAttribute('aria-label', playing ? '暂停' : '播放');
  cancelAnimationFrame(frame);
  update();
  if (playing) frame = requestAnimationFrame(tick);
}
function seekTo(time) {
  try {
    audio.currentTime = Math.max(0, Math.min(time, duration()));
    update();
    updateLyrics(audio.currentTime, true);
  } catch {
    status.textContent = '音频仍在加载，请稍后重试。';
  }
}
function applyTranslationPreference() {
  const available = lines.some(line => line.translations.length > 0);
  const visible = showTranslations && available;
  player.classList.toggle('hide-translations', !visible);
  translationToggle.disabled = !available;
  translationToggle.setAttribute('aria-pressed', String(visible));
  translationToggle.title = available ? (visible ? '隐藏歌词翻译' : '显示歌词翻译') : '当前歌词没有翻译';
  buttons.forEach((button, i) => {
    const text = [lines[i].original, ...(visible ? lines[i].translations : [])].join(' ');
    button.setAttribute('aria-label', format(lines[i].time) + ' ' + text);
  });
  // Hiding translations changes row heights. Re-align only after layout updates.
  requestAnimationFrame(() => { center(false); reportHeight(); });
}
function renderLyrics(source) {
  lines = parseSPL(source).filter(line => !/^(作词|作曲|编曲|作詞|編曲)\s*[:：]/.test(line.original));
  list.replaceChildren();
  buttons = lines.map(line => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'line';
    const original = document.createElement('span');
    original.className = 'jp';
    original.lang = metadata.originalLanguage;
    original.textContent = line.original;
    button.append(original);
    for (const text of line.translations) {
      const translation = document.createElement('span');
      translation.className = 'cn';
      if (metadata.translationLanguage) translation.lang = metadata.translationLanguage;
      translation.textContent = text;
      button.append(translation);
    }
    button.addEventListener('click', () => { manualUntil = 0; seekTo(line.time); });
    list.append(button);
    return button;
  });
  list.setAttribute('aria-busy', 'false');
  applyTranslationPreference();
  active = -2;
  updateLyrics(audio.currentTime, true);
  if (!lines.length) status.textContent = '没有找到可显示的歌词。';
  reportHeight();
}

cover.addEventListener('click', async () => {
  if (pendingPlay) return;
  if (!audio.paused) { audio.pause(); return; }
  pendingPlay = true;
  status.textContent = '';
  try {
    if (audio.ended) audio.currentTime = 0;
    await audio.play();
  } catch {
    status.textContent = '暂时无法播放，请再次点击封面。';
  } finally {
    pendingPlay = false;
    syncPlayback();
  }
});
audio.addEventListener('playing', () => { hasStarted = true; syncPlayback(); });
['play', 'pause', 'ended'].forEach(event => audio.addEventListener(event, syncPlayback));
['loadedmetadata', 'durationchange', 'timeupdate', 'seeked'].forEach(event => audio.addEventListener(event, update));
audio.addEventListener('error', () => {
  status.textContent = '音频无法加载，请刷新页面重试。';
  player.classList.remove('is-playing');
  cover.setAttribute('aria-pressed', 'false');
  cover.setAttribute('aria-label', '播放');
  cancelAnimationFrame(frame);
});
seek.addEventListener('pointerdown', () => { dragging = true; manualUntil = 0; });
seek.addEventListener('input', () => {
  manualUntil = 0;
  if (dragging) update();
  else seekTo(Number(seek.value));
});
function finishSeek() {
  if (!dragging) return;
  const time = Number(seek.value);
  dragging = false;
  seekTo(time);
}
function cancelSeek() {
  if (!dragging) return;
  dragging = false;
  update();
}
window.addEventListener('pointerup', finishSeek);
window.addEventListener('pointercancel', cancelSeek);
seek.addEventListener('change', finishSeek);
seek.addEventListener('blur', finishSeek);
translationToggle.addEventListener('click', () => {
  if (translationToggle.disabled) return;
  showTranslations = !showTranslations;
  try { localStorage.setItem(preferenceKey, showTranslations ? 'on' : 'off'); } catch { /* Toggle still works without storage. */ }
  manualUntil = 0;
  applyTranslationPreference();
});
function manualScroll() {
  manualUntil = Date.now() + 2800;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => center(), 2850);
}
viewport.addEventListener('wheel', manualScroll, { passive: true });
viewport.addEventListener('touchmove', manualScroll, { passive: true });
viewport.addEventListener('scroll', () => viewport.classList.toggle('at-start', viewport.scrollTop <= 4), { passive: true });
new ResizeObserver(() => center(false)).observe(viewport);
new ResizeObserver(() => center(false)).observe(list);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { update(); center(false); } });
$('artwork').addEventListener('load', () => reportHeight());
if (document.fonts?.ready) document.fonts.ready.then(() => { center(false); reportHeight(); });
update();

let artworkURL;
async function loadTrack() {
  try {
    const tags = await readID3(audio.src);
    metadata.title = tags.title || '未命名歌曲';
    $('title').textContent = metadata.title;
    document.title = metadata.title;
    if (tags.artwork) {
      artworkURL = URL.createObjectURL(new Blob([tags.artwork.bytes], { type: tags.artwork.mime }));
      $('artwork').src = artworkURL;
    }
    if (tags.lyrics) renderLyrics(normalizeEmbeddedLyrics(tags.lyrics));
    else {
      list.setAttribute('aria-busy', 'false');
      status.textContent = '歌曲没有内嵌歌词，音乐仍可播放。';
    }
    update();
    reportHeight();
  } catch {
    $('title').textContent = '歌曲';
    list.setAttribute('aria-busy', 'false');
    status.textContent = '无法读取音频内嵌信息，请刷新页面重试；音乐仍可播放。';
    reportHeight();
  }
}

// Exporting the loading promise also makes the static app's startup testable.
export const ready = loadTrack();
