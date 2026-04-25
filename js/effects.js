/* ============================================================
   effects.js — visual feedback (badge, particles, ripple, flash,
   shake, combo popup). Reads from rect cache to avoid per-tap
   forced layout.
   ============================================================ */

import { TUNING, GOOD_ICONS } from './config.js';
import { els, rect, parity } from './dom.js';

/* Preload and cache natural aspect ratios so particles don't get squashed */
const GOOD_ICON_CACHE = {};
GOOD_ICONS.forEach(src => {
  const im = new Image();
  im.src = src;
  GOOD_ICON_CACHE[src] = im;
});

const rand = (a, b) => Math.random() * (b - a) + a;

export function showBadge(rating) {
  const b = els.beatBadge;
  b.className = 'beat-badge ' + rating;
  b.textContent = rating.toUpperCase() + (rating === 'perfect' ? '!!' : (rating === 'great' ? '!' : ''));
  parity.badge = !parity.badge;
  b.classList.add(parity.badge ? 'show' : 'show-b');
}

export function spawnParticles(n, color) {
  if (!TUNING.particlesEnabled) return;
  const btn   = rect.btn       || els.pushBtn.getBoundingClientRect();
  const stage = rect.particles || els.particles.getBoundingClientRect();
  const cx = btn.left + btn.width/2 - stage.left;
  const cy = btn.top + btn.height/2 - stage.top;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('img');
    p.className = 'particle particle-good';
    const src = GOOD_ICONS[Math.floor(Math.random() * GOOD_ICONS.length)];
    p.src = src;
    p.alt = '';
    const size = rand(28, 52);
    const cached = GOOD_ICON_CACHE[src];
    const nw = cached && cached.naturalWidth ? cached.naturalWidth : 1;
    const nh = cached && cached.naturalHeight ? cached.naturalHeight : 1;
    const ratio = nw / nh;
    const w = ratio >= 1 ? size : size * ratio;
    const h = ratio >= 1 ? size / ratio : size;
    p.style.width = w + 'px';
    p.style.height = h + 'px';
    p.style.left = cx + 'px';
    p.style.top = cy + 'px';
    p.style.transform = 'translate(-50%, -50%)';
    els.particles.appendChild(p);
    const angle = rand(-Math.PI, 0) + rand(-0.4, 0.4);
    const dist = rand(80, 200) * (0.7 + TUNING.effectIntensity/20);
    const dx = Math.cos(angle)*dist, dy = Math.sin(angle)*dist - rand(20,50);
    const rot = rand(-360, 360), dur = rand(0.8, 1.3);
    if (window.gsap) {
      gsap.to(p, { x: dx, y: dy, rotation: rot, scale: rand(0.35, 0.7), duration: dur, ease: 'power2.out', onComplete: () => p.remove() });
      gsap.to(p, { opacity: 0, duration: dur * 0.45, delay: dur * 0.55, ease: 'power1.in' });
    } else {
      setTimeout(() => p.remove(), 1000);
    }
  }
}

export function spawnRipple() {
  const r = document.createElement('div');
  r.className = 'ripple';
  els.pushBtn.parentElement.appendChild(r);
  setTimeout(() => r.remove(), 620);
}

export function doFlash(s = 0.2) {
  els.flash.style.opacity = s;
  setTimeout(() => els.flash.style.opacity = 0, 80);
}

export function doShake(mag = 2) {
  mag *= TUNING.effectIntensity / 9;
  if (window.gsap) gsap.fromTo(els.screen, { x: -mag }, { x: 0, duration: 0.18, ease: 'elastic.out(1.2,0.3)', overwrite: 'auto' });
}

export function spawnCombo(text, cls) {
  const t = document.createElement('div');
  t.className = 'combo-pop ' + (cls || '');
  t.textContent = text;
  const btn   = rect.btn   || els.pushBtn.getBoundingClientRect();
  const stage = rect.combo || els.comboLayer.getBoundingClientRect();
  const x = btn.left + btn.width * rand(0.2, 0.8) - stage.left;
  const y = btn.top + rand(-30, 20) - stage.top;
  t.style.left = x + 'px'; t.style.top = y + 'px';
  t.style.transform = `translate(-50%,-50%) rotate(${rand(-12,12)}deg)`;
  els.comboLayer.appendChild(t);
  const dy = -rand(90, 150), dx = rand(-30, 30);
  if (window.gsap) {
    gsap.fromTo(t, { scale: 0.2, opacity: 0 }, { scale: 1.15, opacity: 1, duration: 0.12, ease: 'back.out(2)', onComplete: () => {
      gsap.to(t, { x: dx, y: dy, opacity: 0, scale: 0.8, duration: 0.85, ease: 'power2.out', onComplete: () => t.remove() });
    } });
  } else setTimeout(() => t.remove(), 1000);
}
