/** Measure natural translation heights independently of their clipped wrappers. */
export function measureTranslations(rows) {
  return rows.map(row => {
    const wrapper = row.querySelector('.translations');
    const content = wrapper?.querySelector('.translation-content');
    return {row, wrapper, height: content?.getBoundingClientRect().height || 0};
  });
}

/** All rows share timing, with separate height and opacity channels. */
export function applyTranslationProgress(entries, progress, opacity = progress) {
  const value = Math.max(-.25, Math.min(1.25, progress));
  const layoutValue = Math.max(0, value);
  const alpha = Math.max(0, Math.min(1, opacity));
  let shift = 0;
  for (const {row, wrapper, height} of entries) {
    row?.style.setProperty('--translation-shift', shift + 'px');
    if (wrapper) {
      wrapper.style.height = height * layoutValue + 'px';
      wrapper.style.opacity = String(alpha);
    }
    // Continue the spring past the collapsed target using whole-row movement.
    // CSS heights stay nonnegative; rows without translations move with others.
    shift += height * (value - layoutValue);
  }
}

/** A damped spring moves whole rows through their target, independently of fade. */
export function createTranslationTransition(from, visible) {
  const clamp = value => Math.max(0, Math.min(1, value));
  const height = Math.max(-.25, Math.min(1.25, from.height));
  const opacity = clamp(from.opacity);
  const fadeDuration = 220 * opacity;
  const collapseDuration = 760 * Math.min(1, Math.abs(height));
  const openDistance = Math.min(1, Math.abs(1 - height));
  const openFadeDuration = 220 * (1 - opacity);
  const openHeightDuration = openDistance ? Math.max(900 * openDistance, openFadeDuration) : 0;
  const openDuration = openHeightDuration || openFadeDuration;
  // First target crossing of the spring, after the eased-in movement clock.
  const firstArrival = Math.sqrt((Math.PI - Math.atan(13.2 / 7.3)) / 13.2);
  const duration = visible ? openDuration : fadeDuration + collapseDuration;
  const ease = (time, length) => {
    const value = length > 0 ? clamp(time / length) : 1;
    return value * value * (3 - 2 * value);
  };
  function elasticHeight(time, target, length) {
    if (time <= 0) return height;
    if (time >= length) return target;
    // Slow the main travel too, rather than adding time only to the tiny tail.
    const progress = (time / length) ** 2;
    const response = 1 - Math.exp(-7.3 * progress)
      * (Math.cos(13.2 * progress) + 7.3 / 13.2 * Math.sin(13.2 * progress));
    return height + (target - height) * response;
  }
  return {
    duration,
    sample(elapsed) {
      if (elapsed >= duration) return {height: visible ? 1 : 0, opacity: visible ? 1 : 0};
      const time = Math.max(0, elapsed);
      if (visible) {
        const position = elasticHeight(time, 1, openHeightDuration);
        const reveal = !openHeightDuration ? ease(time, openFadeDuration)
          : time >= firstArrival * openHeightDuration ? 1 : clamp((position - height) / (1 - height));
        return {
          height: position,
          opacity: opacity + (1 - opacity) * reveal,
        };
      }
      return {
        height: elasticHeight(time - fadeDuration, 0, collapseDuration),
        opacity: opacity * (1 - ease(time, fadeDuration)),
      };
    },
  };
}
