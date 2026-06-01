/* ============================================================
   bg.js — live "node network" background (sensors / grid / data).

   Drifting nodes joined by links when near, with occasional energy
   pulses travelling the links, gently leaning toward the cursor.
   Most nodes are pink/purple; a few warm (orange/yellow) for a
   vaporwave accent. Colour wash itself is a static CSS gradient
   (see styles.css) — this layer is just the network.

   Plain Canvas2D — cheap on the CPU, needs no GPU. Cost is bounded:
     - fixed, modest node count (no per-frame quality thrashing)
     - distances compared squared (no per-pair sqrt)
     - pulses globally capped
   Respects prefers-reduced-motion (renders one static frame).
   ============================================================ */

(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ---- CONFIG — tweak these ----
  const CONFIG = {
    density: 0.00007, // nodes per CSS pixel
    minNodes: 28,
    maxNodes: 70,
    linkDist: 150,    // px: link two nodes when closer than this
    minSep: 34,       // px: nodes repel below this so they never clump on the cursor
    speed: 0.18,      // base drift speed
    // full vaporwave palette — each node picks one at random
    palette: [
      "255,106,213", // hot pink
      "199,116,232", // purple
      "120,196,255", // light blue
      "34,211,238",  // cyan
      "255,138,96",  // orange
      "255,248,120", // yellow
    ],
    link: "199,116,232",  // vaporwave purple (links)
    maxPulses: 7,
    pulseSpawn: 0.22,
    pulseSpeed: 0.012,    // lower = slower, travels full link before fading
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Time-of-day brightness: bright around midday, dark at night.
     daylight 0..1 drives --day (warm glow), --night (dimmer), --glow (nodes). */
  function applyDaylight(daylight) {
    const root = document.documentElement.style;
    root.setProperty("--day", daylight.toFixed(3));
    root.setProperty("--night", (0.8 * (1 - daylight)).toFixed(3));
    root.setProperty("--glow", (0.45 + 0.45 * daylight).toFixed(3));
    root.setProperty("--grain", (0.04 + 0.07 * (1 - daylight)).toFixed(3)); // more texture at night
  }
  function clockDaylight() {
    const now = new Date();
    const hour = now.getHours() + now.getMinutes() / 60;
    return Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI)); // 0 at 6/18h, 1 at noon
  }
  applyDaylight(clockDaylight());
  setInterval(() => applyDaylight(clockDaylight()), 5 * 60 * 1000);

  let w, h, dpr = 1, maxD2, minSep2;
  let nodes = [], pulses = [], links = [];
  const mouse = { x: -9999, y: -9999, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    maxD2 = (CONFIG.linkDist * dpr) ** 2;
    minSep2 = (CONFIG.minSep * dpr) ** 2;
    seed();
  }

  function seed() {
    const count = clamp(
      Math.floor(innerWidth * innerHeight * CONFIG.density),
      CONFIG.minNodes,
      CONFIG.maxNodes
    );
    nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-1, 1) * CONFIG.speed * dpr,
        vy: rand(-1, 1) * CONFIG.speed * dpr,
        r: rand(1.2, 2.4) * dpr,
        color: CONFIG.palette[(Math.random() * CONFIG.palette.length) | 0],
      });
    }
  }

  function step() {
    ctx.clearRect(0, 0, w, h);

    // move + draw nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!reduced) {
        n.x += n.vx; n.y += n.vy;
        if (mouse.active) {
          const dx = mouse.x - n.x, dy = mouse.y - n.y;
          if (dx * dx + dy * dy < 240000) {
            n.vx += dx * 0.000004 * dpr;
            n.vy += dy * 0.000004 * dpr;
          }
        }
        if (n.x < 0) n.x = w; else if (n.x > w) n.x = 0;
        if (n.y < 0) n.y = h; else if (n.y > h) n.y = 0;
        n.vx *= 0.992; n.vy *= 0.992;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 6.283185);
      ctx.fillStyle = `rgba(${n.color},0.9)`;
      ctx.fill();
    }

    // links — squared-distance compare, quadratic alpha falloff (no sqrt)
    links.length = 0;
    ctx.lineWidth = dpr;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < maxD2) {
          const alpha = (1 - d2 / maxD2) * 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${CONFIG.link},${alpha})`;
          ctx.stroke();
          links.push(a, b);

          // anti-clump: push apart when too close (stops cursor-pull collapse)
          if (!reduced && d2 < minSep2 && d2 > 0.01) {
            const f = (1 - d2 / minSep2) * 0.04 * dpr;
            const inv = 1 / Math.sqrt(d2);
            const ux = dx * inv, uy = dy * inv;
            a.vx += ux * f; a.vy += uy * f;
            b.vx -= ux * f; b.vy -= uy * f;
          }
        }
      }
    }

    // spawn at most one pulse per frame on a random existing link
    if (!reduced && links.length && pulses.length < CONFIG.maxPulses &&
        Math.random() < CONFIG.pulseSpawn) {
      const k = (Math.floor(Math.random() * (links.length / 2)) | 0) * 2;
      const from = links[k];
      pulses.push({ a: from, b: links[k + 1], t: 0, color: from.color });
    }

    // draw + advance pulses — travel the FULL link, only fading at the very end
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += CONFIG.pulseSpeed;
      if (p.t >= 1) { pulses.splice(i, 1); continue; }
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      // bright most of the way; fade in over first 10% and out over last 15%
      const alpha = Math.min(1, p.t / 0.1, (1 - p.t) / 0.15);
      ctx.beginPath();
      ctx.arc(x, y, 2.4 * dpr, 0, 6.283185);
      ctx.fillStyle = `rgba(${p.color},${alpha})`;
      ctx.fill();
    }

    if (!reduced) requestAnimationFrame(step);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  addEventListener("resize", resize);
  addEventListener("pointermove", (e) => {
    mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; mouse.active = true;
  });
  addEventListener("pointerleave", () => { mouse.active = false; });

  // click background → shove nearby nodes outward from the cursor
  addEventListener("pointerdown", (e) => {
    if (reduced) return;
    const cx = e.clientX * dpr, cy = e.clientY * dpr;
    const radius = 140 * dpr, r2 = radius * radius;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = n.x - cx, dy = n.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.01) {
        const inv = 1 / Math.sqrt(d2);
        const force = (1 - d2 / r2) * 2 * dpr; // closer → harder shove
        n.vx += dx * inv * force;
        n.vy += dy * inv * force;
      }
    }
  });

  resize();
  requestAnimationFrame(step); // animates, or draws one frame if reduced-motion
})();
