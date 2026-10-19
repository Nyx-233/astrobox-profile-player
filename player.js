import { parseLyrics } from './spl.js?v=20261018-generic';
import { parseID3, normalizeEmbeddedLyrics } from './id3.js?v=20261018-translations';
import { loadAudioFile } from './audio-file.js';
import { originalOf, captureAnchor, restoreAnchor } from './lyric-anchor.js?v=20261018-generic';
import { reportHeight } from './astrobox.js';
import { measureTranslations, applyTranslationProgress, createTranslationTransition } from './translation-layout.js?v=20261019-synced-reveal';
import { createSpringMotion } from './spring-motion.js?v=20261018-spring';

const $ = id => document.getElementById(id);
const audio = $('audio');
const player = $('player');
const cover = $('cover');
cover.disabled = true;
const seek = $('seek');
const viewport = $('lyrics');
const list = $('lyric-list');
const status = $('status');
const translationToggle = $('translation-toggle');
const translationToolbar = $('translation-toolbar');
const placeholderArtwork = new URL('../images/cover-placeholder.svg', import.meta.url).href;
const preferenceKey = 'astrobox-profile-player:translation';
let metadata = {
  title: $('title').textContent,
  duration: 0,
  lyricsLanguage: 'und',
};
let lines = [];
let buttons = [];
let active = -2;
let frame = 0;
let dragging = false;
let manualUntil = 0;
let manuallyBrowsing = false;
let followActivated = false;
let layoutScrollTop = null;
let pendingPlay = false;
let pendingSeek = null;
const pendingSeekMessage = '音频正在加载，就绪后将跳转到所选歌词。';
let resumeTimer;
const scrollMotion = createSpringMotion();
let translationFrame = 0;
let translationAnchor = null;
let translationProgress = 1;
let translationOpacity = 1;
let translationEntries = [];
let translationAnimating = false;
let translationFollowing = false;
const followDelay = 3000;
let showTranslations = true;
try { showTranslations = localStorage.getItem(preferenceKey) !== 'off'; } catch { /* Opaque iframe storage may be unavailable. */ }

function format(time) {
  const seconds = Math.max(0, Math.floor(time || 0));
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function duration() {
  if (Number.isFinite(audio.duration) && audio.duration > 0) metadata.duration = audio.duration;
  return metadata.duration;
}
function cancelCenter() {
  scrollMotion.cancel();
}
function restoreLyricAnchor(anchor) {
  const before = viewport.scrollTop;
  restoreAnchor(viewport, anchor, list);
  if (viewport.scrollTop !== before) layoutScrollTop = viewport.scrollTop;
}
function center(smooth = true, clickedButton = null) {
  const button = clickedButton || buttons[active];
  if (!button || !clickedButton && (performance.now() < manualUntil || translationAnimating && !translationFollowing)) return;
  const original = originalOf(button);
  const rect = original.getBoundingClientRect();
  const offset = rect.top - viewport.getBoundingClientRect().top;
  const centeredOffset = (viewport.clientHeight - rect.height) / 2;
  const top = rect.top - viewport.getBoundingClientRect().top
    + viewport.scrollTop - (viewport.clientHeight - rect.height) / 2;
  const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight));
  const destination = clickedButton || translationFollowing ? centeredOffset : offset + viewport.scrollTop - target;
  const anchor = { element: original, offset };
  if (translationFollowing) translationAnchor = anchor;
  function layout(position) {
    // Playback chooses a target; only this viewport animation moves the text.
    // Using an original-text anchor also handles the list's top and bottom.
    anchor.offset = position;
    restoreLyricAnchor(anchor);
  }
  if (!smooth) {
    cancelCenter();
    layout(destination);
    return;
  }
  scrollMotion.start({ from: offset, to: destination, update: layout });
}
function scheduleFollow() {
  manualUntil = performance.now() + followDelay;
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { resumeFollow(); center(); }, followDelay);
}
function holdFollow() {
  cancelCenter();
  // A real touch/scroll takes control immediately. Playback events do not.
  translationAnchor = null;
  translationFollowing = false;
  manuallyBrowsing = true;
  viewport.classList.toggle('is-browsing', true);
  scheduleFollow();
}
function resumeFollow() {
  clearTimeout(resumeTimer);
  manualUntil = 0;
  manuallyBrowsing = false;
  viewport.classList.toggle('is-browsing', false);
  if (translationAnimating && followActivated && buttons[active]) translationFollowing = true;
}
function playingLineIsCentered() {
  const original = originalOf(buttons[active]);
  if (!original) return false;
  const rect = original.getBoundingClientRect();
  const middle = rect.top - viewport.getBoundingClientRect().top + rect.height / 2;
  return Math.abs(middle - viewport.clientHeight / 2) <= 4;
}
function updateLyrics(time, force = false) {
  time = pendingSeek ?? time;
  const first = lines.findIndex(line => Number.isFinite(line.time));
  let index = first >= 0 && time < lines[first].time ? first : -1;
  for (let i = 0; i < lines.length; i++) {
    if (!Number.isFinite(lines[i].time)) continue;
    if (lines[i].time > time) break;
    if (time < lines[i].end) index = i;
  }
  if (index === active && !force) return;
  active = index;
  buttons.forEach((button, i) => {
    button.classList.toggle('active', i === index);
    button.classList.toggle('near', Math.abs(i - index) === 1);
    if (i === index) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  if (translationAnimating && followActivated && !manuallyBrowsing && buttons[active]) translationFollowing = true;
  center();
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
function applyPendingSeek() {
  if (pendingSeek === null) return;
  // Embedded tags can be parsed before the media element has metadata.
  // Never turn an unknown duration into a zero-second seek limit.
  if (audio.readyState === 0) {
    audio.preload = 'auto';
    status.textContent = pendingSeekMessage;
    return;
  }
  try {
    const length = duration();
    audio.currentTime = length > 0 ? Math.min(pendingSeek, length) : pendingSeek;
    pendingSeek = null;
    if (status.textContent === pendingSeekMessage) status.textContent = '';
    update();
    updateLyrics(audio.currentTime, true);
  } catch {
    // Some WebViews temporarily reject seeking during metadata initialization.
    // Keep the latest requested position and retry on the next readiness event.
    status.textContent = pendingSeekMessage;
  }
}
function seekTo(time) {
  const target = Number(time);
  if (!Number.isFinite(target)) return;
  followActivated = true;
  pendingSeek = Math.max(0, target);
  updateLyrics(pendingSeek);
  applyPendingSeek();
}
function applyTranslationPreference(animate = false) {
  scrollMotion.pause();
  cancelAnimationFrame(translationFrame);
  translationAnchor = animate ? captureAnchor(viewport, buttons) : null;
  translationAnimating = animate;
  // Initial highlighting is visual only. Actual playback or a selected time
  // activates follow; toggling translation never activates it by itself.
  translationFollowing = animate && followActivated && !manuallyBrowsing && !!buttons[active];
  // The toggle only changes translation layout; follow state and its existing
  // idle timer belong to scrolling and are never changed here.
  if (translationFollowing) center(true, buttons[active]);
  translationEntries = measureTranslations(buttons);
  const available = lines.some(line => line.translations.length > 0);
  const visible = showTranslations && available;
  player.classList.toggle('hide-translations', !visible);
  translationToggle.disabled = !available;
  translationToggle.hidden = !available;
  translationToolbar.hidden = !available;
  translationToggle.setAttribute('aria-pressed', String(visible));
  translationToggle.title = available ? (visible ? '隐藏歌词翻译' : '显示歌词翻译') : '当前歌词没有翻译';
  buttons.forEach((button, i) => {
    const text = [lines[i].original, ...(visible ? lines[i].translations : [])].join(' ');
    button.setAttribute('aria-label', (Number.isFinite(lines[i].time) ? format(lines[i].time) + ' ' : '') + text);
    button.querySelector('.translations')?.setAttribute('aria-hidden', String(!visible));
  });
  const target = visible ? 1 : 0;
  const motion = createTranslationTransition({height: translationProgress, opacity: translationOpacity}, visible);
  function layout(progress, opacity) {
    translationProgress = progress;
    translationOpacity = opacity;
    applyTranslationProgress(translationEntries, progress, opacity);
    restoreLyricAnchor(translationAnchor);
  }
  function finish() {
    translationFrame = 0;
    translationAnimating = false;
    translationAnchor = null;
    translationFollowing = false;
    // Only an already-following viewport recenters after the layout changes.
    // Browsing keeps its position until the normal idle delay expires.
    if (animate && followActivated && !manuallyBrowsing && buttons[active]) center(true, buttons[active]);
    reportHeight();
  }
  if (translationAnimating && motion.duration > 0) {
    const started = performance.now();
    function step(now) {
      const elapsed = Math.max(0, now - started);
      const state = motion.sample(elapsed);
      // Height, opacity and compensation are updated together before paint.
      // Following uses the playing-row anchor; browsing keeps the visible row.
      layout(state.height, state.opacity);
      if (elapsed < motion.duration) translationFrame = requestAnimationFrame(step);
      else finish();
    }
    translationFrame = requestAnimationFrame(step);
  } else {
    layout(target, target);
    finish();
  }
}

function renderLyrics(source) {
  lines = parseLyrics(source);
  viewport.hidden = !lines.length;
  viewport.classList.toggle('is-untimed', !!lines.length && !lines.some(line => Number.isFinite(line.time)));
  player.classList.toggle('no-lyrics', !lines.length);
  list.replaceChildren();
  list.style.setProperty('--lyric-headroom', '0px');
  list.style.setProperty('--lyric-tailroom', '0px');
  buttons = lines.map(line => {
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = !Number.isFinite(line.time);
    button.className = 'line';
    const original = document.createElement('span');
    original.className = 'original';
    original.lang = metadata.lyricsLanguage;
    original.textContent = line.original;
    button.append(original);
    if (line.translations.length) {
      const translations = document.createElement('span');
      translations.className = 'translations';
      const content = document.createElement('span');
      content.className = 'translation-content';
      for (const text of line.translations) {
        const translation = document.createElement('span');
        translation.className = 'translation';
        translation.lang = 'und';
        translation.textContent = text;
        content.append(translation);
      }
      translations.append(content);
      button.append(translations);
    }
    button.addEventListener('click', () => {
      if (!Number.isFinite(line.time)) return;
      const browsing = performance.now() < manualUntil && !playingLineIsCentered();
      if (browsing) {
        holdFollow();
        seekTo(line.time);
      } else {
        resumeFollow();
        translationAnchor = null;
        seekTo(line.time);
        center(true, button);
      }
    });
    list.append(button);
    return button;
  });
  list.setAttribute('aria-busy', 'false');
  applyTranslationPreference();
  active = -2;
  updateLyrics(audio.currentTime, true);
  status.textContent = lines.length ? '' : '音频没有内嵌歌词，音乐仍可播放。';
  reportHeight();
}

cover.addEventListener('click', async () => {
  if (pendingPlay) return;
  if (!audio.paused) { audio.pause(); return; }
  pendingPlay = true;
  status.textContent = '';
  try {
    if (audio.ended && pendingSeek === null) audio.currentTime = 0;
    await audio.play();
  } catch {
    status.textContent = '暂时无法播放，请再次点击封面。';
  } finally {
    pendingPlay = false;
    syncPlayback();
  }
});
audio.addEventListener('playing', () => { followActivated = true; applyPendingSeek(); syncPlayback(); });
['play', 'pause', 'ended'].forEach(event => audio.addEventListener(event, syncPlayback));
['loadedmetadata', 'durationchange', 'canplay'].forEach(event => {
  audio.addEventListener(event, () => { applyPendingSeek(); update(); });
});
['timeupdate', 'seeked'].forEach(event => audio.addEventListener(event, update));
audio.addEventListener('error', () => {
  pendingSeek = null;
  status.textContent = '音频无法加载，请刷新页面重试。';
  player.classList.remove('is-playing');
  cover.setAttribute('aria-pressed', 'false');
  cover.setAttribute('aria-label', '播放');
  cancelAnimationFrame(frame);
});
seek.addEventListener('pointerdown', () => { dragging = true; resumeFollow(); });
seek.addEventListener('input', () => {
  resumeFollow();
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
  applyTranslationPreference(true);
});
// A tap can select a lyric without entering manual browsing. Actual scrolling
// below still suspends follow and lets the reader keep their current position.
viewport.addEventListener('pointerdown', () => scrollMotion.pause(), { passive: true });
viewport.addEventListener('wheel', holdFollow, { passive: true });
viewport.addEventListener('touchmove', holdFollow, { passive: true });
viewport.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) holdFollow();
});
viewport.addEventListener('scroll', () => {
  viewport.classList.toggle('at-start', viewport.scrollTop <= 4);
  const layoutScroll = layoutScrollTop !== null && Math.abs(viewport.scrollTop - layoutScrollTop) < .5;
  layoutScrollTop = null;
  // Native touch inertia continues after touchmove stops. Wait until scrolling
  // itself is quiet; playback-generated scrolls never extend the manual hold.
  if (manuallyBrowsing && !layoutScroll) scheduleFollow();
}, { passive: true });
function layoutChanged() {
  if (translationAnimating) restoreLyricAnchor(translationAnchor);
  else center();
}
new ResizeObserver(layoutChanged).observe(viewport);
// Height changes use the same anchor as the playing-row viewport animation.
new ResizeObserver(() => {
  if (translationAnimating) restoreLyricAnchor(translationAnchor);
}).observe(list);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { update(); center(); } });
$('artwork').addEventListener('load', () => reportHeight());
$('artwork').addEventListener('error', () => {
  if ($('artwork').src === placeholderArtwork) return;
  if (artworkURL) { URL.revokeObjectURL(artworkURL); artworkURL = undefined; }
  $('artwork').src = placeholderArtwork;
});
if (document.fonts?.ready) document.fonts.ready.then(() => { center(); reportHeight(); });
update();

let artworkURL;
let audioURL;
async function loadTrack() {
  try {
    const source = new URL(audio.dataset.src, document.baseURI).href;
    let filename = new URL(source).pathname.split('/').pop() || '';
    try { filename = decodeURIComponent(filename); } catch { /* Keep malformed escapes as filename text. */ }
    metadata.title = filename.replace(/\.mp3$/i,'') || '未命名音频';
    $('title').textContent = metadata.title;
    document.title = metadata.title;
    $('artwork').src = placeholderArtwork;
    const file = await loadAudioFile(source);
    audioURL = file.url;
    // Set the source once. Lyrics and progress changes only set currentTime;
    // they must never call load(), replace src, or restart playback.
    audio.src = audioURL;
    audio.load();
    cover.disabled = false;
    try {
      const tags = parseID3(file.bytes);
      metadata.title = tags.title || metadata.title;
      metadata.lyricsLanguage = tags.lyricsLanguage || 'und';
      $('title').textContent = metadata.title;
      document.title = metadata.title;
      if (tags.artwork) {
        artworkURL = URL.createObjectURL(new Blob([tags.artwork.bytes], { type: tags.artwork.mime }));
        $('artwork').src = artworkURL;
      }
      renderLyrics(normalizeEmbeddedLyrics(tags.lyrics, audio.dataset.lyricSeparator));
    } catch {
      renderLyrics('');
      status.textContent = '无法读取音频内嵌信息，音乐仍可播放。';
    }
    update();
  } catch {
    viewport.hidden = true;
    player.classList.toggle('no-lyrics', true);
    list.setAttribute('aria-busy', 'false');
    status.textContent = '音频文件未完整加载，请刷新页面重试。';
  } finally {
    player.classList.remove('is-loading');
    reportHeight();
  }
}
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  if (audioURL) URL.revokeObjectURL(audioURL);
  if (artworkURL) URL.revokeObjectURL(artworkURL);
});

// Resolves once the complete audio file and its embedded tags have been loaded.
export const ready = loadTrack();
