import openingArtwork from './brand-opening.svg?raw';
import compactArtwork from './brand-compact.svg?raw';
import { brandMotionData } from './brand-motion-data.js';
import './brand-motion.css';

const DURATION = 1800;
const LINE_UP = .77;
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function scatterTransform(glyph, { x = glyph.x, y = glyph.y, size = glyph.size, angle = glyph.angle } = {}) {
  return `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${size / 1000}) translate(${-glyph.origin}px, 0px)`;
}

function wordTransform(glyph) {
  return `translate(${glyph.wordX}px, ${glyph.baseline}px) scale(${glyph.wordSize / 1000})`;
}

export function initBrandMotion() {
  const home = document.getElementById('brand-home');
  const headerIcon = home?.querySelector('img');
  if (!headerIcon) return;
  let current = null;
  let generation = 0;

  function finish() {
    generation++;
    if (current) {
      for (const animation of current.animations) animation.cancel();
      current.overlay.remove();
      current.actor.remove();
      current.skip.remove();
      current = null;
    }
    document.documentElement.classList.remove('brand-running');
  }

  function play({ speed = 1, paused = false } = {}) {
    finish();
    if (motionPreference.matches || document.hidden) return;
    const run = generation;
    const width = Math.min(760, window.innerWidth - 24, window.innerHeight * 1.18);
    const scale = width / 760;
    const height = width * 500 / 760;
    const left = (window.innerWidth - width) / 2;
    const top = Math.max(12, window.innerHeight * .46 - height / 2);
    const overlay = document.createElement('div');
    overlay.className = 'brand-intro';
    overlay.setAttribute('aria-hidden', 'true');
    const actor = document.createElement('div');
    actor.className = 'brand-actor';
    actor.setAttribute('aria-hidden', 'true');
    actor.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px`;
    actor.innerHTML = openingArtwork;
    const compact = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const compactSource = new DOMParser().parseFromString(compactArtwork, 'image/svg+xml');
    const { compactBox } = brandMotionData;
    compact.setAttribute('class', 'brand-compact-icon');
    compact.setAttribute('transform', `translate(${compactBox.x} ${compactBox.y}) scale(${compactBox.width / 500})`);
    compact.setAttribute('opacity', '0');
    for (const child of compactSource.documentElement.children) {
      compact.append(document.importNode(child, true));
    }
    actor.querySelector('svg').append(compact);
    const skip = document.createElement('button');
    skip.className = 'brand-skip';
    skip.type = 'button';
    skip.textContent = '跳过动画';
    skip.addEventListener('click', finish);
    document.body.append(overlay, actor, skip);
    document.documentElement.classList.add('brand-running');
    const animations = [];
    current = { animations, overlay, actor, skip };

    const animate = (element, frames) => {
      const animation = element.animate(frames, { duration: DURATION, fill: 'both' });
      animation.playbackRate = speed;
      if (paused) animation.pause();
      animations.push(animation);
      return animation;
    };

    const { glyphs } = brandMotionData;
    for (const glyph of glyphs) {
      const element = actor.querySelector(`[data-character="${glyph.character}"]`);
      const scatter = scatterTransform(glyph);
      const word = wordTransform(glyph);
      if (glyph.character === 'B') {
        animate(element, [
          { offset: 0, opacity: 0, fill: glyph.initialColor, transform: scatterTransform(glyph, { y: 307, size: 205, angle: -8 }), easing: 'cubic-bezier(.18,.7,.3,1)' },
          { offset: .045, opacity: 1 },
          { offset: .18, opacity: 1, fill: glyph.initialColor, transform: scatterTransform(glyph, { y: 259, size: 260, angle: -2 }), easing: 'ease-in-out' },
          { offset: .33, opacity: 1, fill: glyph.initialColor, transform: scatter, easing: 'ease-out' },
          { offset: .60, opacity: 1, fill: glyph.initialColor, transform: scatter, easing: 'cubic-bezier(.4,0,.2,1)' },
          { offset: LINE_UP, opacity: 1, fill: glyph.color, transform: word },
          { offset: .94, opacity: 0, fill: glyph.color, transform: word },
          { offset: 1, opacity: 0, fill: glyph.color, transform: word },
        ]);
      } else {
        const index = glyphs.indexOf(glyph) - 1;
        const start = (220 + index * 90) / DURATION;
        const stop = (620 + index * 90) / DURATION;
        const from = scatterTransform(glyph, { x: 250, y: 215, size: glyph.size * .22, angle: -18 });
        animate(element, [
          { offset: 0, opacity: 0, fill: glyph.initialColor, transform: from },
          { offset: start, opacity: 0, fill: glyph.initialColor, transform: from, easing: 'cubic-bezier(.16,.75,.25,1)' },
          { offset: start + .025, opacity: 1 },
          { offset: stop - .045, opacity: 1, fill: glyph.initialColor, transform: scatterTransform(glyph, { x: glyph.x + 5, y: glyph.y - 5, size: glyph.size * 1.05, angle: glyph.angle + 3 }), easing: 'ease-in-out' },
          { offset: stop, opacity: 1, fill: glyph.initialColor, transform: scatter },
          { offset: .60, opacity: 1, fill: glyph.initialColor, transform: scatter, easing: 'cubic-bezier(.4,0,.2,1)' },
          { offset: LINE_UP, opacity: 1, fill: glyph.color, transform: word },
          { offset: .94, opacity: 0, fill: glyph.color, transform: word },
          { offset: 1, opacity: 0, fill: glyph.color, transform: word },
        ]);
      }
    }

    animate(actor.querySelector('.brand-base'), [
      { offset: 0, opacity: 1, transform: 'translate(0,0) scale(1)' },
      { offset: .33, opacity: 1, transform: 'translate(0,0) scale(1)' },
      { offset: .60, opacity: 1, transform: 'translate(0,0) scale(1)', easing: 'ease-in-out' },
      { offset: LINE_UP, opacity: 1, transform: brandMotionData.baseTransform },
      { offset: .94, opacity: 0, transform: brandMotionData.baseTransform },
      { offset: 1, opacity: 0, transform: brandMotionData.baseTransform },
    ]);
    animate(compact, [
      { offset: 0, opacity: 0 },
      { offset: .80, opacity: 0, easing: 'ease-in-out' },
      { offset: .96, opacity: 1 },
      { offset: 1, opacity: 1 },
    ]);

    const target = headerIcon.getBoundingClientRect();
    const shrink = target.width / (compactBox.width * scale);
    const dx = target.left - left - compactBox.x * scale * shrink;
    const dy = target.top - top - compactBox.y * scale * shrink;
    animate(actor, [
      { offset: 0, transform: 'translate(0,0) scale(1)' },
      { offset: LINE_UP, transform: 'translate(0,0) scale(1)', easing: 'cubic-bezier(.4,0,.2,1)' },
      { offset: 1, transform: `translate(${dx}px, ${dy}px) scale(${shrink})` },
    ]);
    animate(overlay, [
      { offset: 0, opacity: 1 },
      { offset: .69, opacity: 1, easing: 'ease-in-out' },
      { offset: 1, opacity: 0 },
    ]);
    animate(skip, [
      { offset: 0, opacity: .8 },
      { offset: .72, opacity: .8 },
      { offset: .93, opacity: 0 },
      { offset: 1, opacity: 0 },
    ]);

    Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (generation === run) finish();
    }).catch(() => {});
  }

  // Input remains usable during the intro. The first real action dismisses it.
  function skipForInput(event) {
    if (current && event.isTrusted) finish();
  }
  document.addEventListener('pointerdown', skipForInput, true);
  document.addEventListener('keydown', skipForInput, true);
  window.addEventListener('resize', finish);
  motionPreference.addEventListener('change', finish);
  home.addEventListener('click', () => play());
  const iconReady = headerIcon.complete ? Promise.resolve() : headerIcon.decode().catch(() => {});
  iconReady.then(() => requestAnimationFrame(() => play()));

  if (import.meta.env.DEV) {
    window.base64BrandMotion = {
      play, finish, duration: DURATION,
      seek(milliseconds) {
        for (const animation of current?.animations || []) {
          animation.pause();
          animation.currentTime = Math.max(0, Math.min(DURATION, milliseconds));
        }
      },
      get running() { return current !== null; },
    };
  }
}
