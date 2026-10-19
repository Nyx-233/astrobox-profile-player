/** Exact critically damped motion, in seconds; independent of frame rate. */
export function stepSpring(value, velocity, target, seconds, stiffness = 180) {
  const time = Math.max(0, seconds);
  const frequency = Math.sqrt(stiffness);
  const distance = value - target;
  const rate = velocity + frequency * distance;
  const decay = Math.exp(-frequency * time);
  return {
    value: target + (distance + rate * time) * decay,
    velocity: (velocity - frequency * rate * time) * decay,
  };
}

/** One viewport animation. Retargeting keeps momentum; gestures cancel it. */
export function createSpringMotion({
  stiffness = 180,
  clock = () => performance.now(),
  request = callback => requestAnimationFrame(callback),
  cancel = id => cancelAnimationFrame(id),
} = {}) {
  let frame = 0;
  let running = false;
  let velocity = 0;
  let generation = 0;

  function pause() {
    cancel(frame);
    frame = 0;
    generation++;
  }

  function stop() {
    pause();
    running = false;
    velocity = 0;
  }

  function start({ from, to, update }) {
    cancel(frame);
    frame = 0;
    if (!running) velocity = 0;
    let value = from;
    let previous = clock();
    const token = ++generation;
    running = true;

    function step(now) {
      if (token !== generation) return;
      frame = 0;
      const state = stepSpring(value, velocity, to, (now - previous) / 1000, stiffness);
      previous = now;
      value = state.value;
      velocity = state.velocity;
      const settled = Math.abs(value - to) < .15 && Math.abs(velocity) < 1.5;
      if (settled) {
        value = to;
        velocity = 0;
        running = false;
      }
      update(value);
      // A gesture or a new target can take over inside the update callback.
      if (!settled && token === generation) frame = request(step);
    }

    if (Math.abs(from - to) < .15 && Math.abs(velocity) < 1.5) {
      running = false;
      velocity = 0;
      update(to);
    } else frame = request(step);
  }

  return { start, pause, cancel: stop };
}
