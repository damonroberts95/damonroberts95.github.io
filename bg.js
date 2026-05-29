/* ============================================================
   bg.js — live "node network" background.

   Draws drifting nodes (sensors) joined by lines (links) when
   they're near each other, plus occasional energy pulses that
   travel along the links. The whole field gently leans toward
   the cursor. Evokes IoT / connected devices / data flow.

   Tuning knobs are in CONFIG below — safe to tweak.
   Respects "prefers-reduced-motion": renders a single static
   frame instead of animating.
   ============================================================ */

(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ---- CONFIG — tweak these ----
  const CONFIG = {
    density: 0.00009,   // nodes per pixel (higher = more nodes)
    maxNodes: 90,       // hard cap
    linkDist: 150,      // px: draw a link when two nodes are closer than this
    speed: 0.18,        // base drift speed
    nodeColor: "236,72,153",   // pink  (rgb, no alpha)
    linkColor: "168,85,247",   // purple
    pulseColor: "249,115,22",  // orange
    pulseChance: 0.004, // per-link, per-frame chance to spawn a pulse
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w, h, nodes = [], pulses = [], dpr = 1;
  const mouse = { x: -9999, y: -9999, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    seed();
  }

  function seed() {
    const count = Math.min(CONFIG.maxNodes, Math.floor(w * h / dpr / dpr * CONFIG.density));
    nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-1, 1) * CONFIG.speed * dpr,
        vy: rand(-1, 1) * CONFIG.speed * dpr,
        r: rand(1.2, 2.6) * dpr,
      });
    }
  }

  function step() {
    ctx.clearRect(0, 0, w, h);

    // move + draw nodes
    for (const n of nodes) {
      if (!reduced) {
        n.x += n.vx;
        n.y += n.vy;
        // gentle pull toward cursor
        if (mouse.active) {
          const dx = mouse.x - n.x, dy = mouse.y - n.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 240000) { n.vx += dx * 0.000004 * dpr; n.vy += dy * 0.000004 * dpr; }
        }
        // wrap around edges
        if (n.x < 0) n.x = w; if (n.x > w) n.x = 0;
        if (n.y < 0) n.y = h; if (n.y > h) n.y = 0;
        // friction so cursor pull doesn't accelerate forever
        n.vx *= 0.992; n.vy *= 0.992;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${CONFIG.nodeColor},0.9)`;
      ctx.fill();
    }

    // draw links + maybe spawn pulses
    const maxD = CONFIG.linkDist * dpr;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < maxD) {
          const alpha = (1 - dist / maxD) * 0.5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = `rgba(${CONFIG.linkColor},${alpha})`;
          ctx.lineWidth = dpr;
          ctx.stroke();
          if (!reduced && Math.random() < CONFIG.pulseChance) {
            pulses.push({ a, b, t: 0 });
          }
        }
      }
    }

    // draw + advance energy pulses
    pulses = pulses.filter((p) => p.t <= 1);
    for (const p of pulses) {
      p.t += 0.02;
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${CONFIG.pulseColor},${1 - p.t})`;
      ctx.fill();
    }

    if (!reduced) requestAnimationFrame(step);
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  addEventListener("resize", resize);
  addEventListener("pointermove", (e) => {
    mouse.x = e.clientX * dpr; mouse.y = e.clientY * dpr; mouse.active = true;
  });
  addEventListener("pointerleave", () => { mouse.active = false; });

  resize();
  step(); // animates, or draws one static frame if reduced-motion
})();
