/* app.js — unlocks the invite and wires up the RSVP, maps, calendar, countdown and games.
   The private details arrive encrypted (sealed.js) and are decrypted here, on the guest's
   own phone, with the key from the invite link. The key never leaves the browser. */
(() => {
  'use strict';

  const { Sound, Fireworks, art, decorate, reduceMotion, rand } = window.Diwali;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: fine */ } },
  };
  const KEY_STORE = 'diwali-party-key';
  const RSVP_STORE = 'diwali-party-rsvp';
  const AAD = new TextEncoder().encode('diwali-party/v1');
  const LABEL = { yes: "I'm in! 🪔", maybe: 'Maybe 🤔', no: "Can't make it 😢" };

  decorate();
  setupSound();
  setupTapFireworks();
  setupScrollButtons();

  unlock().then((res) => {
    if (res.state === 'ok') {
      try { render(res.cfg); } catch (err) { console.error(err); }
      $('#invite').hidden = false;
    } else {
      showLock(res.state);
    }
    document.body.classList.remove('is-loading');
  });

  /* ---------------------------------------------------------------- *
   * Unlocking
   * ---------------------------------------------------------------- */
  async function unlock() {
    const m = /(?:^#|&)k=([A-Za-z0-9_-]{16,64})/.exec(window.location.hash);
    const keys = [m && m[1], store.get(KEY_STORE)].filter((k, i, a) => typeof k === 'string' && a.indexOf(k) === i);
    if (!keys.length) return { state: 'nokey' };
    if (!window.SEALED || !window.crypto || !window.crypto.subtle) return { state: 'unsupported' };
    for (const k of keys) {
      try {
        const cfg = await decrypt(k);
        store.set(KEY_STORE, k); // so the invite still opens if the #key gets lost from the address bar
        return { state: 'ok', cfg };
      } catch (e) { /* try the next key */ }
    }
    return { state: 'badkey' };
  }

  async function decrypt(k) {
    const raw = b64(k.replace(/-/g, '+').replace(/_/g, '/'));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64(window.SEALED.iv), additionalData: AAD }, key, b64(window.SEALED.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function b64(s) {
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function showLock(state) {
    if (state === 'badkey') {
      $('#lock-title').textContent = 'Hmm, this invite link looks incomplete';
      $('#lock-text').textContent = 'Part of the link may have been cut off. Ask the person who sent it to share it with you again 🪔';
    } else if (state === 'unsupported') {
      $('#lock-title').textContent = 'This browser is a little too old for this invite';
      $('#lock-text').textContent = 'Try opening the same link in Safari or Chrome 🪔';
    }
    $('#lock').hidden = false;
  }

  /* ---------------------------------------------------------------- *
   * Filling in the invite
   * ---------------------------------------------------------------- */
  function render(cfg) {
    const start = new Date(cfg.start);
    const end = new Date(cfg.end || start.getTime() + 5 * 3600e3);
    const tz = cfg.timezone || 'Europe/Dublin';
    const part = (o) => new Intl.DateTimeFormat('en-IE', Object.assign({ timeZone: tz }, o)).format(start);
    const dateLabel = `${part({ weekday: 'long' })} ${part({ day: 'numeric' })} ${part({ month: 'long' })}`;
    const ctx = { cfg, start, end, dateLabel };

    fill('host', cfg.host);
    fill('date', dateLabel);
    fill('time', cfg.timeLabel || '');
    fill('arrival', cfg.arrivalNote || '');
    fill('phoneDisplay', cfg.phoneDisplay || cfg.phone || '');
    document.title = `${cfg.host} invites you · Diwali Night 🪔`;

    renderAddress(cfg);
    renderContact(cfg);
    renderCalendar(ctx);
    startCountdown(start, end);
    setupRSVP(ctx);
    setupGame();
    setupFlips();
    setupSay();
    setupAmbient();
    setupSparkler();

    if (!reduceMotion) {
      setTimeout(() => {
        Fireworks.launch(Fireworks.width * 0.25, Fireworks.height * 0.2, 'peony', { silent: true });
        setTimeout(() => Fireworks.launch(Fireworks.width * 0.75, Fireworks.height * 0.16, 'ring', { silent: true }), 380);
      }, 900);
    }
  }

  function fill(name, text) {
    $$(`[data-f="${name}"]`).forEach((el) => { el.textContent = text; });
  }

  function renderAddress(cfg) {
    const el = $('#address');
    el.textContent = '';
    const pin = document.createElement('span');
    pin.className = 'addr-pin';
    pin.setAttribute('aria-hidden', 'true');
    pin.textContent = '🏠';
    el.appendChild(pin);
    (cfg.addressLines || []).forEach((line, i, all) => {
      if (/^[A-Z]\d{2}\s?[A-Z0-9]{4}$/i.test(line.trim())) {
        const ec = document.createElement('span');
        ec.className = 'eircode';
        ec.textContent = line;
        el.appendChild(ec);
      } else {
        el.appendChild(document.createTextNode(line));
        if (i < all.length - 1) el.appendChild(document.createElement('br'));
      }
    });
    const q = encodeURIComponent(cfg.mapsQuery || (cfg.addressLines || []).join(', '));
    $('#map-google').href = cfg.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${q}`;
    $('#map-apple').href = cfg.appleMapsUrl || `https://maps.apple.com/?q=${q}`;
  }

  const waLink = (cfg, text) => `https://wa.me/${String(cfg.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

  function renderContact(cfg) {
    if (!cfg.phone) { $('.arrival .btn-row').hidden = true; return; }
    const tel = String(cfg.phone).replace(/[^\d+]/g, '');
    $('#call-me').href = `tel:${tel}`;
    $('#text-me').href = `sms:${tel}`;
    $('#wa-me').href = waLink(cfg, `Hey ${cfg.host}! 🪔 `);
  }

  /* ---------------------------------------------------------------- *
   * Calendar (Google link + a .ics file built right here for Apple)
   * ---------------------------------------------------------------- */
  const icsDate = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  function renderCalendar({ cfg, start, end }) {
    const title = `Diwali Night at ${cfg.host}'s 🪔`;
    const where = (cfg.addressLines || []).join(', ');
    const details = [
      'Dinner & mithai, card night, music and good conversations.',
      'Dress code: festive & sparkly ✨',
      `${cfg.arrivalNote || ''} ${cfg.phoneDisplay || ''}`.trim(),
    ].join('\n');

    const g = new URL('https://calendar.google.com/calendar/render');
    g.searchParams.set('action', 'TEMPLATE');
    g.searchParams.set('text', title);
    g.searchParams.set('dates', `${icsDate(start)}/${icsDate(end)}`);
    g.searchParams.set('details', details);
    g.searchParams.set('location', where);
    g.searchParams.set('ctz', cfg.timezone || 'Europe/Dublin');
    $$('[data-cal="google"]').forEach((a) => { a.href = g.toString(); });

    const ics = buildICS({ title, start, end, where, details });
    $$('[data-cal="apple"]').forEach((b) => b.addEventListener('click', () => openICS(ics)));
  }

  function buildICS({ title, start, end, where, details }) {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Diwali Invite//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:diwali-${icsDate(start)}@diwali-party`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${esc(title)}`,
      `LOCATION:${esc(where)}`,
      `DESCRIPTION:${esc(details)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Diwali night in 2 hours! 🪔', 'TRIGGER:-PT2H', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ];
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }

  // iCalendar lines must be at most 75 bytes; longer ones continue on the next line after a space.
  function foldLine(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '', bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
      cur += ch; bytes += n;
    }
    out.push(cur);
    return out.map((l, i) => (i ? ' ' : '') + l).join('\r\n');
  }

  function openICS(text) {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (iOS) {
      // iOS opens calendar data straight into the "Add to Calendar" sheet.
      window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(text);
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diwali-night.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------------------------------------------------------------- *
   * Countdown
   * ---------------------------------------------------------------- */
  function startCountdown(start, end) {
    const box = $('#countdown');
    const msg = $('#countdown-msg');
    const cell = (k) => $(`[data-cd="${k}"]`);
    const els = { d: cell('d'), h: cell('h'), m: cell('m'), s: cell('s') };
    const pad = (n) => String(n).padStart(2, '0');
    let timer = 0;
    const tick = () => {
      const now = Date.now();
      if (now >= start.getTime()) {
        box.hidden = true;
        msg.hidden = false;
        msg.textContent = now >= end.getTime()
          ? 'What a night! Thank you for coming 🪔'
          : "It's Diwali night and the party's on! Come on over 🎉";
        clearInterval(timer);
        return;
      }
      let s = Math.floor((start.getTime() - now) / 1000);
      els.d.textContent = pad(Math.floor(s / 86400)); s %= 86400;
      els.h.textContent = pad(Math.floor(s / 3600)); s %= 3600;
      els.m.textContent = pad(Math.floor(s / 60));
      els.s.textContent = pad(s % 60);
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------------- *
   * RSVP: name + one tap, extras optional
   * ---------------------------------------------------------------- */
  function newId() {
    const a = new Uint8Array(14);
    crypto.getRandomValues(a);
    return 'r' + Array.from(a, (b) => (b % 36).toString(36)).join('');
  }

  async function send(cfg, st) {
    if (!cfg.rsvpUrl) return 'offline';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const opts = {
      method: 'POST',
      // text/plain keeps this a "simple" request; no cookies, no referrer.
      body: JSON.stringify({ token: cfg.rsvpToken, id: st.id, name: st.name, status: st.status, plusOnes: st.plusOnes, food: st.food, message: st.message }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: ctrl.signal,
    };
    try {
      let res;
      try {
        res = await fetch(cfg.rsvpUrl, opts);
      } catch (e) {
        if (e.name === 'AbortError') return 'error';
        // The reply couldn't be read (e.g. a CORS hiccup on Google's redirect). The RSVP is a
        // simple POST and saving it twice just updates the same row, so send once more without
        // reading the reply. If that also fails, we're genuinely offline.
        try { await fetch(cfg.rsvpUrl, Object.assign({}, opts, { mode: 'no-cors' })); return 'ok'; } catch (e2) { return 'error'; }
      }
      const j = await res.json().catch(() => null);
      return j && j.ok ? 'ok' : 'error';
    } finally {
      clearTimeout(timer);
    }
  }

  function setupRSVP({ cfg, dateLabel }) {
    const saved = store.get(RSVP_STORE) || {};
    const st = {
      id: /^r[a-z0-9]{10,40}$/i.test(saved.id || '') ? saved.id : newId(),
      name: saved.name || '',
      status: LABEL[saved.status] ? saved.status : '',
      plusOnes: Number(saved.plusOnes) || 0,
      food: saved.food || '',
      message: saved.message || '',
      sent: !!saved.sent,
    };

    const nameInput = $('#rsvp-name');
    const choices = $('.choices');
    const step1 = $('#rsvp-step1');
    const step2 = $('#rsvp-step2');
    const rsvpMsg = $('#rsvp-msg');
    const extrasMsg = $('#extras-msg');
    const foodOther = $('#food-other');
    nameInput.value = st.name;

    const first = () => st.name.split(/\s+/)[0];
    const persist = () => store.set(RSVP_STORE, st);
    const setMsg = (el, text, ok) => { el.textContent = text; el.classList.toggle('ok', !!ok); };
    const rsvpText = () => {
      const lines = [`Hi ${cfg.host}! 🪔 RSVP for Diwali night:`, `${st.name}: ${LABEL[st.status]}`];
      if (st.status !== 'no' && st.plusOnes) lines.push(`Bringing: +${st.plusOnes}`);
      if (st.status !== 'no' && st.food) lines.push(`Food: ${st.food}`);
      if (st.message) lines.push(`Message: ${st.message}`);
      return lines.join('\n');
    };

    // chips behave like radio buttons
    $$('.chips').forEach((group) => {
      group.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        $$('.chip', group).forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
        if (group.dataset.group === 'food') {
          foodOther.hidden = chip.dataset.value !== 'other';
          if (!foodOther.hidden) foodOther.focus();
        }
      });
    });

    function loadExtras() {
      $$('[data-group="plusOnes"] .chip').forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.value) === st.plusOnes)));
      const foodChips = $$('[data-group="food"] .chip');
      const match = foodChips.find((c) => c.dataset.value === st.food);
      foodChips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
      foodOther.hidden = true;
      if (match) match.setAttribute('aria-pressed', 'true');
      else if (st.food) {
        foodChips.find((c) => c.dataset.value === 'other').setAttribute('aria-pressed', 'true');
        foodOther.hidden = false;
        foodOther.value = st.food;
      }
      $('#rsvp-message').value = st.message;
    }

    function readExtras() {
      const plus = $('[data-group="plusOnes"] .chip[aria-pressed="true"]');
      st.plusOnes = plus ? Number(plus.dataset.value) : 0;
      const food = $('[data-group="food"] .chip[aria-pressed="true"]');
      if (!food) st.food = '';
      else if (food.dataset.value === 'other') st.food = foodOther.value.trim().slice(0, 120);
      else st.food = food.dataset.value;
      st.message = $('#rsvp-message').value.trim().slice(0, 600);
    }

    function showFallback(result) {
      const box = $('#rsvp-fallback');
      if (result === 'ok' || !cfg.phone) { box.hidden = true; return; }
      box.hidden = false;
      $('#fallback-text').textContent = result === 'offline'
        ? `Last step: tap below to send your RSVP to ${cfg.host} on WhatsApp.`
        : `Hmm, the RSVP book didn't answer (wobbly connection?). Send it to ${cfg.host} on WhatsApp instead?`;
      $('#fallback-wa').href = waLink(cfg, rsvpText());
    }

    function showStep2(result, mode) {
      step1.hidden = true;
      step2.hidden = false;
      const s = st.status;
      const emoji = { yes: '🎉', maybe: '🤔', no: '💛' }[s];
      let title, text;
      if (mode === 'restore') {
        title = `Welcome back, ${first()}!`;
        text = `You're down as “${LABEL[s]}”. Change it any time below.`;
      } else if (s === 'yes') {
        title = `Yay, see you there, ${first()}!`;
        text = `${dateLabel}, ${cfg.timeLabel}. It's going to be a bright one.`;
      } else if (s === 'maybe') {
        title = `No stress, ${first()}!`;
        text = 'You can change your answer any time from this same link.';
      } else {
        title = `We'll miss you, ${first()}!`;
        text = "We'll save you some mithai.";
      }
      const em = $('#done-emoji');
      em.textContent = emoji;
      em.style.animation = 'none'; void em.offsetWidth; em.style.animation = '';
      $('#done-title').textContent = title;
      $('#done-text').textContent = text;

      $('#extra-plus').hidden = s === 'no';
      $('#extra-food').hidden = s === 'no';
      $('#msg-label').textContent = s === 'no' ? `A little message for ${cfg.host}?` : "Anything you'd like to share?";
      $('#after-yes').hidden = s !== 'yes';
      setMsg(extrasMsg, '');
      loadExtras();
      showFallback(result);
      if (mode !== 'restore') {
        const card = $('#rsvp');
        card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        celebrate(s);
      }
    }

    function celebrate(s) {
      const W = Fireworks.width, H = Fireworks.height;
      if (s === 'yes') {
        Fireworks.finale();
        if (Sound.on) [0, 2, 4, 5].forEach((n, i) => setTimeout(() => Sound.note(n), i * 140));
      } else if (s === 'maybe') {
        Fireworks.launch(W * 0.35, H * 0.25, 'peony');
        setTimeout(() => Fireworks.launch(W * 0.65, H * 0.2, 'ring'), 350);
        if (Sound.on) Sound.note(2);
      } else {
        Fireworks.launch(W * 0.5, H * 0.24, 'heart');
        if (Sound.on) Sound.note(0, 0.14);
      }
    }

    choices.addEventListener('click', async (e) => {
      const btn = e.target.closest('.choice');
      if (!btn || choices.classList.contains('busy')) return;
      const name = nameInput.value.trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!name) {
        setMsg(rsvpMsg, 'Pop your name in first 🙂');
        nameInput.classList.remove('shake'); void nameInput.offsetWidth; nameInput.classList.add('shake');
        nameInput.focus();
        return;
      }
      st.name = name;
      st.status = btn.dataset.status;
      choices.classList.add('busy');
      btn.classList.add('sending');
      setMsg(rsvpMsg, cfg.rsvpUrl ? 'Sending… 🪔' : '');
      const result = await send(cfg, st);
      choices.classList.remove('busy');
      btn.classList.remove('sending');
      setMsg(rsvpMsg, '');
      st.sent = result === 'ok';
      persist();
      showStep2(result, 'new');
    });

    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('.choice.yes').focus(); }
    });

    $('#save-extras').addEventListener('click', async (e) => {
      readExtras();
      persist();
      const btn = e.currentTarget;
      if (!cfg.rsvpUrl) {
        showFallback('offline');
        setMsg(extrasMsg, 'Added to your WhatsApp message above 👆', true);
        return;
      }
      btn.disabled = true;
      setMsg(extrasMsg, 'Saving… 🪔');
      const result = await send(cfg, st);
      btn.disabled = false;
      st.sent = result === 'ok';
      persist();
      if (result === 'ok') {
        setMsg(extrasMsg, 'Saved! Thank you 🪔', true);
        const r = btn.getBoundingClientRect();
        Fireworks.sparks(r.left + r.width / 2, r.top, 26);
        if (Sound.on) Sound.note(4);
      } else {
        setMsg(extrasMsg, "Couldn't save just now. Try again in a moment?");
        showFallback('error');
      }
    });

    $('#change-rsvp').addEventListener('click', () => {
      step2.hidden = true;
      step1.hidden = false;
      nameInput.value = st.name;
      $('#rsvp').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      $('.choice.yes').focus({ preventScroll: true });
    });

    if (st.status && st.name) showStep2(st.sent ? 'ok' : (cfg.rsvpUrl ? 'error' : 'offline'), 'restore');
  }

  /* ---------------------------------------------------------------- *
   * Light-the-diyas game
   * ---------------------------------------------------------------- */
  function setupGame() {
    const shelf = $('#shelf');
    const count = $('#game-count');
    const reveal = $('#reveal');
    const N = 7;
    let lit = 0;

    for (let i = 0; i < N; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'game-diya';
      b.setAttribute('aria-label', `Light diya ${i + 1} of ${N}`);
      b.innerHTML = art.diya(false);
      b.addEventListener('click', () => light(b));
      shelf.appendChild(b);
    }

    function light(b) {
      if (b.classList.contains('on')) return;
      b.classList.add('on');
      $('.diya', b).classList.add('lit');
      b.setAttribute('aria-label', 'Diya lit');
      if (Sound.on) Sound.note(lit);
      lit++;
      const r = b.getBoundingClientRect();
      Fireworks.sparks(r.left + r.width / 2, r.top + r.height * 0.35, 16);
      count.textContent = lit === N ? 'All 7 lit! 🎉' : `${lit} of ${N} lit`;
      if (lit === N) setTimeout(finale, 450);
    }

    function finale() {
      $('[data-rangoli]', reveal).innerHTML = art.rangoli('bloom');
      reveal.hidden = false;
      Fireworks.finale();
      if (Sound.on) for (let k = 0; k < N; k++) setTimeout(() => Sound.note(k, 0.16), k * 120);
      setTimeout(() => reveal.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' }), 300);
    }

    $('#relight').addEventListener('click', () => {
      $$('.game-diya', shelf).forEach((b, i) => {
        b.classList.remove('on');
        $('.diya', b).classList.remove('lit');
        b.setAttribute('aria-label', `Light diya ${i + 1} of ${N}`);
      });
      lit = 0;
      count.textContent = `0 of ${N} lit`;
      reveal.hidden = true;
      shelf.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    });
  }

  /* ---------------------------------------------------------------- *
   * Diwali 101 flip cards + phrasebook
   * ---------------------------------------------------------------- */
  function setupFlips() {
    $$('.flip').forEach((card) => card.addEventListener('click', () => {
      const on = card.getAttribute('aria-pressed') !== 'true';
      card.setAttribute('aria-pressed', String(on));
      if (on && Sound.on) Sound.bell(rand(880, 1180), 0.08);
    }));
  }

  // Uses only voices installed on the guest's own device (no online speech services).
  function setupSay() {
    const synth = window.speechSynthesis;
    const buttons = $$('.say');
    if (!synth || !window.SpeechSynthesisUtterance) { buttons.forEach((b) => { b.hidden = true; }); return; }
    const voices = () => new Promise((resolve) => {
      const list = synth.getVoices();
      if (list.length) return resolve(list);
      const done = () => resolve(synth.getVoices());
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1200);
    });
    buttons.forEach((b) => b.addEventListener('click', async () => {
      const local = (await voices()).filter((v) => v.localService);
      const hi = local.find((v) => /^hi/i.test(v.lang));
      const en = local.find((v) => /^en-IN/i.test(v.lang)) || local.find((v) => /^en/i.test(v.lang));
      const voice = hi || en;
      if (!voice) { b.textContent = '🙊'; setTimeout(() => { b.textContent = '🔊'; }, 1200); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(hi ? b.dataset.hi : b.dataset.ro);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.85;
      b.classList.add('speaking');
      u.onend = u.onerror = () => b.classList.remove('speaking');
      synth.speak(u);
    }));
  }

  /* ---------------------------------------------------------------- *
   * Fun layer: tap fireworks, sparkler trail, ambient sky, sounds
   * ---------------------------------------------------------------- */
  function setupTapFireworks() {
    const hint = $('#hint');
    let hinted = false;
    const hideHint = () => { if (!hinted && hint) { hinted = true; hint.classList.add('gone'); } };
    setTimeout(hideHint, 14000);
    document.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (e.target.closest('a, button, input, textarea, select, label, address, .chips, .extras')) return;
      Fireworks.launch(e.clientX, e.clientY);
      hideHint();
    }, { passive: true });
  }

  function setupSparkler() {
    if (reduceMotion) return;
    let last = 0;
    const emit = (x, y) => {
      const now = performance.now();
      if (now - last < 28) return;
      last = now;
      Fireworks.sparks(x, y, 2);
    };
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') emit(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) emit(t.clientX, t.clientY); }, { passive: true });
  }

  function setupAmbient() {
    if (reduceMotion || !window.IntersectionObserver) return;
    let visible = true;
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0.3 }).observe($('.hero'));
    const fire = () => {
      if (visible && !document.hidden) {
        Fireworks.launch(rand(Fireworks.width * 0.1, Fireworks.width * 0.9), rand(Fireworks.height * 0.08, Fireworks.height * 0.32), undefined, { silent: true });
      }
      setTimeout(fire, rand(2800, 5600));
    };
    setTimeout(fire, 2600);
  }

  // Sound is on by default and starts with the guest's first tap. Muting is remembered.
  function setupSound() {
    const btn = $('#sound');
    const PREF = 'diwali-party-sound';
    const show = (on) => {
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? 'Turn festive sounds off' : 'Turn festive sounds on');
      btn.textContent = on ? '🔔' : '🔇';
    };
    if (store.get(PREF) === 'off') Sound.setOn(false);
    show(Sound.on);

    // Browsers only allow audio to start inside a tap, click or key press.
    const unlock = (e) => { if (!e.target.closest || !e.target.closest('#sound')) Sound.unlock(); };
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach((type) => {
      document.addEventListener(type, unlock, { capture: true, passive: true });
    });

    btn.addEventListener('click', () => {
      const on = !Sound.on;
      Sound.setOn(on);
      store.set(PREF, on ? 'on' : 'off');
      show(on);
      if (on) { Sound.bell(523.25, 0.22); Sound.bell(783.99, 0.15, 0.2); }
    });
  }

  function setupScrollButtons() {
    $$('[data-scroll]').forEach((b) => b.addEventListener('click', () => {
      const target = document.getElementById(b.dataset.scroll);
      if (target) target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }));
  }
})();
