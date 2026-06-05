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
  const winVerdictEl = document.getElementById("win-verdict");
  const winBoardEl = document.getElementById("win-board");
  const winLbSubmitEl = document.getElementById("win-lb-submit");
  const winInitialsEl = document.getElementById("win-initials");
  const winSubmitBtn = document.getElementById("win-submit");
  const winStatusEl = document.getElementById("win-status");
  const plotPanel = document.getElementById("plot");
  const plotStageEl = document.getElementById("plot-stage");
  const plotNameEl = document.getElementById("plot-name");
  const plotTextEl = document.getElementById("plot-text");
  const winPanel = document.getElementById("win");
  const arenaStartPanel = document.getElementById("arena-start");

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
  const SCATTER = "120,196,255"; // blue Scatterers — get a longer web than other colours
  const SCAT_WEB = 1.6;          // scatterer-scatterer web reach multiplier
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
    "120,196,255": { kind: "scatter", spd: 0.48, acc: 0.38, coh: 0.9 },
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
    let ctx = null, master, mlp, music, fx, verb, vg, noise, muted = false, playing = false, step = 0, nextNote = 0, timer = null, bright = false, triumph = false;
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
      // creepy, crawling — the Hive: diminished/tritone tension, hollow square lead, murky + slow
      ember: { chords: [{ root: 53, ivs: [0, 3, 6, 10] }, { root: 54, ivs: [0, 3, 6, 9] }, { root: 51, ivs: [0, 3, 6, 10] }, { root: 56, ivs: [0, 3, 6, 9] }],
               transpose: -5, bright: 5600, reverb: 1.5, bpmMul: 0.95, leadType: "square", leadCut: 1900, sparkle: false },
      // crystalline + jittery — brighter, faster, a glassy saw lead (Erratics)
      ice:   { chords: [{ root: 60, ivs: [0, 4, 7, 11] }, { root: 62, ivs: [0, 4, 7, 11] }, { root: 59, ivs: [0, 3, 7, 10] }, { root: 57, ivs: [0, 4, 7, 11] }],
               transpose: 0, bright: 13000, reverb: 1.3, bpmMul: 1.12, leadType: "sawtooth", leadCut: 6800, sparkle: true },
      // loud, bright, energetic
      neon:  { chords: [{ root: 60, ivs: [0, 4, 7, 11] }, { root: 55, ivs: [0, 4, 7, 10] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 4, 7, 11] }],
               transpose: 0, bright: 13000, reverb: 1.1, bpmMul: 1.12, leadType: "sawtooth", leadCut: 5200, sparkle: true },
      // edgy, acidic minor
      toxic: { chords: [{ root: 55, ivs: [0, 3, 7, 10] }, { root: 57, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 3, 7, 10] }, { root: 50, ivs: [0, 3, 7, 10] }],
               transpose: 0, bright: 8000, reverb: 0.95, bpmMul: 1.05, leadType: "square", leadCut: 2600, sparkle: false },
      // dramatic, predatory — the Ambush: tense minor with a dominant pull + a sharp saw lead
      rose:  { chords: [{ root: 57, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 4, 7, 11] }, { root: 55, ivs: [0, 3, 7, 10] }, { root: 52, ivs: [0, 4, 7, 10] }],
               transpose: 0, bright: 9800, reverb: 1.3, bpmMul: 1.14, leadType: "sawtooth", leadCut: 4200, sparkle: false },
      // finale — driving, dramatic, tense minor with a hard saw lead
      confluence: { chords: [{ root: 45, ivs: [0, 3, 7, 10] }, { root: 53, ivs: [0, 4, 7, 10] }, { root: 50, ivs: [0, 3, 7, 11] }, { root: 52, ivs: [0, 4, 7, 10] }],
               transpose: 0, bright: 13500, reverb: 1.25, bpmMul: 1.22, leadType: "sawtooth", leadCut: 5600, sparkle: true },
    };
    let prof = PROFILES.default;

    const frozenNow = () => elapsed < frozenUntil;
    // crawls during freeze, very slow on menu/loss, eases up while playing.
    // Arena (Bullet Hell) runs a faster, fixed-ish club tempo (Wipeout-style techno).
    // idle tempo breathes: a gentle section bump (chorus up, bridge down) + a slow LFO so the
    // pace cycles up AND down over the song rather than sitting flat. Still biome-flavoured.
    const idleBPM = () => {
      const pos = ((Math.floor(step / 16) % 32) + 32) % 32; // 32-bar song
      const sec = pos < 4 ? 0.95 : pos < 16 ? 1.0 : pos < 24 ? 1.08 : 0.93; // intro / verse / chorus / bridge
      return 100 * prof.bpmMul * sec * (1 + 0.07 * Math.sin(step * 0.004)); // long ~3-min tempo swell, up + down
    };
    const curBPM = () => (frozenNow() ? 28 : !running ? 40
      : mode === "arena" ? Math.min(140, 126 + elapsed * 0.12)
      : mode === "idle" ? idleBPM()
      : Math.min(132, 84 + elapsed * 0.6) * prof.bpmMul * (triumph ? 1.2 : 1)); // power-cache wave → quicker, upbeat

    // Wipeout-flavoured arena pattern data: driving minor changes + a rolling 16th
    // acid bassline (semitone offsets from the chord root; -1 = rest).
    const ARENA_CH = [
      { root: 45, ivs: [0, 3, 7, 10] }, // Am7
      { root: 50, ivs: [0, 3, 7, 10] }, // Dm7
      { root: 53, ivs: [0, 4, 7, 10] }, // F7
      { root: 52, ivs: [0, 4, 7, 11] }, // E (tension → pulls back to Am)
    ];
    const ARENA_BASS = [0, -1, 0, 12, -1, 0, 7, -1, 0, -1, 0, 3, -1, 7, 0, 12];

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
      music = ctx.createGain(); music.gain.value = 0.44; music.connect(mlp); music.connect(verb);
      fx = ctx.createGain(); fx.gain.value = 0.34; fx.connect(mlp); fx.connect(verb);
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

    // Wipeout-style driving techno for arena: punchy 4-on-the-floor, backbeat clap,
    // rolling 16th acid bass, offbeat hats, syncopated saw stabs + a bar pad.
    function scheduleArena(s, t) {
      // blend: Wipeout rhythm section (kick/clap/acid bass/hats) + the current BIOME's
      // harmony & lead timbre, so the music tracks whatever biome the background is in.
      const set = prof.chords, TR = (prof.transpose || 0) + 7; // biome chords, lifted a fifth
      const c = set[Math.floor(s / 16) % set.length], b = s % 16;
      const pitch = frozenNow() ? 0.5 : 1;
      if (b % 4 === 0) { // kick
        const k = ctx.createOscillator(), g = ctx.createGain();
        k.type = "sine"; k.frequency.setValueAtTime(124 * pitch, t); k.frequency.exponentialRampToValueAtTime(46 * pitch, t + 0.1);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.42, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        k.connect(g); g.connect(music); k.start(t); k.stop(t + 0.28);
        k.onended = () => { try { k.disconnect(); g.disconnect(); } catch {} };
      }
      if (b === 4 || b === 12) noiseHit(t, 0.16, 0.16, fx, 1700); // backbeat clap
      const bp = ARENA_BASS[b]; // rolling 16th acid bass (off the biome chord root)
      if (bp >= 0) {
        const acc = b % 4 === 0 ? 1 : 0.62;
        synth(mtof(c.root + bp - 12 + TR) * pitch, t, 0.14, { type: "sawtooth", gain: 0.17 * acc, detune: 7, voices: 2, cut: 560 + (b % 4 === 0 ? 1000 : 320), q: 10, attack: 0.004 });
      }
      noiseHit(t, b % 2 ? 0.05 : 0.02, b % 2 ? 0.02 : 0.011, music, 9200); // hats (open offbeat)
      if (b === 2 || b === 6 || b === 10 || b === 11 || b === 14) { // syncopated stab — biome lead timbre
        const note = c.root + c.ivs[ARP[b] % c.ivs.length] + 12 + TR;
        synth(mtof(note) * pitch, t, 0.4, { type: prof.leadType, gain: 0.06, detune: 13, voices: 3, cut: prof.leadCut, q: 5, attack: 0.01 });
      }
      if (b === 0) c.ivs.forEach((iv) => synth(mtof(c.root + iv + TR) * pitch, t, 2.2, { gain: 0.035, detune: 20, voices: 3, cut: 1400, q: 1.2, attack: 0.6 })); // pad
      if ((prof.sparkle || b % 4 === 2) && b % 2 === 0) { const n = c.root + c.ivs[ARP[b] % c.ivs.length] + 24 + TR; synth(mtof(n) * pitch, t, 0.16, { type: "square", gain: 0.03, detune: 4, voices: 1, cut: Math.max(6200, prof.leadCut), q: 2, attack: 0.005 }); } // shimmer (more in sparkly biomes)
    }

    // idle "song" motifs: [stepInBar, chordToneIndex, octaveOffset]
    const IDLE_RIFF = [[0, 0, 12], [3, 2, 12], [6, 1, 12], [8, 2, 12], [11, 3, 12], [14, 1, 12]];
    const IDLE_HOOK = [[0, 2, 24], [2, 3, 24], [4, 4, 24], [7, 3, 24], [8, 1, 24], [10, 2, 24], [12, 4, 24], [14, 5, 24]];
    const idleRnd = (seed) => { const x = Math.sin(seed * 12.9898 + 7.13) * 43758.5453; return x - Math.floor(x); }; // stable per-seed wobble
    // idle/screensaver: a longer, song-structured generative track — a 32-bar form of
    // intro → verse → chorus → bridge with riffs, a chorus hook + harmony, a wandering
    // solo, fills + risers, and tasteful per-bar variation (note drops, octave lifts,
    // grace turns) so it stays fresh without getting jarring. Biome profile drives chords,
    // lead timbre, brightness and tempo so each biome colours the song.
    function scheduleIdle(s, t) {
      const set = prof.chords, tr = prof.transpose;
      const bar = Math.floor(s / 16), b = s % 16, pos = ((bar % 32) + 32) % 32; // 32-bar song
      const intro = pos < 4, chorus = pos >= 16 && pos < 24, bridge = pos >= 24;
      const verse = !intro && !chorus && !bridge;            // bars 4–15: a long, evolving verse
      const lastBar = pos === 15 || pos === 31;              // section turnaround → fills
      const c = set[(bridge ? bar + 2 : bar) % set.length];  // bridge rotates the progression for contrast
      const root = c.root + tr, ivs = c.ivs;
      const tone = (i, oct) => mtof(root + ivs[((i % ivs.length) + ivs.length) % ivs.length] + oct);
      // kick — four-on-the-floor in verse/chorus, half-time in the bridge, none in intro
      if (!intro && b % 4 === 0 && (!bridge || b % 8 === 0)) {
        const k = ctx.createOscillator(), g = ctx.createGain();
        k.type = "sine"; k.frequency.setValueAtTime(95, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.12);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(chorus ? 0.34 : 0.26, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        k.connect(g); g.connect(music); k.start(t); k.stop(t + 0.32);
        k.onended = () => { try { k.disconnect(); g.disconnect(); } catch {} };
      }
      if ((verse || chorus) && (b === 4 || b === 12)) noiseHit(t, 0.18, chorus ? 0.16 : 0.12, fx, 1600); // backbeat clap
      if (!intro && b % 2 === 1) noiseHit(t, b % 4 === 3 ? 0.05 : 0.025, 0.016, music, 9500);             // hats
      if (lastBar && b >= 12) noiseHit(t, 0.06, 0.05, fx, 380 + (b - 12) * 320);                          // tom fill on the turnaround
      // bass — walks a little in the chorus for groove
      if (b === 0 || b === 8 || (chorus && (b === 6 || b === 14))) synth(mtof(root - 12 + (chorus && b === 14 ? 7 : 0)), t, b === 0 ? 1.2 : 0.7, { gain: 0.24, detune: 6, voices: 2, cut: 460, q: 4, attack: 0.03, sub: true });
      // pad (chord) — fuller/longer in chorus + bridge
      if (b === 0) ivs.forEach((iv) => synth(mtof(root + iv), t, bridge ? 3.4 : chorus ? 2.6 : 2.0, { gain: chorus ? 0.05 : 0.04, detune: 20, voices: 3, cut: chorus ? 1800 : 1300, q: 1.2, attack: bridge ? 1.2 : 0.6 }));
      // long drone bed every two bars
      if (s % 32 === 0) synth(mtof(root - 12), t, 6.4, { gain: 0.04, detune: 26, voices: 3, cut: 900, q: 1.0, attack: 1.8 });
      // gentle continuous arp (signals travelling the links)
      synth(tone(b * 3, 12), t, 0.16, { type: prof.leadType, gain: 0.025, detune: 4, voices: 1, cut: prof.leadCut * 0.85, q: 7, attack: 0.005 });
      // verse/chorus riff — biome lead timbre, with tasteful per-bar variation
      if (verse || chorus) for (const r of IDLE_RIFF) if (r[0] === b) {
        if (idleRnd(bar * 7 + b) < 0.12) continue;                       // occasionally drop a note → space to breathe
        const oct = r[2] + (idleRnd(bar * 3 + 1) < 0.28 ? 12 : 0);       // sometimes lift the phrase an octave
        synth(tone(r[1], oct), t, 0.42, { type: prof.leadType, gain: 0.07, detune: 10, voices: 2, cut: prof.leadCut, q: 5, attack: 0.01 });
      }
      // second half of the verse (bars 10–15): a wandering solo over the chord tones
      if (verse && pos >= 10 && b % 2 === 0 && idleRnd(s) < 0.6) {
        const deg = Math.floor(idleRnd(s * 1.7) * ivs.length * 2);       // random chord tone, up to an octave up
        synth(tone(deg, 12), t, 0.3, { type: prof.leadType, gain: 0.05, detune: 7, voices: 2, cut: prof.leadCut, q: 4, attack: 0.01 });
      }
      // chorus hook + a third of harmony + shimmer + a soaring high counter-melody
      if (chorus) {
        for (const r of IDLE_HOOK) if (r[0] === b) {
          synth(tone(r[1], r[2]), t, 0.5, { type: "triangle", gain: 0.07, detune: 6, voices: 2, cut: 7000, q: 2, attack: 0.01 });
          synth(tone(r[1] + 2, r[2]), t, 0.5, { type: "sine", gain: 0.04, detune: 5, voices: 2, cut: 6000, q: 2, attack: 0.02 });
        }
        if (b % 4 === 2) synth(tone(ARP[(b + bar) % ARP.length] + 4, 24), t, 0.6, { type: "sine", gain: 0.035, detune: 4, voices: 2, cut: 8000, q: 2, attack: 0.04 }); // counter-melody
        if (b % 2 === 0) synth(tone(ARP[b], 24), t, 0.18, { type: "square", gain: 0.03, detune: 4, voices: 1, cut: 9000, q: 2, attack: 0.005 }); // shimmer
      }
      // bridge: airy, sparse counter-arp + the occasional bell
      if (bridge && b % 2 === 0) synth(tone(ARP[(b + bar) % ARP.length], 12), t, 0.6, { type: "sine", gain: 0.04, detune: 8, voices: 2, cut: 3000, q: 2, attack: 0.08 });
      if (bridge && b === 6 && idleRnd(bar) < 0.5) synth(tone(2, 24), t, 0.8, { type: "sine", gain: 0.035, detune: 3, voices: 1, cut: 7000, q: 1.5, attack: 0.02 });
      // grace turn at the very end of a phrase (every 4 bars) → a little melodic lift
      if (pos % 4 === 3 && b >= 13) synth(tone(b - 13, 12), t, 0.16, { type: prof.leadType, gain: 0.04, detune: 5, voices: 1, cut: prof.leadCut, q: 5, attack: 0.005 });
      // riser sweep through the last bar before the chorus (bar 15)
      if (pos === 15 && b >= 8) noiseHit(t, 0.12, 0.01 + (b - 8) * 0.002, fx, 2000 + (b - 8) * 600);
    }

    function scheduleStep(s, t) {
      if (mode === "arena") return scheduleArena(s, t);
      if (mode === "idle") return scheduleIdle(s, t);
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
      // shield active, a sparkly biome, OR a power-cache wave → bright shimmer layer an octave up
      if ((bright || triumph || prof.sparkle) && b % 2 === 0) {
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

    // ramp the master brightness + reverb to the current biome profile.
    // long time-constant → the tonal shift glides over several seconds (slow musical
    // crossfade) instead of snapping when the biome changes.
    function applyProf() {
      if (!ctx) return;
      const tc = mode === "idle" ? 8 : mode === "arena" ? 0.4 : 3.3; // idle ~24s glide; others ~10s; arena = original snappy 0.4 (untouched)
      mlp.frequency.setTargetAtTime(bright ? Math.max(prof.bright, 14000) : prof.bright, ctx.currentTime, tc);
      if (vg) vg.gain.setTargetAtTime(prof.reverb, ctx.currentTime, tc);
    }

    return {
      resume() { ensure(); if (ctx.state === "suspended") ctx.resume(); },
      startMusic() { ensure(); applyProf(); if (playing) return; playing = true; step = 0; nextNote = ctx.currentTime + 0.1; timer = setInterval(tick, 25); },
      setBiome(key) { prof = PROFILES[key] || PROFILES.default; applyProf(); },
      sfx(name) {
        if (!ctx || mode === "idle") return; // idle/screensaver: music only, no sound-effects
        const t = ctx.currentTime;
        if (name === "gem") {                 // rising shimmer arpeggio
          [0, 4, 7, 12].forEach((iv, i) => synth(mtof(72 + iv), t + i * 0.045, 0.22, { type: "triangle", gain: 0.2, detune: 6, voices: 2, cut: 6500, q: 3, dest: fx }));
        } else if (name === "blast") {        // riser + boom + noise burst
          synth(140, t, 0.75, { gain: 0.4, detune: 22, voices: 3, glide: 32, cut: 1800, q: 3, sub: true, dest: fx });
          synth(280, t, 0.5, { type: "square", gain: 0.16, glide: 2400, cut: 6000, dest: fx });
          noiseHit(t, 0.55, 0.4, fx, 280);
        } else if (name === "boom") {         // soft, low explosion thud (Missile)
          synth(80, t, 0.42, { type: "sine", gain: 0.32, glide: 34, cut: 600, q: 1.2, sub: true, dest: fx });
          noiseHit(t, 0.22, 0.14, fx, 160);
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
      setShield(on) { bright = on; if (mlp) mlp.frequency.setTargetAtTime(on || triumph ? 16000 : prof.bright, ctx.currentTime, 0.12); },
      setTriumph(on) { triumph = on; if (mlp) mlp.frequency.setTargetAtTime(on || bright ? 16000 : prof.bright, ctx.currentTime, 0.3); }, // power-cache wave → brighter + (via curBPM) quicker
    };
  }

  // touch devices: smaller arena is harder, so ease difficulty, float the
  // player above the fingertip, and shorten the webs
  const MOBILE = window.matchMedia("(pointer: coarse)").matches;
  const LINK_SCALE = MOBILE ? 0.6 : 1;   // shorter webs on small screens → fewer lethal lines, more gaps
  const GROUP_SCALE = MOBILE ? 0.7 : 1;  // tighter clumps on small screens → nodes ball up, opening dodge lanes

  let w, h, dpr = 1, linkD2, scatLinkD2, arenaScale = 1, uiScale = 1;
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
    scatLinkD2 = linkD2 * SCAT_WEB * SCAT_WEB; // scatterer-scatterer webs reach further
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
      for (const p of weaponPickups) { p.x *= sx; p.y *= sy; }
      for (const p of buffPickups) { p.x *= sx; p.y *= sy; }
      for (const bl of bullets) { bl.x *= sx; bl.y *= sy; }
      for (const eb of enemyBullets) { eb.x *= sx; eb.y *= sy; }
      for (const b of bosses) { b.x *= sx; b.y *= sy; }
      for (const s of shocks) { s.x *= sx; s.y *= sy; }
      sc(star); sc(ice); sc(shield); sc(shooter);
      // NB: do NOT rescale patOffX/Y here — the pattern phase is dpr-normalised at draw
      // (see paintPattern), so leaving the CSS-px offset alone keeps it from rephasing on resize.
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
    if (mode === "idle" && running) { backToMenu(); return; } // tap/click anywhere to leave the screensaver
    if (paused) { togglePause(); return; } // tap anywhere (not a control) to resume
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    anchor = (e.touches || e.pointerType === "touch")
      ? { fx: t.clientX * dpr, fy: t.clientY * dpr, px: player.x, py: player.y }
      : null;
  }
  function movePointer(e) {
    if (mode === "idle") return; // no cursor control in idle — the player drifts on its own
    const t = e.touches ? e.touches[0] : e;
    if (!t) return;
    if (mode === "arena") { aimX = t.clientX * dpr; aimY = t.clientY * dpr; return; } // arena: mouse aims, WASD moves
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

  // arena (Bullet Hell): WASD steering + hold-to-fire. Only active while mode === "arena".
  const arenaKeyMap = { w: "w", a: "a", s: "s", d: "d", arrowup: "w", arrowleft: "a", arrowdown: "s", arrowright: "d" };
  addEventListener("keydown", (e) => {
    if (mode !== "arena" || !running) return;
    const k = arenaKeyMap[e.key.toLowerCase()];
    if (k) { arenaKeys[k] = true; e.preventDefault(); }
  });
  addEventListener("keyup", (e) => {
    const k = arenaKeyMap[e.key.toLowerCase()];
    if (k) arenaKeys[k] = false;
  });
  // autofire always; holding the mouse is a temporary ceasefire (hold = hold fire)
  addEventListener("mousedown", (e) => {
    if (mode !== "arena" || !running || paused) return;
    if (e.target && e.target.closest && e.target.closest("button, a, .mute")) return;
    if (e.button === 0) { fireHold = true; aimX = e.clientX * dpr; aimY = e.clientY * dpr; }
  });
  addEventListener("mouseup", (e) => { if (e.button === 0) fireHold = false; });

  let hunters = [];
  let hunterId = 0;           // stable per-node id, for tracking link ages
  let links = []; // {a,b,al,same} built in physics, drawn in drawScene (one pass, not two)
  let linkAges = new Map();   // pairKey -> seconds that web has existed (pairKey = idLo*LINK_KEY + idHi)
  let linkAgesNext = new Map(); // double-buffered with linkAges + swapped each frame → no per-frame Map alloc
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

  // ---- arena (Bullet Hell, desktop only): WASD move + mouse aim, weapon types, buffs ----
  const arenaKeys = { w: false, a: false, s: false, d: false };
  let aimX = 0, aimY = 0;              // mouse aim target (canvas px)
  let fireHold = false;               // mouse held → temporary ceasefire (autofire is on by default)
  let weapon = "dart", weaponLvl = 1; // current weapon kind + its level (mirror of weaponLvls[weapon])
  let weaponLvls = { dart: 1 };       // per-kind levels persist across switches within a run
  let startWeapon = "dart";           // chosen on the Bullet Hell weapon-select screen
  let nextWeaponDrop = 0, nextBuffDrop = 0;
  let weaponPickups = [], buffPickups = []; // {x, y, t, kind, born} — multiple at once, despawn after PICKUP_TTL
  const buffs = { frenzy: 0, power: 0, bounce: 0, overdrive: 0, blade: 0, dual: 0, shield: 0, repel: 0 }; // each holds the elapsed time it expires at
  let dualWeapon = "dart", nextDual = 0; // Dual-wield buff: a second weapon fired alongside the main
  let bladeAng = 0, bladeVel = 0; // melee blade angle + angular velocity (follows mouse w/ momentum; Blade buff)
  let nextCluster = 0;            // arena: timer for spawning tight node clusters
  let nextArenaBoss = 0, arenaBossIdx = 0; // boss spawn cadence + which archetype is next
  let bossSpawnAt = 0, flashFrom = 0, flashUntil = 0, flashCol = "255,40,60", lowHpFrom = 1e9; // warning/flash timing
  let playerHp = 1, playerMaxHp = 1;  // arena: multiple hits before death (other modes stay one-hit)
  let surge = 0;                      // arena adaptive heat: rises while you keep the screen clear, ramps spawns/HP
  let regenShield = true, regenReadyAt = 0; // arena: passive shield that soaks a hit, recharges over 2s
  const PICKUP_TTL = 9;               // seconds an uncollected weapon/buff pickup lingers before fading
  const WEAPON_MAXLVL = 10;
  // base weapon stats; leveling scales these (see weaponStats) — fire gap, projectile
  // speed, bullet radius, pellet count, fan spread (rad), pierce count, damage.
  const WEAPONS = {
    dart:   { name: "Dart",   gap: 0.15, spd: 820, r: 5,  count: 1, spread: 0,    pierce: 1, dmg: 3.2, homing: false },
    spread: { name: "Spread", gap: 0.30, spd: 700, r: 5,  count: 3, spread: 0.30, pierce: 0, dmg: 2.3, homing: false },
    rapid:  { name: "Rapid",  gap: 0.06, spd: 1000, r: 3.5, count: 1, spread: 0.13, pierce: 1, dmg: 1.5, homing: false },
    homing: { name: "Seeker", gap: 0.30, spd: 560, r: 6,  count: 1, spread: 0,    pierce: 0, dmg: 2.4, homing: true },
    ricochet:{ name: "Ricochet", gap: 0.32, spd: 660, r: 5, count: 1, spread: 0,  pierce: 1, dmg: 3.2, homing: false, bounce: true },
    mortar: { name: "Missile", gap: 0.5,  spd: 540, r: 4, count: 1, spread: 0,    pierce: 0, dmg: 5.5, homing: true, explode: true, turn: 1.6 },
    wave:   { name: "Wave",   gap: 0.46, spd: 400, r: 6, count: 1, spread: 0,    pierce: 8, dmg: 3, homing: false },
  };
  const WEAPON_KINDS = ["dart", "spread", "rapid", "homing", "ricochet", "mortar", "wave"]; // droppable weapon kinds
  const BUFF_KINDS = ["shield", "frenzy", "power", "bounce", "freeze", "heal", "heal", "heal", "levelup", "overdrive", "blade", "dual", "starbomb", "repel"]; // heal weighted up (spawns more)
  const ARENA_BOSSES = ["spiral", "burst", "charger", "splitter", "weaver"];

  // effective weapon stats for the current kind + level. Each level: bigger bullets,
  // faster cadence, +10% damage; plus a kind-specific bump (spread → more/wider pellets,
  // wave → an extra simultaneous wave every 3 levels, lance → +1 pierce, dart/rapid → extra stream).
  function weaponStats(lvlOverride, kindOverride) {
    const wk = kindOverride || weapon, b = WEAPONS[wk], lvl = lvlOverride || weaponLvl;
    const s = {
      name: b.name,
      gap: Math.max(0.04, b.gap * Math.pow(0.89, lvl - 1)),
      spd: b.spd * (1 + 0.06 * (lvl - 1)),
      r:   b.r * (1 + 0.05 * (lvl - 1)),     // bigger bullets every level (gentle so high levels don't fill the screen)
      count: b.count,
      spread: b.spread,
      pierce: b.pierce,
      dmg: b.dmg * (1 + 0.16 * (lvl - 1)),   // +16% damage per level
      waves: 1,
    };
    if (wk === "spread") { s.count = Math.min(13, b.count + (lvl - 1)); s.spread = b.spread + 0.05 * (lvl - 1); } // more pellets, wider fan
    // wave stays a single crescent — its reach/arc grow with level (handled in fireWeapon)
    else if (wk === "rapid") s.count = lvl >= 4 ? 2 : 1;                // twin stream at high level
    else if (wk === "homing") s.count = lvl >= 6 ? 2 : 1; // at most two seekers (kept cheap + not OP)
    else if (wk === "ricochet") { s.count = lvl >= 4 ? 2 : 1; s.pierce = b.pierce + Math.floor((lvl - 1) / 2); } // more ricochets + punches through
    else if (wk === "dart") { s.count = Math.min(8, lvl); s.cross = lvl >= 2; } // +1 evenly-spread direction per level (Lv2 = front+back …)
    return s;
  }

  // fire one weapon (kind + level) toward the aim with slight autoaim — used by the main
  // weapon and, while Dual-wield is active, the second weapon. Caller handles cadence + sfx.
  function fireWeapon(wk, lvl) {
    const ws = weaponStats(lvl, wk), power = buffs.power > elapsed;
    const bspd = ws.spd * dpr * arenaScale;
    const r = ws.r * (power ? 1.4 : 1) * 1.3 * dpr;
    const pierce = ws.pierce + (power ? 3 : 0);
    const bounce = buffs.bounce > elapsed || WEAPONS[wk].bounce;
    const dmg = ws.dmg * (power ? powerMul() : 1);
    let base = Math.atan2(aimY - player.y, aimX - player.x), cone = 0.16, adj = 0;
    for (const hn of hunters) { if (hn.dead) continue; let da = Math.atan2(hn.y - player.y, hn.x - player.x) - base; while (da > Math.PI) da -= 6.283185; while (da < -Math.PI) da += 6.283185; if (Math.abs(da) < cone) { cone = Math.abs(da); adj = da; } }
    for (const b of bosses) { let da = Math.atan2(b.y - player.y, b.x - player.x) - base; while (da > Math.PI) da -= 6.283185; while (da < -Math.PI) da += 6.283185; if (Math.abs(da) < cone) { cone = Math.abs(da); adj = da; } }
    base += adj * (wk === "mortar" ? 0.1 : 0.35); // missile barely auto-aims — fires where you point
    const maxed = lvl >= WEAPON_MAXLVL, wcol = WEAPON_COLOR[wk] || "150,255,210";
    const expl = WEAPONS[wk].explode, boom = expl ? (95 + lvl * 8) * dpr * arenaScale : 0;
    const knock = (260 + lvl * 16) * dpr; // bullets shove surviving nodes hard (physics w/ the HP system)
    if (wk === "wave") {
      // a crescent made of discrete fat segments fanned across an arc — each segment is
      // its own projectile (absorbed after a pierce or two, and bounces with the buff).
      // The fan visibly shows the firing angle; arc width + segment count grow with level.
      const wspd = ws.spd * dpr * arenaScale, half = Math.min(1.1, 0.55 + (lvl - 1) * 0.045);
      const segs = 7 + Math.floor(lvl * 0.9);
      const wr = (5 + ws.r * 0.6) * (power ? 1.3 : 1) * dpr;
      const wPierce = power ? 1 : 0; // absorbed on first hit (Power lets it punch one extra)
      for (let k = 0; k < segs; k++) {
        const a = base + (segs === 1 ? 0 : (k / (segs - 1) - 0.5) * 2 * half);
        bullets.push({ x: player.x, y: player.y, vx: Math.cos(a) * wspd, vy: Math.sin(a) * wspd, life: bounce ? 2.3 : 1.25, r: wr, pierce: wPierce, dmg, bounce, knock, spd: wspd, col: wcol, kind: "wave", rainbow: maxed, hitB: null });
      }
    } else {
      const homing = WEAPONS[wk].homing, n = ws.count, fan = ws.spread || (n > 1 ? 0.12 : 0), angles = [];
      if (ws.cross) { for (let k = 0; k < n; k++) angles.push(base + k * (6.283185 / n)); } // evenly around the circle
      else for (let k = 0; k < n; k++) angles.push(base + (n === 1 ? 0 : (k / (n - 1) - 0.5) * fan) + (Math.random() * 2 - 1) * fan * 0.12);
      const turn = WEAPONS[wk].turn || 7;
      for (const a of angles) bullets.push({ x: player.x, y: player.y, vx: Math.cos(a) * bspd, vy: Math.sin(a) * bspd, life: bounce ? 3.8 : homing ? 2.6 : 1.4, r, pierce, dmg, bounce, homing, turn, explode: expl, boom, knock, spd: bspd, col: wcol, kind: wk, rainbow: maxed, hitB: null });
    }
  }

  // ---- modes: classic (endless), waves (themed waves), journey (story levels) ----
  // `mode` is declared near the top (needed during initial loadBest()).
  let wave = 0, waveEndsAt = 0, waveType = "themed"; // waves mode
  let themeColor = null;            // dominant spawn colour this wave/level (null = all)
  let bossWave = false;             // current wave/level features the boss
  let journeyIdx = 0, levelEndsAt = 0; // journey mode
  let introUntil = 0;                  // journey: brief held intro so you can read the title before the swarm moves
  let idleDisperse = 0;                // idle: until-time during which dense groups push apart (spread out, no wipe)
  let journeyTime = 0, journeyPts = 0; // journey: time + points banked from cleared levels (score persists across levels)
  let frozenAccum = 0, waveRampStart = 0; // seconds spent frozen (excluded from the speed ramp)
  let biomeFade = 1, prevBiome = null, biomeFadeRate = 1.6; // crossfade between biomes (0→1)
  let pattern = null;                     // subtle background pattern — own clock, independent of biome
  let patternDir = 0;                     // random drift direction for the pattern (radians)
  let pendingPattern = null, pendingDir = 0; // next pattern, applied only when faded to ~invisible
  let patOffX = 0, patOffY = 0;           // continuously accumulated pattern offset (no teleport on dir change)
  let nextBiomeAt = 0;              // classic: time of the next slow biome shift
  const PATTERN_KEYS = ["none", "grid", "dots", "rings", "diag", "weave", "cross", "wave", "hex", "tri", "diamond", "chevron", "scales"];
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
      plot: "You wake as a stray node in the Lattice — a living grid of data. A node's colour is its nature.",
      enemy: "Purple nodes are Chasers — they turn and bolt straight at you." },
    { name: "The Timid",  color: "255,138,96",  len: 38, boss: false, biome: "toxic",
      plot: "Deeper into the grid the air turns acrid. Something down here is afraid of you.",
      enemy: "Orange nodes are Shy Ones — bold at range, they flinch and back off when you crowd them." },
    { name: "Drift",      color: "120,196,255", len: 40, boss: false, biome: "void",
      plot: "Past the dense core the Lattice thins to an open void where signals barely hold.",
      enemy: "Blue nodes are Scatterers — they barely chase, but the webs strung between them still bite." },
    { name: "The Ambush", color: "255,106,213", len: 36, boss: false, biome: "rose",
      plot: "Word of you spreads through the mesh. Now the grid hunts back — and it has learned your habits.",
      enemy: "Pink nodes are Ambushers — they cut ahead to where you're going, not where you are." },
    { name: "Static",     color: "34,211,238",  len: 38, boss: false, biome: "ice",
      plot: "The signal frays in the cold. Nothing moves in a straight line this deep.",
      enemy: "Cyan nodes are Erratics — they spiral and jitter, never quite where you expect." },
    { name: "Hivemind",   say: "Hive mind", color: "255,248,120", len: 40, boss: false, biome: "ember",
      plot: "The grid runs hot near the swarm-nests, where many nodes think as one.",
      enemy: "Yellow nodes are the Hive — they clump tight and grow as one drifting mass." },
    { name: "The Warden", color: "199,116,232", len: 42, boss: true, biome: "void",
      plot: "A sealed gateway looms. Something vast stirs in the dark, and it knows you're here.",
      enemy: "The Warden hunts with patterns you haven't seen — read its attack, then catch it in a star-blast." },
    { name: "Confluence", color: null, len: 45, boss: true, bossCount: 3, shooter: true, biome: "confluence",
      plot: "The core. Every colour of the Lattice converges here at once. This is where it ends.",
      enemy: "The core's guardians come at you as one — every attack the Lattice has. Outlast the storm, blast them apart." },
  ];

  function rand(a, b) { return a + Math.random() * (b - a); }

  // spawn a hunter just off a random edge, drifting inward
  function spawnHunter() {
    const edge = (Math.random() * 4) | 0;
    const m = (mode === "arena" ? 60 : 20) * dpr; // arena nodes are big → start well off-screen
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -m; }
    else if (edge === 1) { x = w + m; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + m; }
    else { x = -m; y = rand(0, h); }
    // themed waves/levels bias most spawns to the theme colour for a clear identity
    const color = (themeColor && Math.random() < 0.72)
      ? themeColor
      : PALETTE[(Math.random() * PALETTE.length) | 0];
    const r0 = rand(2.6, 4.4) * dpr * (mode === "arena" ? 1.85 : 1); // arena: chunkier nodes (easier to hit)
    hunters.push({
      id: hunterId++,
      x, y, vx: 0, vy: 0,
      r: r0, r0, // r is the live (grown) radius; r0 the spawn base
      color,
      p: PERSONA[color],
      seed: rand(0, 6.283185), // phase offset so same-kind nodes desync
      joltCd: 0,
      age: 0,
      hp: nodeHp(),
      life: rand(35, 60), // seconds before a lone node gives up and flies off
    });
  }

  // HUD points — journey shows the running total (banked + current level), so it persists across levels
  const showPts = () => { ptsEl.textContent = String(points + (mode === "journey" ? journeyPts : 0)); };

  // arena nodes have HP that scales with time + weapon level (1 elsewhere → one-shot)
  const nodeHp = () => (mode === "arena" ? 1 + Math.floor(elapsed / 20) + Math.floor((weaponLvl - 1) / 3) + Math.floor(surge * 1.5) : 1);

  // arena: drop a tight same-colour blob just off an edge → drifts in as a tanky clump
  function spawnCluster() {
    const edge = (Math.random() * 4) | 0, m = 80 * dpr;
    let cx, cy;
    if (edge === 0) { cx = rand(w * 0.15, w * 0.85); cy = -m; }
    else if (edge === 1) { cx = w + m; cy = rand(h * 0.15, h * 0.85); }
    else if (edge === 2) { cx = rand(w * 0.15, w * 0.85); cy = h + m; }
    else { cx = -m; cy = rand(h * 0.15, h * 0.85); }
    const color = PALETTE[(Math.random() * PALETTE.length) | 0];
    const n = 5 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const a = rand(0, 6.283185), rr = rand(0, 42) * dpr, r0 = rand(2.6, 4.4) * dpr * 1.85;
      hunters.push({ id: hunterId++, x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr, vx: 0, vy: 0, r: r0, r0, color, p: PERSONA[color], seed: rand(0, 6.283185), joltCd: 0, age: 0, hp: nodeHp() + 1, life: rand(45, 75) });
    }
  }
  // apply damage; clumped nodes (many same-colour neighbours) shrug off more → tankier in packs
  const hurtNode = (hn, dmg) => { hn.hp -= dmg / (1 + (hn.snb || 0) * 0.12); return hn.hp <= 0; };
  // Power buff damage multiplier — strength grows with the run (duration stays fixed)
  const powerMul = () => 1.5 + Math.min(1.6, elapsed * 0.011);
  // arena boss death: burst rings, a shower of point diamonds, and a chance at a Level Up
  function bossDrop(x, y) {
    if (mode !== "arena") return;
    shocks.push({ x, y, t: 0, max: 180 * dpr, rainbow: true });        // extra burst ring
    shocks.push({ x, y, t: 0, max: 110 * dpr });                        // inner flash
    if (Math.random() < 0.6) { const n = 3 + ((Math.random() * 5) | 0); for (let i = 0; i < n; i++) gems.push({ x: x + rand(-44, 44) * dpr, y: y + rand(-44, 44) * dpr, t: 0 }); } // point diamonds
    if (Math.random() < 0.5) buffPickups.push({ x, y, t: 0, kind: "levelup", born: elapsed });
  }

  // apply a collected buff at (x,y)
  function applyBuff(k, x, y) {
    if (k === "shield") { buffs.shield = elapsed + 9; audio.setShield(true); audio.sfx("shield"); }
    else if (k === "freeze") { frozenUntil = elapsed + 4; audio.sfx("freeze"); shocks.push({ x, y, t: 0, max: 320 * dpr, ice: true }); }
    else if (k === "heal") { playerHp = Math.min(playerMaxHp, playerHp + 1); audio.sfx("shield"); }
    else if (k === "levelup") { weaponLvls[weapon] = weaponLvl + 1; weaponLvl = weaponLvls[weapon]; audio.sfx("blast"); say(WEAPONS[weapon].name + ", level " + weaponLvl); }
    else if (k === "dual") { const pool = WEAPON_KINDS.filter((x2) => x2 !== weapon); dualWeapon = pool[(Math.random() * pool.length) | 0]; buffs.dual = elapsed + 11; nextDual = 0; audio.sfx("blast"); }
    else if (k === "starbomb") { starBlast(); }
    else if (k === "repel") { buffs.repel = elapsed + 8; audio.sfx("freeze"); shocks.push({ x: player.x, y: player.y, t: 0, max: 460 * dpr, shield: true }); } // timed keep-away field
    else { buffs[k] = elapsed + 9; audio.sfx("blast"); } // frenzy / power / bounce
    if (k !== "levelup") say(BUFF_NAME[k] || k); // levelup already announced weapon + new level
    shocks.push({ x, y, t: 0, max: 130 * dpr, shield: true });
  }

  // Missile explosion — an expanding star-bomb-style shock: the front clears nodes it
  // reaches and chips bosses once (dmg). Handled by the shock-kill pass in drawScene.
  function explode(x, y, rad, dmg) {
    shocks.push({ x, y, t: 0, max: rad, kill: true, rainbow: true, dmg, hitB: new Set() });
    audio.sfx("boom");
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
    showPts();
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
    // arena state
    weapon = mode === "arena" ? startWeapon : "dart"; weaponLvl = 1; weaponLvls = { [weapon]: 1 };
    weaponPickups = []; buffPickups = [];
    nextWeaponDrop = 3 + Math.random() * 2; nextBuffDrop = 2.5 + Math.random() * 2;
    arenaKeys.w = arenaKeys.a = arenaKeys.s = arenaKeys.d = false; fireHold = false;
    buffs.frenzy = buffs.power = buffs.bounce = buffs.overdrive = buffs.blade = buffs.dual = buffs.shield = buffs.repel = 0; bladeAng = 0; bladeVel = 0; nextDual = 0;
    arenaBossIdx = 0; nextArenaBoss = 12 + Math.random() * 4; bossSpawnAt = 0; flashUntil = 0; lowHpFrom = 1e9;
    playerMaxHp = mode === "arena" ? 5 : 1; playerHp = playerMaxHp;
    regenShield = true; regenReadyAt = 0; surge = 0;
    player.vx = 0; player.vy = 0;
    player.x = w / 2; player.y = h / 2; player.px = player.x; player.py = player.y;
    aimX = w / 2; aimY = h * 0.3;
    dead = false;
    introUntil = 0; // only journey levels set a held intro (below); everything else starts live
    idleDisperse = 0; // idle screensaver: dense-group spread-out timer
    // per-mode setup
    wave = 0; themeColor = null; bossWave = false; banner = null;
    biome = null; prevBiome = null; pattern = null; biomeFade = 1;
    if (mode === "waves") nextWave(0);
    else if (mode === "journey") setupJourneyLevel();
    else if (mode === "arena") setupArena();
    else { pickBiome(true, true); scheduleBiomeShift(); } // classic → slow drifting biomes (fade in)
    for (let i = 0; i < 3; i++) spawnHunter();
  }

  // arena: pick a biome and seed the field (endless survival, like classic but you shoot back)
  function setupArena() {
    pickBiome(true, false); scheduleBiomeShift();
    banner = { big: "BULLET HELL", sub: "WASD to move · autofires at your aim", until: 3.2 };
    nextCluster = 6 + Math.random() * 4;
    say("Bullet hell"); say(WEAPONS[startWeapon].name);
  }

  const BOSS_VAL = 50; // points for destroying the boss
  function spawnBoss(forceColor, shooter, kind, hp) {
    const edge = (Math.random() * 4) | 0;
    const m = 150 * dpr; // clear the boss radius + corona (charger ram is long) so it floats in from off-screen
    let x, y;
    if (edge === 0) { x = rand(0, w); y = -m; }
    else if (edge === 1) { x = w + m; y = rand(0, h); }
    else if (edge === 2) { x = rand(0, w); y = h + m; }
    else { x = -m; y = rand(0, h); }
    const color = forceColor || PALETTE[(Math.random() * PALETTE.length) | 0];
    bosses.push({ x, y, vx: 0, vy: 0, r: (kind ? 30 : shooter ? 26 : 22) * dpr, t: 0, color, p: PERSONA[color],
      seed: rand(0, 6.283185), shooter: !!shooter, fireCd: 1.6,
      kind: kind || null, hp: hp || 0, maxHp: hp || 0, spin: 0, chargeCd: 2.2, dashing: 0 });
  }

  // arena: rotate through boss archetypes; hp scales with how long you've survived
  function spawnArenaBoss() {
    const kind = ARENA_BOSSES[(Math.random() * ARENA_BOSSES.length) | 0]; // random archetype each spawn
    const color = PALETTE[(Math.random() * PALETTE.length) | 0];
    const hp = Math.round((10 + elapsed * 1.5) * (1 + (weaponLvl - 1) * 0.08)); // tougher as your weapon levels
    spawnBoss(color, kind === "spiral" || kind === "burst" || kind === "weaver", kind, hp);
  }

  // burst a cluster of same-colour nodes outward from a point (boss death → its swarm)
  function popInto(x, y, color, count) {
    for (let k = 0; k < count; k++) {
      const r0 = rand(2.6, 4.4) * dpr * (mode === "arena" ? 1.85 : 1);
      const ang = rand(0, 6.283185), spd = rand(180, 420) * dpr;
      hunters.push({
        id: hunterId++,
        x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
        r: r0, r0,
        color,
        p: PERSONA[color],
        seed: rand(0, 6.283185),
        joltCd: 0, age: 0,
        hp: nodeHp(),
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
    prevBiome = biome;
    biome = BIOMES[bkey];
    // pattern is NOT touched here — it lives on its own clock (see drawBiome), so biome and
    // pattern change independently at different rates
    biomeFade = fade ? 0 : 1;
    biomeFadeRate = mode === "idle" ? 0.1 : slow ? 0.13 : 1.6; // idle: ~10s crossfade; classic ~8s; others snappy
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
    audio.setTriumph(waveType === "special"); // power-cache wave → upbeat, quicker music
    banner = { big: "WAVE " + wave, sub, until: now + 2.4 };
    // voiceover: announce the wave by number + flavour
    say(bossWave ? "Wave " + wave + ". " + sub.replace(" · ", ", ")
      : waveType === "special" ? "Wave " + wave + ". Power cache"
      : themeColor ? "Wave " + wave + ". " + (PERSONA_NAME[themeColor] || "")
      : "Wave " + wave);
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
    // pattern runs on its own independent clock (see drawBiome) — not reset per level
    audio.setBiome(L.biome);
    introUntil = 1.4;                 // hold the swarm briefly so the title/enemy text can be read
    levelEndsAt = L.len + introUntil; // ...and don't charge the held time against the survival clock
    // title fades out by `until`; the enemy line lingers to `subUntil`, then fades slowly
    banner = { big: L.name.toUpperCase(), sub: L.enemy, from: 0, until: 2.8, subUntil: 5.2 };
    say(L.say || L.name); // voiceover: announce the level name (L.say = TTS-only spelling, e.g. "Hive mind")
    if (L.boss) {
      bosses = []; enemyBullets = [];
      const n = L.bossCount || 1;
      // distinct colours per boss when the level has no single theme (Confluence)
      const pool = PALETTE.slice().sort(() => Math.random() - 0.5);
      // give each boss a bullet-hell archetype (charger/spiral/burst/weaver/splitter) for varied
      // behaviour — hp stays 0 so a star-blast still pops them in one hit, as before
      const kinds = ARENA_BOSSES.slice().sort(() => Math.random() - 0.5);
      for (let i = 0; i < n; i++) spawnBoss(themeColor || pool[i % pool.length], false, kinds[i % kinds.length]);
      nextStar = introUntil + 6; // delay the first star — let the fight open before you can blast (was ~immediate)
      while (hunters.length < (MOBILE ? 12 : 18)) spawnHunter();
    }
  }

  // journey: a level cleared → next plot card, or the win screen
  function levelComplete() {
    running = false;
    audio.sfx("shield"); // little fanfare
    journeyTime += elapsed; journeyPts += points; // bank this level's score → carries to the next
    journeyIdx++;
    if (journeyIdx >= JOURNEY.length) {
      winPanel.hidden = false; document.body.classList.remove("playing");
      audio.sfx("blast"); winCelebrate();
      say("Freedom"); // journey-complete voiceover (matches the FREEDOM panel)
      recordWin(); // log the full-run score + offer a leaderboard submit on the win screen
    } else showPlot();
  }

  // journey complete: log the whole-run score (banked time + points) and offer a submit
  function recordWin() {
    const totalTime = journeyTime, totalPts = journeyPts, score = totalTime + totalPts;
    lastRun = { score, time: totalTime, points: totalPts };
    const isBest = score > best;
    if (isBest) { best = score; localStorage.setItem(bestKey(), best.toFixed(2)); bestEl.textContent = best.toFixed(1); }
    winVerdictEl.textContent = "Run score " + score.toFixed(1) + " · " + totalTime.toFixed(1) + "s · ◆ " + totalPts + (isBest ? " · New best! 🏆" : " · Best " + best.toFixed(1));
    winStatusEl.textContent = "";
    winSubmitBtn.disabled = false;
    winLbSubmitEl.hidden = false;
    loadBoard(undefined, winView);
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
    if (mode === "idle") return false;              // idle/screensaver: nodes pass through, nothing kills
    if (elapsed < invulnUntil) return false;        // i-frames
    if (buffs.shield > elapsed) {                   // timed Shield buff — soaks every hit for its duration
      invulnUntil = elapsed + 0.5;
      shocks.push({ x: player.x, y: player.y, t: 0, max: 200 * dpr, shield: true });
      for (const hn of hunters) { const dx = hn.x - player.x, dy = hn.y - player.y, d = Math.hypot(dx, dy) || 1; if (d < 300 * dpr) { const k = 700 * dpr; hn.vx += (dx / d) * k; hn.vy += (dy / d) * k; } }
      return false;
    }
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
    if (mode === "arena") {
      if (regenShield) { // recharging shield soaks the hit — no life lost; recharges in 2s
        regenShield = false; regenReadyAt = elapsed + 4;
        invulnUntil = elapsed + 0.8;
        shocks.push({ x: player.x, y: player.y, t: 0, max: 260 * dpr, shield: true });
        for (const hn of hunters) { const dx = hn.x - player.x, dy = hn.y - player.y, d = Math.hypot(dx, dy) || 1; if (d < 360 * dpr) { const k = 1100 * dpr; hn.vx += (dx / d) * k; hn.vy += (dy / d) * k; } }
        audio.sfx("freeze");
        return false;
      }
      // arena: chip a life, brief i-frames + a shove so a swarm can't drain you instantly
      playerHp--;
      invulnUntil = elapsed + 1.2;
      flashFrom = elapsed; flashUntil = Math.max(flashUntil, elapsed + 0.5); flashCol = "255,40,60"; // red edge flash on every hit
      shocks.push({ x: player.x, y: player.y, t: 0, max: 340 * dpr });
      for (const hn of hunters) { // hard shove — clear breathing room after a hit
        const dx = hn.x - player.x, dy = hn.y - player.y, d = Math.hypot(dx, dy) || 1;
        if (d < 440 * dpr) { const k = 1500 * dpr; hn.vx += (dx / d) * k; hn.vy += (dy / d) * k; }
      }
      audio.sfx("freeze");
      if (playerHp === 1) { lowHpFrom = elapsed; say(["Critical", "Energy critical", "Warning, low energy"][(Math.random() * 3) | 0]); } // last life
      return playerHp <= 0; // dead only when the last life is gone
    }
    return true;
  }

  // collect a star → expanding shockwave that destroys nodes as it reaches them
  function starBlast() {
    // smaller reach on mobile so it doesn't engulf the whole (small) screen
    const reach = (MOBILE ? 260 : mode === "journey" || mode === "waves" ? 380 : 460) * dpr * arenaScale * (1 + Math.min(1, elapsed / 120)); // bigger blast later; journey + waves desktop dialled back
    shocks.push({ x: player.x, y: player.y, t: 0, max: reach, rainbow: true, kill: true, fat: true });
    audio.sfx("blast");
    star = null;
  }

  function start() {
    reset();
    audio.resume(); audio.startMusic(); audio.sfx("start"); // gesture → unlock audio
    if (mode === "classic") say("Classic"); // waves/journey/arena announce their wave/level/mode in their own setup
    startPanel.hidden = true;
    overPanel.hidden = true;
    helpPanel.hidden = true;
    plotPanel.hidden = true;
    winPanel.hidden = true;
    arenaStartPanel.hidden = true;
    document.body.classList.add("playing"); // hide cursor mid-run
    document.body.classList.toggle("idle", mode === "idle"); // idle → hide HUD chrome
    playerAlpha = 0; // fade the player in
    running = true; paused = false; celebrating = false; document.body.classList.remove("paused"); setPauseBtn();
    startT = -1; // stamp on first frame (no Date.now needed)
    requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    dead = true;
    audio.sfx("death");
    audio.setTriumph(false); // clear any power-cache uplift on death
    say(mode === "journey" ? "Caught" // journey loss always matches the CAUGHT panel
      : ["Eliminated", "Game over", "Destroyed", "Signal lost", "System failure", "Connection terminated"][(Math.random() * 6) | 0]); // end-of-game voiceover
    document.body.classList.remove("playing"); // restore cursor on menu
    // journey: carry cleared-level time + points so the score is a whole-run total, not per-level
    const totalTime = elapsed + (mode === "journey" ? journeyTime : 0);
    const totalPts = points + (mode === "journey" ? journeyPts : 0);
    const score = totalTime + totalPts; // seconds + 10/gem, one decimal
    finalEl.textContent = totalTime.toFixed(1);
    finalPtsEl.textContent = totalPts;
    finalScoreEl.textContent = score.toFixed(1);
    // leaderboard: record this run (per mode), show the board + submit box
    lastRun = { score, time: totalTime, points: totalPts };
    lbStatusEl.textContent = "";
    submitScoreBtn.disabled = false;
    lbSubmitEl.hidden = false; // always show the button; it submits THIS run only
    document.getElementById("restart-btn").hidden = mode !== "journey" && mode !== "arena"; // "Start over": journey restart / arena weapon select
    const modeName = mode === "waves" ? "Waves" : mode === "journey" ? "Journey" : mode === "arena" ? "Bullet Hell" : "Classic";
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
    const intro = elapsed < introUntil; // journey: brief held intro (swarm frozen, no spawns) so the title reads
    if (elapsed < frozenUntil || intro) frozenAccum += dt; // don't let frozen/intro time fuel the speed ramp
    if (biomeFade < 1) biomeFade = Math.min(1, biomeFade + dt * biomeFadeRate); // biome crossfade
    // classic counts up (survival); waves/journey count DOWN to the wave/level end;
    // journey boss levels show bosses-remaining instead (they end on defeat, not time)
    timeEl.textContent = mode === "waves" ? Math.max(0, waveEndsAt - elapsed).toFixed(1)
      : mode === "journey" ? (JOURNEY[journeyIdx].boss ? bosses.length + " ◉" : Math.max(0, levelEndsAt - elapsed).toFixed(1))
      : elapsed.toFixed(1);
    playerAlpha = Math.min(1, playerAlpha + dt * 2.4); // fade-in
    if (playerAlpha > 0.05) { trail.push({ x: player.x, y: player.y }); if (trail.length > 24) trail.shift(); }

    // arena: WASD steering with momentum — gentle accel + slow glide means you carry
    // speed and bank through turns rather than stopping/redirecting on a dime.
    if (mode === "arena") {
      const maxV = 460 * dpr * arenaScale;
      const acc = 2900 * dpr * arenaScale; // snappy — small bit of carry, no skating
      let ix = (arenaKeys.d ? 1 : 0) - (arenaKeys.a ? 1 : 0);
      let iy = (arenaKeys.s ? 1 : 0) - (arenaKeys.w ? 1 : 0);
      if (ix || iy) { const il = Math.hypot(ix, iy); player.vx += (ix / il) * acc * dt; player.vy += (iy / il) * acc * dt; }
      else { const f = Math.pow(0.001, dt); player.vx *= f; player.vy *= f; } // brisk stop, slight glide
      const sv = Math.hypot(player.vx, player.vy);
      if (sv > maxV) { player.vx = player.vx / sv * maxV; player.vy = player.vy / sv * maxV; }
      player.x = clamp01(player.x + player.vx * dt, w);
      player.y = clamp01(player.y + player.vy * dt, h);
    }

    // idle: no cursor — the player drifts on its own gentle Lissajous wander
    if (mode === "idle") {
      // time-warp the wander clock so the player's speed surges and eases a lot — it
      // near-drifts at times, then darts across (phase velocity ranges ~0.04×–1.96×)
      const tt = elapsed + 8 * Math.sin(elapsed * 0.12);
      player.x = w * (0.5 + 0.34 * Math.sin(tt * 0.17) + 0.08 * Math.sin(tt * 0.55));
      player.y = h * (0.5 + 0.32 * Math.cos(tt * 0.14) + 0.07 * Math.cos(tt * 0.47));
    }
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
    } else if ((mode === "classic" || mode === "arena" || mode === "idle") && elapsed >= nextBiomeAt) { pickBiome(true, true); scheduleBiomeShift(); }

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
      maxSpeed = (baseS + into * (MOBILE ? 1.45 : 1.5)) * dpr * sp * arenaScale; // mobile waves nudged up (was too easy)
      accel = (baseA + into * (MOBILE ? 2.9 : 3)) * dpr * sp * arenaScale;
    } else if (mode === "arena") {
      // Arena: gentle base ramp, but a stronger weapon ramps the threat with it
      const wdiff = (1 + (weaponLvl - 1) * 0.05) * (1 + surge * 0.2); // weapon level + surge → tougher swarm
      maxSpeed = (62 + st * 1.1) * dpr * sp * arenaScale * wdiff; // a bit slower than before
      accel = (150 + st * 2.6) * dpr * sp * arenaScale * wdiff;
    } else if (mode === "idle") {
      // idle/screensaver: slow drift whose speed cycles up + down over a long ~2-min wave
      const sw = 0.5 + 0.5 * Math.sin(elapsed * 0.055);
      maxSpeed = (20 + 30 * sw) * dpr * arenaScale; // ~20 → 50
      accel = (50 + 60 * sw) * dpr * arenaScale;
    } else {
      // Classic/Journey: ramp with active time; journey escalates a touch per level
      // (mobile journey nudged ~10% harder).
      const diff = mode === "journey" ? (1 + journeyIdx * 0.045) * (MOBILE ? 1.1 : 1) : 1;
      maxSpeed = (90 + st * (MOBILE ? 4 : 5)) * dpr * sp * arenaScale * diff;
      accel = (220 + st * (MOBILE ? 9 : 11)) * dpr * sp * arenaScale * diff;
    }
    // The Hive (yellow, slow clusterers) packs more nodes — bigger cap + faster build
    const hive = themeColor === "255,248,120";
    const wmob = mode === "waves" && MOBILE; // waves felt too easy on phones → bigger swarm + faster build
    const sparse = mode === "journey" && (journeyIdx === 1 || journeyIdx === 2); // "The Timid"/"Drift" — shy + scattering nodes barely chase → felt too empty; pack more in
    const hiveLvl = mode === "journey" && journeyIdx === 5; // "Hivemind" — extra-dense yellow swarm on top of the Hive boost
    const cap = Math.round((wmob ? 60 : mode === "idle" ? (MOBILE ? 70 : 160) : MOBILE ? 32 : mode === "arena" ? 270 : 130) * arenaScale * (hive ? 1.45 : 1) * (sparse ? 1.5 : 1) * (hiveLvl ? 1.5 : 1)), rate = (wmob ? 0.95 : mode === "idle" ? (MOBILE ? 0.9 : 1.4) : MOBILE ? 0.6 : 1.15) * (hive ? 1.5 : 1) * (sparse ? 1.6 : 1) * (hiveLvl ? 1.5 : 1);
    // Journey resets elapsed each level, so it would re-ramp from sparse every time.
    // Start fuller, ramp faster, and escalate the floor with the level number.
    const jBase = mode === "journey" ? 4 + journeyIdx : mode === "waves" ? 6 : mode === "arena" ? 26 + (weaponLvl - 1) * 4 : mode === "idle" ? 14 : 0;
    const jRate = mode === "journey" ? 1.25 : mode === "waves" ? 1.25 : mode === "arena" ? 2.1 : 1;
    let targetCount = Math.min(cap, 6 + jBase + Math.floor(rt * rate * jRate));
    if (bossWave) targetCount = mode === "journey" ? (MOBILE ? 18 : 28) // journey boss: steady swarm that keeps refilling (don't stall after the initial fill)
      : Math.min(targetCount, MOBILE ? 14 : 22); // waves boss: thin the swarm so the boss is the threat
    else if (waveType === "special") targetCount = Math.min(targetCount, MOBILE ? 18 : 30); // calmer reward wave
    // arena adaptive heat: if you keep the screen near-empty (melting everything), surge
    // hard — way more, tougher, faster nodes — until you're actually pressured again.
    if (mode === "arena") {
      const clearFrac = hunters.length / Math.max(1, targetCount);
      if (clearFrac < 0.3) surge = Math.min(3, surge + dt * 0.28);
      else surge = Math.max(0, surge - dt * 0.5);
      targetCount = Math.min(360, Math.round(targetCount * (1 + surge * 0.8)));
    }
    const grow = 1; // node size scaling removed — constant radius
    // refill toward the target ONE node at a time on a cooldown — so a powerup
    // blast (or boss pop) thins the swarm for a while instead of backfilling
    // instantly next frame. The natural ramp is slower than this, so it's only
    // throttled right after a big kill.
    if (hunters.length < targetCount && elapsed >= nextSpawn && !intro) {
      spawnHunter();
      // journey fills faster, waves a bit slower (killed enemies don't snap back);
      // the Hive refills quickest of all
      let gap = mode === "journey" ? 0.42 : mode === "waves" ? 0.9 : mode === "arena" ? 0.2 / (1 + surge * 1.5) : SPAWN_GAP;
      if (hive) gap *= 0.5;
      if (sparse) gap *= 0.55; // Timid/Drift fill faster too
      if (mode === "waves" && hunters.length < targetCount * 0.4) gap *= 0.3; // wave screen emptied (e.g. after a blast) → repopulate fast instead of trickling back
      nextSpawn = elapsed + gap;
    }

    // spawn a rainbow star now and then; collect it by touching it
    // (arena has its own weapon/buff pickups instead of these touch powerups)
    if (mode !== "arena" && mode !== "idle" && !star && elapsed >= nextStar) {
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
    if (mode !== "arena" && mode !== "idle" && !ice && elapsed >= nextIce) {
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
    if (mode !== "idle" && elapsed >= nextGem && gems.length < 5) {
      gems.push({ x: rand(w * 0.08, w * 0.92), y: rand(h * 0.1, h * 0.9), t: 0 });
      nextGem = elapsed + 1.5 + Math.random() * 2;
    }
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const gdx = player.x - g.x, gdy = player.y - g.y;
      const reach = (mode === "arena" ? 34 : GEM_R) * dpr + player.r; // arena: roomier diamond grab
      if (gdx * gdx + gdy * gdy < reach * reach) {
        mult = elapsed < comboUntil ? Math.min(MULT_MAX, mult + 1) : 1; // chain → multiplier
        comboUntil = elapsed + COMBO_WINDOW;
        points += GEM_VAL * mult;
        showPts();
        shocks.push({ x: g.x, y: g.y, t: 0, max: 60 * dpr });
        audio.sfx("gem");
        gems.splice(i, 1);
      }
    }
    if (elapsed > comboUntil) mult = 1; // combo lapsed

    // shield powerup — absorbs one hit; while held the music brightens
    if (mode !== "arena" && mode !== "idle" && !shield && !shieldActive && elapsed >= nextShield) {
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
    if (mode !== "arena" && mode !== "idle" && !shooter && elapsed >= shootUntil && elapsed >= nextShooter) {
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

    // ---- arena: weapon drops, buff drops (both fade out), autofire, rotating bosses ----
    if (mode === "arena") {
      if (!regenShield && elapsed >= regenReadyAt) regenShield = true; // shield finished recharging
      if (buffs.shield > 0 && buffs.shield <= elapsed) { audio.setShield(false); buffs.shield = 0; } // timed shield ended → music back to normal
      if (buffs.repel > elapsed) { // keep-away field: firmly but smoothly push nodes out of a bubble
        const fieldR = 185 * dpr * arenaScale;
        for (const hn of hunters) {
          const dx = hn.x - player.x, dy = hn.y - player.y, d = Math.hypot(dx, dy) || 1;
          if (d < fieldR) { const ux = dx / d, uy = dy / d; hn.kvx = (hn.kvx || 0) + ux * 1100 * dpr * dt; hn.kvy = (hn.kvy || 0) + uy * 1100 * dpr * dt; const ease = (fieldR - d) * 0.15; hn.x += ux * ease; hn.y += uy * ease; }
        }
      }
      // weapon drops — several can sit on the field at once
      if (weaponPickups.length < 3 && elapsed >= nextWeaponDrop) {
        weaponPickups.push({ x: rand(w * 0.12, w * 0.88), y: rand(h * 0.14, h * 0.86), t: 0, kind: WEAPON_KINDS[(Math.random() * WEAPON_KINDS.length) | 0], born: elapsed });
        nextWeaponDrop = elapsed + 4 + Math.random() * 3;
      }
      for (let i = weaponPickups.length - 1; i >= 0; i--) {
        const wp = weaponPickups[i];
        if (elapsed - wp.born > PICKUP_TTL) { weaponPickups.splice(i, 1); continue; }
        const dx = player.x - wp.x, dy = player.y - wp.y, reach = STAR_R * 1.6 * dpr + player.r;
        if (dx * dx + dy * dy < reach * reach) {
          const pk = wp.kind;
          // floor a freshly-grabbed weapon to ~60% of your best level, so switching off a
          // maxed weapon late game doesn't leave you helpless against its over-scaled swarm
          const best = Math.max(1, ...Object.values(weaponLvls));
          weaponLvls[pk] = Math.max((weaponLvls[pk] || 0) + 1, Math.ceil(best * 0.6));
          weapon = pk; weaponLvl = weaponLvls[pk];
          audio.sfx("blast"); say(WEAPONS[pk].name + ", level " + weaponLvl);
          shocks.push({ x: wp.x, y: wp.y, t: 0, max: 130 * dpr, shield: true });
          weaponPickups.splice(i, 1);
        }
      }
      // buff drops — several at once
      if (buffPickups.length < 3 && elapsed >= nextBuffDrop) {
        buffPickups.push({ x: rand(w * 0.12, w * 0.88), y: rand(h * 0.14, h * 0.86), t: 0, kind: BUFF_KINDS[(Math.random() * BUFF_KINDS.length) | 0], born: elapsed });
        nextBuffDrop = elapsed + 4 + Math.random() * 3;
      }
      for (let i = buffPickups.length - 1; i >= 0; i--) {
        const bp = buffPickups[i];
        if (elapsed - bp.born > PICKUP_TTL) { buffPickups.splice(i, 1); continue; }
        const dx = player.x - bp.x, dy = player.y - bp.y, reach = STAR_R * 1.6 * dpr + player.r;
        if (dx * dx + dy * dy < reach * reach) { applyBuff(bp.kind, bp.x, bp.y); buffPickups.splice(i, 1); }
      }
      // rotating boss archetypes — warn first (voice + edge flash), then spawn a beat later
      const wantBosses = Math.min(3, 1 + Math.floor(elapsed / 70));
      if (bosses.length < wantBosses && !bossSpawnAt && elapsed >= nextArenaBoss) {
        say(["Warning", "Danger", "Incoming", "Threat detected", "Alert", "Hostile inbound"][(Math.random() * 6) | 0]);
        flashFrom = elapsed; flashUntil = elapsed + 1.4; flashCol = "255,170,40"; // amber = boss incoming (red is reserved for damage)
        bossSpawnAt = elapsed + 1.4;
        nextArenaBoss = elapsed + 13 + Math.random() * 7;
      }
      if (bossSpawnAt && elapsed >= bossSpawnAt) { spawnArenaBoss(); bossSpawnAt = 0; }
      // periodic tight clusters of tanky nodes (alongside the steady spawn)
      if (elapsed >= nextCluster && hunters.length < 300) { spawnCluster(); nextCluster = elapsed + 5 + Math.random() * 4; }
      // Blade buff — a spinning melee blade: slices nodes in its sweep, swirls the rest
      // away (physics), and grinds bosses it touches
      if (buffs.blade > elapsed) {
        const blLen = 124 * dpr * arenaScale, blW = 26 * dpr;
        // physics flail — your movement whips the blade; it coasts (damped) but never drops below idle spin
        const ta = -Math.sin(bladeAng), tb = Math.cos(bladeAng);
        const drag = -(player.vx * ta + player.vy * tb) / blLen * 9;
        bladeVel = bladeVel * Math.pow(0.5, dt) + drag * dt;
        const idle = 2.6, target = bladeVel >= 0 ? Math.max(idle, bladeVel) : Math.min(-idle, bladeVel);
        bladeVel += (target - bladeVel) * 1.6 * dt;
        bladeAng += bladeVel * dt;
        const ca = Math.cos(bladeAng), sa = Math.sin(bladeAng), tx = -sa, ty = ca; // tx,ty = swing tangential
        // blade damage scales with time + weapon level; faster swing also bites harder
        const bdmg = (8 + elapsed * 0.5 + weaponLvl * 1.2) * (0.6 + Math.min(1.4, Math.abs(bladeVel) / 6)) * dt;
        let sliced = false;
        for (let j = 0; j < hunters.length; j++) {
          const hn = hunters[j]; if (hn.dead) continue;
          const ax = hn.x - player.x, ay = hn.y - player.y;
          const proj = Math.max(0, Math.min(blLen, ax * ca + ay * sa));
          const dx = hn.x - (player.x + ca * proj), dy = hn.y - (player.y + sa * proj), reach = blW + hn.r;
          if (dx * dx + dy * dy < reach * reach) { hn.dead = true; points += KILL_VAL; sliced = true; const kk = 220 * dpr; hn.kvx = (hn.kvx || 0) + tx * kk; hn.kvy = (hn.kvy || 0) + ty * kk; } // blade instakills + flings along the swing
          else if (ax * ax + ay * ay < (blLen * 1.15) ** 2) { const k = 300 * dpr * dt; hn.vx += tx * k; hn.vy += ty * k; } // tangential swirl
        }
        if (sliced) { showPts(); hunters = hunters.filter((hn) => !hn.dead); shocks.push({ x: player.x + ca * blLen, y: player.y + sa * blLen, t: 0, max: 44 * dpr }); }
        for (let bi = bosses.length - 1; bi >= 0; bi--) {
          const b = bosses[bi]; if (!b.maxHp) continue;
          const ax = b.x - player.x, ay = b.y - player.y;
          const proj = Math.max(0, Math.min(blLen, ax * ca + ay * sa));
          const dx = b.x - (player.x + ca * proj), dy = b.y - (player.y + sa * proj), reach = blW + b.r;
          if (dx * dx + dy * dy < reach * reach) {
            b.hp -= bdmg * 7; // bosses take the scaled blade damage too
            const d = Math.hypot(ax, ay) || 1; b.vx += (ax / d) * 140 * dpr * dt; b.vy += (ay / d) * 140 * dpr * dt;
            if (b.hp <= 0) { popInto(b.x, b.y, b.color, b.kind === "splitter" ? 16 : 9); points += BOSS_VAL; showPts(); shocks.push({ x: b.x, y: b.y, t: 0, max: 240 * dpr, rainbow: true }); audio.sfx("blast"); bossDrop(b.x, b.y); bosses.splice(bi, 1); if (bosses.length === 0) nextArenaBoss = elapsed + 8 + Math.random() * 5; }
          }
        }
      }
    }

    const frozen = elapsed < frozenUntil || intro;

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
      if (!hn.escaping && hn.age > hn.life * (mode === "idle" ? 3 : 1) && (hn.nb || 0) < 2) {
        hn.escaping = true;
        const kick = (mode === "idle" ? 120 + Math.random() * 80 : 440 + Math.random() * 200) * dpr; // idle: gentle drift-off; others unchanged
        hn.vx = (-pdx / pd) * kick; hn.vy = (-pdy / pd) * kick;
      }

      if (!hn.escaping) {
        const p = hn.p;
        // each personality aims at a different target point
        let tx = player.x, ty = player.y;
        if (mode === "idle") {
          // idle: the whole swarm cycles through collective moods (~22s each) for evolving
          // interest — gather, orbit the drifting player, roam, then chase. Low accel makes
          // each shift a gentle drift, not a snap.
          const mood = Math.floor(elapsed / 22) % 4;
          if (mood === 0) { tx = w * (0.5 + 0.3 * Math.sin(elapsed * 0.06)); ty = h * (0.5 + 0.28 * Math.cos(elapsed * 0.05)); } // gather to a wandering point
          else if (mood === 1) { const a = hn.age * 1.3 + hn.seed; tx = player.x + Math.cos(a) * 180 * dpr; ty = player.y + Math.sin(a) * 180 * dpr; } // orbit
          else if (mood === 2) { const a = elapsed * 0.18 + hn.seed; tx = w * 0.5 + Math.cos(a) * w * 0.46; ty = h * 0.5 + Math.sin(a * 1.3) * h * 0.46; } // roam
          // mood 3 → chase the drifting player (tx,ty already set)
        } else if (p.kind === "ambush") {     // Pinky: lead further ahead of the player
          tx = player.x + player.vx * 1.3; ty = player.y + player.vy * 1.3;
        } else if (p.kind === "erratic") {    // Inky: wide, fast wobble orbit
          const a = hn.age * 3.2 + hn.seed;
          tx = player.x + Math.cos(a) * 210 * dpr; ty = player.y + Math.sin(a * 1.25) * 210 * dpr;
        } else if (p.kind === "scatter") {    // roam the whole arena, barely chasing
          const a = elapsed * 0.22 + hn.seed;
          tx = w * 0.5 + Math.cos(a) * w * 0.46; ty = h * 0.5 + Math.sin(a * 1.3) * h * 0.46;
        }
        let tdx = tx - hn.x, tdy = ty - hn.y;
        if (p.kind === "shy" && pd < 260 * dpr && mode !== "idle") { tdx = -pdx; tdy = -pdy; } // Clyde bolts when close
        const td = Math.hypot(tdx, tdy) || 1;
        hn.vx += (tdx / td) * accel * p.acc * dt;
        hn.vy += (tdy / td) * accel * p.acc * dt;
        const ms = maxSpeed * p.spd, sp = Math.hypot(hn.vx, hn.vy);
        if (sp > ms) { hn.vx = (hn.vx / sp) * ms; hn.vy = (hn.vy / sp) * ms; }
      }
      hn.x += hn.vx * dt; hn.y += hn.vy * dt;
      // smooth bullet knockback — uncapped, decays (steering can't swallow it)
      if (hn.kvx || hn.kvy) { hn.x += hn.kvx * dt; hn.y += hn.kvy * dt; const kd = Math.pow(0.0009, dt); hn.kvx *= kd; hn.kvy *= kd; }

      if (hn.escaping) {
        // remove escapers once fully off-screen
        if (hn.x < -margin || hn.x > w + margin || hn.y < -margin || hn.y > h + margin) hn.dead = true;
      } else if (mode !== "arena") {
        // classic/waves/journey: keep the swarm on-screen — bounce off the edges
        const m = hn.r;
        if (hn.x < m) { hn.x = m; hn.vx = Math.abs(hn.vx) * 0.5; }
        else if (hn.x > w - m) { hn.x = w - m; hn.vx = -Math.abs(hn.vx) * 0.5; }
        if (hn.y < m) { hn.y = m; hn.vy = Math.abs(hn.vy) * 0.5; }
        else if (hn.y > h - m) { hn.y = h - m; hn.vy = -Math.abs(hn.vy) * 0.5; }
      }
      // arena: free to drift off the edges and float back in (no clamp); their chase pulls them home
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
        const m = boss.r;
        if (boss.kind === "charger") {
          // Charger: drift in, wind up, then dash straight through the player; repeat
          boss.chargeCd -= dt;
          if (boss.dashing > 0) { boss.dashing -= dt; }
          else if (boss.chargeCd <= 0) {
            const dx = player.x - boss.x, dy = player.y - boss.y, d = Math.hypot(dx, dy) || 1;
            const ds = 1050 * dpr * arenaScale;
            boss.vx = dx / d * ds; boss.vy = dy / d * ds;
            boss.dashing = 0.45; boss.chargeCd = 2 + Math.random() * 0.8; audio.sfx("blast");
          } else { // slow creep between dashes
            const dx = player.x - boss.x, dy = player.y - boss.y, d = Math.hypot(dx, dy) || 1;
            const slow = 80 * dpr * arenaScale;
            boss.vx = dx / d * slow; boss.vy = dy / d * slow;
          }
          boss.x += boss.vx * dt; boss.y += boss.vy * dt;
          if (boss.x < m) { boss.x = m; boss.vx = Math.abs(boss.vx); } else if (boss.x > w - m) { boss.x = w - m; boss.vx = -Math.abs(boss.vx); }
          if (boss.y < m) { boss.y = m; boss.vy = Math.abs(boss.vy); } else if (boss.y > h - m) { boss.y = h - m; boss.vy = -Math.abs(boss.vy); }
        } else {
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
        if (boss.x < m) { boss.x = m; boss.vx = Math.abs(boss.vx); } else if (boss.x > w - m) { boss.x = w - m; boss.vx = -Math.abs(boss.vx); }
        if (boss.y < m) { boss.y = m; boss.vy = Math.abs(boss.vy); } else if (boss.y > h - m) { boss.y = h - m; boss.vy = -Math.abs(boss.vy); }
        }
        // ranged attacks — arena archetypes fire distinct patterns; legacy shooter lobs aimed shots
        const bspd = 300 * dpr * arenaScale;
        if (boss.kind === "spiral") {            // steady rotating twin stream
          boss.spin += dt * 2.6; boss.fireCd -= dt;
          if (boss.fireCd <= 0) {
            for (let s = 0; s < 2; s++) { const a = boss.spin + s * Math.PI; enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * bspd, vy: Math.sin(a) * bspd, life: 3.6, color: boss.color }); }
            boss.fireCd = 0.08; audio.sfx("pop");
          }
        } else if (boss.kind === "burst") {      // periodic radial ring
          boss.fireCd -= dt;
          if (boss.fireCd <= 0) {
            const n = 18; for (let s = 0; s < n; s++) { const a = boss.seed + (s / n) * 6.283185; enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * bspd, vy: Math.sin(a) * bspd, life: 3, color: boss.color }); }
            boss.fireCd = 1.9; audio.sfx("blast");
          }
        } else if (boss.kind === "weaver") {     // aimed 3-shot fan
          boss.fireCd -= dt;
          if (boss.fireCd <= 0) {
            const base = Math.atan2(player.y - boss.y, player.x - boss.x);
            for (let s = -1; s <= 1; s++) { const a = base + s * 0.26; enemyBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * bspd, vy: Math.sin(a) * bspd, life: 3, color: boss.color }); }
            boss.fireCd = 1.5; audio.sfx("pop");
          }
        } else if (!boss.kind && boss.shooter) { // legacy (classic/waves/journey) shooter boss
          boss.fireCd -= dt;
          if (boss.fireCd <= 0) {
            const dx = player.x - boss.x, dy = player.y - boss.y, d = Math.hypot(dx, dy) || 1;
            enemyBullets.push({ x: boss.x, y: boss.y, vx: dx / d * 320 * dpr * arenaScale, vy: dy / d * 320 * dpr * arenaScale, life: 3, color: boss.color });
            boss.fireCd = 1.4; audio.sfx("pop");
          }
        }
        // splitter: no ranged attack — pure pursuit, bursts into a big swarm on death
        // apply + decay the smooth knockback (separate from the speed-capped steering)
        if (boss.kvx || boss.kvy) {
          boss.x += boss.kvx * dt; boss.y += boss.kvy * dt;
          const kd = Math.pow(0.0009, dt); boss.kvx *= kd; boss.kvy *= kd;
          const m = boss.r;
          if (boss.x < m) boss.x = m; else if (boss.x > w - m) boss.x = w - m;
          if (boss.y < m) boss.y = m; else if (boss.y > h - m) boss.y = h - m;
        }
      }
      const bdx2 = player.x - boss.x, bdy2 = player.y - boss.y, brr = boss.r + player.r;
      if (bdx2 * bdx2 + bdy2 * bdy2 < brr * brr && takeHit()) { drawScene(); gameOver(); return; }
    }

    // boss shots — travel, expire, and kill the player on contact (shield/i-frames apply)
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const eb = enemyBullets[i];
      if (!frozen) { eb.x += eb.vx * dt; eb.y += eb.vy * dt; eb.life -= dt; } // freeze halts travel AND lifespan
      if (eb.life <= 0 || eb.x < -30 || eb.x > w + 30 || eb.y < -30 || eb.y > h + 30) { enemyBullets.splice(i, 1); continue; }
      const dx = player.x - eb.x, dy = player.y - eb.y, rr = player.r + 6 * dpr;
      if (dx * dx + dy * dy < rr * rr) {
        enemyBullets.splice(i, 1);
        if (takeHit()) { drawScene(); gameOver(); return; }
      }
    }

    // hunter-hunter forces (skipped while frozen) + lethal web check, one pass
    if (physics(dt, frozen) && takeHit()) { drawScene(); gameOver(); return; } // caught by a link

    // idle: when the web gets too DENSE (lots of links per node), gently spread the swarm
    // apart for a few seconds (no screen-wipe) — tight groups loosen, then drift back together
    if (mode === "idle" && hunters.length > 40 && links.length > hunters.length * 1.4 && elapsed >= idleDisperse) {
      idleDisperse = elapsed + 5;
    }

    // legacy shooter weapon (classic/waves/journey) — fire darts along travel, ±2°
    if (mode !== "arena" && elapsed < shootUntil && elapsed >= nextBullet) {
      const bspd = 820 * dpr * arenaScale;
      const ang = Math.atan2(heading.y, heading.x) + (Math.random() * 2 - 1) * (2 * Math.PI / 180);
      bullets.push({ x: player.x, y: player.y, vx: Math.cos(ang) * bspd, vy: Math.sin(ang) * bspd, life: 1.1, pierce: 0, dmg: 1, kind: "pill" });
      nextBullet = elapsed + BULLET_GAP;
      audio.sfx("pop");
    }
    // arena: autofire toward the mouse aim (holding the mouse is a temporary ceasefire)
    if (mode === "arena" && !fireHold && playerAlpha > 0.5) {
      const odrive = buffs.overdrive > elapsed, frenzy = buffs.frenzy > elapsed ? 0.5 : 1;
      if (elapsed >= nextBullet) {
        const eff = odrive ? weaponLvl + 10 : weaponLvl;
        fireWeapon(weapon, eff);
        nextBullet = elapsed + weaponStats(eff, weapon).gap * frenzy;
        audio.sfx("pop");
      }
      if (buffs.dual > elapsed && elapsed >= nextDual) { // Dual-wield: a second weapon fires too
        const dl = (weaponLvls[dualWeapon] || 1) + (odrive ? 10 : 0);
        fireWeapon(dualWeapon, dl);
        nextDual = elapsed + weaponStats(dl, dualWeapon).gap * frenzy;
        audio.sfx("pop");
      }
    }
    // hunter spatial grid for bullet collisions (kills are marked, then filtered once
    // after the bullet + arc passes — avoids O(bullets × hunters) every frame)
    let bhGrid = null, bhCell = 72 * dpr, bhCols = 1, bhRows = 1;
    if (bullets.length) {
      bhCols = Math.max(1, Math.ceil(w / bhCell)); bhRows = Math.max(1, Math.ceil(h / bhCell));
      bhGrid = new Array(bhCols * bhRows);
      for (let j = 0; j < hunters.length; j++) {
        const hn = hunters[j];
        const ci = Math.min(bhCols - 1, Math.max(0, (hn.x / bhCell) | 0));
        const ri = Math.min(bhRows - 1, Math.max(0, (hn.y / bhCell) | 0));
        const idx = ri * bhCols + ci;
        (bhGrid[idx] || (bhGrid[idx] = [])).push(hn);
      }
    }
    let bulletKills = false;
    for (let i = bullets.length - 1; i >= 0; i--) {
      const bl = bullets[i];
      const br = bl.r || 5 * dpr;
      if (bl.homing) { // Seeker: curve toward the nearest node/boss within a few grid cells
        let bestD2 = (520 * dpr) ** 2, tx = 0, ty = 0, found = false;
        const hci = Math.min(bhCols - 1, Math.max(0, (bl.x / bhCell) | 0));
        const hri = Math.min(bhRows - 1, Math.max(0, (bl.y / bhCell) | 0));
        for (let oy = -3; oy <= 3; oy++) {
          const ny = hri + oy; if (ny < 0 || ny >= bhRows) continue;
          for (let ox = -3; ox <= 3; ox++) {
            const nx = hci + ox; if (nx < 0 || nx >= bhCols) continue;
            const arr = bhGrid && bhGrid[ny * bhCols + nx]; if (!arr) continue;
            for (let k = 0; k < arr.length; k++) { const hn = arr[k]; if (hn.dead) continue; const dx = hn.x - bl.x, dy = hn.y - bl.y, d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; tx = hn.x; ty = hn.y; found = true; } }
          }
        }
        for (const b of bosses) { if (!b.maxHp) continue; const dx = b.x - bl.x, dy = b.y - bl.y, d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; tx = b.x; ty = b.y; found = true; } }
        if (found) {
          let cur = Math.atan2(bl.vy, bl.vx);
          let da = Math.atan2(ty - bl.y, tx - bl.x) - cur; while (da > Math.PI) da -= 6.283185; while (da < -Math.PI) da += 6.283185;
          const turn = (bl.turn || 7) * dt; cur += Math.max(-turn, Math.min(turn, da));
          const sp = bl.spd || Math.hypot(bl.vx, bl.vy);
          bl.vx = Math.cos(cur) * sp; bl.vy = Math.sin(cur) * sp;
        }
      }
      bl.x += bl.vx * dt; bl.y += bl.vy * dt; bl.life -= dt; bl.age = (bl.age || 0) + dt;
      if (bl.bounce) { // ricochet off the walls (arena Bounce buff)
        if (bl.x < 0) { bl.x = 0; bl.vx = Math.abs(bl.vx); } else if (bl.x > w) { bl.x = w; bl.vx = -Math.abs(bl.vx); }
        if (bl.y < 0) { bl.y = 0; bl.vy = Math.abs(bl.vy); } else if (bl.y > h) { bl.y = h; bl.vy = -Math.abs(bl.vy); }
        if (bl.life <= 0) { bullets.splice(i, 1); continue; }
      } else if (bl.life <= 0 || bl.x < -30 || bl.x > w + 30 || bl.y < -30 || bl.y > h + 30) { bullets.splice(i, 1); continue; }
      let spent = false, bounced = false;
      // hunters — destroyed outright (marked dead, filtered later); pierce passes through several.
      // only the 9 grid cells around the bullet are checked, not every hunter.
      const ci = Math.min(bhCols - 1, Math.max(0, (bl.x / bhCell) | 0));
      const ri = Math.min(bhRows - 1, Math.max(0, (bl.y / bhCell) | 0));
      for (let oy = -1; oy <= 1 && !spent && !bounced; oy++) {
        const ny = ri + oy; if (ny < 0 || ny >= bhRows) continue;
        for (let ox = -1; ox <= 1 && !spent && !bounced; ox++) {
          const nx = ci + ox; if (nx < 0 || nx >= bhCols) continue;
          const arr = bhGrid && bhGrid[ny * bhCols + nx]; if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const hn = arr[k]; if (hn.dead) continue;
            const dx = hn.x - bl.x, dy = hn.y - bl.y, rr = hn.r + br;
            if (dx * dx + dy * dy < rr * rr) {
              if (bl.explode) { explode(bl.x, bl.y, bl.boom, bl.dmg); bulletKills = true; spent = true; break; }
              shocks.push({ x: bl.x, y: bl.y, t: 0, max: 30 * dpr });
              const killed = hurtNode(hn, bl.dmg);
              if (killed) { hn.dead = true; bulletKills = true; points += KILL_VAL; shocks.push({ x: bl.x, y: bl.y, t: 0, max: 46 * dpr }); }
              if (bl.bounce) { // ricochet off the node (chip it, deflect, keep going) — even if it dies
                const d = Math.hypot(dx, dy) || 1, nx2 = -dx / d, ny2 = -dy / d, dot = bl.vx * nx2 + bl.vy * ny2;
                bl.vx -= 2 * dot * nx2; bl.vy -= 2 * dot * ny2;
                bl.x = hn.x + nx2 * (hn.r + br + 1); bl.y = hn.y + ny2 * (hn.r + br + 1);
                bounced = true; break;
              }
              if (!killed) { const bs = Math.hypot(bl.vx, bl.vy) || 1, imp = (bl.knock || 110 * dpr) * 0.7; hn.kvx = (hn.kvx || 0) + (bl.vx / bs) * imp; hn.kvy = (hn.kvy || 0) + (bl.vy / bs) * imp; } // smooth shove on survivors
              if ((bl.pierce = (bl.pierce | 0) - 1) < 0) { spent = true; break; }
            }
          }
        }
      }
      if (spent) { bullets.splice(i, 1); continue; }
      // shoot down incoming boss shots
      for (let ei = enemyBullets.length - 1; ei >= 0; ei--) {
        const eb = enemyBullets[ei];
        const dx = eb.x - bl.x, dy = eb.y - bl.y, rr = br + 6 * dpr;
        if (dx * dx + dy * dy < rr * rr) {
          enemyBullets.splice(ei, 1);
          shocks.push({ x: bl.x, y: bl.y, t: 0, max: 30 * dpr });
          if ((bl.pierce = (bl.pierce | 0) - 1) < 0) { spent = true; break; }
        }
      }
      if (spent) { bullets.splice(i, 1); continue; }
      // bosses — chip hp (each bullet damages a given boss once); arena bosses only
      for (let bi = bosses.length - 1; bi >= 0; bi--) {
        const b = bosses[bi];
        if (!b.maxHp) continue;
        if (bl.hitB && bl.hitB.has(b)) continue;
        // swept test against this frame's travel segment so fast bullets can't tunnel the boss
        const ax = bl.x - bl.vx * dt, ay = bl.y - bl.vy * dt, sx = bl.vx * dt, sy = bl.vy * dt, L2 = sx * sx + sy * sy || 1;
        let tp = ((b.x - ax) * sx + (b.y - ay) * sy) / L2; tp = tp < 0 ? 0 : tp > 1 ? 1 : tp;
        const dx = b.x - (ax + sx * tp), dy = b.y - (ay + sy * tp), rr = b.r + br + 5 * dpr;
        if (dx * dx + dy * dy < rr * rr) {
          if (bl.explode) { if (explode(bl.x, bl.y, bl.boom, bl.dmg)) bulletKills = true; spent = true; break; } // Mortar bursts on the boss
          b.hp -= bl.dmg || 1;
          (bl.hitB || (bl.hitB = new Set())).add(b);
          shocks.push({ x: bl.x, y: bl.y, t: 0, max: 38 * dpr });
          // smooth knockback: feed an impulse into a decaying knock-velocity (applied in the boss loop)
          const bs = Math.hypot(bl.vx, bl.vy) || 1, imp = (bl.knock || 110 * dpr) * 0.5;
          b.kvx = (b.kvx || 0) + (bl.vx / bs) * imp; b.kvy = (b.kvy || 0) + (bl.vy / bs) * imp;
          if (b.hp <= 0) {
            popInto(b.x, b.y, b.color, b.kind === "splitter" ? 16 : 9);
            points += BOSS_VAL; showPts();
            shocks.push({ x: b.x, y: b.y, t: 0, max: 240 * dpr, rainbow: true });
            audio.sfx("blast");
            bossDrop(b.x, b.y);
            bosses.splice(bi, 1);
            if (mode === "arena" && bosses.length === 0) nextArenaBoss = elapsed + 8 + Math.random() * 5;
          } else if (bl.bounce) {
            // ricochet off the boss instead of tunnelling through it
            const d = Math.hypot(dx, dy) || 1, nx = -dx / d, ny = -dy / d; // boss → bullet
            const dot = bl.vx * nx + bl.vy * ny;
            bl.vx -= 2 * dot * nx; bl.vy -= 2 * dot * ny;
            bl.x = b.x + nx * (b.r + br + 1); bl.y = b.y + ny * (b.r + br + 1);
            if (bl.hitB) bl.hitB.delete(b); // can chip again on the next bounce in
            break;
          }
          if ((bl.pierce = (bl.pierce | 0) - 1) < 0) { spent = true; break; }
        }
      }
      if (spent) { bullets.splice(i, 1); continue; }
    }
    if (bulletKills) { showPts(); hunters = hunters.filter((hn) => !hn.dead); } // sweep bullet-killed nodes once

    drawScene();
    requestAnimationFrame(loop);
  }

  // uniform spatial grid: bucket hunters into cells sized to the max interaction
  // radius, then visit only the 9-cell neighbourhood per node → near-O(n) instead of
  // O(n²). Each unordered pair is handed to fn exactly once (j > i).
  let gridCells = [], gridCx = [], gridCy = [], gridUsed = []; // buckets are pooled + reused across frames (no per-frame alloc)
  function forEachPair(fn) {
    const n = hunters.length;
    if (n < 2) return;
    const cell = Math.max(74 * dpr * GROUP_SCALE, JOLT_R * dpr, COH_R * dpr, GROUP_R * dpr * GROUP_SCALE, Math.sqrt(scatLinkD2)) + 1;
    const cols = Math.max(1, Math.ceil(w / cell)), rows = Math.max(1, Math.ceil(h / cell));
    const grid = gridCells;
    // empty only the buckets we filled last frame (cheaper than fill(null) + reallocating arrays)
    for (let u = 0; u < gridUsed.length; u++) { const b = grid[gridUsed[u]]; if (b) b.length = 0; }
    gridUsed.length = 0;
    gridCx.length = n; gridCy.length = n;
    for (let i = 0; i < n; i++) {
      const hx = hunters[i].x, hy = hunters[i].y;
      const ci = hx < 0 ? 0 : hx >= w ? cols - 1 : (hx / cell) | 0;
      const ri = hy < 0 ? 0 : hy >= h ? rows - 1 : (hy / cell) | 0;
      gridCx[i] = ci; gridCy[i] = ri;
      const idx = ri * cols + ci;
      let bucket = grid[idx];
      if (!bucket) bucket = grid[idx] = [];
      if (bucket.length === 0) gridUsed.push(idx); // first node into this bucket this frame
      bucket.push(i);
    }
    for (let i = 0; i < n; i++) {
      const ci = gridCx[i], ri = gridCy[i], a = hunters[i];
      for (let oy = -1; oy <= 1; oy++) {
        const ny = ri + oy; if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = ci + ox; if (nx < 0 || nx >= cols) continue;
          const arr = grid[ny * cols + nx]; if (!arr || arr.length === 0) continue;
          for (let k = 0; k < arr.length; k++) {
            const j = arr[k]; if (j <= i) continue;
            const b = hunters[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            fn(i, j, a, b, dx, dy, dx * dx + dy * dy);
          }
        }
      }
    }
  }
  // reused physics scratch (cleared each frame) — avoids 4 array allocations per physics pass
  const LINK_KEY = 4194304; // 2^22; hunter ids stay well under this within a session → collision-free pair keys
  let pCnt = [], pSx = [], pSy = [], pScnt = [];

  // hunter-hunter forces + lethal-web detection, one neighbourhood pass via the grid:
  //  - soft repulsion within SEP so they spread into a cloud, not a clump
  //  - hard separation when actually overlapping
  //  - if a drawn link (pair within LINK_DIST) touches the player → lethal
  function physics(dt, frozen) {
    links.length = 0;
    // track how long each web has existed → a freshly-formed web can't kill
    // until WEB_GRACE has passed (gives the player a beat to read the threat).
    const prevAges = linkAges;
    const nextAges = linkAgesNext; nextAges.clear(); // reuse two maps + swap → no per-frame Map allocation
    // frozen: hunters don't move, only their webs can still catch you
    if (frozen) {
      let kill = false;
      forEachPair((i, j, a, b, dx, dy, d2) => {
        const ld2 = a.color === SCATTER && b.color === SCATTER ? scatLinkD2 : linkD2;
        if (d2 < ld2) {
          const key = a.id < b.id ? a.id * LINK_KEY + b.id : b.id * LINK_KEY + a.id;
          const lifeT = (prevAges.get(key) || 0) + dt;
          nextAges.set(key, lifeT);
          links.push({ a, b, al: 1 - d2 / ld2, same: a.color === b.color });
          if (!kill && lifeT >= WEB_GRACE && segHitsPlayer(a.x, a.y, b.x, b.y)) kill = true;
        }
      });
      linkAges = nextAges; linkAgesNext = prevAges;
      return kill;
    }
    const SEP = 74 * dpr * GROUP_SCALE, SEP2 = SEP * SEP; // tighter packing on mobile
    const JR = JOLT_R * dpr, JR2 = JR * JR;
    const CR = COH_R * dpr, CR2 = CR * CR;
    const GR = GROUP_R * dpr * GROUP_SCALE, GR2 = GR * GR; // smaller "same clump" radius on mobile
    // clumps pack tighter the longer you survive: same-colour cohesion strengthens
    // and internal repulsion eases, while inter-colour repulsion scales up in step
    // so the tighter balls still stay segregated into separate groups.
    const idleMode = mode === "idle"; // idle: looser clumps + colours allowed to mingle
    const tight = idleMode ? 1 : 1 + Math.min(1.3, elapsed / 45);
    const n = hunters.length;
    const cnt = pCnt, sx = pSx, sy = pSy, scnt = pScnt; // reused scratch (cleared below)
    cnt.length = sx.length = sy.length = scnt.length = n;
    for (let i = 0; i < n; i++) { cnt[i] = 0; sx[i] = 0; sy[i] = 0; scnt[i] = 0; }
    let linkKill = false;
    forEachPair((i, j, a, b, dx, dy, d2) => {
        if (d2 <= 0.01) return;
        if (d2 < JR2) { cnt[i]++; cnt[j]++; sx[i] += b.x; sy[i] += b.y; sx[j] += a.x; sy[j] += a.y; }
        const same = a.color === b.color;
        const szf = idleMode ? (a.r + b.r) / (7 * dpr) : 1; // idle only: scale push-apart/repel with node size
        if (same && d2 < GR2) { scnt[i]++; scnt[j]++; }
        if (d2 < SEP2) {
          const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          // same colour barely repels (lets them pack tight, even tighter over time);
          // different colours shove hard — and harder over time — to stay segregated
          const f = (1 - d / SEP) * (same ? 68 / tight : (idleMode ? 200 : 1700 * tight)) * dpr * dt * szf; // idle: soft cross-colour push → colours mingle (no segregated grid); push scales with size
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
          // idle: cohesion slowly oscillates between gathering (+) and dispersing (−) so the
          // field breathes; while a "too dense" disperse window is active it pushes apart hard
          // so tight groups visibly spread out (then drift back together)
          const idleCoh = elapsed < idleDisperse ? -300 : 220 * Math.sin(elapsed * 0.052);
          const cf = a.p.coh * (idleMode ? idleCoh : (crowded ? -220 : 560 * tight)) * dpr * dt;
          a.vx += ux * cf; a.vy += uy * cf;
          b.vx -= ux * cf; b.vy -= uy * cf;
        } else if (d2 < CR2) {
          // differing colours shove apart at range → clumps segregate hard (harder over time)
          const d = Math.sqrt(d2), ux = dx / d, uy = dy / d;
          const rf = (1 - d / CR) * (idleMode ? 0 : 400 * tight) * dpr * dt * szf; // idle: no cross-colour segregation → multicolour clumps; repel scales with size
          a.vx -= ux * rf; a.vy -= uy * rf;
          b.vx += ux * rf; b.vy += uy * rf;
        }
        const ld2 = same && a.color === SCATTER ? scatLinkD2 : linkD2; // scatterers web up at longer range
        if (d2 < ld2) {
          const key = a.id < b.id ? a.id * LINK_KEY + b.id : b.id * LINK_KEY + a.id;
          const lifeT = (prevAges.get(key) || 0) + dt;
          nextAges.set(key, lifeT);
          links.push({ a, b, al: 1 - d2 / ld2, same });
          if (!linkKill && lifeT >= WEB_GRACE && segHitsPlayer(a.x, a.y, b.x, b.y)) linkKill = true;
        }
    });
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
    linkAges = nextAges; linkAgesNext = prevAges;
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

  // circular health ring around an arena boss — depletes clockwise from the top,
  // colour shifts red as it nears death
  function drawBossHealth(boss) {
    const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    const R = boss.r + 11 * dpr;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.lineWidth = 4 * dpr; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(10,8,16,0.7)"; // track
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.283185); ctx.stroke();
    const hue = 120 * frac; // green → red as hp drops
    ctx.strokeStyle = `hsl(${hue},85%,58%)`;
    ctx.shadowColor = `hsl(${hue},85%,58%)`; ctx.shadowBlur = 8 * dpr;
    ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + frac * 6.283185); ctx.stroke();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  // boss attack tell — a glow ring that brightens/swells as the next fire or dash
  // approaches, so the player can read the windup. Charger also paints its dash line.
  function drawBossTelegraph(b) {
    let tele = 0, lead = 0;
    if (b.kind === "charger") { if (b.dashing > 0) return; lead = 0.9; tele = b.chargeCd < lead ? 1 - b.chargeCd / lead : 0; } // tell only during wind-up, not the dash
    else if (b.kind === "burst") { lead = 0.75; tele = b.fireCd < lead ? 1 - b.fireCd / lead : 0; }
    else if (b.kind === "weaver") { lead = 0.6; tele = b.fireCd < lead ? 1 - b.fireCd / lead : 0; }
    else if (!b.kind && b.shooter) { lead = 0.6; tele = b.fireCd < lead ? 1 - b.fireCd / lead : 0; }
    if (tele <= 0) return;
    const c = b.color;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.globalAlpha = Math.min(1, tele);
    if (b.kind === "charger") { // dash path the boss is about to take
      const ang = Math.atan2(player.y - b.y, player.x - b.x);
      ctx.strokeStyle = `rgba(${c},${0.5 * tele})`; ctx.lineWidth = 3 * dpr; ctx.setLineDash([9 * dpr, 9 * dpr]);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * 460 * dpr, Math.sin(ang) * 460 * dpr); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = `rgba(${c},${0.4 + 0.5 * tele})`;
    ctx.lineWidth = (2 + 5 * tele) * dpr;
    ctx.shadowColor = `rgba(${c},0.95)`; ctx.shadowBlur = (10 + 22 * tele) * dpr;
    ctx.beginPath(); ctx.arc(0, 0, b.r + (6 + 16 * tele) * dpr, 0, 6.283185); ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }

  // boss — big menacing spiked orb with a glaring eye, in its own colour.
  // Deliberately unlike the small glowy powerup icons: spiky, dark-bodied, an eye.
  function drawBoss(boss) {
    const c = boss.color;
    const pulse = 1 + Math.sin(boss.t * 4) * 0.08;
    const R = boss.r * pulse;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // corona — a distinct silhouette per archetype so each boss reads at a glance
    ctx.shadowColor = `rgba(${c},0.95)`; ctx.shadowBlur = 26 * dpr;
    ctx.fillStyle = `rgba(${c},0.9)`; ctx.strokeStyle = `rgba(${c},0.95)`; ctx.lineCap = "round";
    const k = boss.kind;
    if (k === "spiral") {            // pinwheel of curved arms
      ctx.rotate(boss.t * 1.2);
      for (let a = 0; a < 5; a++) {
        const a0 = (6.283185 / 5) * a;
        ctx.beginPath(); ctx.moveTo(0, 0);
        for (let s = 0; s <= 8; s++) { const u = s / 8, ang = a0 + u * 1.1, rad = R * (0.6 + u); ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); }
        for (let s = 8; s >= 0; s--) { const u = s / 8, ang = a0 + u * 1.1 + 0.26, rad = R * (0.6 + u); ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); }
        ctx.closePath(); ctx.fill();
      }
      ctx.rotate(-boss.t * 1.2);
    } else if (k === "burst") {      // long thin radiating rays
      ctx.rotate(boss.t * 0.5); ctx.lineWidth = 2.6 * dpr;
      for (let a = 0; a < 16; a++) { const ang = (6.283185 / 16) * a; ctx.beginPath(); ctx.moveTo(Math.cos(ang) * R, Math.sin(ang) * R); ctx.lineTo(Math.cos(ang) * R * 1.75, Math.sin(ang) * R * 1.75); ctx.stroke(); }
      ctx.rotate(-boss.t * 0.5);
    } else if (k === "charger") {    // arrowhead ram aimed at the player
      const look = Math.atan2(player.y - boss.y, player.x - boss.x);
      ctx.rotate(look);
      ctx.beginPath(); ctx.moveTo(R * 1.95, 0); ctx.lineTo(R * 0.55, -R * 0.95); ctx.lineTo(R * 0.55, R * 0.95); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-R * 0.4, -R * 0.8); ctx.lineTo(-R * 1.35, -R * 1.1); ctx.lineTo(-R * 0.5, -R * 0.15); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-R * 0.4, R * 0.8); ctx.lineTo(-R * 1.35, R * 1.1); ctx.lineTo(-R * 0.5, R * 0.15); ctx.closePath(); ctx.fill();
      ctx.rotate(-look);
    } else if (k === "splitter") {   // broken segmented ring — looks ready to split
      ctx.rotate(boss.t * 0.6); ctx.lineWidth = 5 * dpr;
      for (let a = 0; a < 6; a++) { const a0 = (6.283185 / 6) * a + 0.12; ctx.beginPath(); ctx.arc(0, 0, R * 1.4, a0, a0 + 6.283185 / 6 - 0.34); ctx.stroke(); }
      ctx.rotate(-boss.t * 0.6);
    } else if (k === "weaver") {     // hexagonal web lattice
      ctx.rotate(boss.t * 0.4); ctx.lineWidth = 2 * dpr;
      const pts = [];
      for (let a = 0; a < 6; a++) { const ang = (Math.PI / 3) * a; pts.push([Math.cos(ang) * R * 1.5, Math.sin(ang) * R * 1.5]); }
      ctx.beginPath(); pts.forEach(([x, y], a) => (a ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      for (let a = 0; a < 6; a++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(pts[a][0], pts[a][1]); ctx.stroke(); }
      ctx.rotate(-boss.t * 0.4);
    } else {                          // non-arena bosses: jagged 12-spike star
      ctx.rotate(boss.t * 0.8);
      ctx.beginPath();
      for (let i = 0; i < 24; i++) { const ang = (Math.PI / 12) * i, rad = i % 2 ? R * 1.55 : R * 1.05; const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill();
      ctx.rotate(-boss.t * 0.8);
    }
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

  // arena pickup fade: full while fresh, blinks + fades over the last 2.5s of its life
  function pickupAlpha(p) {
    const left = PICKUP_TTL - (elapsed - p.born);
    if (left > 2.5) return 1;
    const blink = ((elapsed * 6) | 0) % 2 ? 0.35 : 1; // urgent blink as it's about to vanish
    return Math.max(0, left / 2.5) * blink;
  }

  // arena weapon drop — a glowing diamond with a per-kind glyph + colour
  const WEAPON_COLOR = { spread: "255,200,90", rapid: "150,255,210", homing: "120,196,255", ricochet: "120,255,190", mortar: "255,140,60", wave: "199,116,232", dart: "170,255,215" };
  const WEAPON_GLYPH = { spread: "≪", rapid: "»", homing: "◎", ricochet: "⇆", mortar: "➤", wave: "≈", dart: "↑" };
  function drawWeaponPickup(cx, cy, t, kind, alpha) {
    const c = WEAPON_COLOR[kind] || "150,255,210";
    const R = (STAR_R * 1.6 + 2 + Math.sin(t * 5) * 1.5) * dpr;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.shadowColor = `rgba(${c},0.9)`; ctx.shadowBlur = 16 * dpr;
    ctx.lineWidth = 2.6 * dpr; ctx.strokeStyle = `rgba(${c},0.96)`;
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-R * 0.62, -R * 0.62, R * 1.24, R * 1.24); // diamond
    ctx.rotate(-Math.PI / 4);
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${c},0.98)`;
    ctx.font = `700 ${24 * dpr}px "General Sans", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(WEAPON_GLYPH[kind] || "»", 0, dpr);
    // name label below, so it's obvious which weapon (and that it IS a weapon)
    ctx.font = `700 ${10 * dpr}px "General Sans", system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillStyle = `rgba(${c},0.95)`;
    ctx.fillText("⬗ " + WEAPONS[kind].name.toUpperCase(), 0, R + 5 * dpr);
    ctx.restore();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }

  // arena buff drop — a glowing hexagon with a per-kind glyph + colour
  const BUFF_STYLE = {
    shield: ["150,225,255", "⬡"], frenzy: ["255,106,213", "✸"],
    power:  ["255,138,96", "✦"],  bounce: ["120,255,190", "⟲"], freeze: ["190,240,255", "❄"],
    heal:   ["255,90,120", "♥"], levelup: ["255,236,120", "▲"], overdrive: ["120,255,255", "★"], blade: ["230,245,255", "⚔"], dual: ["255,180,90", "⚌"], starbomb: ["255,240,150", "✷"], repel: ["150,210,255", "⤜"],
  };
  const BUFF_NAME = { shield: "Shield", frenzy: "Frenzy", power: "Power", bounce: "Bounce", freeze: "Freeze", heal: "Heal", levelup: "Level Up", overdrive: "Overdrive", blade: "Blade", dual: "Dual wield", starbomb: "Star bomb", repel: "Repel" };
  function drawBuffPickup(cx, cy, t, kind, alpha) {
    const st = BUFF_STYLE[kind] || ["150,255,210", "✦"], c = st[0];
    const R = (STAR_R * 1.6 + 1 + Math.sin(t * 5) * 1.5) * dpr;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy); ctx.rotate(t * 0.4);
    ctx.shadowColor = `rgba(${c},0.9)`; ctx.shadowBlur = 16 * dpr;
    ctx.lineWidth = 2.6 * dpr; ctx.strokeStyle = `rgba(${c},0.96)`;
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) { const a = (Math.PI / 3) * i; const x = Math.cos(a) * R, y = Math.sin(a) * R; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.rotate(-t * 0.4);
    ctx.shadowBlur = 0;
    if (kind === "bounce") {
      // a coiled spring — reads as bounce/ricochet
      ctx.strokeStyle = `rgba(${c},0.98)`; ctx.lineWidth = 2 * dpr; ctx.lineCap = "round"; ctx.lineJoin = "round";
      const sr = R * 0.42, turns = 4, top = -R * 0.5, bot = R * 0.5, seg = 24;
      ctx.beginPath();
      ctx.moveTo(-sr * 0.6, top); ctx.lineTo(sr * 0.6, top); // top cap
      for (let i = 0; i <= seg; i++) { const u = i / seg; const y = top + (bot - top) * u; const x = Math.sin(u * turns * 6.283185) * sr; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.moveTo(-sr * 0.6, bot); ctx.lineTo(sr * 0.6, bot); // bottom cap
      ctx.stroke();
    } else {
      ctx.fillStyle = `rgba(${c},0.98)`;
      ctx.font = `700 ${22 * dpr}px "General Sans", system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(st[1], 0, dpr);
    }
    // name label below — names the buff and marks it as a power-up (hexagon, not weapon diamond)
    ctx.font = `700 ${10 * dpr}px "General Sans", system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    ctx.fillStyle = `rgba(${c},0.95)`;
    ctx.fillText("⬡ " + (BUFF_NAME[kind] || kind).toUpperCase(), 0, R + 5 * dpr);
    ctx.restore();
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
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
      ctx.fillStyle = grd; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); // bounded to the blob, not the whole screen
      i++;
    }
    // extra wandering mottle blobs drawn from the palette — more texture, always moving
    const gl = bm.glows, mott = MOBILE ? 3 : 6;
    for (let k = 0; k < mott; k++) {
      const [r, g, b] = gl[k % gl.length];
      const ph = k * 2.3 + 0.6;
      const cx = w * (0.5 + Math.sin(bgT * 0.07 + ph) * 0.46);
      const cy = h * (0.5 + Math.cos(bgT * 0.058 + ph * 1.6) * 0.46);
      const rad = D * (0.3 + 0.16 * Math.sin(bgT * 0.09 + ph));
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(${r},${g},${b},${0.10 * am})`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); // bounded to the blob, not the whole screen
    }
    // light splodges — soft pale highlights drifting the other way, lifts the mood
    for (let k = 0; k < (MOBILE ? 1 : 3); k++) {
      const ph = k * 2.7 + 2.2;
      const cx = w * (0.5 + Math.cos(bgT * 0.045 + ph) * 0.44);
      const cy = h * (0.5 + Math.sin(bgT * 0.067 + ph * 1.2) * 0.44);
      const rad = D * (0.24 + 0.12 * Math.sin(bgT * 0.1 + ph));
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(225,235,255,${0.07 * am})`);
      grd.addColorStop(1, "rgba(225,235,255,0)");
      ctx.fillStyle = grd; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); // bounded to the blob, not the whole screen
    }
    // dark drifting patches — carve out shadowed regions for more contrast
    for (let k = 0; k < (MOBILE ? 3 : 5); k++) {
      const ph = k * 3.1 + 1.4;
      const cx = w * (0.5 + Math.sin(bgT * 0.063 + ph) * 0.46);
      const cy = h * (0.5 + Math.cos(bgT * 0.05 + ph * 1.5) * 0.46);
      const rad = D * (0.26 + 0.12 * Math.sin(bgT * 0.08 + ph));
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(4,3,10,${0.34 * am})`);
      grd.addColorStop(1, "rgba(4,3,10,0)");
      ctx.fillStyle = grd; ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); // bounded to the blob, not the whole screen
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
    const a = 0.13 * am;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.lineWidth = 1 * dpr;
    const zoom = mode === "idle" ? 1 + 0.18 * Math.sin(bgT * 0.05) : 1; // idle: patterns slowly zoom in + out (~2-min cycle)
    const step = 64 * dpr * zoom;
    // patOffX/Y accumulate in CSS px (dpr-independent); we scale by dpr only here, at draw.
    // So the visible phase is dpr*(patOff mod 64) — unchanged by a window resize (same dpr,
    // same phase) AND by a zoom (dpr cancels). The pattern never rephases/jumps on resize.
    // Direction changes only affect future velocity, so a biome swap never teleports it.
    const wrap = (v, m) => ((v % m) + m) % m;
    const dx = patOffX * dpr, dy = patOffY * dpr;
    const ox = wrap(dx, step), oy = wrap(dy, step);
    if (type === "grid") {
      ctx.beginPath();
      for (let x = ox - step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = oy - step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else if (type === "dots") {
      const r = 1.6 * dpr;
      for (let x = ox - step; x < w + step; x += step) for (let y = oy - step; y < h + step; y += step) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283185); ctx.fill();
      }
    } else if (type === "rings") {
      const max = Math.hypot(w, h); // centre wanders continuously so the expansion reset never reads as a snap
      const cx = w / 2 + Math.sin(patOffX * 0.004) * w * 0.14, cy = h / 2 + Math.cos(patOffY * 0.004) * h * 0.14;
      ctx.beginPath();
      // expansion + spacing both in device px (×dpr) → phase is dpr-stable, no jump on zoom
      for (let rad = (bgT * 6 * dpr) % (step * 1.6) + 8 * dpr; rad < max + step; rad += step * 1.6) { ctx.moveTo(cx + rad, cy); ctx.arc(cx, cy, rad, 0, 6.283185); }
      ctx.stroke();
    } else if (type === "diag") {
      const gap = step * 1.4, od = wrap(dx + dy, gap);
      ctx.beginPath();
      for (let x = -h + od - gap; x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); }
      ctx.stroke();
    } else if (type === "weave") { // cross-hatch (both diagonals)
      const gap = step * 1.4, od = wrap(dx + dy, gap);
      ctx.beginPath();
      for (let x = -h + od - gap; x < w; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); }
      ctx.stroke();
    } else if (type === "cross") { // small plus marks on a grid
      const s = 5 * dpr;
      for (let x = ox - step; x < w + step; x += step) for (let y = oy - step; y < h + step; y += step) {
        ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.stroke();
      }
    } else if (type === "wave") { // sine bands drifting vertically with the biome direction
      for (let y = oy - step; y < h + step; y += step) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12 * dpr) {
          const yy = y + Math.sin(x / (90 * dpr) + bgT * 0.4 + y) * 10 * dpr;
          x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    } else if (type === "hex") { // staggered dot lattice
      const r = 1.7 * dpr; let row = 0;
      for (let y = oy - step; y < h + step; y += step * 0.86) {
        const xo = (row % 2) * step / 2 + ox - step;
        for (let x = xo; x < w + step; x += step) { ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283185); ctx.fill(); }
        row++;
      }
    } else if (type === "diamond") { // small filled diamonds on a grid — one fill for the whole field
      const s = 3.4 * dpr;
      ctx.beginPath();
      for (let x = ox - step; x < w + step; x += step) for (let y = oy - step; y < h + step; y += step) {
        ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
      }
      ctx.fill();
    } else if (type === "tri") { // outlined triangle lattice — one stroked path
      ctx.beginPath();
      for (let y = oy - step; y < h + step; y += step) for (let x = ox - step; x < w + step; x += step) {
        ctx.moveTo(x, y + step * 0.42); ctx.lineTo(x + step * 0.5, y - step * 0.42); ctx.lineTo(x + step, y + step * 0.42);
      }
      ctx.stroke();
    } else if (type === "chevron") { // rows of soft zigzags drifting with the biome
      ctx.beginPath();
      for (let y = oy - step; y < h + step; y += step) for (let x = ox - step; x < w + step; x += step) {
        ctx.moveTo(x, y); ctx.lineTo(x + step * 0.5, y - step * 0.4); ctx.lineTo(x + step, y);
      }
      ctx.stroke();
    } else if (type === "scales") { // overlapping fish-scale arcs, staggered rows
      let row = 0;
      ctx.beginPath();
      for (let y = oy - step; y < h + step; y += step * 0.6) {
        const xo = (row % 2) * step / 2 + ox - step;
        for (let x = xo; x < w + step; x += step) { ctx.moveTo(x + step * 0.5, y); ctx.arc(x, y, step * 0.5, 0, Math.PI); }
        row++;
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // pick the next pattern + drift direction; applied only once faded out (see drawBiome)
  function queuePattern() {
    const np = PATTERN_KEYS[(Math.random() * PATTERN_KEYS.length) | 0], nd = Math.random() * 6.283185; // "none" allowed → occasional clean breather
    if (pattern === null) { pattern = np; patternDir = nd; } else { pendingPattern = np; pendingDir = nd; }
  }
  let bgT = 0, nextPatternAt = 0, patFade = 1;
  function drawBiome() {
    bgT += 0.016; // own clock so the wash animates even on menus
    patOffX += Math.cos(patternDir) * 0.4; patOffY += Math.sin(patternDir) * 0.4; // gentle, slow pattern drift
    // pattern on its OWN quick clock (~10–16s), fully independent of biome shifts. A short
    // dedicated fade-out/in hides each swap — NOT the slow breath, which used to bottleneck
    // changes to once a minute. Games are short, so the pattern cycles briskly.
    if (pendingPattern === null && bgT >= nextPatternAt) { queuePattern(); nextPatternAt = bgT + 10 + Math.random() * 6; }
    if (pendingPattern !== null) { patFade -= 0.045; if (patFade <= 0) { patFade = 0; pattern = pendingPattern; patternDir = pendingDir; pendingPattern = null; } }
    else if (patFade < 1) patFade = Math.min(1, patFade + 0.03);
    if (biomeFade < 1 && prevBiome) paintBiome(prevBiome, 1 - biomeFade);
    const f = biomeFade < 1 ? biomeFade : 1;
    paintBiome(biome, f);
    const pb = 0.55 + 0.45 * Math.sin(bgT * 0.11); // gentle breathing (never fully gone), independent of swaps
    paintPattern(pattern, patFade * pb);
  }

  // transient wave/level title + small persistent progress label (non-classic modes)
  function drawHud() {
    if (mode === "idle") { // screensaver: just a faint exit hint, no score chrome
      if (!running) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = `600 ${12 * uiScale}px "General Sans", system-ui, sans-serif`;
      ctx.fillStyle = `rgba(255,255,255,${0.12 + 0.06 * Math.sin(bgT * 0.6)})`; // gentle pulse
      ctx.fillText(MOBILE ? "tap for menu" : "click for menu", w / 2, h - 26 * dpr);
      ctx.restore();
      return;
    }
    if (mode === "classic" || !running) return;
    ctx.save();
    ctx.textAlign = "center";
    if (mode === "arena") {
      // bottom-centred stack: HP hearts, weapon icon+name, stat line, active buff chips (clears the pause btn)
      const cx = w / 2;
      // hearts
      const hs = 20 * dpr, hy = h - 140 * dpr, x0 = cx - (playerMaxHp - 1) * hs / 2;
      ctx.font = `${16 * uiScale}px system-ui, sans-serif`;
      for (let i = 0; i < playerMaxHp; i++) {
        const lost = i >= playerHp;
        ctx.fillStyle = lost ? "rgba(255,255,255,0.25)" : "rgba(255,90,120,0.95)";
        ctx.fillText(lost ? "♡" : "♥", x0 + i * hs, hy);
      }
      // weapon icon + name + level (icon in the weapon's colour)
      const wc = WEAPON_COLOR[weapon] || "150,255,210", glyph = WEAPON_GLYPH[weapon] || "»";
      const name = WEAPONS[weapon].name.toUpperCase() + "  Lv" + weaponLvl + (fireHold ? "  · CEASEFIRE" : "");
      const iconFont = `700 ${19 * uiScale}px "General Sans", system-ui, sans-serif`;
      const nameFont = `700 ${15 * uiScale}px "General Sans", system-ui, sans-serif`;
      ctx.font = iconFont; const iconW = ctx.measureText(glyph).width;
      ctx.font = nameFont; const nameW = ctx.measureText(name).width;
      const igap = 9 * dpr, sx = cx - (iconW + igap + nameW) / 2;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.font = iconFont; ctx.fillStyle = `rgba(${wc},0.95)`;
      ctx.shadowColor = `rgba(${wc},0.7)`; ctx.shadowBlur = 8 * dpr;
      ctx.fillText(glyph, sx, h - 110 * dpr);
      ctx.shadowBlur = 0;
      ctx.font = nameFont; ctx.fillStyle = "rgba(255,255,255,0.78)";
      ctx.fillText(name, sx + iconW + igap, h - 110 * dpr);
      ctx.textAlign = "center";
      // stat line — each stat coloured in the colour of whatever buff is boosting it
      const odv = buffs.overdrive > elapsed, pwr = buffs.power > elapsed, frz = buffs.frenzy > elapsed;
      const ws = weaponStats(odv ? weaponLvl + 10 : weaponLvl);
      const eDmg = ws.dmg * (pwr ? powerMul() : 1), eRate = (1 / ws.gap) * (frz ? 2 : 1);
      const extra = weapon === "spread" ? `${ws.count}× pellet` : weapon === "wave" ? "shockwave" : weapon === "homing" ? `${ws.count}× seek` : weapon === "ricochet" ? "ricochet" : ws.count > 1 ? `${ws.count}× shot` : "";
      const dmgCol = pwr ? "255,138,96" : odv ? "120,255,255" : "255,255,255";
      const rateCol = frz ? "255,106,213" : odv ? "120,255,255" : "255,255,255";
      const dim = "255,255,255";
      const segs = [[`DMG ${eDmg.toFixed(1)}`, dmgCol, pwr || odv ? 0.95 : 0.42], [" · ", dim, 0.42], [`${eRate.toFixed(1)}/s`, rateCol, frz || odv ? 0.95 : 0.42]];
      if (extra) segs.push([" · " + extra, dim, 0.42]);
      ctx.font = `600 ${11 * uiScale}px "General Sans", system-ui, sans-serif`;
      ctx.textAlign = "left";
      let stw = 0; for (const s of segs) stw += ctx.measureText(s[0]).width;
      let stx = cx - stw / 2;
      for (const [txt, col, a] of segs) { ctx.fillStyle = `rgba(${col},${a})`; ctx.fillText(txt, stx, h - 92 * dpr); stx += ctx.measureText(txt).width; }
      ctx.textAlign = "center";
      // buffs
      const active = [];
      if (shieldActive || buffs.shield > elapsed) active.push(["SHIELD", "150,225,255"]);
      if (elapsed < frozenUntil) active.push(["FREEZE", "190,240,255"]);
      if (buffs.frenzy > elapsed) active.push(["FRENZY", "255,106,213"]);
      if (buffs.power > elapsed) active.push(["POWER", "255,138,96"]);
      if (buffs.bounce > elapsed) active.push(["BOUNCE", "120,255,190"]);
      if (buffs.repel > elapsed) active.push(["REPEL", "150,210,255"]);
      if (buffs.overdrive > elapsed) active.push(["OVERDRIVE", "120,255,255"]);
      if (buffs.blade > elapsed) active.push(["BLADE", "230,245,255"]);
      if (buffs.dual > elapsed) active.push(["DUAL " + (WEAPONS[dualWeapon] ? WEAPONS[dualWeapon].name.toUpperCase() : ""), "255,180,90"]);
      if (active.length) {
        ctx.font = `700 ${11 * uiScale}px "General Sans", system-ui, sans-serif`;
        const gap = ctx.measureText("   ").width;
        const widths = active.map((a) => ctx.measureText(a[0]).width);
        let bx = cx - (widths.reduce((s, x) => s + x, 0) + gap * (active.length - 1)) / 2;
        ctx.textAlign = "left";
        for (let i = 0; i < active.length; i++) {
          ctx.fillStyle = `rgba(${active[i][1]},0.9)`;
          ctx.fillText(active[i][0], bx, h - 74 * dpr);
          bx += widths[i] + gap;
        }
        ctx.textAlign = "center";
      }
      // weapon table — every weapon, its icon + stored level; current one marked
      const order = ["dart", "spread", "rapid", "homing", "ricochet", "mortar", "wave"];
      const tx = 22 * dpr, rh = 24 * dpr;
      let ty = h * 0.5 - (order.length * rh) / 2;
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      for (const k of order) {
        const lvl = weaponLvls[k] || 0, owned = lvl > 0, cur = k === weapon;
        const col = WEAPON_COLOR[k] || "200,200,200";
        ctx.font = `700 ${17 * uiScale}px "General Sans", system-ui, sans-serif`;
        ctx.fillStyle = `rgba(${col},${cur ? 1 : owned ? 0.75 : 0.3})`;
        ctx.fillText(WEAPON_GLYPH[k] || "»", tx, ty);
        ctx.font = `600 ${11 * uiScale}px "General Sans", system-ui, sans-serif`;
        ctx.fillStyle = `rgba(255,255,255,${cur ? 0.92 : owned ? 0.6 : 0.3})`;
        ctx.fillText(WEAPONS[k].name + (owned ? "  Lv" + lvl : ""), tx + 22 * dpr, ty);
        ty += rh;
      }
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    } else {
      const label = mode === "waves"
        ? "WAVE " + wave + (biome ? "  ·  " + biome.name : "")
        : (journeyIdx + 1) + "/" + JOURNEY.length + "  ·  " + (JOURNEY[journeyIdx] ? JOURNEY[journeyIdx].name : "");
      ctx.font = `600 ${13 * uiScale}px "General Sans", system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      // desktop: bottom-centre, well above the pause button (matches arena). mobile: keep
      // it up top below the HUD — bottom gets too busy next to the pause button + thumb.
      ctx.fillText(label.toUpperCase(), w / 2, MOBILE ? 58 * dpr : h - 92 * dpr);
    }
    // banner: title fades in then out by `until`; the sub line can outlast it (subUntil)
    // and fade slowly, so the enemy briefing lingers after the title is gone.
    const bSubEnd = banner ? (banner.subUntil || banner.until) : 0;
    if (banner && elapsed < bSubEnd) {
      const from = banner.from != null ? banner.from : banner.until - 2.4;
      const fadeIn = Math.max(0, Math.min(1, (elapsed - from) / 0.4));
      const titleA = Math.max(0, Math.min(fadeIn, (banner.until - elapsed) / 0.5));
      const subFade = banner.subUntil ? 1.6 : 0.5; // a lingering sub fades out slowly
      const subA = Math.max(0, Math.min(fadeIn, (bSubEnd - elapsed) / subFade));
      if (titleA > 0.001) {
        ctx.font = `700 ${44 * uiScale}px "Clash Display", system-ui, sans-serif`;
        if (mode === "arena") { // rainbow sweep for the BULLET HELL title
          const tw = ctx.measureText(banner.big).width;
          const g = ctx.createLinearGradient(w / 2 - tw / 2, 0, w / 2 + tw / 2, 0);
          for (let s = 0; s <= 6; s++) g.addColorStop(s / 6, `hsla(${(s * 60 + elapsed * 120) % 360},100%,65%,${titleA})`);
          ctx.fillStyle = g;
          ctx.shadowColor = `hsla(${(elapsed * 120) % 360},100%,60%,${titleA * 0.7})`; ctx.shadowBlur = 22 * dpr;
        } else ctx.fillStyle = `rgba(255,255,255,${titleA})`;
        ctx.fillText(banner.big, w / 2, h * 0.42);
        ctx.shadowBlur = 0;
      }
      if (banner.sub && subA > 0.001) {
        ctx.font = `600 ${18 * uiScale}px "General Sans", system-ui, sans-serif`;
        ctx.fillStyle = `rgba(200,220,255,${subA * 0.85})`;
        // word-wrap the sub so a full enemy line fits on screen (short subs stay one line)
        const maxW = Math.min(w * 0.82, 640 * uiScale), words = banner.sub.split(" ");
        let line = "", lines = [];
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = word; }
          else line = test;
        }
        if (line) lines.push(line);
        const lh = 24 * uiScale;
        for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], w / 2, h * 0.42 + 34 * uiScale + i * lh);
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
    ctx.fillText(MOBILE ? "tap to resume" : "press P / Space or tap to resume" + " · H for help", w / 2, h * 0.46 + 36 * uiScale);
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
        if (killed) { points += killed * KILL_VAL; showPts(); }
        // bosses the front reaches: a Missile shock (s.dmg) chips once; a star blast pops them
        for (let bi = bosses.length - 1; bi >= 0; bi--) {
          const b = bosses[bi];
          const dx = b.x - s.x, dy = b.y - s.y;
          if (dx * dx + dy * dy <= r2) {
            if (s.dmg) { if (s.hitB.has(b)) continue; s.hitB.add(b); b.hp -= s.dmg; if (b.hp > 0) continue; }
            popInto(b.x, b.y, b.color, 8);
            points += BOSS_VAL; showPts();
            shocks.push({ x: b.x, y: b.y, t: 0, max: 200 * dpr });
            bossDrop(b.x, b.y);
            bosses.splice(bi, 1);
            if (mode === "arena" && bosses.length === 0) nextArenaBoss = elapsed + 8 + Math.random() * 5;
          }
        }
        if (mode === "classic" && bosses.length === 0) nextBoss = elapsed + 24 + Math.random() * 14;
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, rad, 0, 6.283185);
      ctx.lineWidth = (s.fat ? 14 : s.rainbow || s.ice ? 5 : 2) * dpr;
      ctx.strokeStyle = s.rainbow
        ? `hsla(${(s.t * 360) | 0},100%,65%,${(1 - s.t) * 0.9})`
        : s.ice
        ? `rgba(150,225,255,${(1 - s.t) * 0.85})`
        : `rgba(255,248,120,${(1 - s.t) * 0.5})`;
      if (s.fat) { ctx.shadowColor = `hsla(${(s.t * 360) | 0},100%,65%,0.8)`; ctx.shadowBlur = 18 * dpr; }
      ctx.stroke();
      if (s.fat) ctx.shadowBlur = 0;
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
    for (const b of bosses) { drawBossTelegraph(b); drawBoss(b); if (b.maxHp) drawBossHealth(b); }

    // boss shots — bright menacing darts in the boss's colour
    if (enemyBullets.length) {
      ctx.save();
      ctx.lineCap = "round"; ctx.lineWidth = 4 * dpr; // no per-bullet shadowBlur (boss spam = many)
      for (const eb of enemyBullets) {
        const s = Math.hypot(eb.vx, eb.vy) || 1, ux = eb.vx / s, uy = eb.vy / s, len = 13 * dpr;
        ctx.strokeStyle = `rgba(${eb.color},0.95)`;
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

    // arena weapon + buff pickups (fade out as they near their despawn time)
    for (const wp of weaponPickups) { wp.t += 0.05; drawWeaponPickup(wp.x, wp.y, wp.t, wp.kind, pickupAlpha(wp)); }
    for (const bp of buffPickups) { bp.t += 0.05; drawBuffPickup(bp.x, bp.y, bp.t, bp.kind, pickupAlpha(bp)); }

    // darts/projectiles in flight — coloured per weapon; Lv10 turns them rainbow
    if (bullets.length) {
      ctx.save();
      ctx.lineCap = "round";
      // active powerup tints the bullets' glow (set once for the whole pass to stay cheap)
      // active powerup glows the bullet's own outline (Overdrive excluded — it's already rainbow)
      const glowCol = buffs.power > elapsed ? "255,138,96" : buffs.frenzy > elapsed ? "255,106,213" : buffs.bounce > elapsed ? "120,255,190" : null;
      if (glowCol) { ctx.shadowColor = `rgba(${glowCol},1)`; ctx.shadowBlur = 14 * dpr; }
      for (const bl of bullets) {
        const br = bl.r || 5 * dpr;
        const base = bl.col || "150,255,210";
        const hue = (elapsed * 320 + bl.x * 0.5 + bl.y * 0.5) % 360;
        const solid = bl.rainbow ? `hsl(${hue},100%,65%)` : `rgba(${base},0.96)`;
        const faint = bl.rainbow ? `hsla(${hue},100%,65%,0.22)` : `rgba(${base},0.22)`;
        const s = Math.hypot(bl.vx, bl.vy) || 1, ux = bl.vx / s, uy = bl.vy / s, px = -uy, py = ux;
        // motion trail — grows from 0 as the bullet leaves (no full-length streak over the player)
        const tlen = Math.min(br * 3, s * (bl.age || 0));
        if (tlen > 1) { ctx.strokeStyle = faint; ctx.lineWidth = br * 1.1; ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x - ux * tlen, bl.y - uy * tlen); ctx.stroke(); }
        ctx.strokeStyle = solid; ctx.fillStyle = solid;
        const k = bl.kind;
        if (k === "homing") {                       // round seeker orb + short tail
          ctx.lineWidth = br * 0.6; ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x - ux * br * 2.6, bl.y - uy * br * 2.6); ctx.stroke();
          ctx.beginPath(); ctx.arc(bl.x, bl.y, br * 0.95, 0, 6.283185); ctx.fill();
        } else if (k === "spread") {                 // short pellet streak (not a blob)
          ctx.lineWidth = br * 0.9; ctx.beginPath(); ctx.moveTo(bl.x + ux * br * 0.6, bl.y + uy * br * 0.6); ctx.lineTo(bl.x - ux * br * 1.3, bl.y - uy * br * 1.3); ctx.stroke();
        } else if (k === "ricochet") {               // spinning diamond
          ctx.beginPath();
          ctx.moveTo(bl.x + ux * br * 1.4, bl.y + uy * br * 1.4);
          ctx.lineTo(bl.x + px * br, bl.y + py * br);
          ctx.lineTo(bl.x - ux * br * 1.4, bl.y - uy * br * 1.4);
          ctx.lineTo(bl.x - px * br, bl.y - py * br);
          ctx.closePath(); ctx.fill();
        } else if (k === "rapid") {                  // short thick dash
          ctx.lineWidth = br * 1.1; ctx.beginPath(); ctx.moveTo(bl.x + ux * br, bl.y + uy * br); ctx.lineTo(bl.x - ux * br * 1.6, bl.y - uy * br * 1.6); ctx.stroke();
        } else if (k === "mortar") {                 // heavy round bomb with a ring
          ctx.beginPath(); ctx.arc(bl.x, bl.y, br, 0, 6.283185); ctx.fill();
          ctx.lineWidth = 1.6 * dpr; ctx.beginPath(); ctx.arc(bl.x, bl.y, br * 1.5, 0, 6.283185); ctx.stroke();
        } else if (k === "wave") {                   // fat wavefront chunk — bar across the travel direction
          ctx.lineWidth = br * 1.1;
          ctx.beginPath(); ctx.moveTo(bl.x - px * br * 1.3, bl.y - py * br * 1.3); ctx.lineTo(bl.x + px * br * 1.3, bl.y + py * br * 1.3); ctx.stroke();
        } else if (k === "pill") {                   // classic/waves/journey shot — plain capsule (round-capped), no arrowhead
          ctx.lineWidth = br * 1.5;
          const half = br * 1.1;
          ctx.beginPath(); ctx.moveTo(bl.x + ux * half, bl.y + uy * half); ctx.lineTo(bl.x - ux * half, bl.y - uy * half); ctx.stroke();
        } else {                                     // dart / default — streak + arrowhead
          const len = Math.max(11 * dpr, br * 2.2);
          ctx.lineWidth = Math.max(3 * dpr, br * 0.7);
          ctx.beginPath(); ctx.moveTo(bl.x, bl.y); ctx.lineTo(bl.x - ux * len, bl.y - uy * len); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bl.x + ux * br * 1.4, bl.y + uy * br * 1.4);
          ctx.lineTo(bl.x + px * br * 0.8 - ux * br * 0.6, bl.y + py * br * 0.8 - uy * br * 0.6);
          ctx.lineTo(bl.x - px * br * 0.8 - ux * br * 0.6, bl.y - py * br * 0.8 - uy * br * 0.6);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.restore(); ctx.shadowBlur = 0;
    }


    // Repel buff — a glowing keep-away bubble with outward ripples
    if (mode === "arena" && buffs.repel > elapsed && playerAlpha > 0.3) {
      const fieldR = 185 * dpr * arenaScale;
      const g = ctx.createRadialGradient(player.x, player.y, fieldR * 0.45, player.x, player.y, fieldR);
      g.addColorStop(0, "rgba(150,210,255,0)"); g.addColorStop(0.75, "rgba(150,210,255,0.05)"); g.addColorStop(1, "rgba(160,215,255,0.2)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(player.x, player.y, fieldR, 0, 6.283185); ctx.fill();
      ctx.save(); ctx.lineCap = "round";
      for (let r = 0; r < 2; r++) { const t = (elapsed * 0.7 + r * 0.5) % 1, rad = fieldR * (0.35 + t * 0.65); ctx.strokeStyle = `rgba(150,210,255,${(1 - t) * 0.35})`; ctx.lineWidth = 2.5 * dpr; ctx.beginPath(); ctx.arc(player.x, player.y, rad, 0, 6.283185); ctx.stroke(); }
      ctx.strokeStyle = `rgba(180,225,255,${0.45 + 0.2 * Math.sin(elapsed * 5)})`; ctx.lineWidth = 2.5 * dpr;
      ctx.beginPath(); ctx.arc(player.x, player.y, fieldR, 0, 6.283185); ctx.stroke();
      ctx.restore();
    }

    // Blade buff — glowing spinning blade + a trailing sweep arc
    if (mode === "arena" && buffs.blade > elapsed && playerAlpha > 0.3) {
      const blLen = 124 * dpr * arenaScale, ca = Math.cos(bladeAng), sa = Math.sin(bladeAng);
      ctx.save(); ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(238,249,255,0.96)"; ctx.lineWidth = 4 * dpr;
      ctx.shadowColor = "rgba(200,235,255,0.9)"; ctx.shadowBlur = 10 * dpr;
      ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(player.x + ca * blLen, player.y + sa * blLen); ctx.stroke();
      ctx.restore(); ctx.shadowBlur = 0;
    }

    // arena aim reticle (cursor is hidden mid-run) — dims to a ring during ceasefire
    if (mode === "arena" && running && playerAlpha > 0.3) {
      const rr = 9 * dpr, a = fireHold ? 0.35 : 0.9;
      ctx.save();
      ctx.strokeStyle = `rgba(150,255,210,${a})`; ctx.lineWidth = 2 * dpr; ctx.lineCap = "round";
      ctx.shadowColor = "rgba(120,255,190,0.8)"; ctx.shadowBlur = 8 * dpr;
      ctx.beginPath(); ctx.arc(aimX, aimY, rr, 0, 6.283185); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(aimX - rr * 1.7, aimY); ctx.lineTo(aimX - rr * 0.6, aimY);
      ctx.moveTo(aimX + rr * 0.6, aimY); ctx.lineTo(aimX + rr * 1.7, aimY);
      ctx.moveTo(aimX, aimY - rr * 1.7); ctx.lineTo(aimX, aimY - rr * 0.6);
      ctx.moveTo(aimX, aimY + rr * 0.6); ctx.lineTo(aimX, aimY + rr * 1.7);
      ctx.stroke();
      ctx.restore(); ctx.shadowBlur = 0;
    }

    // edge flash — amber for boss-incoming, red for hits; at 1 HP a red glow stays on
    const edgeWash = (col, a) => {
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.62);
      v.addColorStop(0, `rgba(${col},0)`); v.addColorStop(1, `rgba(${col},${a})`);
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    };
    if (elapsed < flashUntil) { // gentle fade in then out across the warning window
      const k = Math.max(0, Math.min(1, (elapsed - flashFrom) / 0.3, (flashUntil - elapsed) / 0.45));
      edgeWash(flashCol, k * (0.34 + 0.28 * Math.abs(Math.sin(elapsed * 7))));
    }
    if (mode === "arena" && running && playerHp === 1) { // constant red danger edge (slight pulse), eases in
      const k = Math.max(0, Math.min(1, (elapsed - lowHpFrom) / 0.5));
      edgeWash("255,40,60", k * (0.38 + 0.07 * Math.sin(elapsed * 4)));
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
      ctx.fillText(`×${mult}`, w / 2, 96 * dpr); // below the wave/level label, no overlap
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
    // shield ring (pickup / timed shield)
    if (shieldActive || buffs.shield > elapsed) {
      ctx.lineWidth = 2.5 * dpr;
      ctx.strokeStyle = `rgba(150,225,255,${0.6 + 0.3 * Math.sin(elapsed * 6)})`;
      ctx.beginPath(); ctx.arc(player.x, player.y, pr * 2.6, 0, 6.283185); ctx.stroke();
    }
    // arena recharging shield — solid ring when charged, a filling arc while recharging
    if (mode === "arena") {
      const rr = pr * 2.9;
      if (regenShield) {
        ctx.lineWidth = 2.5 * dpr;
        ctx.strokeStyle = `rgba(120,255,210,${0.55 + 0.3 * Math.sin(elapsed * 5)})`;
        ctx.shadowColor = "rgba(120,255,210,0.8)"; ctx.shadowBlur = 8 * dpr;
        ctx.beginPath(); ctx.arc(player.x, player.y, rr, 0, 6.283185); ctx.stroke();
        ctx.shadowBlur = 0;
      } else {
        const prog = Math.max(0, Math.min(1, 1 - (regenReadyAt - elapsed) / 4));
        ctx.lineWidth = 2 * dpr;
        ctx.strokeStyle = "rgba(120,255,210,0.18)";
        ctx.beginPath(); ctx.arc(player.x, player.y, rr, 0, 6.283185); ctx.stroke();
        ctx.strokeStyle = "rgba(120,255,210,0.85)";
        ctx.beginPath(); ctx.arc(player.x, player.y, rr, -Math.PI / 2, -Math.PI / 2 + prog * 6.283185); ctx.stroke();
      }
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

  // the over panel and the journey-win panel each have their own leaderboard widgets;
  // a "view" bundles one set of elements so the same load/submit logic drives both.
  const overView = { board: boardEl, submit: lbSubmitEl, initials: initialsEl, btn: submitScoreBtn, status: lbStatusEl };
  const winView = { board: winBoardEl, submit: winLbSubmitEl, initials: winInitialsEl, btn: winSubmitBtn, status: winStatusEl };
  async function loadBoard(myName, view = overView) {
    const board = view.board;
    if (!LB.url) { board.innerHTML = '<li class="lb__empty">leaderboard not set up</li>'; return; }
    board.innerHTML = '<li class="lb__empty">loading…</li>'; // clear stale (other-mode) rows first
    try {
      // prefer the per-mode board; if the `mode` column isn't set up yet, fall back
      // to the legacy single board so the leaderboard keeps working.
      let res = await fetch(`${LB.url}/rest/v1/scores?select=name,score&mode=eq.${mode}&order=score.desc&limit=${LB.limit}`, { headers: lbHeaders(), cache: "no-store" });
      if (!res.ok) res = await fetch(`${LB.url}/rest/v1/scores?select=name,score&order=score.desc&limit=${LB.limit}`, { headers: lbHeaders(), cache: "no-store" });
      if (!res.ok) throw 0;
      const list = await res.json();
      if (!list.length) { board.innerHTML = '<li class="lb__empty">no scores yet — be first</li>'; return; }
      let shownMine = false;
      board.innerHTML = list.map((e) => {
        const mine = !shownMine && myName && e.name === myName ? (shownMine = true, "me") : "";
        return `<li class="${mine}"><span class="nm">${escHtml(e.name)}</span><span class="sc">${Number(e.score).toFixed(1)}</span></li>`;
      }).join("");
    } catch {
      board.innerHTML = '<li class="lb__empty">leaderboard unavailable</li>';
    }
  }

  async function submitScore(view = overView) {
    if (!LB.url) { view.status.textContent = "leaderboard not set up yet"; return; }
    const name = (view.initials.value || "AAA").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3) || "AAA";
    view.btn.disabled = true;
    view.status.textContent = "submitting…";
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
      view.status.textContent = "saved!";
      view.submit.hidden = true;
      setTimeout(() => loadBoard(name, view), 700);
    } catch {
      view.status.textContent = "submit failed — try again";
      view.btn.disabled = false;
    }
  }

  // how-to-play overlay — opens over whichever menu is showing, returns to it
  const helpPanel = document.getElementById("help");
  let helpReturn = startPanel;
  const helpClassicEl = document.getElementById("help-classic"), helpArenaEl = document.getElementById("help-arena");
  function openHelp() {
    if (!helpPanel.hidden) return;
    // show only the current mode's section (null return = opened over a paused run)
    const arena = mode === "arena";
    helpClassicEl.style.display = arena ? "none" : "";
    helpArenaEl.style.display = arena ? "" : "none";
    helpReturn = !overPanel.hidden ? overPanel : !arenaStartPanel.hidden ? arenaStartPanel : !plotPanel.hidden ? plotPanel : startPanel.hidden ? null : startPanel;
    if (helpReturn) helpReturn.hidden = true;
    helpPanel.hidden = false;
  }
  function closeHelp() { helpPanel.hidden = true; if (helpReturn) helpReturn.hidden = false; }

  // pick a mode from the start menu → straight into play, or a plot card for Journey
  function chooseMode(m) {
    mode = m;
    loadBest();
    if (mode === "journey") { journeyIdx = 0; journeyTime = 0; journeyPts = 0; startPanel.hidden = true; showPlot(); }
    else if (mode === "arena") { startPanel.hidden = true; arenaStartPanel.hidden = false; } // pick a weapon first
    else start();
  }
  // return to the mode-select menu from win/over/plot
  function backToMenu() {
    running = false; dead = false; paused = false; celebrating = false; setPauseBtn();
    audio.setTriumph(false);
    overPanel.hidden = true; winPanel.hidden = true; plotPanel.hidden = true; helpPanel.hidden = true; arenaStartPanel.hidden = true;
    document.body.classList.remove("playing", "paused", "idle");
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
    if (!running || mode === "idle") return; // no pause in idle/screensaver
    paused = !paused;
    document.body.classList.toggle("paused", paused); // show the cursor while paused (keeps .playing → pause btn stays)
    setPauseBtn();
  }

  let muted = false;
  const muteLabel = (m) => (m ? "🔇 Muted" : "🔊 Sound on") + (MOBILE ? "" : " (M)");
  function toggleMute() { audio.resume(); muted = audio.toggleMute(); muteEl.textContent = muteLabel(muted); if (muted && window.speechSynthesis) { speechQ = []; window.speechSynthesis.cancel(); } }
  muteEl.textContent = muteLabel(false); // set initial label (drops "(M)" on mobile)

  // Wipeout-style announcer via Web Speech — English female (US first), never male.
  let ttsVoice = null;
  const FEMALE = /female|samantha|victoria|zira|karen|tessa|fiona|moira|susan|allison|catherine|serena|veena|sara|nicky|amelie|libby|sonia|aria|ava|emma|jenny|michelle|joanna|salli|kimberly/i;
  const MALE = /\bmale\b|daniel|arthur|alex|fred|oliver|george|james|aaron|gordon|rishi|david|mark/i;
  function pickVoice() {
    const vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
    if (!vs.length) return;
    ttsVoice = vs.find((v) => FEMALE.test(v.name) && /en-GB/i.test(v.lang))
      || vs.find((v) => /en-GB/i.test(v.lang) && !MALE.test(v.name))
      || vs.find((v) => FEMALE.test(v.name) && /^en/i.test(v.lang))
      || vs.find((v) => /^en/i.test(v.lang) && !MALE.test(v.name))
      || vs.find((v) => FEMALE.test(v.name))
      || null; // nothing suitable → browser default rather than a male voice
  }
  if (window.speechSynthesis) { pickVoice(); window.speechSynthesis.onvoiceschanged = pickVoice; }
  // queue announcer lines so rapid pickups don't cancel each other mid-word
  let speechQ = [];
  function speakNext() {
    const synth = window.speechSynthesis;
    if (!synth || !speechQ.length || synth.speaking || synth.pending) return;
    const text = speechQ.shift();
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (ttsVoice) u.voice = ttsVoice;
      u.rate = 0.96 + Math.random() * 0.03;  // brisk + steady → assertive, not draggy
      u.pitch = 1.45 + Math.random() * 0.06; // bright announcer
      u.volume = 0.95;                        // present + commanding
      u.onend = u.onerror = () => speakNext();
      synth.speak(u);
    } catch { speakNext(); }
  }
  function say(text) {
    if (muted || !window.speechSynthesis) return;
    if (speechQ.length > 3) speechQ.shift(); // cap backlog so the voice doesn't lag behind play
    speechQ.push(text);
    speakNext();
  }

  // controls
  if (pauseBtn) pauseBtn.addEventListener("click", togglePause);
  muteEl.addEventListener("click", toggleMute);
  startPanel.querySelectorAll(".mode-btn[data-mode]").forEach((b) => b.addEventListener("click", () => chooseMode(b.dataset.mode)));
  document.getElementById("retry-btn").addEventListener("click", () => { journeyTime = 0; journeyPts = 0; start(); }); // continue after death → score from zero
  document.getElementById("restart-btn").addEventListener("click", () => {
    if (mode === "arena") { overPanel.hidden = true; document.body.classList.remove("playing"); arenaStartPanel.hidden = false; return; } // back to weapon select
    journeyIdx = 0; journeyTime = 0; journeyPts = 0; start();
  });
  document.getElementById("plot-begin").addEventListener("click", start);
  document.getElementById("plot-back").addEventListener("click", backToMenu);
  document.getElementById("idle-btn").addEventListener("click", () => { mode = "idle"; startPanel.hidden = true; start(); }); // ambient screensaver
  // bullet hell weapon select
  arenaStartPanel.querySelectorAll("[data-weapon]").forEach((b) => b.addEventListener("click", () => { mode = "arena"; startWeapon = b.dataset.weapon; start(); }));
  document.getElementById("arena-back").addEventListener("click", backToMenu);
  document.getElementById("win-menu").addEventListener("click", backToMenu);
  document.getElementById("menu-btn").addEventListener("click", backToMenu);
  document.getElementById("help-btn").addEventListener("click", openHelp);
  document.getElementById("help-btn-over").addEventListener("click", openHelp);
  document.getElementById("help-btn-arena").addEventListener("click", openHelp);
  document.getElementById("help-back").addEventListener("click", closeHelp);
  submitScoreBtn.addEventListener("click", () => submitScore(overView));
  initialsEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); submitScore(overView); } });
  winSubmitBtn.addEventListener("click", () => submitScore(winView));
  winInitialsEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); submitScore(winView); } });
  addEventListener("keydown", (e) => {
    if (document.activeElement === initialsEl || document.activeElement === winInitialsEl) return; // typing initials → ignore game keys
    if (!helpPanel.hidden) { if (e.key === "Escape" || e.key === "h" || e.key === "H" || e.key === "?") closeHelp(); return; }
    if (!arenaStartPanel.hidden) { if (e.key === "Escape") backToMenu(); else if (e.key === "h" || e.key === "H" || e.key === "?") openHelp(); return; }
    if (!plotPanel.hidden) { if (e.key === "Enter" || e.key === " ") start(); else if (e.key === "Escape") backToMenu(); return; }
    if (!winPanel.hidden) { if (e.key === "Enter" || e.key === "Escape") backToMenu(); return; }
    if ((e.key === "h" || e.key === "H" || e.key === "?") && (!running || paused)) { openHelp(); return; } // menus + pause
    if ((e.key === "p" || e.key === "P" || e.key === " ") && running) { e.preventDefault(); togglePause(); return; }
    if (e.key === "Escape") { if (paused) togglePause(); else if (mode === "idle" || !overPanel.hidden) backToMenu(); else window.location.href = "/"; }
    if ((e.key === "r" || e.key === "R") && dead) start();
    if (e.key === "m" || e.key === "M") toggleMute();
  });

  // Browser Back, while in a game/sub-screen, returns to the main menu instead of
  // leaving the page. We keep one "trap" history entry on top: popping it sends us
  // to the menu and re-arms the trap; at the menu, Back leaves to home (like Esc).
  addEventListener("popstate", () => {
    if (!helpPanel.hidden) { history.pushState(null, ""); closeHelp(); return; }
    const inGame = running || !overPanel.hidden || !plotPanel.hidden || !winPanel.hidden || !arenaStartPanel.hidden;
    if (inGame) { history.pushState(null, ""); backToMenu(); }
    else window.location.href = "/"; // already at the main menu → leave to home
  });
  history.pushState(null, ""); // arm the trap so the first Back is caught

  reset();
  idleFrame();

  // dev shortcut (LOCAL ONLY — never runs on the live site): play.html#level=N jumps
  // straight into Journey level N (1-based). e.g. #level=8 = Confluence. Also #waves/#classic.
  (function jumpFromHash() {
    if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
    const h = location.hash;
    const m = h.match(/level=(\d+)/);
    if (m) { mode = "journey"; journeyIdx = Math.max(0, Math.min(JOURNEY.length - 1, +m[1] - 1)); journeyTime = 0; journeyPts = 0; loadBest(); startPanel.hidden = true; start(); }
    else if (/waves/.test(h)) { mode = "waves"; loadBest(); startPanel.hidden = true; start(); }
    else if (/arena/.test(h)) { mode = "arena"; loadBest(); startPanel.hidden = true; start(); }
    else if (/classic/.test(h)) { mode = "classic"; loadBest(); startPanel.hidden = true; start(); }
  })();
})();
