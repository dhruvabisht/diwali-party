/* fx.js — fireworks, sparklers, sounds and festive artwork.
   Everything is drawn and synthesised right here in the browser: no libraries, no network. */
(() => {
  'use strict';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const PALETTE = ['#ffcf4a', '#ff8a1f', '#ff4f9a', '#e8197f', '#ffe9a8', '#3fd1c7', '#b388ff', '#8dff7a', '#ff5a36'];

  /* ------------------------------------------------------------------ *
   * Sound: temple bells, rockets and crackers, synthesised with Web Audio
   * ------------------------------------------------------------------ */
  const Sound = (() => {
    // On by default; browsers only allow it to start after the guest's first tap (see unlock()).
    let ac = null, master = null, noiseBuf = null, on = true;

    // iPhones mute web audio when the silent switch is on. Asking for a "playback" session
    // (Safari 16.4+) makes the page's sounds behave like a video, so they play anyway.
    function setSession(type) {
      try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* unsupported */ }
    }

    // Must be called from inside a tap/click/keypress handler.
    function unlock() {
      if (!on) return;
      setSession('playback');
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.7;
        const comp = ac.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ac.state !== 'running') ac.resume().catch(() => {});
    }

    // Sounds only play once the guest has tapped (so nothing ever blares on its own).
    function ctx() {
      if (!on || !ac) return null;
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    }

    // A ghanti (temple bell): a few inharmonic partials with long, shimmering decays.
    function bell(freq = 660, vol = 0.22, when = 0) {
      if (!on) return;
      const a = ctx(); if (!a) return;
      const t = a.currentTime + when;
      [[1, 1, 2.8], [2.76, 0.45, 1.7], [5.4, 0.22, 0.9], [8.93, 0.1, 0.5], [0.5, 0.3, 3.4]].forEach(([m, amp, dec]) => {
        const o = a.createOscillator();
        const g = a.createGain();
        o.type = 'sine';
        o.frequency.value = freq * m;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + dec + 0.05);
      });
    }

    function noise(dur, o = {}) {
      if (!on) return;
      const a = ctx(); if (!a) return;
      const t = a.currentTime + (o.when || 0);
      const src = a.createBufferSource();
      src.buffer = noiseBuf;
      const f = a.createBiquadFilter();
      f.type = o.type || 'lowpass';
      f.Q.value = o.q == null ? 0.7 : o.q;
      f.frequency.setValueAtTime(o.f0 || 1200, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1 || 200), t + dur);
      const g = a.createGain();
      const attack = Math.min(o.attack || 0.004, dur * 0.5);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.vol == null ? 0.5 : o.vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 1.2);
      src.stop(t + dur + 0.05);
    }

    const boom = (vol = 0.5) => {
      noise(1.1, { type: 'lowpass', f0: 900, f1: 60, vol });
      noise(0.14, { type: 'bandpass', f0: 2600, f1: 900, q: 1, vol: vol * 0.55 });
    };
    const crackle = (n = 16, delay = 0.35, spread = 0.9) => {
      for (let i = 0; i < n; i++) {
        noise(0.035, { type: 'highpass', f0: rand(2500, 6000), f1: 1800, vol: rand(0.08, 0.22), when: delay + Math.random() * spread });
      }
    };
    const whoosh = (vol = 0.1) => noise(0.5, { type: 'bandpass', f0: 400, f1: 3200, q: 2.5, vol, attack: 0.25 });

    // Raag Bhupali (Sa Re Ga Pa Dha Sa' Re'), a classic evening raag: one note per diya.
    const SCALE = [349.23, 392.0, 440.0, 523.25, 587.33, 698.46, 783.99];
    const note = (i, vol = 0.2) => bell(SCALE[Math.max(0, i) % SCALE.length], vol);

    return {
      bell, boom, crackle, whoosh, note, unlock,
      setOn(v) {
        on = !!v;
        if (on) {
          unlock();
        } else {
          // Muting releases the audio entirely, so other apps' music can play again.
          if (ac && ac.state === 'running') ac.suspend().catch(() => {});
          setSession('auto');
        }
      },
      get on() { return on; },
      get state() { return ac ? ac.state : 'none'; },
    };
  })();

  /* ------------------------------------------------------------------ *
   * Fireworks + sparkler trail on one full-screen canvas
   * ------------------------------------------------------------------ */
  const Fireworks = (() => {
    const cv = document.getElementById('fx');
    if (!cv) return { launch() {}, burst() {}, sparks() {}, fountain() {}, finale() {} };
    const c = cv.getContext('2d');
    let W = 0, H = 0, raf = 0, last = 0;
    const parts = [], rockets = [], emitters = [];
    const MAX_PARTS = 1800;

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    const scale = () => Math.max(0.75, Math.min(1.35, Math.min(W, H) / 560));
    const spawn = (p) => { if (parts.length < MAX_PARTS) parts.push(p); };

    function burst(x, y, type, opts = {}) {
      type = type || pick(['peony', 'peony', 'ring', 'willow', 'double', 'peony', 'heart']);
      const s = scale();
      const c1 = pick(PALETTE), c2 = pick(PALETTE);
      const base = (o) => spawn(Object.assign({ x, y, px: x, py: y, life: 0, size: 2, drag: 0.972, g: 0.035 }, o));

      if (type === 'ring' || type === 'double') {
        const n = 44, sp = 3.3 * s;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          base({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(52, 64), color: c1 });
        }
      }
      if (type === 'peony' || type === 'double') {
        const n = type === 'double' ? 40 : 72;
        const k = type === 'double' ? 0.55 : 1;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(0.8, 4.4) * s * k;
          base({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(46, 74), color: Math.random() < 0.6 ? c2 : c1 });
        }
      }
      if (type === 'willow') {
        for (let i = 0; i < 64; i++) {
          const a = Math.random() * Math.PI * 2, sp = rand(0.6, 3) * s;
          base({ vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rand(95, 140), color: pick(['#ffd36b', '#ffe9a8', '#ffb347']), drag: 0.985, g: 0.022, size: 1.6, glitter: true });
        }
      }
      if (type === 'heart') {
        const n = 56, k = 0.2 * s;
        for (let i = 0; i < n; i++) {
          const t = (i / n) * Math.PI * 2;
          const hx = 16 * Math.pow(Math.sin(t), 3);
          const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          base({ vx: hx * k, vy: hy * k, max: rand(56, 66), color: pick(['#ff4f9a', '#ff7ab8', '#e8197f']), drag: 0.955, g: 0.012 });
        }
      }
      // the bright flash at the centre
      spawn({ x, y, px: x, py: y, vx: 0, vy: 0, life: 0, max: 9, color: '#fff7e0', size: 18 * s, flash: true, drag: 1, g: 0 });

      if (Sound.on && !opts.silent) {
        Sound.boom(rand(0.32, 0.5));
        if (type === 'willow' || Math.random() < 0.45) Sound.crackle(16);
      }
      start();
    }

    function launch(x, y, type, opts = {}) {
      if (y > H * 0.78) { burst(x, y, type, opts); return; }
      const sx = x + rand(-30, 30);
      rockets.push({ sx, sy: H + 8, x: sx, y: H + 8, tx: x, ty: y, t: 0, dur: rand(34, 44), type, opts });
      if (Sound.on && !opts.silent) Sound.whoosh(0.09);
      start();
    }

    function sparks(x, y, n = 3) {
      for (let i = 0; i < n; i++) {
        spawn({ x, y, px: x, py: y, vx: rand(-1.3, 1.3), vy: rand(-1.6, 0.8), life: 0, max: rand(14, 30), color: pick(['#fff6d5', '#ffd36b', '#ffb347', '#ffffff']), size: 1.3, drag: 0.93, g: 0.07, glitter: true });
      }
      start();
    }

    // An anaar (flower-pot firework): a fountain of golden sparks from the ground.
    function fountain(x, y, frames = 120) {
      emitters.push({ x, y, left: frames });
      start();
    }

    function finale() {
      const n = reduceMotion ? 3 : 9;
      for (let i = 0; i < n; i++) {
        setTimeout(() => launch(rand(W * 0.12, W * 0.88), rand(H * 0.12, H * 0.42), i === n - 1 ? 'heart' : undefined), i * 260);
      }
      if (!reduceMotion) { fountain(W * 0.2, H, 150); fountain(W * 0.8, H, 150); }
    }

    function start() {
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(step); }
    }

    function step(now) {
      const dt = Math.min(3, Math.max(0.2, (now - last) / 16.67));
      last = now;
      c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      c.lineCap = 'round';

      for (let i = emitters.length - 1; i >= 0; i--) {
        const e = emitters[i];
        for (let k = 0; k < 5; k++) {
          spawn({ x: e.x + rand(-4, 4), y: e.y, px: e.x, py: e.y, vx: rand(-1.4, 1.4), vy: rand(-9, -5.5) * scale(), life: 0, max: rand(40, 62), color: pick(['#ffd36b', '#fff2c4', '#ffb347', '#ffffff']), size: 1.6, drag: 0.985, g: 0.14, glitter: true });
        }
        e.left -= dt;
        if (e.left <= 0) emitters.splice(i, 1);
      }

      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.t += dt;
        const k = Math.min(1, r.t / r.dur);
        const e = 1 - Math.pow(1 - k, 3);
        const px = r.x, py = r.y;
        r.x = r.sx + (r.tx - r.sx) * e;
        r.y = r.sy + (r.ty - r.sy) * e;
        c.globalAlpha = 1;
        c.strokeStyle = '#ffe2a0';
        c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(px, py); c.lineTo(r.x, r.y); c.stroke();
        spawn({ x: r.x, y: r.y, px: r.x, py: r.y, vx: rand(-0.4, 0.4), vy: rand(0.4, 1.4), life: 0, max: rand(10, 22), color: '#ffb347', size: 1.2, drag: 0.95, g: 0.02, glitter: true });
        if (k >= 1) { rockets.splice(i, 1); burst(r.tx, r.ty, r.type, r.opts); }
      }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life += dt;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        const fade = 1 - p.life / p.max;
        if (p.flash) {
          const rad = p.size * (1 + p.life * 0.25);
          const grd = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad);
          grd.addColorStop(0, `rgba(255,247,224,${0.85 * fade})`);
          grd.addColorStop(1, 'rgba(255,200,120,0)');
          c.globalAlpha = 1;
          c.fillStyle = grd;
          c.beginPath(); c.arc(p.x, p.y, rad, 0, Math.PI * 2); c.fill();
          continue;
        }
        const drag = Math.pow(p.drag, dt);
        p.vx *= drag; p.vy = p.vy * drag + p.g * dt;
        p.px = p.x; p.py = p.y;
        p.x += p.vx * dt; p.y += p.vy * dt;
        let alpha = Math.min(1, fade * 1.4);
        if (p.glitter && Math.random() < 0.35) alpha *= 0.25;
        c.globalAlpha = alpha;
        c.strokeStyle = p.color;
        c.lineWidth = p.size;
        c.beginPath(); c.moveTo(p.px, p.py); c.lineTo(p.x + 0.01, p.y + 0.01); c.stroke();
      }

      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
      if (parts.length || rockets.length || emitters.length) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
        c.clearRect(0, 0, W, H);
      }
    }

    return { launch, burst, sparks, fountain, finale, get width() { return W; }, get height() { return H; } };
  })();

  /* ------------------------------------------------------------------ *
   * Artwork (SVG strings). Shared gradients live in index.html <defs>.
   * ------------------------------------------------------------------ */
  const art = {};

  art.diya = (lit = true, cls = '') => `
<svg class="diya ${lit ? 'lit' : ''} ${cls}" viewBox="0 0 120 92" aria-hidden="true" focusable="false">
  <g class="diya-glow"><circle cx="60" cy="38" r="40" fill="url(#g-glow)"/></g>
  <g class="diya-flame">
    <path d="M60 4 C68 18 75 30 71 42 C68 51 52 51 49 42 C45 30 52 18 60 4Z" fill="url(#g-flame)"/>
    <path d="M60 22 C64 30 66 37 64 43 C62.5 47 57.5 47 56 43 C54 37 56 30 60 22Z" fill="#fffbe8"/>
  </g>
  <path d="M60 45 L60 53" stroke="#3a1a08" stroke-width="2.4" stroke-linecap="round"/>
  <ellipse cx="60" cy="80" rx="19" ry="4.5" fill="#5e1f0b"/>
  <path d="M8 54 C16 90 104 90 112 54 Z" fill="url(#g-clay)"/>
  <ellipse cx="60" cy="54" rx="52" ry="8.5" fill="#8a3414"/>
  <ellipse cx="60" cy="54" rx="45" ry="5.6" fill="url(#g-oil)"/>
  <path d="M17 63 Q60 77 103 63" fill="none" stroke="#ffd36b" stroke-width="2" stroke-dasharray="0.1 6" stroke-linecap="round"/>
  <path d="M24 70 Q60 82 96 70" fill="none" stroke="#fff1cc" stroke-width="1.2" opacity=".75"/>
  <g fill="#ffd36b"><circle cx="34" cy="73.5" r="1.8"/><circle cx="47" cy="76.5" r="1.8"/><circle cx="60" cy="77.5" r="2.2"/><circle cx="73" cy="76.5" r="1.8"/><circle cx="86" cy="73.5" r="1.8"/></g>
</svg>`;

  // Akash kandil: the star-shaped paper lantern hung outside homes at Diwali.
  art.lantern = (hue = 'pink') => {
    const fill = hue === 'pink' ? 'url(#g-lantern-pink)' : 'url(#g-lantern-gold)';
    const cx = 40, cy = 86, R = 32, r = 14;
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r : R;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const poly = pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
    const tassel = (x, y, len) => `<path d="M${x} ${y} L${x} ${y + len}" stroke="#ffd36b" stroke-width="1.4"/><circle cx="${x}" cy="${y + len + 3}" r="3" fill="#ffd36b"/>`;
    return `
<svg class="lantern" viewBox="0 0 80 170" aria-hidden="true" focusable="false">
  <path d="M40 0 L40 52" stroke="#ffd36b" stroke-width="1.2"/>
  <circle cx="${cx}" cy="${cy}" r="44" fill="url(#g-lglow)"/>
  <polygon points="${poly}" fill="${fill}" stroke="#ffd36b" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="${cx}" cy="${cy}" r="9" fill="#fff4cf" opacity=".9"/>
  <circle cx="${cx}" cy="${cy}" r="4" fill="#ffd36b"/>
  ${tassel(pts[4][0].toFixed(1), +pts[4][1].toFixed(1), 30)}
  ${tassel(cx, cy + r, 50)}
  ${tassel(pts[6][0].toFixed(1), +pts[6][1].toFixed(1), 30)}
</svg>`;
  };

  // Toran: a marigold and mango-leaf garland hung across the top of the doorway.
  art.toran = (width) => {
    const w = Math.max(320, Math.round(width));
    const h = 118;
    const flower = (x, y, r, i) => {
      const col = i % 2 ? '#ff8a00' : '#ffc400';
      const ruff = i % 2 ? '#d65f00' : '#e09a00';
      return `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}"/><circle cx="${x}" cy="${y}" r="${r - 1.4}" fill="none" stroke="${ruff}" stroke-width="2.2" stroke-dasharray="1.4 1.9"/><circle cx="${x}" cy="${y}" r="${(r * 0.28).toFixed(1)}" fill="#a83c00"/>`;
    };
    let s = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">`;
    s += `<path d="M0 9 H${w}" stroke="#6b3410" stroke-width="3"/>`;
    let i = 0;
    for (let x = 6; x < w; x += 14, i++) s += flower(x, 10, 8, i);
    const gap = 44;
    const lens = [5, 7, 6, 8, 6, 7];
    let n = 0;
    for (let x = 22; x < w - 6; x += gap, n++) {
      const delay = (-Math.random() * 4).toFixed(2);
      if (n % 2 === 0) {
        const len = lens[(n / 2) % lens.length];
        let strand = `<g class="strand" style="animation-delay:${delay}s"><path d="M${x} 16 L${x} ${18 + len * 12}" stroke="#6b3410" stroke-width="1"/>`;
        for (let k = 0; k < len; k++) strand += flower(x, 26 + k * 12, 6.5, k + n);
        strand += `<circle cx="${x}" cy="${30 + len * 12}" r="3.4" fill="#ffd36b"/><path d="M${x - 3} ${33 + len * 12} L${x} ${40 + len * 12} L${x + 3} ${33 + len * 12}Z" fill="#ffd36b"/></g>`;
        s += strand;
      } else {
        s += `<g class="strand leaf" style="animation-delay:${delay}s"><path d="M${x} 14 C${x + 10} 26 ${x + 8} 44 ${x} 56 C${x - 8} 44 ${x - 10} 26 ${x} 14Z" fill="#2f8a3a" stroke="#1b5e26" stroke-width="1"/><path d="M${x} 16 L${x} 54" stroke="#9fd18b" stroke-width="0.8"/></g>`;
      }
    }
    return s + '</svg>';
  };

  // Rangoli: a symmetric floor pattern of petals and dots.
  art.rangoli = (cls = '') => {
    const ring = (n, fn, off = 0) => Array.from({ length: n }, (_, i) => fn(((i * 360) / n + off).toFixed(2))).join('');
    return `
<svg class="rangoli ${cls}" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
  ${ring(16, (a) => `<path d="M100 8 C109 22 109 36 100 46 C91 36 91 22 100 8Z" fill="#14b8a6" transform="rotate(${a} 100 100)"/>`)}
  ${ring(16, (a) => `<circle cx="100" cy="12" r="3.2" fill="#ffd36b" transform="rotate(${a} 100 100)"/>`, 11.25)}
  ${ring(12, (a) => `<ellipse cx="100" cy="50" rx="10" ry="20" fill="#e8197f" transform="rotate(${a} 100 100)"/>`)}
  ${ring(12, (a) => `<ellipse cx="100" cy="56" rx="7" ry="15" fill="#ff8a1f" transform="rotate(${a} 100 100)"/>`, 15)}
  <circle cx="100" cy="100" r="33" fill="#ffcf4a"/>
  ${ring(24, (a) => `<circle cx="100" cy="64" r="1.7" fill="#fff4dc" transform="rotate(${a} 100 100)"/>`)}
  ${ring(8, (a) => `<ellipse cx="100" cy="80" rx="6" ry="12" fill="#fff4dc" transform="rotate(${a} 100 100)"/>`)}
  ${ring(8, (a) => `<ellipse cx="100" cy="82" rx="3" ry="7" fill="#b388ff" transform="rotate(${a} 100 100)"/>`, 22.5)}
  <circle cx="100" cy="100" r="10" fill="#e8197f"/>
  <circle cx="100" cy="100" r="4.5" fill="#fff4dc"/>
</svg>`;
  };

  /* ------------------------------------------------------------------ *
   * Background decorations: stars, bokeh lights, falling marigold petals
   * ------------------------------------------------------------------ */
  function decorate() {
    const sky = document.querySelector('.sky');
    if (sky && !sky.childElementCount) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 60; i++) {
        const st = document.createElement('i');
        st.className = 'star';
        st.style.left = rand(0, 100) + '%';
        st.style.top = rand(0, 100) + '%';
        st.style.setProperty('--d', rand(2.5, 6).toFixed(2) + 's');
        st.style.animationDelay = (-rand(0, 6)).toFixed(2) + 's';
        const sz = rand(1, 2.6).toFixed(1) + 'px';
        st.style.width = sz; st.style.height = sz;
        frag.appendChild(st);
      }
      ['#ff8a1f', '#e8197f', '#ffcf4a', '#12a6a0', '#b388ff', '#ff5a36', '#ffcf4a'].forEach((col, i) => {
        const b = document.createElement('i');
        b.className = 'bokeh';
        const sz = rand(90, 220).toFixed(0) + 'px';
        b.style.width = sz; b.style.height = sz;
        b.style.left = rand(-10, 90) + '%';
        b.style.top = rand(0, 95) + '%';
        b.style.setProperty('--c', col);
        b.style.animationDelay = (-i * 3).toFixed(1) + 's';
        frag.appendChild(b);
      });
      sky.appendChild(frag);
    }

    const petals = document.querySelector('.petals');
    if (petals && !reduceMotion && !petals.childElementCount) {
      for (let i = 0; i < 14; i++) {
        const p = document.createElement('i');
        p.className = 'petal';
        p.style.left = rand(0, 98) + '%';
        p.style.setProperty('--s', rand(9, 16).toFixed(1) + 'px');
        p.style.setProperty('--c', pick(['#ff8a00', '#ffb000', '#ff6a00', '#ffc400', '#e8197f']));
        p.style.setProperty('--sway', rand(-60, 60).toFixed(0) + 'px');
        p.style.setProperty('--dur', rand(10, 18).toFixed(1) + 's');
        p.style.animationDelay = (-rand(0, 18)).toFixed(1) + 's';
        petals.appendChild(p);
      }
    }

    const toran = document.querySelector('.toran');
    if (toran) {
      const draw = () => { toran.innerHTML = art.toran(document.documentElement.clientWidth); };
      draw();
      let tw = document.documentElement.clientWidth, timer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const nw = document.documentElement.clientWidth;
          if (Math.abs(nw - tw) > 40) { tw = nw; draw(); }
        }, 200);
      });
    }

    document.querySelectorAll('[data-lantern]').forEach((el) => { el.innerHTML = art.lantern(el.dataset.lantern); });
    document.querySelectorAll('[data-diya]').forEach((el) => { el.innerHTML = art.diya(true); });
    document.querySelectorAll('[data-rangoli]').forEach((el) => { el.innerHTML = art.rangoli(el.dataset.rangoli); });
  }

  window.Diwali = { Sound, Fireworks, art, decorate, reduceMotion, rand, pick };
})();
