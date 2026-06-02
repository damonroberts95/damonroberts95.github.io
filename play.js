/* ============================================================
   play.js — "NODE RUN", the hidden dodge game.

   You ARE the cursor (a bright node). Drifting hunter-nodes home
   in on you and accelerate the longer you survive. Touch = caught.
   Score = seconds survived; best kept in localStorage.

   Shares the site's vaporwave node-network look (see bg.js): same
   palette, glow, and link lines between nearby hunters.
   Reached by clicking the "O" in ROBERTS on the home page.
   ============================================================ */

(function () {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const startPanel = document.getElementById("start");
  const overPanel = document.getElementById("over");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const finalEl = document.getElementById("final");
  const finalScoreEl = document.getElementById("finalscore");
  const finalPtsEl = document.getElementById("finalpts");
  const verdictEl = document.getElementById("verdict");
  const ptsEl = document.getElementById("pts");
  const muteEl = document.getElementById("mute");
  const boardEl = document.getElementById("board");
  const lbSubmitEl = document.getElementById("lb-submit");
  const initialsEl = document.getElementById("initials");
  const submitScoreBtn = document.getElementById("submit-score");
  const lbStatusEl = document.getElementById("lb-status");
  const lbHeadEl = document.getElementById("lb-head");
  const plotPanel = document.getElementById("plot");
  const plotStageEl = document.getElementById("plot-stage");
  const plotNameEl = document.getElementById("plot-name");
  const plotTextEl = document.getElementById("plot-text");
  const winPanel = document.getElementById("win");

  // Leaderboard via Supabase (free, HTTPS, no server). Paste your project URL
  // + anon (public) key below. The anon key is meant to be public; a row-level
  // security policy limits clients to read + insert. Blank → board hidden.
  const LB = { url: "https://ktpjbqmlapmqshyjrzji.supabase.co", anonKey: "sb_publishable_nBZJyXI8Xj-XVjXVXR4VRw_6bPw8dsm", limit: 10 };
  let lastRun = { score: 0, time: 0, points: 0 };

  const PALETTE = [
    "255,106,213", "199,116,232", "120,196,255",
    "34,211,238", "255,138,96", "255,248,120",
  ];
  const LINK = "199,116,232";
  const LINK_DIST = 94;    // web length (scaled down further on mobile)
  const LINK_W = 3.5;   // px: drawn web thickness
  const LETHAL = 6;     // px: extra kill-band around the web line + node
  const JOLT_R = 70;    // px: crowding radius
  const JOLT_X = 9;     // neighbours within JOLT_R before a clump pops apart
  const STAR_R = 16;    // px: rainbow powerup radius (collect / draw)
  const COH_R = 150;    // px: same-colour cohesion range (tight → many small clumps)
  const GROUP_R = 120;  // px: radius that counts as "in the same clump"
  const SPLIT_SIZE = 8; // a clump this big repels itself apart → splits

  /* Pac-Man ghost personalities, one per colour. Each colour homes
     differently AND same-colour nodes stick together → distinct,
     differently-behaving clumps.
       chase   (purple/Blinky)  — straight aggressive pursuit
       ambush  (pink/Pinky)     — aims ahead of where you're heading
       erratic (cyan/Inky)      — orbits a wobbling point near you
       shy     (orange/Clyde)   — chases, but flees when it gets close
       scatter (blue)           — roams the arena, only loosely after you
       cluster (yellow)         — slow, weak chase, strong flock cohesion */
  const PERSONA = {
    "199,116,232": { kind: "chase",   spd: 1.50, acc: 2.00, coh: 0.2 },
    "255,106,213": { kind: "ambush",  spd: 1.18, acc: 1.45, coh: 0.4 },
    "34,211,238":  { kind: "erratic", spd: 1.35, acc: 1.60, coh: 0.1 },
    "255,138,96":  { kind: "shy",     spd: 1.05, acc: 1.05, coh: 0.6 },
    "120,196,255": { kind: "scatter", spd: 0.68, acc: 0.52, coh: 0.9 },
    "255,248,120": { kind: "cluster", spd: 0.52, acc: 0.34, coh: 1.5, split: 6 },
  };

  // score = 1 point per second survived + 10 per gem; best is the high score.
  // best is tracked per mode; classic keeps the original key for continuity.
  let mode = "classic"; // declared early: bestKey() reads it during initial loadBest()
  const bestKey = () => (mode === "classic" ? "noderun-best-score" : "noderun-best-score-" + mode);
  const loadBest = () => { best = parseFloat(localStorage.getItem(bestKey()) || "0") || 0; bestEl.textContent = best.toFixed(1); };
  let best = 0;
  loadBest();

  const audio = makeAudio();

  /* ---- Web Audio: generative synth loop + SFX (no asset files).
     Supersaw voices + reverb + filter envelopes; tempo rises with
     elapsed so the music tracks the game's pace. ---- */
  function makeAudio() {
    let ctx = null, master, mlp, music, fx, verb, vg, noise, muted = false, playing = false, step = 0, nextNote = 0, timer = null, bright = false;
    const CHORDS = [
      { root: 57, ivs: [0, 3, 7, 10] }, // Am7
      { root: 53, ivs: [0, 4, 7, 11] }, // Fmaj7
      { root: 60, ivs: [0, 4, 7, 11] }, // Cmaj7
      { root: 55, ivs: [0, 4, 7, 10] }, // G7
    ];
    const ARP = [0, 2, 3, 2, 1, 2, 3, 1, 0, 3, 2, 3, 1, 2, 0, 2];
    const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

    /* Per-biome music profiles — same vaporwave engine, tweaked for identity:
       chords (mood), transpose (register), bright (master cutoff), reverb (space),
       bpmMul (pace), leadType/leadCut (lead timbre), sparkle (shimmer layer). */
    const PROFILES = {
      default: { chords: CHORDS, transpose: 0, bright: 8500, reverb: 1.0, bpmMul: 1, leadType: "triangle", leadCut: 2100, sparkle: false },
      // warm, mellow sunset
      dusk:  { chords: [{ root: 53, ivs: [0, 4, 7, 11] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 50, ivs: [0, 3, 7, 10] }, { root: 55, ivs: [0, 4, 7, 10] }],
               transpose: 0, bright: 6800, reverb: 1.2, bpmMul: 0.94, leadType: "triangle", leadCut: 1700, sparkle: false },
      // deep, dark, spacious
      void:  { chords: [{ root: 45, ivs: [0, 3, 7, 10] }, { root: 48, ivs: [0, 3, 7, 10] }, { root: 50, ivs: [0, 3, 7, 10] }, { root: 43, ivs: [0, 3, 7, 10] }],
               transpose: -12, bright: 4600, reverb: 1.7, bpmMul: 0.88, leadType: "sine", leadCut: 1300, sparkle: false },
      // tense, smouldering
      ember: { chords: [{ root: 53, ivs: [0, 4, 7, 10] }, { root: 56, ivs: [0, 3, 7, 10] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 55, ivs: [0, 4, 7, 10] }],
               transpose: 0, bright: 7200, reverb: 0.9, bpmMul: 1.06, leadType: "sawtooth", leadCut: 2400, sparkle: false },
      // crystalline + jittery — brighter, faster, a glassy saw lead (Erratics)
      ice:   { chords: [{ root: 60, ivs: [0, 4, 7, 11] }, { root: 62, ivs: [0, 4, 7, 11] }, { root: 59, ivs: [0, 3, 7, 10] }, { root: 57, ivs: [0, 4, 7, 11] }],
               transpose: 0, bright: 13000, reverb: 1.3, bpmMul: 1.12, leadType: "sawtooth", leadCut: 6800, sparkle: true },
      // loud, bright, energetic
      neon:  { chords: [{ root: 60, ivs: [0, 4, 7, 11] }, { root: 55, ivs: [0, 4, 7, 10] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 4, 7, 11] }],
               transpose: 0, bright: 13000, reverb: 1.1, bpmMul: 1.12, leadType: "sawtooth", leadCut: 5200, sparkle: true },
      // edgy, acidic minor
      toxic: { chords: [{ root: 55, ivs: [0, 3, 7, 10] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 3, 7, 10] }, { root: 50, ivs: [0, 3, 7, 10] }],
               transpose: 0, bright: 8000, reverb: 0.95, bpmMul: 1.05, leadType: "square", leadCut: 2600, sparkle: false },
      // lush, dreamy, romantic
      rose:  { chords: [{ root: 53, ivs: [0, 4, 7, 11] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 55, ivs: [0, 4, 7, 10] }, { root: 60, ivs: [0, 4, 7, 11] }],
               transpose: 0, bright: 9200, reverb: 1.35, bpmMul: 1.0, leadType: "triangle", leadCut: 3000, sparkle: false },
      // finale — driving, dramatic, tense minor with a hard saw lead
      confluence: { chords: [{ root: 45, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 4, 7, 10] }, { root: 50, ivs: [0, 3, 7, 11] }, { root: 52, ivs: [0, 4, 7, 10] }],
               transpose: 0, bright: 13500, reverb: 1.25, bpmMul: 1.22, leadType: "sawtooth", leadCut: 5600, sparkle: true },
    };
    let prof = PROFILES.default;

    const frozenNow = () => elapsed < frozenUntil;
    // crawls during freeze, very slow on menu/loss, eases up while playing
    const curBPM = () => (frozenNow() ? 28 : running ? Math.min(132, 84 + elapsed * 0.6) * prof.bpmMul : 40);

    function impulse(dur, decay) {
      const len = Math.floor(ctx.sampleRate * dur);
      const b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay; }
      return b;
    }
    function ensure() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext; ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
      mlp = ctx.createBiquadFilter(); mlp.type = "lowpass"; mlp.frequency.value = 8500; mlp.connect(master); // warm, less harsh
      verb = ctx.createConvolver(); verb.buffer = impulse(3.2, 2.4);
      vg = ctx.createGain(); vg.gain.value = 1.0; verb.connect(vg); vg.connect(mlp);
      music = ctx.createGain(); music.gain.value = 0.17; music.connect(mlp); music.connect(verb);
      fx = ctx.createGain(); fx.gain.value = 0.5; fx.connect(mlp); fx.connect(verb);
      const len = Math.floor(ctx.sampleRate * 0.5);
      noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    // rich detuned voice through an enveloped low-pass — the synthy core
    function synth(freq, t, dur, o) {
      o = o || {};
      const type = o.type || "sawtooth", gain = o.gain || 0.1, dest = o.dest || music;
      const detune = o.detune || 0, voices = o.voices || 2, glide = o.glide || 0;
      const cut = o.cut || 4000, q = o.q || 4, attack = o.attack || 0.01;
      const vca = ctx.createGain();
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = q;
      lp.frequency.setValueAtTime(Math.min(cut, 18000), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(180, cut * 0.4), t + dur);
      lp.connect(vca); vca.connect(dest);
      vca.gain.setValueAtTime(0.0001, t);
      vca.gain.exponentialRampToValueAtTime(gain, t + attack);
      vca.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const oscs = [];
      for (let i = 0; i < voices; i++) {
        const osc = ctx.createOscillator(); osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (glide) osc.frequency.exponentialRampToValueAtTime(glide, t + dur);
        osc.detune.value = detune * (i - (voices - 1) / 2);
        osc.connect(lp); osc.start(t); osc.stop(t + dur + 0.05);
        oscs.push(osc);
      }
      // tear the whole voice out of the graph once it ends (else nodes pile up → lag)
      oscs[0].onended = () => { try { oscs.forEach((o) => o.disconnect()); lp.disconnect(); vca.disconnect(); } catch {} };
      if (o.sub) { // sub-octave sine for weight
        const s = ctx.createOscillator(); s.type = "sine"; s.frequency.setValueAtTime(freq / 2, t);
        if (glide) s.frequency.exponentialRampToValueAtTime(glide / 2, t + dur);
        const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t);
        sg.gain.exponentialRampToValueAtTime(gain * 0.8, t + attack); sg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        s.connect(sg); sg.connect(dest); s.start(t); s.stop(t + dur + 0.05);
        s.onended = () => { try { s.disconnect(); sg.disconnect(); } catch {} };
      }
    }
    function noiseHit(t, dur, gain, dest, hp) {
      const s = ctx.createBufferSource(); s.buffer = noise;
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      let f = null;
      if (hp) { f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; s.connect(f); f.connect(g); }
      else s.connect(g);
      g.connect(dest || fx); s.start(t); s.stop(t + dur + 0.02);
      s.onended = () => { try { s.disconnect(); g.disconnect(); if (f) f.disconnect(); } catch {} };
    }

    function scheduleStep(s, t) {
      const set = prof.chords, tr = prof.transpose;
      const c = set[Math.floor(s / 16) % set.length], b = s % 16;
      const pitch = frozenNow() ? 0.5 : 1; // drop an octave while frozen (deep + woozy)
      // kick on every beat — gentle four-on-the-floor pulse
      if (b % 4 === 0) {
        const k = ctx.createOscillator(), g = ctx.createGain();
        k.type = "sine"; k.frequency.setValueAtTime(95 * pitch, t); k.frequency.exponentialRampToValueAtTime(45 * pitch, t + 0.12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        k.connect(g); g.connect(music); k.start(t); k.stop(t + 0.32);
        k.onended = () => { try { k.disconnect(); g.disconnect(); } catch {} };
      }
      // warm bass on the half-bar
      if (b === 0 || b === 8) synth(mtof(c.root - 12 + tr) * pitch, t, 1.1, { gain: 0.26, detune: 6, voices: 2, cut: 440, q: 4, attack: 0.04, sub: true });
      // lush pad swell
      if (b === 0) c.ivs.forEach((iv) => synth(mtof(c.root + iv + tr) * pitch, t, 2.5, { gain: 0.05, detune: 18, voices: 3, cut: 1300, q: 1.2, attack: 0.8 }));
      // bouncier lead — more notes, plucky (timbre/brightness set by biome)
      if (b === 0 || b === 3 || b === 6 || b === 8 || b === 11 || b === 14) {
        const note = c.root + c.ivs[ARP[b] % c.ivs.length] + 12 + tr;
        synth(mtof(note) * pitch, t, 0.55, { type: prof.leadType, gain: 0.07, detune: 8, voices: 2, cut: prof.leadCut, q: 3, attack: 0.02 });
      }
      // offbeat hats keep it moving
      if (b % 2 === 1) noiseHit(t, 0.025, 0.014, music, 10000);
      // long evolving drone bed — a sustained synth layer spanning two bars
      if (s % 32 === 0) {
        synth(mtof(c.root - 12 + tr) * pitch, t, 6.2, { gain: 0.04, detune: 26, voices: 3, cut: 900, q: 1.0, attack: 1.8 });
        synth(mtof(c.root + 7 + tr) * pitch, t, 6.2, { gain: 0.03, detune: 22, voices: 3, cut: 1100, q: 1.0, attack: 2.2 });
      }
      // quiet electronic 16th pulse — a filtered arp, like signals travelling the links
      {
        const seq = c.root + c.ivs[(b * 3) % c.ivs.length] + 12 + tr;
        synth(mtof(seq) * pitch, t, 0.16, { type: prof.leadType, gain: 0.03, detune: 4, voices: 1, cut: prof.leadCut * 0.85, q: 7, attack: 0.005 });
      }
      // shield active OR a sparkly biome → bright shimmer layer an octave up
      if ((bright || prof.sparkle) && b % 2 === 0) {
        const note = c.root + c.ivs[ARP[b] % c.ivs.length] + 24 + tr;
        synth(mtof(note) * pitch, t, 0.3, { type: "sine", gain: 0.05, detune: 4, voices: 2, cut: 9000, q: 1, attack: 0.01 });
      }
    }
    function tick() {
      // after a tab-away the clock jumps; don't schedule a huge backlog of notes at once
      if (nextNote < ctx.currentTime - 0.3) nextNote = ctx.currentTime;
      const ahead = ctx.currentTime + 0.12;
      while (nextNote < ahead) { scheduleStep(step, nextNote); nextNote += 60 / curBPM() / 4; step++; }
    }

    // ramp the master brightness + reverb to the current biome profile
    function applyProf() {
      if (!ctx) return;
      mlp.frequency.setTargetAtTime(bright ? Math.max(prof.bright, 14000) : prof.bright, ctx.currentTime, 0.4);
      if (vg) vg.gain.setTargetAtTime(prof.reverb, ctx.currentTime, 0.4);
    }

    return {
      resume() { ensure(); if (ctx.state === "suspended") ctx.resume(); },
      startMusic() { ensure(); applyProf(); if (playing) return; playing = true; step = 0; nextNote = ctx.currentTime + 0.1; timer = setInterval(tick, 25); },
      setBiome(key) { prof = PROFILES[key] || PROFILES.default; applyProf(); },
      sfx(name) {
        if (!ctx) return; const t = ctx.currentTime;
        if (name === "gem") {                 // rising shimmer arpeggio
          [0, 4, 7, 12].forEach((iv, i) => synth(mtof(72 + iv), t + i * 0.045, 0.22, { type: "triangle", gain: 0.2, detune: 6, voices: 2, cut: 6500, q: 3, dest: fx }));
        } else if (name === "blast") {        // riser + boom + noise burst
          synth(140, t, 0.75, { gain: 0.4, detune: 22, voices: 3, glide: 32, cut: 1800, q: 3, sub: true, dest: fx });
          synth(280, t, 0.5, { type: "square", gain: 0.16, glide: 2400, cut: 6000, dest: fx });
          noiseHit(t, 0.55, 0.4, fx, 280);
        } else if (name === "freeze") {       // crystalline descending detuned sines
          [0, 7, 12, 19].forEach((iv, i) => { const f = mtof(96 - iv); synth(f, t + i * 0.05, 0.7 - i * 0.1, { type: "sine", gain: 0.16, detune: 5, voices: 2, glide: f * 0.5, cut: 9000, q: 1, dest: fx }); });
        } else if (name === "death") {        // detuned saw fall, filter slams shut
          synth(330, t, 1.1, { gain: 0.4, detune: 26, voices: 3, glide: 48, cut: 2800, q: 6, sub: true, dest: fx });
        } else if (name === "shield") {       // bright rising power-up chord
          [60, 64, 67, 72].forEach((m, i) => synth(mtof(m), t + i * 0.05, 0.45, { type: "sawtooth", gain: 0.28, detune: 10, voices: 2, cut: 3200, q: 3, dest: fx }));
          synth(mtof(79), t + 0.22, 0.5, { type: "sine", gain: 0.22, detune: 4, voices: 2, cut: 8500, dest: fx });
        } else if (name === "start") {        // warm chord stab
          [57, 64, 69].forEach((m) => synth(mtof(m), t, 0.45, { gain: 0.16, detune: 12, voices: 2, cut: 1200, q: 4, attack: 0.02, dest: fx }));
        } else if (name === "pop") {
          synth(220 + Math.random() * 280, t, 0.12, { type: "triangle", gain: 0.09, cut: 4000, dest: fx });
        }
      },
      toggleMute() { if (!master) return false; muted = !muted; master.gain.setTargetAtTime(muted ? 0 : 0.8, ctx.currentTime, 0.02); return muted; },
      setShield(on) { bright = on; if (mlp) mlp.frequency.setTargetAtTime(on ? 16000 : prof.bright, ctx.currentTime, 0.12); },
    };
  }

  // touch devices: smaller arena is harder, so ease difficulty, float the
  // player above the fingertip, and shorten the webs
  const MOBILE = window.matchMedia("(pointer: coarse)").matches;
  const LINK_SCALE = MOBILE ? 0.6 : 1;   // shorter webs on small screens → fewer lethal lines, more gaps
  const GROUP_SCALE = MOBILE ? 0.7 : 1;  // tighter clumps on small screens → nodes ball up, opening dodge lanes

  let w, h, dpr = 1, linkD2, arenaScale = 1, uiScale = 1;
  function resize() {
    const oldW = w, oldH = h;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    // resolution/zoom independence: a larger viewport (zoomed out, big monitor)
    // would otherwise feel slower & sparser since speeds/reach are fixed px. Scale
    // motion and web reach with the viewport so difficulty stays consistent.
    arenaScale = Math.max(0.8, Math.min(2, Math.min(innerWidth, innerHeight) / 820));
    linkD2 = (LINK_DIST * LINK_SCALE * arenaScale * dpr) ** 2;
    // on-canvas UI (banner/labels) sized off DEVICE dimensions, not dpr, so it stays
    // a sensible physical size when zoomed out (where dpr shrinks but the screen doesn't).
    uiScale = Math.max(0.9, Math.min(2, Math.min(w, h) / 780));
    // remap every position to the new dimensions so a mid-run zoom/resize doesn't
    // throw entities out of the (rescaled) coordinate space and break the game.
    // (guarded by oldW so it never runs on the first call, before state exists)
    if (oldW && oldH && (oldW !== w || oldH !== h)) {
      const sx = w / oldW, sy = h / oldH;
      const sc = (o) => { if (o) { o.x *= sx; o.y *= sy; } };
      player.r = 7 * dpr;
      sc(player); player.px *= sx; player.py *= sy;
      for (const hn of hunters) { hn.x *= sx; hn.y *= sy; }
      for (const g of gems) { g.x *= sx; g.y *= sy; }
      for (const bl of bullets) { bl.x *= sx; bl.y *= sy; }
      for (const eb of enemyBullets) { eb.x *= sx; eb.y *= sy; }
      for (const b of bosses) { b.x *= sx; b.y *= sy; }
      for (const s of shocks) { s.x *= sx; s.y *= sy; }
      sc(star); sc(ice); sc(shield); sc(shooter);
      if (anchor) { anchor.fx *= sx; anchor.fy *= sy; anchor.px *= sx; anchor.py *= sy; }
    }
  }
  resize();
  addEventListener("resize", resize);

  // player follows the pointer; start centred
  // px/py = previous frame position, vx/vy = velocity (drives ambush/predict)
  const player = { x: w / 2, y: h / 2, px: w / 2, py: h / 2, vx: 0, vy: 0, r: 7 * dpr };
  let anchor = null; // touch: where the finger + player were when the drag began
  const clamp01 = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);

  let lastDown = -1e9;
  function startTouch(e) {
    // ignore taps on UI controls (the button's own click handles them) so we
    // don't double-toggle, and dedupe the pointerdown+touchstart pair for one tap
    if (e.target && e.target.closest && e.target.closest("button, a, .mute")) return;
    if (e.timeStamp - lastDown < 120) return;
    lastDown = e.timeStamp;
    if (paused) { togglePause(); return; } // tap anywhere (not a control) to resume
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    anchor = (e.touches || e.pointerType === "touch")
      ? { fx: t.clientX * dpr, fy: t.clientY * dpr, px: player.x, py: player.y }
      : null;
  }
  function movePointer(e) {
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    const isTouch = !!e.touches || e.pointerType === "touch";
    if (isTouch && anchor) {
      // relative: move the player by the finger's delta from where the drag started
      player.x = clamp01(anchor.px + (t.clientX * dpr - anchor.fx), w);
      player.y = clamp01(anchor.py + (t.clientY * dpr - anchor.fy), h);
    } else {
      player.x = t.clientX * dpr;
      player.y = t.clientY * dpr;
    }
  }
  addEventListener("pointerdown", startTouch, { passive: true });
  addEventListener("touchstart", startTouch, { passive: true });
  addEventListener("pointermove", movePointer, { passive: true });
  addEventListener("touchmove", movePointer, { passive: true });

  let hunters = [];
  let hunterId = 0;           // stable per-node id, for tracking link ages
  let links = []; // {a,b,al,same} built in physics, drawn in drawScene (one pass, not two)
  let linkAges = new Map();   // "idA|idB" -> seconds that web has existed
  const WEB_GRACE = 0.32;     // s: a freshly-formed web can't kill until it settles
  let running = false, dead = false, paused = false;
  let elapsed = 0, lastT = 0, startT = 0;
  let shocks = [];            // {x, y, t, max} expanding ring visuals
  let star = null;            // {x, y, t} collectable rainbow powerup (blast)
  let nextStar = 0;           // seconds until next star spawns
  let ice = null;             // {x, y, t} collectable freeze powerup
  let nextIce = 0;            // seconds until next freeze spawns
  let frozenUntil = 0;        // hunters frozen while elapsed < this
  let playerAlpha = 0;        // 0 on menu → fades to 1 after Start
  let gems = [];              // {x, y, t} collectable points
  let nextGem = 0;            // seconds until next gem spawns
  let points = 0;             // collected points (gems)
  const GEM_R = 9, GEM_VAL = 10, KILL_VAL = 5; // points: gem / hunter destroyed
  let nextSpawn = 0;          // seconds: respawn cooldown gate (throttles refill after kills)
  const SPAWN_GAP = 0.65;     // seconds between respawns while below target count
  let trail = [];             // player comet trail {x,y}
  let mult = 1, comboUntil = 0; // gem combo multiplier
  const COMBO_WINDOW = 2.4, MULT_MAX = 8;
  let shield = null, nextShield = 0; // {x,y,t} collectable
  let shieldActive = false, invulnUntil = 0; // shield absorbs one hit + brief i-frames
  let shooter = null, nextShooter = 0; // {x,y,t} collectable — temp auto-fire weapon
  let shootUntil = 0, nextBullet = 0;  // armed window + dart cadence
  let bullets = [];                    // {x,y,vx,vy,life} darts fired along travel
  const heading = { x: 1, y: 0 };      // last significant travel direction
  const SHOOT_DUR = 6, BULLET_GAP = 0.1;
  let slowmo = null, nextSlow = 0, speedSetback = 0; // rare powerup: rolls the SPEED ramp back a few seconds (cap unaffected)
  const SLOW_SETBACK = 10;          // seconds of speed-progression removed per pickup
  let bosses = [], nextBoss = 0;   // big slow hunters (usually 1; Confluence fields several)
  let enemyBullets = [];           // shots a "shooter" boss fires at the player

  // ---- modes: classic (endless), waves (themed waves), journey (story levels) ----
  // `mode` is declared near the top (needed during initial loadBest()).
  let wave = 0, waveEndsAt = 0, waveType = "themed"; // waves mode
  let themeColor = null;            // dominant spawn colour this wave/level (null = all)
  let bossWave = false;             // current wave/level features the boss
  let journeyIdx = 0, levelEndsAt = 0; // journey mode
  let frozenAccum = 0, waveRampStart = 0; // seconds spent frozen (excluded from the speed ramp)
  let biomeFade = 1, prevBiome = null, biomeFadeRate = 1.6; // crossfade between biomes (0→1)
  let pattern = null, prevPattern = null; // subtle background pattern, varies per biome
  let nextBiomeAt = 0;              // classic: time of the next slow biome shift
  const PATTERN_KEYS = ["none", "grid", "dots", "rings", "diag", "weave", "cross", "wave", "hex"];
  let banner = null;                // {big, sub, until} transient on-canvas wave/level title
  let biome = null;                 // current biome (visual theme)
  const WAVE_LEN = 18;              // seconds per wave (survive to advance)

  const PERSONA_NAME = {
    "199,116,232": "Chasers", "255,106,213": "Ambushers", "34,211,238": "Erratics",
    "255,138,96": "Shy Ones", "120,196,255": "Scatterers", "255,248,120": "The Hive",
  };

  // Biomes — a full-screen colour tint plus vibrant radial glows drawn over the
  // (transparent) canvas; the site's day/night bg still shows faintly through. Kept
  // dark-but-saturated so each reads distinctly. tint: [r,g,b,alpha] flat wash;
  // glows: [r,g,b,alpha,xfrac,yfrac,sizefrac]; vig = edge-darken alpha.
  const BIOMES = {
    dusk:  { name: "Dusk",  vig: 0.40, tint: [40, 14, 36, 0.30], glows: [[255,120,40,0.26,0.5,1.15,1.2], [210,70,180,0.20,0.18,-0.08,1.0], [120,60,220,0.14,0.85,0.1,0.9]] },
    void:  { name: "Void",  vig: 0.58, tint: [16, 12, 40, 0.40], glows: [[90,50,210,0.24,0.5,0.45,1.4], [40,30,120,0.20,0.15,1.05,1.1]] },
    ember: { name: "Ember", vig: 0.46, tint: [44, 10, 8, 0.34], glows: [[255,60,40,0.30,0.3,1.08,1.1], [255,150,30,0.22,0.82,1.05,0.9], [255,40,90,0.16,0.5,-0.05,0.9]] },
    ice:   { name: "Ice",   vig: 0.34, tint: [10, 26, 46, 0.32], glows: [[90,200,255,0.28,0.5,-0.08,1.2], [60,130,230,0.20,0.5,1.12,1.0], [150,240,255,0.14,0.15,0.4,0.8]] },
    neon:  { name: "Neon",  vig: 0.34, tint: [22, 8, 38, 0.32], glows: [
      [255,30,200,0.30,0.16,0.16,0.8], [30,235,255,0.30,0.86,0.22,0.8],
      [160,50,255,0.24,0.5,0.94,0.9], [60,255,170,0.18,0.1,0.86,0.7], [255,215,40,0.16,0.92,0.86,0.6],
    ] },
    toxic: { name: "Toxic", vig: 0.42, tint: [10, 30, 8, 0.32], glows: [[120,255,60,0.28,0.5,-0.06,1.2], [80,200,40,0.22,0.18,1.08,1.0], [210,255,90,0.15,0.86,0.42,0.8]] },
    rose:  { name: "Rose",  vig: 0.38, tint: [42, 8, 26, 0.32], glows: [[255,40,120,0.30,0.3,-0.05,1.1], [255,100,170,0.22,0.82,1.05,0.9], [200,30,100,0.16,0.5,0.95,0.9]] },
    // the finale — every colour at once, loud and dramatic
    confluence: { name: "Confluence", vig: 0.30, tint: [18, 6, 34, 0.34], glows: [
      [255,30,200,0.30,0.12,0.14,0.7], [30,235,255,0.30,0.88,0.16,0.7],
      [255,120,30,0.24,0.5,1.06,0.8], [130,60,255,0.26,0.1,0.9,0.8],
      [60,255,160,0.20,0.9,0.9,0.7], [255,60,90,0.22,0.5,-0.06,0.8], [255,215,40,0.18,0.32,0.5,0.6],
    ] },
  };
  const BIOME_KEYS = ["dusk", "ice", "ember", "void", "neon", "toxic", "rose"];
  let lastBiome = null; // avoid immediate repeats when picking randomly

  // Journey — a light run through "the Lattice". Each level: dominant colour,
  // survive seconds, optional boss, a biome, and a line of plot shown before it.
  const JOURNEY = [
    { name: "Awakening",  color: "199,116,232", len: 35, boss: false, biome: "dusk",
      plot: "You wake as a stray node in the Lattice — a living grid of data. The Chasers turn toward you. Run." },
    { name: "The Ambush", color: "255,106,213", len: 36, boss: false, biome: "rose",
      plot: "Word spreads through the mesh. The Ambushers learn your habits, cutting ahead of every move you make." },
    { name: "Static",     color: "34,211,238",  len: 38, boss: false, biome: "ice",
      plot: "Deeper in, the signal frays. Erratics spiral around you, never quite where you expect." },
    { name: "The Timid",  color: "255,138,96",  len: 38, boss: false, biome: "toxic",
      plot: "The Shy ones swarm and flinch — bold from afar, panicked up close. Use their fear." },
    { name: "Drift",      color: "120,196,255", len: 40, boss: false, biome: "void",
      plot: "Out in the open field the Scatterers roam, barely chasing. Calm — but the webs between them still bite." },
    { name: "The Hive",   color: "255,248,120", len: 40, boss: false, biome: "ember",
      plot: "The Hive packs tight and grows as one. Whole clusters drift together. Thread the gaps." },
    { name: "The Warden", color: "199,116,232", len: 42, boss: true, biome: "void",
      plot: "A Warden node guards the gateway. It won't let you pass — catch it in a star-blast and break it open. The level ends only when it falls." },
    { name: "Confluence", color: null, len: 45, boss: true, bossCount: 3, shooter: true, biome: "confluence",
      plot: "Every colour converges on the core — three Wardens, one that fires on you. Blast them all to break through. No way out until they're gone." },
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }

  // spawn a hunter just off a random edge, drifting inward
  function spawnHunter() {
    const edge = (Math.random() * 4) | 0;
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -20 * dpr; }
    else if (edge === 1) { x = w + 20 * dpr; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + 20 * dpr; }
    else { x = -20 * dpr; y = rand(0, h); }
    // themed waves/levels bias most spawns to the theme colour for a clear identity
    const color = (themeColor && Math.random() < 0.72)
      ? themeColor
      : PALETTE[(Math.random() * PALETTE.length) | 0];
    const r0 = rand(2.6, 4.4) * dpr;
    hunters.push({
      id: hunterId++,
      x, y, vx: 0, vy: 0,
      r: r0, r0, // r is the live (grown) radius; r0 the spawn base
      color,
      p: PERSONA[color],
      seed: rand(0, 6.283185), // phase offset so same-kind nodes desync
      joltCd: 0,
      age: 0,
      life: rand(35, 60), // seconds before a lone node gives up and flies off
    });
  }

  function reset() {
    hunters = [];
    linkAges = new Map();
    nextSpawn = 0;
    elapsed = 0;
    shocks = [];
    star = null;
    nextStar = 5 + Math.random() * 4;
    ice = null;
    nextIce = 9 + Math.random() * 6;
    frozenUntil = 0;
    gems = [];
    nextGem = 2;
    points = 0;
    ptsEl.textContent = "0";
    trail = [];
    mult = 1; comboUntil = 0;
    shield = null; nextShield = 16 + Math.random() * 10;
    shieldActive = false; invulnUntil = 0;
    shooter = null; nextShooter = 18 + Math.random() * 10;
    shootUntil = 0; nextBullet = 0; bullets = [];
    slowmo = null; nextSlow = 40 + Math.random() * 30; speedSetback = 0;
    heading.x = 1; heading.y = 0;
    bosses = []; enemyBullets = []; nextBoss = 24 + Math.random() * 14;
    frozenAccum = 0; waveRampStart = 0; biomeFade = 1; prevBiome = null;
    audio.setShield(false);
    player.x = w / 2; player.y = h / 2;
    dead = false;
    // per-mode setup
    wave = 0; themeColor = null; bossWave = false; banner = null;
    biome = null; prevBiome = null; pattern = null; biomeFade = 1;
    if (mode === "waves") nextWave(0);
    else if (mode === "journey") setupJourneyLevel();
    else { pickBiome(true, true); scheduleBiomeShift(); } // classic → slow drifting biomes (fade in)
    for (let i = 0; i < 3; i++) spawnHunter();
  }

  const BOSS_VAL = 50; // points for destroying the boss
  function spawnBoss(forceColor, shooter) {
    const edge = (Math.random() * 4) | 0;
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -30 * dpr; }
    else if (edge === 1) { x = w + 30 * dpr; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + 30 * dpr; }
    else { x = -30 * dpr; y = rand(0, h); }
    const color = forceColor || PALETTE[(Math.random() * PALETTE.length) | 0];
    bosses.push({ x, y, vx: 0, vy: 0, r: (shooter ? 26 : 22) * dpr, t: 0, color, p: PERSONA[color], seed: rand(0, 6.283185), shooter: !!shooter, fireCd: 1.6 });
  }

  // burst a cluster of same-colour nodes outward from a point (boss death → its swarm)
  function popInto(x, y, color, count) {
    for (let k = 0; k < count; k++) {
      const r0 = rand(2.6, 4.4) * dpr;
      const ang = rand(0, 6.283185), spd = rand(180, 420) * dpr;
      hunters.push({
        id: hunterId++,
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        r: r0, r0,
        color,
        p: PERSONA[color],
        seed: rand(0, 6.283185),
        joltCd: 0, age: 0,
        life: rand(35, 60),
        safe: elapsed + 0.6, // can't kill the player for a beat after popping out
      });
    }
  }

  // ---- mode flow ----

  // pick a new random biome + pattern (no immediate biome repeat). `fade`=false snaps
  // (use at level start); `slow` gives a longer, gentle crossfade (classic ambience).
  function pickBiome(fade, slow) {
    let bkey = BIOME_KEYS[(Math.random() * BIOME_KEYS.length) | 0];
    if (bkey === lastBiome) bkey = BIOME_KEYS[(BIOME_KEYS.indexOf(bkey) + 1) % BIOME_KEYS.length];
    lastBiome = bkey;
    prevBiome = biome; prevPattern = pattern;
    biome = BIOMES[bkey];
    pattern = PATTERN_KEYS[(Math.random() * PATTERN_KEYS.length) | 0];
    biomeFade = fade ? 0 : 1;
    biomeFadeRate = slow ? 0.13 : 1.6; // classic: a long, gentle ~8s crossfade
    audio.setBiome(bkey);
  }

  // classic: drift to a fresh biome every so often (slow colour crossfade)
  function scheduleBiomeShift() { nextBiomeAt = elapsed + 13 + Math.random() * 4; } // steady, frequent (fade is slow)

  // waves: advance to the next wave (called at reset for wave 1, then on timer).
  // Flavours: themed (one colour), mixed (all colours, like classic), special
  // (a powerup/gem cache — a reward breather), and a boss every 5th wave.
  function nextWave(now) {
    wave++;
    bossWave = wave % 5 === 0;
    // random biome each wave (no immediate repeat)
    pickBiome(true, false); // always crossfade colours + pattern into the new biome
    waveEndsAt = now + WAVE_LEN;
    // undefeated bosses carry over to the next wave (don't clear them)
    waveRampStart = elapsed - frozenAccum; // wave speed ramps from here (active time)
    let sub;
    if (bossWave) {
      waveType = "boss";
      themeColor = PALETTE[(Math.random() * PALETTE.length) | 0];
      const shoots = Math.random() < Math.min(0.6, 0.2 + wave * 0.04); // later waves more likely
      spawnBoss(themeColor, shoots);
      while (hunters.length < (MOBILE ? 12 : 18)) spawnHunter(); // a proper swarm alongside the boss
      sub = (shoots ? "SHOOTER BOSS · " : "BOSS · ") + (PERSONA_NAME[themeColor] || "");
    } else {
      const roll = Math.random();
      waveType = roll < 0.18 ? "special" : roll < 0.5 ? "mixed" : "themed";
      if (waveType === "themed") {
        themeColor = PALETTE[(Math.random() * PALETTE.length) | 0];
        sub = PERSONA_NAME[themeColor] || "";
      } else {
        themeColor = null; // all colours
        sub = waveType === "special" ? "POWER CACHE" : "Mixed";
        if (waveType === "special") startSpecial(now);
      }
    }
    banner = { big: "WAVE " + wave, sub, until: now + 2.4 };
  }

  // special wave: scatter gems and front-load the powerups (incl. the shooter)
  function startSpecial(now) {
    for (let i = 0; i < 8; i++) gems.push({ x: rand(w * 0.1, w * 0.9), y: rand(h * 0.12, h * 0.88), t: 0 });
    nextStar = now + 1.5;
    nextShield = now + 3;
    nextShooter = now + 0.8;
    nextIce = now + 5.5;
  }

  // journey: configure the arena for the current level (elapsed has just reset to 0)
  function setupJourneyLevel() {
    const L = JOURNEY[journeyIdx];
    themeColor = L.color;
    bossWave = !!L.boss;
    biome = BIOMES[L.biome] || null;
    prevBiome = null; biomeFade = 0; biomeFadeRate = 1.6; // always fade the biome in
    pattern = PATTERN_KEYS[(Math.random() * PATTERN_KEYS.length) | 0];
    audio.setBiome(L.biome);
    levelEndsAt = L.len;
    banner = { big: L.name, sub: themeColor ? PERSONA_NAME[themeColor] : "All colours", until: 2.4 };
    if (L.boss) {
      bosses = []; enemyBullets = [];
      const n = L.bossCount || 1;
      // distinct colours per boss when the level has no single theme (Confluence)
      const pool = PALETTE.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < n; i++) spawnBoss(themeColor || pool[i % pool.length], L.shooter && i === 0);
      nextStar = 2; // boss levels need blasts to win → first one comes quickly
      while (hunters.length < (MOBILE ? 12 : 18)) spawnHunter();
    }
  }

  // journey: a level cleared → next plot card, or the win screen
  function levelComplete() {
    running = false;
    audio.sfx("shield"); // little fanfare
    journeyIdx++;
    if (journeyIdx >= JOURNEY.length) {
      winPanel.hidden = false; document.body.classList.remove("playing");
      audio.sfx("blast"); winCelebrate();
    } else showPlot();
  }

  // journey: show the plot card for the upcoming level (Begin → start())
  function showPlot() {
    const L = JOURNEY[journeyIdx];
    plotStageEl.textContent = "Level " + (journeyIdx + 1) + " of " + JOURNEY.length;
    plotNameEl.textContent = L.name;
    plotTextEl.textContent = L.plot;
    document.body.classList.remove("playing");
    plotPanel.hidden = false;
  }

  // a lethal touch — consumed by shield + i-frames; returns true if it kills
  function takeHit() {
    if (elapsed < invulnUntil) return false;        // i-frames
    if (shieldActive) {
      shieldActive = false; audio.setShield(false);
      invulnUntil = elapsed + 1.3;
      shocks.push({ x: player.x, y: player.y, t: 0, max: 300 * dpr, shield: true });
      for (const hn of hunters) { // shove the swarm off — wider, harder pop
        const dx = hn.x - player.x, dy = hn.y - player.y, d = Math.hypot(dx, dy) || 1;
        if (d < 320 * dpr) { const k = 780 * dpr; hn.vx += (dx / d) * k; hn.vy += (dy / d) * k; }
      }
      audio.sfx("freeze");
      return false;
    }
    return true;
  }

  // collect a star → expanding shockwave that destroys nodes as it reaches them
  function starBlast() {
    // smaller reach on mobile so it doesn't engulf the whole (small) screen
    const reach = (MOBILE ? 200 : 340) * dpr * arenaScale;
    shocks.push({ x: player.x, y: player.y, t: 0, max: reach, rainbow: true, kill: true });
    audio.sfx("blast");
    star = null;
  }

  function start() {
    reset();
    audio.resume(); audio.startMusic(); audio.sfx("start"); // gesture → unlock audio
    startPanel.hidden = true;
    overPanel.hidden = true;
    helpPanel.hidden = true;
    plotPanel.hidden = true;
    winPanel.hidden = true;
    document.body.classList.add("playing"); // hide cursor mid-run
    playerAlpha = 0; // fade the player in
    running = true; paused = false; celebrating = false; document.body.classList.remove("paused"); setPauseBtn();
    startT = -1; // stamp on first frame (no Date.now needed)
    requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    dead = true;
    audio.sfx("death");
    document.body.classList.remove("playing"); // restore cursor on menu
    const score = elapsed + points; // seconds + 10/gem, one decimal
    finalEl.textContent = elapsed.toFixed(1);
    finalPtsEl.textContent = points;
    finalScoreEl.textContent = score.toFixed(1);
    // leaderboard: record this run (per mode), show the board + submit box
    lastRun = { score, time: elapsed, points };
    lbStatusEl.textContent = "";
    submitScoreBtn.disabled = false;
    lbSubmitEl.hidden = false; // always show the button; it submits THIS run only
    document.getElementById("restart-btn").hidden = mode !== "journey"; // "Start over" only in journey
    const modeName = mode === "waves" ? "Waves" : mode === "journey" ? "Journey" : "Classic";
    let reach = "";
    if (mode === "waves") reach = "Reached wave " + wave + " · ";
    else if (mode === "journey") reach = "Level " + (journeyIdx + 1) + " — " + JOURNEY[journeyIdx].name + " · ";
    if (lbHeadEl) lbHeadEl.textContent = modeName + " leaderboard";
    loadBoard();
    const isBest = score > best;
    if (isBest) {
      best = score;
      localStorage.setItem(bestKey(), best.toFixed(2));
      bestEl.textContent = best.toFixed(1);
    }
    verdictEl.textContent = reach + (isBest ? "New best! 🏆" : "Best " + best.toFixed(1));
    overPanel.hidden = false;
  }

  function loop(now) {
    if (!running) return;
    if (startT < 0) { startT = now; lastT = now; }
    if (paused) { // freeze elapsed (so it doesn't jump on resume), hold the frame, show overlay
      startT += now - lastT; lastT = now;
      drawScene(); drawPauseOverlay();
      requestAnimationFrame(loop);
      return;
    }
    const dt = Math.min(0.05, (now - lastT) / 1000); // clamp big tab-switch gaps
    lastT = now;
    elapsed = (now - startT) / 1000;
    if (elapsed < frozenUntil) frozenAccum += dt; // don't let frozen time fuel the speed ramp
    if (biomeFade < 1) biomeFade = Math.min(1, biomeFade + dt * biomeFadeRate); // biome crossfade
    // classic counts up (survival); waves/journey count DOWN to the wave/level end;
    // journey boss levels show bosses-remaining instead (they end on defeat, not time)
    timeEl.textContent = mode === "waves" ? Math.max(0, waveEndsAt - elapsed).toFixed(1)
      : mode === "journey" ? (JOURNEY[journeyIdx].boss ? bosses.length + " ◉" : Math.max(0, levelEndsAt - elapsed).toFixed(1))
      : elapsed.toFixed(1);
    playerAlpha = Math.min(1, playerAlpha + dt * 2.4); // fade-in
    if (playerAlpha > 0.05) { trail.push({ x: player.x, y: player.y }); if (trail.length > 24) trail.shift(); }

    // player velocity from this frame's pointer movement (for ambush/predict)
    player.vx = (player.x - player.px) / (dt || 0.016);
    player.vy = (player.y - player.py) / (dt || 0.016);
    player.px = player.x; player.py = player.y;
    // remember the last real travel direction (drives the shooter's aim)
    const psp = Math.hypot(player.vx, player.vy);
    if (psp > 8 * dpr) { heading.x = player.vx / psp; heading.y = player.vy / psp; }

    // mode progression: advance waves / complete journey levels.
    // boss levels end ONLY when every boss is defeated (not on the timer).
    if (mode === "waves" && elapsed >= waveEndsAt) nextWave(elapsed);
    else if (mode === "journey") {
      const L = JOURNEY[journeyIdx];
      if (L.boss) { if (bosses.length === 0) { levelComplete(); return; } }
      else if (elapsed >= levelEndsAt) { levelComplete(); return; }
    } else if (mode === "classic" && elapsed >= nextBiomeAt) { pickBiome(true, true); scheduleBiomeShift(); }

    // difficulty ramps with time: more hunters fast, slightly slower speed.
    // rampTime excludes time spent frozen, so a late freeze doesn't make the game
    // jump to a much higher speed the instant it thaws.
    const rt = elapsed - frozenAccum;
    // speed clock = ramp time minus any roll-back from the slow powerup (cap/grow
    // use rt, so the node count keeps climbing — only travel speed is rewound)
    const st = Math.max(0, rt - speedSetback);
    const sp = MOBILE ? 0.78 : 1;                 // ease speed on small screens
    let maxSpeed, accel;
    if (mode === "waves") {
      // Waves: ramp off time-INTO-the-current-wave (resets each wave → speed steps
      // down at every wave start), with a gentle per-wave base so it rises overall.
      const into = Math.max(0, st - waveRampStart); // active secs into the current wave
      const baseS = 90 + Math.min(120, (wave - 1) * 8);
      const baseA = 200 + Math.min(180, (wave - 1) * 12);
      maxSpeed = (baseS + into * (MOBILE ? 1.2 : 1.5)) * dpr * sp * arenaScale;
      accel = (baseA + into * (MOBILE ? 2.4 : 3)) * dpr * sp * arenaScale;
    } else {
      // Classic/Journey: ramp with active time; journey escalates a touch per level
      // (mobile journey nudged ~10% harder).
      const diff = mode === "journey" ? (1 + journeyIdx * 0.045) * (MOBILE ? 1.1 : 1) : 1;
      maxSpeed = (90 + st * (MOBILE ? 4 : 5)) * dpr * sp * arenaScale * diff;
      accel = (220 + st * (MOBILE ? 9 : 11)) * dpr * sp * arenaScale * diff;
    }
    // The Hive (yellow, slow clusterers) packs more nodes — bigger cap + faster build
    const hive = themeColor === "255,248,120";
    const cap = Math.round((MOBILE ? 32 : 130) * arenaScale * (hive ? 1.45 : 1)), rate = (MOBILE ? 0.6 : 1.15) * (hive ? 1.5 : 1);
    // Journey resets elapsed each level, so it would re-ramp from sparse every time.
    // Start fuller, ramp faster, and escalate the floor with the level number.
    const jBase = mode === "journey" ? 4 + journeyIdx : mode === "waves" ? 6 : 0;
    const jRate = mode === "journey" ? 1.25 : mode === "waves" ? 1.25 : 1;
    let targetCount = Math.min(cap, 6 + jBase + Math.floor(rt * rate * jRate));
    if (bossWave) targetCount = Math.min(targetCount, MOBILE ? 14 : 22); // thin the swarm so the boss is the threat
    else if (waveType === "special") targetCount = Math.min(targetCount, MOBILE ? 18 : 30); // calmer reward wave
    const grow = 1; // node size scaling removed — constant radius
    // refill toward the target ONE node at a time on a cooldown — so a powerup
    // blast (or boss pop) thins the swarm for a while instead of backfilling
    // instantly next frame. The natural ramp is slower than this, so it's only
    // throttled right after a big kill.
    if (hunters.length < targetCount && elapsed >= nextSpawn) {
      spawnHunter();
      // journey fills faster, waves a bit slower (killed enemies don't snap back);
      // the Hive refills quickest of all
      let gap = mode === "journey" ? 0.42 : mode === "waves" ? 0.9 : SPAWN_GAP;
      if (hive) gap *= 0.5;
      nextSpawn = elapsed + gap;
    }

    // spawn a rainbow star now and then; collect it by touching it
    if (!star && elapsed >= nextStar) {
      star = { x: rand(w * 0.14, w * 0.86), y: rand(h * 0.16, h * 0.84), t: 0 };
    }
    if (star) {
      const sdx = player.x - star.x, sdy = player.y - star.y;
      const reach = STAR_R * dpr + player.r;
      if (sdx * sdx + sdy * sdy < reach * reach) {
        starBlast();
        // boss levels rely on blasts to kill bosses → stars come back faster
        nextStar = elapsed + (bosses.length ? 3.5 : 8) + Math.random() * (bosses.length ? 2 : 7);
      }
    }

    // freeze powerup — collect to freeze every hunter for a few seconds
    if (!ice && elapsed >= nextIce) {
      ice = { x: rand(w * 0.14, w * 0.86), y: rand(h * 0.16, h * 0.84), t: 0 };
    }
    if (ice) {
      const idx = player.x - ice.x, idy = player.y - ice.y;
      const reach = STAR_R * dpr + player.r;
      if (idx * idx + idy * idy < reach * reach) {
        frozenUntil = elapsed + 3.5;
        shocks.push({ x: ice.x, y: ice.y, t: 0, max: 300 * dpr, ice: true });
        audio.sfx("freeze");
        ice = null;
        nextIce = elapsed + 12 + Math.random() * 8;
      }
    }

    // collectable point gems — keep a few on screen, grab for points
    if (elapsed >= nextGem && gems.length < 5) {
      gems.push({ x: rand(w * 0.08, w * 0.92), y: rand(h * 0.1, h * 0.9), t: 0 });
      nextGem = elapsed + 1.5 + Math.random() * 2;
    }
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const gdx = player.x - g.x, gdy = player.y - g.y;
      const reach = GEM_R * dpr + player.r;
      if (gdx * gdx + gdy * gdy < reach * reach) {
        mult = elapsed < comboUntil ? Math.min(MULT_MAX, mult + 1) : 1; // chain → multiplier
        comboUntil = elapsed + COMBO_WINDOW;
        points += GEM_VAL * mult;
        ptsEl.textContent = String(points);
        shocks.push({ x: g.x, y: g.y, t: 0, max: 60 * dpr });
        audio.sfx("gem");
        gems.splice(i, 1);
      }
    }
    if (elapsed > comboUntil) mult = 1; // combo lapsed

    // shield powerup — absorbs one hit; while held the music brightens
    if (!shield && !shieldActive && elapsed >= nextShield) {
      shield = { x: rand(w * 0.14, w * 0.86), y: rand(h * 0.16, h * 0.84), t: 0 };
    }
    if (shield) {
      const dx = player.x - shield.x, dy = player.y - shield.y, reach = STAR_R * dpr + player.r;
      if (dx * dx + dy * dy < reach * reach) {
        shieldActive = true; audio.setShield(true); audio.sfx("shield");
        shocks.push({ x: shield.x, y: shield.y, t: 0, max: 140 * dpr, shield: true });
        shield = null; nextShield = elapsed + 22 + Math.random() * 12;
      }
    }

    // shooter powerup — collect to auto-fire darts along your travel for a few seconds
    if (!shooter && elapsed >= shootUntil && elapsed >= nextShooter) {
      shooter = { x: rand(w * 0.14, w * 0.86), y: rand(h * 0.16, h * 0.84), t: 0 };
    }
    if (shooter) {
      const dx = player.x - shooter.x, dy = player.y - shooter.y, reach = STAR_R * dpr + player.r;
      if (dx * dx + dy * dy < reach * reach) {
        shootUntil = elapsed + SHOOT_DUR;
        audio.sfx("blast");
        shocks.push({ x: shooter.x, y: shooter.y, t: 0, max: 140 * dpr, shield: true });
        shooter = null; nextShooter = elapsed + SHOOT_DUR + 14 + Math.random() * 10;
      }
    }

    // slow powerup (classic, rare) — rewinds the swarm's speed by a few seconds
    if (mode === "classic" && !slowmo && elapsed >= nextSlow) {
      slowmo = { x: rand(w * 0.14, w * 0.86), y: rand(h * 0.16, h * 0.84), t: 0 };
    }
    if (slowmo) {
      const dx = player.x - slowmo.x, dy = player.y - slowmo.y, reach = STAR_R * dpr + player.r;
      if (dx * dx + dy * dy < reach * reach) {
        speedSetback += SLOW_SETBACK; // roll the speed ramp back
        audio.sfx("freeze");
        shocks.push({ x: slowmo.x, y: slowmo.y, t: 0, max: 220 * dpr, ice: true });
        slowmo = null; nextSlow = elapsed + 45 + Math.random() * 35;
      }
    }

    // boss — occasional big slow hunter
    // classic: occasional boss; chance it's a shooter rises the longer you survive
    if (mode === "classic" && bosses.length === 0 && elapsed >= nextBoss) {
      spawnBoss(undefined, Math.random() < Math.min(0.5, 0.18 + elapsed / 240));
    }

    const frozen = elapsed < frozenUntil;

    ctx.clearRect(0, 0, w, h);

    // move + steer hunters per personality; old ones give up and fly off-screen
    const margin = 60 * dpr;
    for (const hn of hunters) {
      hn.r = hn.r0 * grow; // swell over time
      const pdx = player.x - hn.x, pdy = player.y - hn.y; // toward the real player
      const pd = Math.hypot(pdx, pdy) || 1;

      if (!frozen) {
      hn.age += dt;

      // only LONE nodes age out and fly off; clumped nodes stay (clumps persist)
      if (!hn.escaping && hn.age > hn.life && (hn.nb || 0) < 2) {
        hn.escaping = true;
        const kick = (440 + Math.random() * 200) * dpr;
        hn.vx = (-pdx / pd) * kick; hn.vy = (-pdy / pd) * kick;
      }

      if (!hn.escaping) {
        const p = hn.p;
        // each personality aims at a different target point
        let tx = player.x, ty = player.y;
        if (p.kind === "ambush") {            // Pinky: lead further ahead of the player
          tx = player.x + player.vx * 1.3; ty = player.y + player.vy * 1.3;
        } else if (p.kind === "erratic") {    // Inky: wide, fast wobble orbit
          const a = hn.age * 3.2 + hn.seed;
          tx = player.x + Math.cos(a) * 210 * dpr; ty = player.y + Math.sin(a * 1.25) * 210 * dpr;
        } else if (p.kind === "scatter") {    // roam the whole arena, barely chasing
          const a = elapsed * 0.22 + hn.seed;
          tx = w * 0.5 + Math.cos(a) * w * 0.46; ty = h * 0.5 + Math.sin(a * 1.3) * h * 0.46;
        }
        let tdx = tx - hn.x, tdy = ty - hn.y;
        if (p.kind === "shy" && pd < 260 * dpr) { tdx = -pdx; tdy = -pdy; } // Clyde bolts when close
        const td = Math.hypot(tdx, tdy) || 1;
        hn.vx += (tdx / td) * accel * p.acc * dt;
        hn.vy += (tdy / td) * accel * p.acc * dt;
        const ms = maxSpeed * p.spd, sp = Math.hypot(hn.vx, hn.vy);
        if (sp > ms) { hn.vx = (hn.vx / sp) * ms; hn.vy = (hn.vy / sp) * ms; }
      }
      hn.x += hn.vx * dt; hn.y += hn.vy * dt;

      if (hn.escaping) {
        // remove escapers once fully off-screen
        if (hn.x < -margin || hn.x > w + margin || hn.y < -margin || hn.y > h + margin) hn.dead = true;
      } else {
        // keep the swarm on-screen — bounce off the edges (repulsion can't fling them away)
        const m = hn.r;
        if (hn.x < m) { hn.x = m; hn.vx = Math.abs(hn.vx) * 0.5; }
        else if (hn.x > w - m) { hn.x = w - m; hn.vx = -Math.abs(hn.vx) * 0.5; }
        if (hn.y < m) { hn.y = m; hn.vy = Math.abs(hn.vy) * 0.5; }
        else if (hn.y > h - m) { hn.y = h - m; hn.vy = -Math.abs(hn.vy) * 0.5; }
      }
      } // end !frozen

      // collision with the real player → caught (frozen hunters still kill on contact).
      // freshly-popped boss nodes get a brief safe window so they can't instakill.
      const rr = hn.r + player.r;
      const armed = !hn.safe || elapsed > hn.safe;
      if (armed && pdx * pdx + pdy * pdy < rr * rr && takeHit()) { drawScene(); gameOver(); return; }
    }
    hunters = hunters.filter((h) => !h.dead);

    // bosses — each steers by its colour's personality (a heavy, slower version of
    // the matching node behaviour), bounces on walls, lethal on touch. A "shooter"
    // boss also fires aimed shots at the player.
    for (const boss of bosses) {
      boss.t += dt;
      if (!frozen) {
        const p = boss.p;
        let tx = player.x, ty = player.y;             // default: straight chase
        if (p.kind === "ambush") {                    // lead the player's motion
          tx = player.x + player.vx * 1.3; ty = player.y + player.vy * 1.3;
        } else if (p.kind === "erratic") {            // wobble orbit around the player
          const a = boss.t * 2.4 + boss.seed;
          tx = player.x + Math.cos(a) * 200 * dpr; ty = player.y + Math.sin(a * 1.25) * 200 * dpr;
        } else if (p.kind === "scatter") {            // roam the arena, barely chasing
          const a = elapsed * 0.22 + boss.seed;
          tx = w * 0.5 + Math.cos(a) * w * 0.46; ty = h * 0.5 + Math.sin(a * 1.3) * h * 0.46;
        }
        let tdx = tx - boss.x, tdy = ty - boss.y;
        const bd0 = Math.hypot(player.x - boss.x, player.y - boss.y) || 1;
        if (p.kind === "shy" && bd0 < 300 * dpr) { tdx = boss.x - player.x; tdy = boss.y - player.y; } // bolt when close
        const td = Math.hypot(tdx, tdy) || 1;
        const bms = (60 + elapsed * 2) * dpr * p.spd * arenaScale; // persona scales the boss's top speed
        boss.vx += (tdx / td) * 120 * dpr * p.acc * dt;
        boss.vy += (tdy / td) * 120 * dpr * p.acc * dt;
        const bsp = Math.hypot(boss.vx, boss.vy);
        if (bsp > bms) { boss.vx = (boss.vx / bsp) * bms; boss.vy = (boss.vy / bsp) * bms; }
        boss.x += boss.vx * dt; boss.y += boss.vy * dt;
        const m = boss.r;
        if (boss.x < m) { boss.x = m; boss.vx = Math.abs(boss.vx); } else if (boss.x > w - m) { boss.x = w - m; boss.vx = -Math.abs(boss.vx); }
        if (boss.y < m) { boss.y = m; boss.vy = Math.abs(boss.vy); } else if (boss.y > h - m) { boss.y = h - m; boss.vy = -Math.abs(boss.vy); }
        // shooter boss: lob an aimed shot on a cooldown
        if (boss.shooter) {
          boss.fireCd -= dt;
          if (boss.fireCd <= 0) {
            const dx = player.x - boss.x, dy = player.y - boss.y, d = Math.hypot(dx, dy) || 1;
            const spd = 320 * dpr * arenaScale;
            enemyBullets.push({ x: boss.x, y: boss.y, vx: dx / d * spd, vy: dy / d * spd, life: 3, color: boss.color });
            boss.fireCd = 1.4;
            audio.sfx("pop");
          }
        }
      }
      const bdx2 = player.x - boss.x, bdy2 = player.y - boss.y, brr = boss.r + player.r;
      if (bdx2 * bdx2 + bdy2 * bdy2 < brr * brr && takeHit()) { drawScene(); gameOver(); return; }
    }

    // boss shots — travel, expire, and kill the player on contact (shield/i-frames apply)
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const eb = enemyBullets[i];
      if (!frozen) { eb.x += eb.vx * dt; eb.y += eb.vy * dt; }
      eb.life -= dt;
      if (eb.life <= 0 || eb.x < -30 || eb.x > w + 30 || eb.y < -30 || eb.y > h + 30) { enemyBullets.splice(i, 1); continue; }
      const dx = player.x - eb.x, dy = player.y - eb.y, rr = player.r + 6 * dpr;
      if (dx * dx + dy * dy < rr * rr) {
        enemyBullets.splice(i, 1);
        if (takeHit()) { drawScene(); gameOver(); return; }
      }
    }

    // hunter-hunter forces (skipped while frozen) + lethal web check, one pass
    if (physics(dt, frozen) && takeHit()) { drawScene(); gameOver(); return; } // caught by a link

    // shooter weapon — fire darts straight, but each leaves the node at a random ±2°
    if (elapsed < shootUntil && elapsed >= nextBullet) {
      const bspd = 820 * dpr * arenaScale;
      const ang = Math.atan2(heading.y, heading.x) + (Math.random() * 2 - 1) * (2 * Math.PI / 180);
      bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * bspd, vy: Math.sin(ang) * bspd, life: 1.1 });
      nextBullet = elapsed + BULLET_GAP;
      audio.sfx("pop");
    }
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt;
      if (bl.life <= 0 || bl.x < -30 || bl.x > w + 30 || bl.y < -30 || bl.y > h + 30) { bullets.splice(i, 1); continue; }
      for (let j = hunters.length - 1; j >= 0; j--) {
        const hn = hunters[j];
        const dx = hn.x - bl.x, dy = hn.y - bl.y, rr = hn.r + 5 * dpr;
        if (dx * dx + dy * dy < rr * rr) {
          hunters.splice(j, 1);
          points += KILL_VAL; ptsEl.textContent = String(points);
          shocks.push({ x: bl.x, y: bl.y, t: 0, max: 46 * dpr });
          bullets.splice(i, 1);
          break;
        }
      }
    }

    drawScene();
    requestAnimationFrame(loop);
  }

  // one O(n²) pass over hunter pairs:
  //  - soft repulsion within SEP so they spread into a cloud, not a clump
  //  - hard separation when actually overlapping
  //  - if a drawn link (pair within LINK_DIST) touches the player → lethal
  function physics(dt, frozen) {
    links.length = 0;
    // track how long each web has existed → a freshly-formed web can't kill
    // until WEB_GRACE has passed (gives the player a beat to read the threat).
    const prevAges = linkAges;
    const nextAges = new Map();
    // frozen: hunters don't move, only their webs can still catch you
    if (frozen) {
      let kill = false;
      for (let i = 0; i < hunters.length; i++) {
        const a = hunters[i];
        for (let j = i + 1; j < hunters.length; j++) {
          const b = hunters[j];
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 < linkD2) {
            const key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
            const lifeT = (prevAges.get(key) || 0) + dt;
            nextAges.set(key, lifeT);
            links.push({ a, b, al: 1 - d2 / linkD2, same: a.color === b.color });
            if (!kill && lifeT >= WEB_GRACE && segHitsPlayer(a.x, a.y, b.x, b.y)) kill = true;
          }
        }
      }
      linkAges = nextAges;
      return kill;
    }
    const SEP = 74 * dpr * GROUP_SCALE, SEP2 = SEP * SEP; // tighter packing on mobile
    const JR = JOLT_R * dpr, JR2 = JR * JR;
    const CR = COH_R * dpr, CR2 = CR * CR;
    const GR = GROUP_R * dpr * GROUP_SCALE, GR2 = GR * GR; // smaller "same clump" radius on mobile
    // clumps pack tighter the longer you survive: same-colour cohesion strengthens
    // and internal repulsion eases, while inter-colour repulsion scales up in step
    // so the tighter balls still stay segregated into separate groups.
    const tight = 1 + Math.min(1.3, elapsed / 45);
    const n = hunters.length;
    const cnt = new Array(n).fill(0), sx = new Array(n).fill(0), sy = new Array(n).fill(0);
    const scnt = new Array(n).fill(0); // same-colour clump-mates
    let linkKill = false;
    for (let i = 0; i < n; i++) {
      const a = hunters[i];
      for (let j = i + 1; j < n; j++) {
        const b = hunters[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 0.01) continue;
        if (d2 < JR2) { cnt[i]++; cnt[j]++; sx[i] += b.x; sy[i] += b.y; sx[j] += a.x; sy[j] += a.y; }
        const same = a.color === b.color;
        if (same && d2 < GR2) { scnt[i]++; scnt[j]++; }
        if (d2 < SEP2) {
          const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          // same colour barely repels (lets them pack tight, even tighter over time);
          // different colours shove hard — and harder over time — to stay segregated
          const f = (1 - d / SEP) * (same ? 90 / tight : 1700 * tight) * dpr * dt;
          a.vx -= ux * f; a.vy -= uy * f;
          b.vx += ux * f; b.vy += uy * f;
          const min = a.r + b.r;
          if (d < min) { // resolve overlap directly
            const overlap = (min - d) / 2;
            a.x -= ux * overlap; a.y -= uy * overlap;
            b.x += ux * overlap; b.y += uy * overlap;
          }
        } else if (same && d2 < CR2) {
          // same colour attracts within range → local clumps form (beyond range,
          // nodes are free to chase the cursor). Crowded clump → members repel → split.
          const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          const crowded = (a.snb || 0) >= (a.p.split || SPLIT_SIZE) || (b.snb || 0) >= (b.p.split || SPLIT_SIZE);
          const cf = a.p.coh * (crowded ? -220 : 430 * tight) * dpr * dt; // gather harder over time
          a.vx += ux * cf; a.vy += uy * cf;
          b.vx -= ux * cf; b.vy -= uy * cf;
        } else if (d2 < CR2) {
          // differing colours shove apart at range → clumps segregate hard (harder over time)
          const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          const rf = (1 - d / CR) * 400 * tight * dpr * dt;
          a.vx -= ux * rf; a.vy -= uy * rf;
          b.vx += ux * rf; b.vy += uy * rf;
        }
        if (d2 < linkD2) {
          const key = a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
          const lifeT = (prevAges.get(key) || 0) + dt;
          nextAges.set(key, lifeT);
          links.push({ a, b, al: 1 - d2 / linkD2, same });
          if (!linkKill && lifeT >= WEB_GRACE && segHitsPlayer(a.x, a.y, b.x, b.y)) linkKill = true;
        }
      }
    }
    // crowding: a node with ≥ JOLT_X neighbours jolts away from the local centroid
    for (let i = 0; i < n; i++) {
      const a = hunters[i];
      a.nb = cnt[i];   // crowding (any colour) for lone-node logic
      a.snb = scnt[i]; // same-colour clump size for split logic
      if (a.joltCd > 0) a.joltCd -= dt;
      if (cnt[i] >= JOLT_X && a.joltCd <= 0) {
        const cx = sx[i] / cnt[i], cy = sy[i] / cnt[i];
        const dx = a.x - cx, dy = a.y - cy;
        const d = Math.hypot(dx, dy) || 1;
        const kick = (650 + Math.random() * 350) * dpr; // hard pop out of the crowd
        a.vx = (dx / d) * kick; a.vy = (dy / d) * kick;  // override, not add
        a.joltCd = 0.55;
        if (Math.random() < 0.16) { shocks.push({ x: cx, y: cy, t: 0, max: 120 * dpr }); audio.sfx("pop"); }
      }
    }
    linkAges = nextAges;
    return linkKill;
  }

  // rainbow five-point star, rotating + pulsing, with a coloured glow
  function drawStar(cx, cy, t) {
    const R = (STAR_R + Math.sin(t * 6) * 2) * dpr;
    const r = R * 0.45;
    const hue = (t * 220) % 360;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.8);
    ctx.shadowColor = `hsla(${hue},100%,65%,0.95)`;
    ctx.shadowBlur = 22 * dpr;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : r;
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-R, -R, R, R);
    g.addColorStop(0, `hsl(${hue},100%,62%)`);
    g.addColorStop(0.5, `hsl(${(hue + 120) % 360},100%,62%)`);
    g.addColorStop(1, `hsl(${(hue + 240) % 360},100%,62%)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // small pale-cyan diamond, gentle bob + glow
  function drawGem(cx, cy, t) {
    const R = (GEM_R + Math.sin(t * 4) * 1.5) * dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(0.7854); // 45° → diamond
    ctx.shadowColor = "rgba(150,230,255,0.9)";
    ctx.shadowBlur = 14 * dpr;
    ctx.fillStyle = "rgba(210,245,255,0.96)";
    ctx.fillRect(-R / 1.6, -R / 1.6, R * 1.25, R * 1.25);
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // boss — big menacing spiked orb with a glaring eye, in its own colour.
  // Deliberately unlike the small glowy powerup icons: spiky, dark-bodied, an eye.
  function drawBoss(boss) {
    const c = boss.color;
    const pulse = 1 + Math.sin(boss.t * 4) * 0.08;
    const R = boss.r * pulse;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // rotating spiked corona — jagged star, clearly a threat not a pickup
    ctx.rotate(boss.t * 0.8);
    ctx.shadowColor = `rgba(${c},0.95)`; ctx.shadowBlur = 30 * dpr;
    ctx.fillStyle = `rgba(${c},0.9)`;
    const spikes = 12;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const ang = (Math.PI / spikes) * i;
      const rad = i % 2 ? R * 1.55 : R * 1.05;
      const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.rotate(-boss.t * 0.8);
    ctx.shadowBlur = 0;

    // dark body + bright colour rim
    ctx.fillStyle = "rgba(10,6,16,0.97)";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283185); ctx.fill();
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = `rgba(${c},1)`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283185); ctx.stroke();

    // glaring eye — glowing iris that follows the player, dark pupil
    const eye = R * (0.34 + Math.sin(boss.t * 6) * 0.05);
    const look = Math.atan2(player.y - boss.y, player.x - boss.x);
    const ox = Math.cos(look) * R * 0.22, oy = Math.sin(look) * R * 0.22;
    ctx.shadowColor = `rgba(${c},0.95)`; ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = `rgba(${c},0.95)`;
    ctx.beginPath(); ctx.arc(0, 0, eye, 0, 6.283185); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(8,5,14,0.95)";
    ctx.beginPath(); ctx.arc(ox, oy, eye * 0.5, 0, 6.283185); ctx.fill();
    // shooter boss: a counter-rotating targeting ring so it reads as the threat
    if (boss.shooter) {
      ctx.rotate(-boss.t * 1.6);
      ctx.lineWidth = 2 * dpr; ctx.strokeStyle = `rgba(${c},0.85)`;
      ctx.setLineDash([6 * dpr, 7 * dpr]);
      ctx.beginPath(); ctx.arc(0, 0, R * 1.32, 0, 6.283185); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // shield powerup — cyan hexagon ring
  function drawShield(cx, cy, t) {
    const R = (STAR_R + Math.sin(t * 5) * 1.5) * dpr;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(t * 0.4);
    ctx.shadowColor = "rgba(150,225,255,0.9)"; ctx.shadowBlur = 18 * dpr;
    ctx.lineWidth = 3 * dpr; ctx.strokeStyle = "rgba(190,240,255,0.95)";
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) { const a = (Math.PI / 3) * i; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.restore(); ctx.shadowBlur = 0;
  }

  // icy six-spoke snowflake, slow spin + glow
  function drawIce(cx, cy, t) {
    const R = (STAR_R + Math.sin(t * 5) * 2) * dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.5);
    ctx.shadowColor = "rgba(150,225,255,0.95)";
    ctx.shadowBlur = 20 * dpr;
    ctx.strokeStyle = "rgba(220,245,255,0.95)";
    ctx.lineWidth = 2.4 * dpr;
    ctx.lineCap = "round";
    for (let i = 0; i < 6; i++) {
      const ang = (Math.PI / 3) * i;
      const ex = Math.cos(ang) * R, ey = Math.sin(ang) * R;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(ex, ey); ctx.stroke();
      // little side barbs
      const bx = Math.cos(ang) * R * 0.6, by = Math.sin(ang) * R * 0.6;
      const px = Math.cos(ang + 0.5) * R * 0.3, py = Math.sin(ang + 0.5) * R * 0.3;
      const qx = Math.cos(ang - 0.5) * R * 0.3, qy = Math.sin(ang - 0.5) * R * 0.3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px, by + py); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + qx, by + qy); ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // shooter powerup — bright green double-chevron, spinning + glowing
  function drawShooter(cx, cy, t) {
    const R = (STAR_R + Math.sin(t * 5) * 1.5) * dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.6);
    ctx.shadowColor = "rgba(120,255,190,0.9)"; ctx.shadowBlur = 18 * dpr;
    ctx.fillStyle = "rgba(170,255,215,0.96)";
    for (let k = 0; k < 2; k++) {
      const off = (k - 0.3) * R * 0.5;
      ctx.beginPath();
      ctx.moveTo(off + R * 0.5, 0);
      ctx.lineTo(off - R * 0.3, -R * 0.55);
      ctx.lineTo(off - R * 0.05, 0);
      ctx.lineTo(off - R * 0.3, R * 0.55);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // slow powerup — pale-blue clock with hands running backwards (rewind time/speed),
  // visually distinct from the shooter's chevrons
  function drawSlow(cx, cy, t) {
    const R = (STAR_R + Math.sin(t * 5) * 1.5) * dpr;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = "rgba(150,210,255,0.9)"; ctx.shadowBlur = 18 * dpr;
    ctx.strokeStyle = "rgba(195,230,255,0.96)"; ctx.lineWidth = 2.4 * dpr; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.92, 0, 6.283185); ctx.stroke(); // clock face
    const a = -t * 1.6; // counter-clockwise = winding back
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R * 0.55, Math.sin(a) * R * 0.55); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a * 2 - 1.3) * R * 0.42, Math.sin(a * 2 - 1.3) * R * 0.42); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // player caught if within (its radius + half web width + kill-band) of segment a→b
  function segHitsPlayer(ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((player.x - ax) * vx + (player.y - ay) * vy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + vx * t, cy = ay + vy * t;
    const dx = player.x - cx, dy = player.y - cy;
    const reach = player.r + (LINK_W / 2 + LETHAL) * dpr;
    return dx * dx + dy * dy < reach * reach;
  }

  // biome wash — translucent colour over the dark, transparent canvas (site bg shows through)
  // draw one biome's wash at an alpha multiplier (am) — used to crossfade between biomes
  function paintBiome(bm, am) {
    if (!bm || am <= 0) return;
    const D = Math.max(w, h);
    if (bm.tint) { // flat colour wash for a clear, distinct base hue
      const [r, g, b, a] = bm.tint;
      ctx.fillStyle = `rgba(${r},${g},${b},${a * am})`;
      ctx.fillRect(0, 0, w, h);
    }
    // defined glows — drift + pulse (lava-lamp motion)
    let i = 0;
    for (const [r, g, b, a, fx, fy, fs] of bm.glows) {
      const ph = i * 1.7;
      const cx = w * (fx + Math.sin(bgT * 0.11 + ph) * 0.16);
      const cy = h * (fy + Math.cos(bgT * 0.085 + ph * 1.3) * 0.16);
      const rad = D * fs * (1 + Math.sin(bgT * 0.14 + ph) * 0.18);
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${a * am})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
      i++;
    }
    // extra wandering mottle blobs drawn from the palette — more texture, always moving
    const gl = bm.glows, mott = MOBILE ? 2 : 4;
    for (let k = 0; k < mott; k++) {
      const [r, g, b] = gl[k % gl.length];
      const ph = k * 2.3 + 0.6;
      const cx = w * (0.5 + Math.sin(bgT * 0.07 + ph) * 0.46);
      const cy = h * (0.5 + Math.cos(bgT * 0.058 + ph * 1.6) * 0.46);
      const rad = D * (0.3 + 0.16 * Math.sin(bgT * 0.09 + ph));
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${0.10 * am})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    }
    // dark drifting patches — carve out shadowed regions for more contrast
    for (let k = 0; k < (MOBILE ? 2 : 3); k++) {
      const ph = k * 3.1 + 1.4;
      const cx = w * (0.5 + Math.sin(bgT * 0.063 + ph) * 0.46);
      const cy = h * (0.5 + Math.cos(bgT * 0.05 + ph * 1.5) * 0.46);
      const rad = D * (0.26 + 0.12 * Math.sin(bgT * 0.08 + ph));
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(4,3,10,${0.34 * am})`);
      grd.addColorStop(1, "rgba(4,3,10,0)");
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    }
    if (bm.vig) { // darken the edges to keep it grounded and dark
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, D * 0.75);
      v.addColorStop(0, "rgba(6,5,12,0)");
      v.addColorStop(1, `rgba(6,5,12,${bm.vig * am})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    }
  }
  // faint geometric pattern overlay — adds texture/variety on top of the colour wash;
  // drifts slowly so it feels alive
  function paintPattern(type, am) {
    if (!type || type === "none" || am <= 0) return;
    const a = 0.05 * am;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 1 * dpr;
    const step = 64 * dpr;
    const off = (bgT * 4) % step; // slow scroll
    if (type === "grid") {
      ctx.beginPath();
      for (let x = off; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = off; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else if (type === "dots") {
      const r = 1.6 * dpr;
      for (let x = off; x < w + step; x += step) for (let y = off; y < h + step; y += step) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283185); ctx.fill();
      }
    } else if (type === "rings") {
      const cx = w / 2, cy = h / 2, max = Math.hypot(w, h);
      ctx.beginPath();
      for (let rad = (bgT * 6) % (step * 1.6) + 8; rad < max; rad += step * 1.6) { ctx.moveTo(cx + rad, cy); ctx.arc(cx, cy, rad, 0, 6.283185); }
      ctx.stroke();
    } else if (type === "diag") {
      const gap = step * 1.4;
      ctx.beginPath();
      for (let x = -h + (off * 2); x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); }
      ctx.stroke();
    } else if (type === "weave") { // cross-hatch (both diagonals)
      const gap = step * 1.4;
      ctx.beginPath();
      for (let x = -h + (off * 2); x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); }
      ctx.stroke();
    } else if (type === "cross") { // small plus marks on a grid
      const s = 5 * dpr;
      for (let x = off; x < w + step; x += step) for (let y = off; y < h + step; y += step) {
        ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
      }
    } else if (type === "wave") { // horizontal sine bands
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12 * dpr) {
          const yy = y + Math.sin(x / (90 * dpr) + bgT * 0.4 + y) * 10 * dpr;
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    } else if (type === "hex") { // staggered dot lattice
      const r = 1.7 * dpr; let row = 0;
      for (let y = off; y < h + step; y += step * 0.86) {
        const xo = (row % 2) * step / 2 + off;
        for (let x = xo; x < w + step; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283185); ctx.fill(); }
        row++;
      }
    }
    ctx.restore();
  }
  let bgT = 0;
  function drawBiome() {
    bgT += 0.016; // own clock so the wash animates even on menus
    if (biomeFade < 1 && prevBiome) paintBiome(prevBiome, 1 - biomeFade);
    const f = biomeFade < 1 ? biomeFade : 1;
    paintBiome(biome, f);
    // patterns slowly breathe in and out on top of the wash
    const pb = Math.max(0, Math.sin(bgT * 0.09));
    if (biomeFade < 1 && prevBiome) paintPattern(prevPattern, (1 - biomeFade) * pb);
    paintPattern(pattern, f * pb);
    // time-of-day: darken the whole field at night (matches the site's day/night)
    const d = new Date(), hour = d.getHours() + d.getMinutes() / 60;
    const night = 0.8 * (1 - Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)));
    if (night > 0.01) { ctx.fillStyle = `rgba(4,3,12,${night * 0.5})`; ctx.fillRect(0, 0, w, h); }
  }

  // transient wave/level title + small persistent progress label (non-classic modes)
  function drawHud() {
    if (mode === "classic" || !running) return;
    ctx.save();
    ctx.textAlign = "center";
    const label = mode === "waves"
      ? "WAVE " + wave + (biome ? "  ·  " + biome.name : "")
      : (journeyIdx + 1) + "/" + JOURNEY.length + "  ·  " + (JOURNEY[journeyIdx] ? JOURNEY[journeyIdx].name : "");
    ctx.font = `600 ${13 * uiScale}px "General Sans", system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(label.toUpperCase(), w / 2, 78 * dpr); // sit below the HUD row (score), not over it
    if (banner && elapsed < banner.until) {
      const k = Math.min(1, (banner.until - elapsed) / 0.5, (elapsed - (banner.until - 2.4)) / 0.4 + 0.0001);
      const a = Math.max(0, Math.min(1, k));
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.font = `700 ${44 * uiScale}px "Clash Display", system-ui, sans-serif`;
      ctx.fillText(banner.big, w / 2, h * 0.42);
      if (banner.sub) {
        ctx.font = `600 ${18 * uiScale}px "General Sans", system-ui, sans-serif`;
        ctx.fillStyle = `rgba(200,220,255,${a * 0.85})`;
        ctx.fillText(banner.sub, w / 2, h * 0.42 + 34 * uiScale);
      }
    }
    ctx.restore();
  }

  let pauseHue = 0;
  function drawPauseOverlay() {
    pauseHue = (pauseHue + 1.6) % 360; // elapsed is frozen while paused → own clock
    ctx.save();
    ctx.fillStyle = "rgba(8,7,13,0.6)";
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    const fs = 52 * uiScale;
    ctx.font = `700 ${fs}px "Clash Display", system-ui, sans-serif`;
    // rainbow sweep across the word
    const tw = ctx.measureText("PAUSED").width;
    const g = ctx.createLinearGradient(w / 2 - tw / 2, 0, w / 2 + tw / 2, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${(pauseHue + i * 60) % 360},95%,63%)`);
    ctx.fillStyle = g;
    ctx.shadowColor = `hsl(${pauseHue},95%,60%)`; ctx.shadowBlur = 26 * uiScale;
    ctx.fillText("PAUSED", w / 2, h * 0.46);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `hsla(${pauseHue},70%,80%,0.9)`;
    ctx.font = `500 ${15 * uiScale}px "General Sans", system-ui, sans-serif`;
    ctx.fillText(MOBILE ? "tap to resume" : "press P / Space or tap to resume", w / 2, h * 0.46 + 36 * uiScale);
    ctx.restore();
  }

  // journey finale flourish — rainbow rings burst from centre behind the win panel
  let celebrating = false;
  function winCelebrate() {
    celebrating = true;
    const rings = [];
    for (let i = 0; i < 7; i++) rings.push({ t: -i * 0.1, hue: i * 52 });
    const step = () => {
      if (!celebrating) return;
      ctx.clearRect(0, 0, w, h);
      drawBiome();
      let alive = false;
      for (const r of rings) {
        r.t += 0.012;
        if (r.t < 0) { alive = true; continue; }
        if (r.t >= 1.1) continue;
        alive = true;
        const rad = r.t * Math.max(w, h) * 0.9;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, rad, 0, 6.283185);
        ctx.lineWidth = 5 * dpr;
        ctx.strokeStyle = `hsla(${(r.hue + r.t * 220) % 360},95%,65%,${Math.max(0, 1 - r.t) * 0.85})`;
        ctx.stroke();
      }
      if (alive) requestAnimationFrame(step); else celebrating = false;
    };
    requestAnimationFrame(step);
  }

  function drawScene() {
    drawBiome();
    // expanding shockwave rings — yellow for cluster jolts, rainbow for star blast
    for (let i = shocks.length - 1; i >= 0; i--) {
      const s = shocks[i];
      s.t += s.rainbow ? 0.03 : 0.05;
      if (s.t >= 1) { shocks.splice(i, 1); continue; }
      const rad = s.t * s.max;
      if (s.kill) { // destroy nodes the expanding front has reached → points each
        const r2 = rad * rad, before = hunters.length;
        hunters = hunters.filter((hn) => {
          const dx = hn.x - s.x, dy = hn.y - s.y;
          return dx * dx + dy * dy > r2;
        });
        const killed = before - hunters.length;
        if (killed) { points += killed * KILL_VAL; ptsEl.textContent = String(points); }
        // the wave also destroys any boss it reaches → pops into a swarm + bonus
        for (let bi = bosses.length - 1; bi >= 0; bi--) {
          const b = bosses[bi];
          const dx = b.x - s.x, dy = b.y - s.y;
          if (dx * dx + dy * dy <= r2) {
            popInto(b.x, b.y, b.color, 8);
            points += BOSS_VAL; ptsEl.textContent = String(points);
            shocks.push({ x: b.x, y: b.y, t: 0, max: 200 * dpr });
            bosses.splice(bi, 1);
          }
        }
        if (mode === "classic" && bosses.length === 0) nextBoss = elapsed + 24 + Math.random() * 14;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, 6.283185);
      ctx.lineWidth = (s.rainbow || s.ice ? 5 : 2) * dpr;
      ctx.strokeStyle = s.rainbow
        ? `hsla(${(s.t * 360) | 0},100%,65%,${(1 - s.t) * 0.9})`
        : s.ice
        ? `rgba(150,225,255,${(1 - s.t) * 0.85})`
        : `rgba(255,248,120,${(1 - s.t) * 0.5})`;
      ctx.stroke();
    }

    // links — dark underlay first so they stay visible over the bright yellow wash,
    // then the colour on top. Both alphas track proximity (lk.al) so a link
    // fades in as nodes approach instead of flashing on at the threshold.
    ctx.lineWidth = (LINK_W + 2.5) * dpr;
    for (const lk of links) {
      ctx.strokeStyle = `rgba(6,5,12,${lk.al * 0.5})`;
      ctx.beginPath(); ctx.moveTo(lk.a.x, lk.a.y); ctx.lineTo(lk.b.x, lk.b.y); ctx.stroke();
    }
    ctx.lineWidth = LINK_W * dpr;
    for (const lk of links) {
      const alpha = lk.al * (lk.same ? 1 : 0.7);
      ctx.strokeStyle = `rgba(${lk.same ? lk.a.color : LINK},${alpha})`;
      ctx.beginPath(); ctx.moveTo(lk.a.x, lk.a.y); ctx.lineTo(lk.b.x, lk.b.y); ctx.stroke();
    }
    // hunters — grouped by colour, one path + one fill each, no per-node shadow (fast)
    for (const col of PALETTE) {
      ctx.fillStyle = `rgba(${col},0.95)`;
      ctx.beginPath();
      for (const hn of hunters) {
        if (hn.color !== col) continue;
        ctx.moveTo(hn.x + hn.r, hn.y);
        ctx.arc(hn.x, hn.y, hn.r, 0, 6.283185);
      }
      ctx.fill();
    }

    // boss
    for (const b of bosses) drawBoss(b);

    // boss shots — bright menacing darts in the boss's colour
    if (enemyBullets.length) {
      ctx.save();
      ctx.lineCap = "round";
      for (const eb of enemyBullets) {
        const s = Math.hypot(eb.vx, eb.vy) || 1, ux = eb.vx / s, uy = eb.vy / s, len = 13 * dpr;
        ctx.strokeStyle = `rgba(${eb.color},0.95)`; ctx.lineWidth = 4 * dpr;
        ctx.shadowColor = `rgba(${eb.color},0.9)`; ctx.shadowBlur = 12 * dpr;
        ctx.beginPath(); ctx.moveTo(eb.x, eb.y); ctx.lineTo(eb.x - ux * len, eb.y - uy * len); ctx.stroke();
      }
      ctx.restore(); ctx.shadowBlur = 0;
    }

    // point gems
    for (const g of gems) { g.t += 0.04; drawGem(g.x, g.y, g.t); }

    // rainbow powerup star
    if (star) { star.t += 0.02; drawStar(star.x, star.y, star.t); }

    // freeze powerup (icy snowflake)
    if (ice) { ice.t += 0.02; drawIce(ice.x, ice.y, ice.t); }

    // shield powerup
    if (shield) { shield.t += 0.03; drawShield(shield.x, shield.y, shield.t); }

    // shooter powerup
    if (shooter) { shooter.t += 0.04; drawShooter(shooter.x, shooter.y, shooter.t); }

    // slow powerup
    if (slowmo) { slowmo.t += 0.03; drawSlow(slowmo.x, slowmo.y, slowmo.t); }

    // darts in flight
    if (bullets.length) {
      ctx.save();
      ctx.strokeStyle = "rgba(150,255,210,0.95)";
      ctx.lineWidth = 3 * dpr; ctx.lineCap = "round";
      ctx.shadowColor = "rgba(120,255,190,0.9)"; ctx.shadowBlur = 10 * dpr;
      for (const bl of bullets) {
        const s = Math.hypot(bl.vx, bl.vy) || 1, ux = bl.vx / s, uy = bl.vy / s, len = 11 * dpr;
        ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x - ux * len, bl.y - uy * len); ctx.stroke();
      }
      ctx.restore(); ctx.shadowBlur = 0;
    }

    // frozen-time tint + frost vignette
    if (elapsed < frozenUntil) {
      ctx.fillStyle = "rgba(120,200,255,0.10)";
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 8 * dpr;
      ctx.strokeStyle = "rgba(170,230,255,0.30)";
      ctx.strokeRect(0, 0, w, h);
    }

    // player comet trail — vaporwave colours, fading + shrinking toward the tail
    for (let i = 0; i < trail.length; i++) {
      const tp = trail[i], f = (i + 1) / trail.length;
      const col = PALETTE[(i + ((elapsed * 12) | 0)) % PALETTE.length];
      ctx.fillStyle = `rgba(${col},${f * f * 0.45})`;
      ctx.beginPath(); ctx.arc(tp.x, tp.y, player.r * f * 1.7, 0, 6.283185); ctx.fill();
    }

    // rainbow combo multiplier
    if (mult > 1) {
      const hue = (elapsed * 240) % 360;
      ctx.save();
      ctx.font = `700 ${32 * uiScale}px "Clash Display", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = 18 * dpr;
      ctx.fillStyle = `hsl(${hue},100%,66%)`;
      ctx.fillText(`×${mult}`, w / 2, 84 * uiScale + 36 * uiScale);
      ctx.restore(); ctx.shadowBlur = 0;
    }

    drawHud(); // wave/level title + progress label (non-classic modes)

    // player — bright pulsing node with halo (hidden on menu, fades in on start)
    if (playerAlpha < 0.01) return;
    const invuln = elapsed < invulnUntil;
    ctx.globalAlpha = playerAlpha * (invuln && ((elapsed * 16) | 0) % 2 ? 0.35 : 1); // flicker while invulnerable
    const pr = player.r;
    const halo = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, pr * 3.2);
    halo.addColorStop(0, "rgba(255,255,255,0.9)");
    halo.addColorStop(0.4, "rgba(255,106,213,0.55)");
    halo.addColorStop(1, "rgba(255,106,213,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(player.x, player.y, pr * 3.2, 0, 6.283185); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.beginPath(); ctx.arc(player.x, player.y, pr, 0, 6.283185); ctx.fill();
    // shield ring
    if (shieldActive) {
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = `rgba(150,225,255,${0.6 + 0.3 * Math.sin(elapsed * 6)})`;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr * 2.6, 0, 6.283185); ctx.stroke();
    }
    // armed (shooter) ring — green, with a little aim tick in the travel direction
    if (elapsed < shootUntil) {
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = `rgba(140,255,200,${0.55 + 0.3 * Math.sin(elapsed * 10)})`;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr * 2.1, 0, 6.283185); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(player.x + heading.x * pr * 2.1, player.y + heading.y * pr * 2.1);
      ctx.lineTo(player.x + heading.x * pr * 3.2, player.y + heading.y * pr * 3.2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // a faint idle frame behind the start panel
  function idleFrame() {
    if (running || dead) return;
    ctx.clearRect(0, 0, w, h);
    drawScene();
  }

  // ---- leaderboard ----
  function escHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function lbHeaders() { return { apikey: LB.anonKey, Authorization: `Bearer ${LB.anonKey}` }; }

  async function loadBoard(myName) {
    if (!LB.url) { boardEl.innerHTML = '<li class="lb__empty">leaderboard not set up</li>'; return; }
    boardEl.innerHTML = '<li class="lb__empty">loading…</li>'; // clear stale (other-mode) rows first
    try {
      // prefer the per-mode board; if the `mode` column isn't set up yet, fall back
      // to the legacy single board so the leaderboard keeps working.
      let res = await fetch(`${LB.url}/rest/v1/scores?select=name,score&mode=eq.${mode}&order=score.desc&limit=${LB.limit}`, { headers: lbHeaders(), cache: "no-store" });
      if (!res.ok) res = await fetch(`${LB.url}/rest/v1/scores?select=name,score&order=score.desc&limit=${LB.limit}`, { headers: lbHeaders(), cache: "no-store" });
      if (!res.ok) throw 0;
      const list = await res.json();
      if (!list.length) { boardEl.innerHTML = '<li class="lb__empty">no scores yet — be first</li>'; return; }
      let shownMine = false;
      boardEl.innerHTML = list.map((e) => {
        const mine = !shownMine && myName && e.name === myName ? (shownMine = true, "me") : "";
        return `<li class="${mine}"><span class="nm">${escHtml(e.name)}</span><span class="sc">${Number(e.score).toFixed(1)}</span></li>`;
      }).join("");
    } catch {
      boardEl.innerHTML = '<li class="lb__empty">leaderboard unavailable</li>';
    }
  }

  async function submitScore() {
    if (!LB.url) { lbStatusEl.textContent = "leaderboard not set up yet"; return; }
    const name = (initialsEl.value || "AAA").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "AAA";
    submitScoreBtn.disabled = true;
    lbStatusEl.textContent = "submitting…";
    try {
      const base = { name, score: +lastRun.score.toFixed(1), time: +lastRun.time.toFixed(1), points: lastRun.points };
      const post = (body) => fetch(`${LB.url}/rest/v1/scores`, {
        method: "POST",
        headers: { ...lbHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      // include mode; if the column isn't set up yet, retry without it
      let res = await post({ ...base, mode });
      if (!res.ok) res = await post(base);
      if (!res.ok) throw 0;
      lbStatusEl.textContent = "saved!";
      lbSubmitEl.hidden = true;
      setTimeout(() => loadBoard(name), 700);
    } catch {
      lbStatusEl.textContent = "submit failed — try again";
      submitScoreBtn.disabled = false;
    }
  }

  // how-to-play overlay — opens over whichever menu is showing, returns to it
  const helpPanel = document.getElementById("help");
  let helpReturn = startPanel;
  function openHelp() {
    if (!helpPanel.hidden) return;
    helpReturn = !overPanel.hidden ? overPanel : startPanel;
    helpReturn.hidden = true; helpPanel.hidden = false;
  }
  function closeHelp() { helpPanel.hidden = true; helpReturn.hidden = false; }

  // pick a mode from the start menu → straight into play, or a plot card for Journey
  function chooseMode(m) {
    mode = m;
    loadBest();
    if (mode === "journey") { journeyIdx = 0; startPanel.hidden = true; showPlot(); }
    else start();
  }
  // return to the mode-select menu from win/over/plot
  function backToMenu() {
    running = false; dead = false; paused = false; celebrating = false; setPauseBtn();
    overPanel.hidden = true; winPanel.hidden = true; plotPanel.hidden = true; helpPanel.hidden = true;
    document.body.classList.remove("playing", "paused");
    startPanel.hidden = false;
    mode = "classic"; biome = null; banner = null; loadBest();
    reset(); idleFrame();
  }

  // pause — freezes the run; cursor returns; resume via key/button/tap
  const pauseBtn = document.getElementById("pause-btn");
  function setPauseBtn() {
    if (!pauseBtn) return;
    pauseBtn.textContent = paused ? "▶" : "❚❚";
    pauseBtn.setAttribute("aria-label", paused ? "resume" : "pause");
  }
  function togglePause() {
    if (!running) return;
    paused = !paused;
    document.body.classList.toggle("paused", paused); // show the cursor while paused (keeps .playing → pause btn stays)
    setPauseBtn();
  }

  const muteLabel = (m) => (m ? "🔇 Muted" : "🔊 Sound on") + (MOBILE ? "" : " (M)");
  function toggleMute() { audio.resume(); muteEl.textContent = muteLabel(audio.toggleMute()); }
  muteEl.textContent = muteLabel(false); // set initial label (drops "(M)" on mobile)

  // controls
  if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
  muteEl.addEventListener("click", toggleMute);
  document.querySelectorAll(".mode-btn").forEach((b) => b.addEventListener("click", () => chooseMode(b.dataset.mode)));
  document.getElementById("retry-btn").addEventListener("click", start);
  document.getElementById("restart-btn").addEventListener("click", () => { journeyIdx = 0; start(); }); // journey from level 1
  document.getElementById("plot-begin").addEventListener("click", start);
  document.getElementById("plot-back").addEventListener("click", backToMenu);
  document.getElementById("win-menu").addEventListener("click", backToMenu);
  document.getElementById("menu-btn").addEventListener("click", backToMenu);
  document.getElementById("help-btn").addEventListener("click", openHelp);
  document.getElementById("help-btn-over").addEventListener("click", openHelp);
  document.getElementById("help-back").addEventListener("click", closeHelp);
  submitScoreBtn.addEventListener("click", submitScore);
  initialsEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); submitScore(); } });
  addEventListener("keydown", (e) => {
    if (document.activeElement === initialsEl) return; // typing initials → ignore game keys
    if (!helpPanel.hidden) { if (e.key === "Escape" || e.key === "h" || e.key === "H" || e.key === "?") closeHelp(); return; }
    if (!plotPanel.hidden) { if (e.key === "Enter" || e.key === " ") start(); else if (e.key === "Escape") backToMenu(); return; }
    if (!winPanel.hidden) { if (e.key === "Enter" || e.key === "Escape") backToMenu(); return; }
    if ((e.key === "h" || e.key === "H" || e.key === "?") && !running) { openHelp(); return; }
    if ((e.key === "p" || e.key === "P" || e.key === " ") && running) { e.preventDefault(); togglePause(); return; }
    if (e.key === "Escape") { if (paused) togglePause(); else if (!overPanel.hidden) backToMenu(); else window.location.href = "/"; }
    if ((e.key === "r" || e.key === "R") && dead) start();
    if (e.key === "m" || e.key === "M") toggleMute();
  });

  reset();
  idleFrame();

  // dev shortcut (LOCAL ONLY — never runs on the live site): play.html#level=N jumps
  // straight into Journey level N (1-based). e.g. #level=8 = Confluence. Also #waves/#classic.
  (function jumpFromHash() {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    const h = location.hash;
    const m = h.match(/level=(\d+)/);
    if (m) { mode = "journey"; journeyIdx = Math.max(0, Math.min(JOURNEY.length - 1, +m[1] - 1)); loadBest(); startPanel.hidden = true; start(); }
    else if (/waves/.test(h)) { mode = "waves"; loadBest(); startPanel.hidden = true; start(); }
    else if (/classic/.test(h)) { mode = "classic"; loadBest(); startPanel.hidden = true; start(); }
  })();
})();
