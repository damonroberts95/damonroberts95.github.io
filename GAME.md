# NODE RUN — game internals (`play.html` + `play.js`)

This is the deep-dive for the hidden mini-game. For the site as a whole (deploy,
blog, fonts, etc.) see **MAINTAINING.md** first; this document assumes you've read
its overview.

Audience: a moderately technical maintainer, or an AI assistant making changes. The
goal is that you can find and safely change any part of the game without reading all
3,200 lines.

> **Stale comment warning:** the banner comment at the top of `play.js` says the game
> is "reached by clicking the O in ROBERTS." That is out of date. It is actually
> reached via the **`#egg` element — the "D" of DAMON** on the home page (`app.js`).
> Don't trust that one comment; everything else in the file is accurate.

---

## 1. What it is

"NODE RUN" is a Canvas2D arcade game. **You are the cursor** (a bright player node).
Coloured "hunter" nodes drift in, chase you per their colour's personality, clump
with their own colour, and string lethal "web" lines between near neighbours. Touch a
node or a web and you're caught. There are power-ups, bosses, five play modes, a
generative music engine, a global leaderboard, and an ambient **idle/screensaver**
mode.

**How to reach it:** on the home page, click (desktop) or drag (touch) the **"D" of
DAMON**. That element is `#egg`, wired in `app.js`, which just navigates to
`play.html`. There is no other link — that's deliberate (easter egg). Local dev can
also jump straight in with URL hashes (see §18).

**Files:**
- `play.html` — the shell: canvas, all the overlay panels (start menu, game-over,
  plot card, win screen, weapon select, help), the HUD, and an inline `<style>` block
  for everything game-specific. Loads `fonts.css`, `styles.css`, `bg.js` (for the
  daylight wash only — the game draws its own background), and `play.js`.
- `play.js` — the entire game, one self-contained IIFE. No build step, no
  dependencies. ~3,200 lines.

---

## 2. High-level architecture

`play.js` is one big IIFE `(function () { ... })()`. Rough top-to-bottom layout:

1. **DOM handles** (lines ~14–44): every panel/HUD element grabbed once by id.
2. **`LB`** (line ~49): Supabase leaderboard config (URL + public anon key).
3. **Tunable constants** (lines ~52–67): palette, link/web sizes, clump radii,
   power-up radius, point values.
4. **`PERSONA` / `PERSONA_NAME`** (~70–90): the six node behaviours keyed by colour.
5. **`makeAudio()`** (~95–410): the entire generative Web Audio engine, returned as an
   object with methods (`startMusic`, `setBiome`, `sfx`, `setShield`, `setTriumph`, …).
6. **Biome + pattern data** (`BIOMES`, `BIOME_KEYS`, `PATTERN_KEYS`, `PROFILES` inside
   audio) and **`JOURNEY`** levels, **`WEAPONS`**/**`ARENA_BOSSES`** for Bullet Hell.
7. **State**: canvas size (`w,h,dpr`), `hunters`, `bosses`, `bullets`, `gems`,
   `shocks`, `links`, mode flags, timers.
8. **`resize()`** + remap (~344–376): sizes the canvas and rescales all entities on a
   viewport/zoom change.
9. **Spawning / mode setup** (`spawnHunter`, `spawnBoss`, `pickBiome`, `nextWave`,
   `setupJourneyLevel`, `setupArena`, `chooseMode`, `start`, `reset`, `backToMenu`).
10. **`gameOver` / `levelComplete` / `recordWin`** — end-of-run + scoring.
11. **`loop(now)`** (~1142+): the per-frame update — input, mode progression,
    difficulty, spawns, power-ups, bullets, then `physics()` and `drawScene()`.
12. **`physics(dt, frozen)`** (~1880+): the one O(n)-ish neighbour pass (forces +
    web/link build + lethal check) using the spatial grid `forEachPair`.
13. **`drawScene()`** + many `drawX` helpers: biome wash, patterns, links, nodes,
    player, bosses, power-ups, HUD, banners.
14. **Event wiring** (~3100+): buttons, keyboard, pointer, `popstate`.
15. **Boot**: `reset(); idleFrame();` then an optional dev hash-jump.

**The game loop** is a standard `requestAnimationFrame(loop)`. `loop` returns early
when `!running` (menus are static — the menu does not animate the field). `drawScene`
is also called once by `idleFrame()` to paint a single frame behind the start menu,
and once on death just before `gameOver()`.

---

## 3. Coordinate system & scaling (important)

Everything is in **device pixels**. Three scale factors, all recomputed in `resize()`:

- **`dpr`** — device pixel ratio, capped at 1.5 (`Math.min(devicePixelRatio, 1.5)`).
  `canvas.width = innerWidth * dpr`; CSS size stays `innerWidth` px. Most sizes are
  written `… * dpr`.
- **`arenaScale`** — `clamp(min(innerW,innerH)/820, 0.8, 2)`. Scales speeds/reach so a
  big monitor isn't easier than a laptop. Multiplied into movement and blast radii.
- **`uiScale`** — `clamp(min(w,h)/780, 0.9, 2)`. Scales on-canvas text (banners/HUD).

**Resize remap (lines ~358–373):** when the viewport or zoom changes, every entity's
position is multiplied by `sx=w/oldW, sy=h/oldH` so the field doesn't jump out of
frame. **Note:** the background *pattern* offset is deliberately **not** remapped here
— its phase is dpr-normalised at draw time instead (see §10), which keeps it from
jumping on resize/zoom. Don't "fix" that by scaling `patOffX/Y` in resize; that
re-introduces the jump.

`MOBILE` is a one-time `matchMedia("(pointer: coarse)")` check; many tunables branch
on it.

---

## 4. Modes

`mode` is a string global. Five values:

| `mode` | Name shown | How it ends | Notes |
|--------|-----------|-------------|-------|
| `classic` | Classic | death | endless survival; slow biome drift; occasional boss/slow power-up |
| `waves` | Waves | death | 18-second themed waves; boss every 5th; "power cache" reward waves |
| `journey` | Journey | death or **win** | 8 scripted levels through "the Lattice"; plot card before each; two boss levels |
| `arena` | Bullet Hell | death | desktop-only; WASD move + autofire at mouse; weapons, buffs, boss archetypes |
| `idle` | (small "Idle" button) | tap/Esc/Back | screensaver: invincible, auto-drifting player, ambient swarm + song music |

Mode is chosen on the start panel (`chooseMode(m)`), except `arena` (goes to a weapon
picker first) and `idle` (its own small button). `start()` runs `reset()`, unlocks
audio, hides panels, sets `running`, and kicks the loop. `reset()` re-inits all state
and runs the per-mode setup branch (waves→`nextWave(0)`, journey→`setupJourneyLevel`,
arena→`setupArena`, otherwise classic/idle → `pickBiome` + slow drift).

Per-mode behaviour is overwhelmingly expressed as `mode === "…"` branches in `loop()`
(difficulty, spawns, power-ups) and in the audio engine (tempo, which `scheduleX`
runs). When adding a mode, search for existing `mode ===` branches to see every place
that needs a case.

---

## 5. Hunter nodes & personalities

A hunter is `{ id, x, y, vx, vy, r, r0, color, p, seed, age, life, nb, snb, … }`.
`color` is a `"r,g,b"` string from `PALETTE`; `p = PERSONA[color]` drives steering.

**`PERSONA`** (six entries, Pac-Man-style), each `{ kind, spd, acc, coh, split? }`:

| Colour | RGB | Name | `kind` | Behaviour |
|--------|-----|------|--------|-----------|
| purple | `199,116,232` | Chasers | `chase` | head straight at you |
| pink | `255,106,213` | Ambushers | `ambush` | aim ahead of your velocity |
| cyan | `34,211,238` | Erratics | `erratic` | wobble/orbit around you |
| orange | `255,138,96` | Shy Ones | `shy` | chase at range, **bolt away when close** |
| blue | `120,196,255` | Scatterers | `scatter` | barely chase; roam the field |
| yellow | `255,248,120` | The Hive | `cluster` | clump tight, grow as one, `split` at size 6 |

`spd`/`acc` scale the node's max speed / steering accel; `coh` scales same-colour
attraction. Steering target is chosen per `kind` in the hunter loop (`loop`, ~1495+):
ambush leads your velocity, erratic orbits, scatter roams a Lissajous path, shy
inverts the target when `pd < 260px`. Everything else chases the player point.

**Spawning:** `spawnHunter()` drops a node just off a random edge drifting inward.
Themed waves/levels bias 72% of spawns to `themeColor`. Difficulty (`loop`, ~1200+)
computes a `targetCount` and refills toward it one node at a time on a cooldown
(`nextSpawn`), so a blast thins the swarm for a beat instead of instantly backfilling.
Lone, old nodes (`age > life`, few neighbours) "escape" — fly off-screen and despawn.

---

## 6. Physics, clumps & lethal webs

`physics(dt, frozen)` runs once per frame. It uses **`forEachPair(fn)`** — a uniform
spatial grid (buckets sized to the max interaction radius; visits the 9-cell
neighbourhood) so it's ~O(n) not O(n²). Each unordered pair is handed to `fn` once.

For each near pair it applies, by distance band:
- **Separation** (`< SEP`): soft push apart; same-colour barely (pack tight),
  different-colour hard (segregate). Plus hard overlap resolution at `a.r+b.r`.
- **Cohesion** (`< COH_R`, same colour): attract → local clumps. A clump bigger than
  `split` repels itself apart (so clumps split, Hive-style).
- **Range repel** (`< COH_R`, different colour): push apart → colours segregate.
- **Web/link** (`< linkD2`): record a link `{a, b, al, same}` into `links`. A link
  older than `WEB_GRACE` that the player's position intersects (`segHitsPlayer`) =
  **caught** → `takeHit()` returns true → `gameOver()`.

`tight = 1 + min(1.3, elapsed/45)` makes clumps pack tighter the longer you survive
(disabled in idle). **Scatterers get a longer web** (`SCAT_WEB = 1.6×`, `scatLinkD2`)
— the grid cell is sized to that larger reach so the longer pairs are still found.

`links` is rebuilt every frame and reused by the renderer and (in idle) the
"too-dense" detector. Web "ages" are tracked in a double-buffered Map (`linkAges` /
`linkAgesNext`, swapped each frame) keyed by a numeric pair id (`idLo*LINK_KEY+idHi`)
so a freshly-formed web has a grace period before it can kill.

---

## 7. The player & input

The player is `{ x, y, px, py, vx, vy, r }`. `vx/vy` are derived each frame from
position delta (used by ambush/shooter aim). Input by mode:
- **classic/waves/journey:** `player.x/y` follow the pointer (`movePointer`). Touch
  uses a relative drag anchor so your finger doesn't have to be exactly on the node.
- **arena:** WASD/arrows steer with momentum; the mouse sets the **aim** point;
  holding the mouse is a *ceasefire*.
- **idle:** pointer input is ignored; the player auto-drifts on a time-warped
  Lissajous path (see §14). The OS cursor is hidden via `body.playing`.

`takeHit()` centralises "did something kill me": honours i-frames, the timed Shield
buff, the held Shield power-up (one-hit absorb + shove), and arena's regenerating
shield / multi-HP. **In idle it returns `false` immediately** (invincible).

---

## 8. Power-ups & arena gear

Touch-collected power-ups (classic/waves/journey — **not** arena, **not** idle):
- **Rainbow star** → `starBlast()`: an expanding shockwave (`shocks`, `kill:true`)
  that destroys nodes as the front reaches them and pops bosses. Reach is smaller on
  mobile and dialled back for journey/waves on desktop.
- **Freeze** → `frozenUntil`: halts hunters + their travel for a few seconds (music
  drops an octave, deep + woozy).
- **Shield** → one-hit absorb; music brightens while held.
- **Shooter** → temporary auto-fire of "pill" bullets along your travel direction.
- **Gems** → points with a combo multiplier (`mult`, `comboUntil`).
- **Slow** (classic only, rare) → rewinds the swarm's speed ramp.

**Arena** replaces these with weapon pickups (`WEAPONS`: dart/spread/rapid/homing/
ricochet/mortar/wave — grab same kind to level up) and buff drops (`BUFF_KINDS`:
frenzy/power/bounce/overdrive/blade/dual/shield/repel/heal/levelup/starbomb), plus a
multi-HP player with a recharging shield and an adaptive "surge" that ramps the swarm
when you keep the screen clear.

---

## 9. Bosses

`spawnBoss(forceColor, shooter, kind, hp)` makes a boss `{x,y,vx,vy,r,color,p,
shooter,kind,hp,maxHp,…}`. Two damage models:
- **Legacy bosses** (classic/waves/journey): `hp = 0`. They are **killed in one
  star-blast** (the shock-kill path pops any boss it reaches). Movement follows the
  colour persona; a `shooter` boss fires aimed shots.
- **Arena bosses** (`ARENA_BOSSES = spiral/burst/charger/splitter/weaver`): have `hp`
  scaled by survival time; killed by your **bullets**. Each `kind` has a distinct
  attack/movement (charger dashes; spiral/burst/weaver fire patterns; splitter bursts
  into a big swarm on death). Health bar drawn only when `maxHp`.

**Journey boss levels (Warden, Confluence)** now give each boss a random arena `kind`
for varied attacks, but keep `hp = 0` so a star-blast still kills them in one hit
(the level ends only when every boss is down).

---

## 10. Biomes & background patterns

**Biomes** (`BIOMES`, keys in `BIOME_KEYS`) are full-screen colour washes: a flat
tint + several animated radial glows + drifting dark/light blobs + an edge vignette,
all drawn in `paintBiome(biome, alpha)`. `pickBiome(fade, slow)` switches biome and
cross-fades: it sets `prevBiome` and ramps `biomeFade` 0→1 at `biomeFadeRate`
(classic ~8s, **idle ~10s**, others snappy). During the fade both biomes are painted
(prev at `1-fade`, new at `fade`) so it's a true crossfade.

**Patterns** are the faint white geometric overlay (`paintPattern(type, alpha)`):
grid, dots, rings, diag, weave, cross, wave, hex, tri, diamond, chevron, scales, plus
`none`. Key facts (these were the source of several "jump" bugs — read before
touching):
- The pattern runs on its **own clock**, fully decoupled from biomes
  (`queuePattern()` is called by a timer in `drawBiome`, ~every 10–16s, **not** by
  biome changes). A queued pattern swaps in behind a short fade (`patFade`).
- Pattern **alpha follows only a slow "breath"** (`pb`), never the biome crossfade
  `f` — tying it to `f` made it blink out on every biome change.
- **Phase is dpr-normalised:** offsets accumulate in CSS px and are multiplied by
  `dpr` only at draw (`dx = patOffX*dpr`). So a window resize (same dpr → same phase)
  and a zoom (dpr cancels) both leave the tiling visually anchored — no jump.
- **Idle adds a slow zoom** (`step` scaled by `1 + 0.18·sin`), other modes `zoom = 1`.

---

## 11. Audio engine (`makeAudio()`)

A from-scratch Web Audio synth — **no audio files**. Graph: oscillator voices →
per-voice low-pass (`synth()`), a master low-pass `mlp` (brightness), a reverb send
(`verb`/`vg`), `music`/`fx` buses → master gain. Helpers: `synth(freq,t,dur,opts)`
(detuned, enveloped voice; `opts.sub` adds a sub-octave), `noiseHit()` (percussion).

**Per-biome `PROFILES`**: each biome has `{chords, transpose, bright, reverb, bpmMul,
leadType, leadCut, sparkle}`. `setBiome(key)` swaps the profile; `applyProf()` ramps
brightness + reverb toward it. The crossfade time-constant is **idle ~24 s, arena
0.4 s (kept original), others ~10 s** — see `applyProf`.

**Scheduler:** a `setInterval` `tick()` schedules 16th notes ahead of the clock.
`scheduleStep(s,t)` dispatches by mode:
- `scheduleArena` — driving Wipeout-style techno (kick/clap/acid bass/hats + biome
  stabs).
- `scheduleIdle` — a **song**: a 32-bar intro→verse→chorus→bridge form with a riff
  (per-bar note drops + octave lifts), a chorus hook + harmony + counter-melody, a
  wandering verse solo, bridge bells, tom fills and a riser. Tempo ebbs and flows
  (section bumps + a ~3-min LFO).
- otherwise — the standard chill vaporwave loop.

`curBPM()` sets the tempo: frozen→28, menu→40, arena ramps to 140, **idle uses
`idleBPM()`** (section-aware + slow swell), others ramp 84→132 ×`bpmMul` (× a 1.2
"triumph" boost during a power-cache wave). `M` mutes.

`sfx(name)` plays synth sound-effects — **and is a no-op in idle** (idle is music
only).

**Voiceover (TTS):** `say(text)` queues a Web-Speech utterance (English female voice
preferred), used for wave/level names and start/end lines. Config (rate/pitch/volume)
is in `speakNext()`.

---

## 12. UI: panels, HUD, banners, navigation

Panels are `.panel` divs in `play.html`, shown/hidden by toggling `hidden`:
`#start` (mode menu), `#arena-start` (weapon picker), `#plot` (journey level card),
`#over` (game-over + leaderboard), `#win` (journey complete + its own leaderboard),
`#help`. The HUD (`.hud`: time/points/best) and pause button are CSS-hidden in idle
(`body.idle …`).

**Important CSS gotcha:** `.btn { display: inline-block }` overrides the UA
`[hidden]{display:none}` rule, so to hide a `.btn` you need an explicit
`.btn[hidden]{display:none}` (it exists). This caused the Classic game-over panel to
show three buttons once; don't remove that rule.

On-canvas **banners** (`banner = {big, sub, from, until, subUntil}`) show the wave/
level title. Title fades by `until`; a `subUntil` lets the sub-line (journey enemy
briefing) linger and fade slowly. Long subs word-wrap.

**Navigation:** Esc and the Menu button call `backToMenu()`. **Browser Back returns
to the in-game menu** rather than leaving the page — a `popstate` handler keeps one
history "trap" entry, sends you to the menu while in a run, and only leaves to `/`
from the menu itself.

---

## 13. Scoring & leaderboard

Score = seconds survived + points (10/gem etc.), kept per-mode as a `best` in
`localStorage` (`bestKey()`). The global board is **Supabase** (public anon key + RLS;
read + insert only). See MAINTAINING.md §9 for the DB schema and policies.

The leaderboard UI is duplicated on two panels (game-over `#over` and journey-win
`#win`). `loadBoard(myName, view)` and `submitScore(view)` take a **view** object
(`overView` / `winView`) bundling that panel's elements, so one set of functions
drives both. Scores are filtered/inserted per `mode`.

---

## 14. Idle / screensaver mode (full)

Reached by the small **"Idle"** button. It reuses the engine but is heavily
special-cased (search `mode === "idle"` and `idleMode`). Behaviour:

- **Invincible** (`takeHit→false`), **no power-ups / bosses / gems / SFX**, HUD +
  pause hidden, a faint pulsing **"click for menu"** ("tap" on mobile) hint.
- **Player auto-drifts** on a Lissajous path whose clock is time-warped
  (`+8·sin(0.12t)`) so its **speed varies a lot** (near-still → darting). No cursor.
- **Many slow nodes:** high cap (160 desktop / 70 mobile), brisk fill, but
  `maxSpeed` cycles ~20→50 over a ~2-min wave.
- **Looser, mingling clumps:** no `tight` ramp; cross-colour segregation removed
  (`rf=0`) and cross-colour push softened → multicolour clumps. Push/repel scale with
  node size (`szf`, idle only). Cohesion slowly oscillates gather↔disperse.
- **Behaviour cycles** a collective "mood" every ~22 s: gather to a wandering point →
  orbit the player → roam → chase.
- **Dense → spread out (no wipe):** when the web exceeds ~1.4 links/node, an
  `idleDisperse` window (~5 s) flips cohesion negative so tight groups gently spread,
  then drift back.
- **Less / gentler despawn** (3× longer life; soft fly-off kick).
- **Biomes + patterns cycle** (with the idle pattern zoom), and **`scheduleIdle`**
  plays the song, with the long ~24 s music crossfade.

Exit: tap/click anywhere, Esc, or browser Back.

All idle changes are gated so **arena and the scored modes are unaffected** (e.g.
`szf` is `1` outside idle; the escape kick, `tight`, cohesion, crossfade times all
fall back to their original values).

---

## 15. Difficulty & spawn tuning (the knobs)

The block in `loop()` around the `maxSpeed/accel` and `cap/rate/jBase/jRate`
computation is where pacing lives. Quick map of the per-mode multipliers currently in
place:

- **Speed:** waves ramp off time-into-wave; arena off survival × weapon level × surge;
  classic/journey off survival (journey + ~4.5%/level, mobile journey ×1.1); idle a
  slow 20→50 sine.
- **Count:** `cap` (max nodes) and `rate` (fill speed) vary by mode/mobile, with
  multipliers for the Hive theme, the **Timid/Drift** journey levels (`sparse`, denser),
  **Hivemind** (`hiveLvl`, denser still), and **waves-on-mobile** (`wmob`).
- **Boss levels:** journey keeps a steady refilling swarm; waves boss waves thin it.
- **Waves empty-screen:** when a wave is <40% full, the spawn gap shrinks ×0.3 to
  repopulate fast.

If you change balance, change it here and test each mode — these branches are shared.

---

## 16. Performance notes

The field can hold a few hundred nodes, so the hot path matters:
- **Spatial grid** (`forEachPair`) keeps neighbour work near O(n). Its **buckets are
  pooled and reused** across frames (no per-frame array allocation; only the cells
  touched last frame are cleared).
- **Physics scratch arrays** (`pCnt/pSx/pSy/pScnt`) are reused, not re-`new`'d.
- **Link ages** use two swapped Maps + numeric keys (no per-frame Map alloc, no string
  keys).
- **Nodes are batch-drawn per colour** without per-node shadow blur. `shadowBlur` is
  expensive — it's used only on a handful of entities (player/bosses/pickups), never
  per hunter or per bullet (see the explicit "no per-bullet shadow" note).
- DPR is capped at 1.5.

If you add effects, keep them off the per-node/per-bullet path and avoid allocating in
the loop.

---

## 17. Tunables cheat-sheet

Near the top of `play.js` (lines ~52–67):

| Constant | Meaning |
|----------|---------|
| `PALETTE` | the six node colours (also drives `PERSONA`) |
| `LINK_DIST` | web length (px, ×`LINK_SCALE` on mobile) |
| `SCATTER` / `SCAT_WEB` | blue scatterers' colour + their longer-web multiplier |
| `LINK_W` / `LETHAL` | web thickness + extra kill band |
| `JOLT_R` / `JOLT_X` | crowding radius + neighbour count that pops a clump |
| `STAR_R` | power-up pickup/draw radius |
| `COH_R` / `GROUP_R` / `SPLIT_SIZE` | cohesion range, clump radius, split size |
| `GEM_VAL`/`KILL_VAL`/`BOSS_VAL` | point values |

Feel knobs also live in `PERSONA` (per-colour speed/accel/cohesion), `PROFILES`
(per-biome music), `JOURNEY` (level list), `WEAPONS`/`ARENA_BOSSES`, and the
difficulty block (§15).

---

## 18. "How do I…" cookbook

- **Add a Journey level:** add an entry to `JOURNEY` (`{name, say?, color, len, boss,
  bossCount?, shooter?, biome, plot, enemy}`). `plot` shows on the card; `enemy` shows
  on the in-game banner; title renders ALL-CAPS. Keep the title distinct from the
  colour's persona name (the banner shows both). Boss levels end on boss defeat.
- **Add a biome:** add to `BIOMES` (tint/glows/vig) and `BIOME_KEYS`, and a matching
  entry to `PROFILES` in `makeAudio` for its music character.
- **Add a background pattern:** add a key to `PATTERN_KEYS` and a branch in
  `paintPattern`. Use the `ox/oy` (or `dx/dy`) wrapped offsets so it tiles seamlessly.
- **Retune difficulty:** edit the `maxSpeed/accel` and `cap/rate/jBase` block in
  `loop()` (§15). Test every mode.
- **Tweak idle:** everything is behind `mode === "idle"` / `idleMode` — see §14.
- **Change the music feel:** `PROFILES` (timbre per biome), `curBPM`/`idleBPM`
  (tempo), `scheduleStep`/`scheduleArena`/`scheduleIdle` (parts).
- **Turn the leaderboard off:** blank `LB.url`.
- **Jump to a mode/level in local dev:** `play.html#level=8`, `#waves`, `#arena`,
  `#classic` (localhost only — see the `jumpFromHash` IIFE at the very bottom).

---

## 19. Known quirks / gotchas

- The top-of-file comment about "the O in ROBERTS" is **stale** (it's the D of DAMON).
- `bg.js` runs on `play.html` only for the **daylight CSS wash**; the game draws its
  own canvas background, so the node-network from `bg.js` is not visible here.
- Menus don't animate the field (the loop returns when `!running`); `idleFrame()`
  paints one frame behind the start menu.
- `arena` is hidden on coarse-pointer (mobile) — it needs a keyboard.
- Audio only starts after a user gesture (the Start click) — browsers block autoplay.
- The dev hash-jumps are guarded to **localhost only** and never run on the live site.
