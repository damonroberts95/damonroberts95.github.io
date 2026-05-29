/* ============================================================
   bg.js — live "node network" background (sensors / grid / data).

   Drifting nodes joined by links when near, with occasional energy
   pulses travelling the links, gently leaning toward the cursor.

   Performance:
     - distances compared squared (no per-pair sqrt)
     - pulses are globally capped
     - ADAPTIVE QUALITY: it measures FPS and raises/lowers the node
       count to hit a smooth frame rate on whatever device is running.
   Respects "prefers-reduced-motion" (renders one static frame).
   ============================================================ */

(function () {
  const canvas = document.getElementById("bg");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  // ---- CONFIG — tweak these ----
  const CONFIG = {
    minNodes: 16,        // never go below this
    maxNodes: 80,        // never go above this
    startDensity: 0.00006, // initial nodes per CSS pixel
    linkDist: 150,       // px: link two nodes when closer than this
    speed: 0.18,         // base drift speed
    nodeColor: "236,72,153",  // pink
    linkColor: "168,85,247",  // purple
    pulseColor: "249,115,22", // orange
    maxPulses: 8,        // hard cap on simultaneous pulses
    pulseSpawn: 0.25,    // chance per frame to spawn one pulse
    targetFps: 55,       // aim for this; scale quality to keep near it
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w, h, dpr = 1, maxD, maxD2;
  let nodes = [], pulses = [], links = [];
  let target = CONFIG.minNodes;
  const mouse = { x: -9999, y: -9999, active: false };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap dpr — big perf win
    w = canvas.width = Math.floor(innerWidth * dpr);
    h = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    maxD = CONFIG.linkDist * dpr;
    maxD2 = maxD * maxD;
    // set the starting target from screen size, then adaptivity tunes it
    const fromArea = Math.floor(innerWidth * innerHeight * CONFIG.startDensity);
    target = clamp(fromArea, CONFIG.minNodes, CONFIG.maxNodes);
    syncNodes();
  }

  function makeNode() {
    return {
      x: rand(0, w),
      y: rand(0, h),
      vx: rand(-1, 1) * CONFIG.speed * dpr,
      vy: rand(-1, 1) * CONFIG.speed * dpr,
      r: rand(1.2, 2.4) * dpr,
    };
  }

  // Grow/shrink the node list toward `target` without a full reseed.
  function syncNodes() {
    while (nodes.length < target) nodes.push(makeNode());
    if (nodes.length > target) nodes.length = target;
  }

  // ---- adaptive FPS tracking ----
  let lastT = 0, acc = 0, frames = 0;

  function adapt(dt) {
    if (dt > 0 && dt < 1000) { acc += dt; frames++; }
    if (acc < 1000) return;
    const fps = (frames * 1000) / acc;
    acc = 0; frames = 0;
    if (fps < CONFIG.targetFps - 8 && target > CONFIG.minNodes) {
      target = Math.max(CONFIG.minNodes, target - 6); // laggy → shed nodes fast
      syncNodes();
    } else if (fps > CONFIG.targetFps + 3 && target < CONFIG.maxNodes) {
      target = Math.min(CONFIG.maxNodes, target + 2); // headroom → add slowly
      syncNodes();
    }
  }

  function step(t) {
    const dt = t - lastT; lastT = t;
    if (!reduced) adapt(dt);

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
      ctx.fillStyle = `rgba(${CONFIG.nodeColor},0.9)`;
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
          ctx.strokeStyle = `rgba(${CONFIG.linkColor},${alpha})`;
          ctx.stroke();
          links.push(a, b); // remember close pairs for pulse spawning
        }
      }
    }

    // spawn at most one pulse per frame, on a random existing link
    if (!reduced && links.length && pulses.length < CONFIG.maxPulses &&
        Math.random() < CONFIG.pulseSpawn) {
      const k = (Math.floor(Math.random() * (links.length / 2)) | 0) * 2;
      pulses.push({ a: links[k], b: links[k + 1], t: 0 });
    }

    // draw + advance pulses
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += 0.02;
      if (p.t > 1) { pulses.splice(i, 1); continue; }
      const x = p.a.x + (p.b.x - p.a.x) * p.t;
      const y = p.a.y + (p.b.y - p.a.y) * p.t;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * dpr, 0, 6.283185);
      ctx.fillStyle = `rgba(${CONFIG.pulseColor},${1 - p.t})`;
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

  resize();
  requestAnimationFrame(step); // animates, or draws one frame if reduced-motion
})();
