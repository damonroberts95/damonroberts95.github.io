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

  // score = 1 point per second survived + 10 per gem; best is the high score
  const BEST_KEY = "noderun-best-score";
  let best = parseFloat(localStorage.getItem(BEST_KEY) || "0") || 0;
  bestEl.textContent = best.toFixed(1);

  const audio = makeAudio();

  /* ---- Web Audio: generative synth loop + SFX (no asset files).
     Supersaw voices + reverb + filter envelopes; tempo rises with
     elapsed so the music tracks the game's pace. ---- */
  function makeAudio() {
    let ctx = null, master, mlp, music, fx, verb, noise, muted = false, playing = false, step = 0, nextNote = 0, timer = null, bright = false;
    const CHORDS = [
      { root: 57, ivs: [0, 3, 7, 10] }, // Am7
      { root: 53, ivs: [0, 4, 7, 11] }, // Fmaj7
      { root: 60, ivs: [0, 4, 7, 11] }, // Cmaj7
      { root: 55, ivs: [0, 4, 7, 10] }, // G7
    ];
    const ARP = [0, 2, 3, 2, 1, 2, 3, 1, 0, 3, 2, 3, 1, 2, 0, 2];
    const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
    const frozenNow = () => elapsed < frozenUntil;
    // crawls during freeze, very slow on menu/loss, eases up while playing
    const curBPM = () => (frozenNow() ? 28 : running ? Math.min(132, 84 + elapsed * 0.6) : 40);

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
      const vg = ctx.createGain(); vg.gain.value = 1.0; verb.connect(vg); vg.connect(mlp);
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
      const c = CHORDS[Math.floor(s / 16) % CHORDS.length], b = s % 16;
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
      if (b === 0 || b === 8) synth(mtof(c.root - 12) * pitch, t, 1.1, { gain: 0.26, detune: 6, voices: 2, cut: 440, q: 4, attack: 0.04, sub: true });
      // lush pad swell
      if (b === 0) c.ivs.forEach((iv) => synth(mtof(c.root + iv) * pitch, t, 2.5, { gain: 0.05, detune: 18, voices: 3, cut: 1300, q: 1.2, attack: 0.8 }));
      // bouncier lead — more notes, plucky
      if (b === 0 || b === 3 || b === 6 || b === 8 || b === 11 || b === 14) {
        const note = c.root + c.ivs[ARP[b] % c.ivs.length] + 12;
        synth(mtof(note) * pitch, t, 0.55, { type: "triangle", gain: 0.07, detune: 8, voices: 2, cut: 2100, q: 3, attack: 0.02 });
      }
      // offbeat hats keep it moving
      if (b % 2 === 1) noiseHit(t, 0.025, 0.014, music, 10000);
      // shield active → bright sparkle layer an octave up (audible "powered" change)
      if (bright && b % 2 === 0) {
        const note = c.root + c.ivs[ARP[b] % c.ivs.length] + 24;
        synth(mtof(note) * pitch, t, 0.3, { type: "sine", gain: 0.05, detune: 4, voices: 2, cut: 9000, q: 1, attack: 0.01 });
      }
    }
    function tick() {
      // after a tab-away the clock jumps; don't schedule a huge backlog of notes at once
      if (nextNote < ctx.currentTime - 0.3) nextNote = ctx.currentTime;
      const ahead = ctx.currentTime + 0.12;
      while (nextNote < ahead) { scheduleStep(step, nextNote); nextNote += 60 / curBPM() / 4; step++; }
    }

    return {
      resume() { ensure(); if (ctx.state === "suspended") ctx.resume(); },
      startMusic() { ensure(); if (playing) return; playing = true; step = 0; nextNote = ctx.currentTime + 0.1; timer = setInterval(tick, 25); },
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
      setShield(on) { bright = on; if (mlp) mlp.frequency.setTargetAtTime(on ? 16000 : 8500, ctx.currentTime, 0.12); },
    };
  }

  // touch devices: smaller arena is harder, so ease difficulty, float the
  // player above the fingertip, and shorten the webs
  const MOBILE = window.matchMedia("(pointer: coarse)").matches;
  const LINK_SCALE = MOBILE ? 0.6 : 1;   // shorter webs on small screens → fewer lethal lines, more gaps
  const GROUP_SCALE = MOBILE ? 0.7 : 1;  // tighter clumps on small screens → nodes ball up, opening dodge lanes

  let w, h, dpr = 1, linkD2;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    linkD2 = (LINK_DIST * LINK_SCALE * dpr) ** 2;
  }
  resize();
  addEventListener("resize", resize);

  // player follows the pointer; start centred
  // px/py = previous frame position, vx/vy = velocity (drives ambush/predict)
  const player = { x: w / 2, y: h / 2, px: w / 2, py: h / 2, vx: 0, vy: 0, r: 7 * dpr };
  let anchor = null; // touch: where the finger + player were when the drag began
  const clamp01 = (v, hi) => (v < 0 ? 0 : v > hi ? hi : v);

  function startTouch(e) {
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
  let running = false, dead = false;
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
  let boss = null, nextBoss = 0; // big slow hunter

  function rand(a, b) { return a + Math.random() * (b - a); }

  // spawn a hunter just off a random edge, drifting inward
  function spawnHunter() {
    const edge = (Math.random() * 4) | 0;
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -20 * dpr; }
    else if (edge === 1) { x = w + 20 * dpr; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + 20 * dpr; }
    else { x = -20 * dpr; y = rand(0, h); }
    const color = PALETTE[(Math.random() * PALETTE.length) | 0];
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
    boss = null; nextBoss = 24 + Math.random() * 14;
    audio.setShield(false);
    player.x = w / 2; player.y = h / 2;
    dead = false;
    for (let i = 0; i < 3; i++) spawnHunter();
  }

  const BOSS_VAL = 50; // points for destroying the boss
  function spawnBoss() {
    const edge = (Math.random() * 4) | 0;
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -30 * dpr; }
    else if (edge === 1) { x = w + 30 * dpr; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + 30 * dpr; }
    else { x = -30 * dpr; y = rand(0, h); }
    const color = PALETTE[(Math.random() * PALETTE.length) | 0];
    boss = { x, y, vx: 0, vy: 0, r: 22 * dpr, t: 0, color };
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
    shocks.push({ x: player.x, y: player.y, t: 0, max: 340 * dpr, rainbow: true, kill: true });
    audio.sfx("blast");
    star = null;
  }

  function start() {
    reset();
    audio.resume(); audio.startMusic(); audio.sfx("start"); // gesture → unlock audio
    startPanel.hidden = true;
    overPanel.hidden = true;
    document.body.classList.add("playing"); // hide cursor mid-run
    playerAlpha = 0; // fade the player in
    running = true;
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
    // leaderboard: record this run, show the board + submit box
    lastRun = { score, time: elapsed, points };
    lbStatusEl.textContent = "";
    submitScoreBtn.disabled = false;
    lbSubmitEl.hidden = false; // always show the button; it submits THIS run only
    loadBoard();
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, best.toFixed(2));
      bestEl.textContent = best.toFixed(1);
      verdictEl.textContent = "New best! 🏆";
    } else {
      verdictEl.textContent = "Best " + best.toFixed(1);
    }
    overPanel.hidden = false;
  }

  function loop(now) {
    if (!running) return;
    if (startT < 0) { startT = now; lastT = now; }
    const dt = Math.min(0.05, (now - lastT) / 1000); // clamp big tab-switch gaps
    lastT = now;
    elapsed = (now - startT) / 1000;
    timeEl.textContent = elapsed.toFixed(1);
    playerAlpha = Math.min(1, playerAlpha + dt * 2.4); // fade-in
    if (playerAlpha > 0.05) { trail.push({ x: player.x, y: player.y }); if (trail.length > 24) trail.shift(); }

    // player velocity from this frame's pointer movement (for ambush/predict)
    player.vx = (player.x - player.px) / (dt || 0.016);
    player.vy = (player.y - player.py) / (dt || 0.016);
    player.px = player.x; player.py = player.y;

    // difficulty ramps with time: more hunters fast, slightly slower speed.
    // desktop ramps a touch harder (steeper speed/accel, more nodes); mobile eased.
    const sp = MOBILE ? 0.78 : 1;                 // ease speed on small screens
    const maxSpeed = (90 + elapsed * (MOBILE ? 4 : 5)) * dpr * sp;
    const accel = (220 + elapsed * (MOBILE ? 9 : 11)) * dpr * sp; // homing strength (chase the cursor)
    const cap = MOBILE ? 32 : 130, rate = MOBILE ? 0.6 : 1.15; // fewer nodes, slower build on mobile
    const targetCount = Math.min(cap, 6 + Math.floor(elapsed * rate));
    // nodes swell the longer you survive → bigger targets, harder dodging (capped at 3x)
    const grow = 1 + Math.min(2, elapsed / 90);
    // refill toward the target ONE node at a time on a cooldown — so a powerup
    // blast (or boss pop) thins the swarm for a while instead of backfilling
    // instantly next frame. The natural ramp is slower than this, so it's only
    // throttled right after a big kill.
    if (hunters.length < targetCount && elapsed >= nextSpawn) {
      spawnHunter();
      nextSpawn = elapsed + SPAWN_GAP;
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
        nextStar = elapsed + 8 + Math.random() * 7;
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

    // boss — occasional big slow hunter
    if (!boss && elapsed >= nextBoss) spawnBoss();

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
          tx = player.x + player.vx * 0.7; ty = player.y + player.vy * 0.7;
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

    // boss — slow relentless chase, bounces on walls, lethal on touch
    if (boss) {
      boss.t += dt;
      if (!frozen) {
        const bdx = player.x - boss.x, bdy = player.y - boss.y, bd = Math.hypot(bdx, bdy) || 1;
        const bms = (60 + elapsed * 2) * dpr;
        boss.vx += (bdx / bd) * 120 * dpr * dt;
        boss.vy += (bdy / bd) * 120 * dpr * dt;
        const bsp = Math.hypot(boss.vx, boss.vy);
        if (bsp > bms) { boss.vx = (boss.vx / bsp) * bms; boss.vy = (boss.vy / bsp) * bms; }
        boss.x += boss.vx * dt; boss.y += boss.vy * dt;
        const m = boss.r;
        if (boss.x < m) { boss.x = m; boss.vx = Math.abs(boss.vx); } else if (boss.x > w - m) { boss.x = w - m; boss.vx = -Math.abs(boss.vx); }
        if (boss.y < m) { boss.y = m; boss.vy = Math.abs(boss.vy); } else if (boss.y > h - m) { boss.y = h - m; boss.vy = -Math.abs(boss.vy); }
      }
      const bdx2 = player.x - boss.x, bdy2 = player.y - boss.y, brr = boss.r + player.r;
      if (bdx2 * bdx2 + bdy2 * bdy2 < brr * brr && takeHit()) { drawScene(); gameOver(); return; }
    }

    // hunter-hunter forces (skipped while frozen) + lethal web check, one pass
    if (physics(dt, frozen) && takeHit()) { drawScene(); gameOver(); return; } // caught by a link

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
  function drawBoss() {
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

  function drawScene() {
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
        // the wave also destroys the boss → pops into a swarm of its own colour + bonus
        if (boss) {
          const dx = boss.x - s.x, dy = boss.y - s.y;
          if (dx * dx + dy * dy <= r2) {
            popInto(boss.x, boss.y, boss.color, 8);
            points += BOSS_VAL; ptsEl.textContent = String(points);
            shocks.push({ x: boss.x, y: boss.y, t: 0, max: 160 * dpr });
            boss = null;
          }
        }
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
    if (boss) drawBoss();

    // point gems
    for (const g of gems) { g.t += 0.04; drawGem(g.x, g.y, g.t); }

    // rainbow powerup star
    if (star) { star.t += 0.02; drawStar(star.x, star.y, star.t); }

    // freeze powerup (icy snowflake)
    if (ice) { ice.t += 0.02; drawIce(ice.x, ice.y, ice.t); }

    // shield powerup
    if (shield) { shield.t += 0.03; drawShield(shield.x, shield.y, shield.t); }

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
      ctx.font = `700 ${30 * dpr}px "Clash Display", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = `hsl(${hue},100%,60%)`; ctx.shadowBlur = 18 * dpr;
      ctx.fillStyle = `hsl(${hue},100%,66%)`;
      ctx.fillText(`×${mult}`, w / 2, 96 * dpr);
      ctx.restore(); ctx.shadowBlur = 0;
    }

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
    try {
      const res = await fetch(`${LB.url}/rest/v1/scores?select=name,score&order=score.desc&limit=${LB.limit}`, { headers: lbHeaders(), cache: "no-store" });
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
      const res = await fetch(`${LB.url}/rest/v1/scores`, {
        method: "POST",
        headers: { ...lbHeaders(), "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ name, score: +lastRun.score.toFixed(1), time: +lastRun.time.toFixed(1), points: lastRun.points }),
      });
      if (!res.ok) throw 0;
      lbStatusEl.textContent = "saved!";
      lbSubmitEl.hidden = true;
      setTimeout(() => loadBoard(name), 700);
    } catch {
      lbStatusEl.textContent = "submit failed — try again";
      submitScoreBtn.disabled = false;
    }
  }

  // controls
  document.getElementById("start-btn").addEventListener("click", start);
  document.getElementById("retry-btn").addEventListener("click", start);
  submitScoreBtn.addEventListener("click", submitScore);
  initialsEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); submitScore(); } });
  addEventListener("keydown", (e) => {
    if (document.activeElement === initialsEl) return; // typing initials → ignore game keys
    if (e.key === "Escape") { window.location.href = "/"; }
    if ((e.key === "r" || e.key === "R") && dead) start();
    if (e.key === "Enter" && !running) start();
    if (e.key === "m" || e.key === "M") { const m = audio.toggleMute(); muteEl.textContent = m ? "🔇 muted (M)" : "🔊 sound on (M)"; }
  });

  reset();
  idleFrame();
})();
