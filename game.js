/* ============================================================
   game.js — Main Loop, Mouse Raycast Collision & Horror Rendering
   ============================================================ */
(function (global) {
  "use strict";

  const { W, H, CX, CY, CAMPAIGN_LEVELS, buildLevelData, generateEndlessLevel } =
    global.MazeLevels;

  // 4x4 Bayer ordered dithering matrix (normalized 0..1)
  const BAYER4 = [
    [0 / 16, 8 / 16, 2 / 16, 10 / 16],
    [12 / 16, 4 / 16, 14 / 16, 6 / 16],
    [3 / 16, 11 / 16, 1 / 16, 9 / 16],
    [15 / 16, 7 / 16, 13 / 16, 5 / 16],
  ];

  // DOM Elements
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const crtFrame = document.getElementById("crt-frame");

  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySubtitle = document.getElementById("overlay-subtitle");
  const overlayNote = document.getElementById("overlay-note");
  const overlayActions = document.getElementById("overlay-actions");

  const btnStart = document.getElementById("btn-start");
  const btnMute = document.getElementById("btn-mute");
  const volSlider = document.getElementById("vol-slider");
  const btnStrobe = document.getElementById("btn-strobe");
  const btnMode = document.getElementById("btn-mode");
  const btnRestartCampaign = document.getElementById("btn-restart-campaign");
  const btnTryEndless = document.getElementById("btn-try-endless");

  const countdownHud = document.getElementById("countdown-hud");
  const countdownNum = document.getElementById("countdown-num");
  const countdownMsg = document.getElementById("countdown-msg");
  const scareCaption = document.getElementById("scare-caption");

  const hudFloor = document.getElementById("hud-floor");
  const hudDeaths = document.getElementById("hud-deaths");
  const hudTime = document.getElementById("hud-time");
  const hudProximity = document.getElementById("hud-proximity");
  const hudBest = document.getElementById("hud-best");

  // Subsystems
  const audio = new global.HorrorAudio();
  const jumpscare = new global.JumpscareEngine();

  // Offscreen coarse lighting canvas (160x100 scaled 2x for crisp retro pixel shadows)
  const LIGHT_W = W / 2;
  const LIGHT_H = H / 2;
  const lightCanvas = document.createElement("canvas");
  lightCanvas.width = LIGHT_W;
  lightCanvas.height = LIGHT_H;
  const lightCtx = lightCanvas.getContext("2d");
  const lightImg = lightCtx.createImageData(LIGHT_W, LIGHT_H);

  // Game State
  const state = {
    mode: "campaign", // "campaign" | "endless"
    phase: "TITLE", // TITLE | READY | COUNTDOWN | PLAYING | JUMPSCARE | LEVEL_CLEAR | VICTORY
    levelIndex: 0,
    endlessFloor: 1,
    levelData: null,

    deaths: 0,
    runTime: 0,
    totalCampaignTime: 0,

    // Mouse logical coordinates (320x200)
    mouseX: CX,
    mouseY: CY,
    prevMouseX: CX,
    prevMouseY: CY,
    pointerInside: false,

    // Countdown timer
    countdownVal: 3.0,
    lastCountdownInt: 4,
    outOfCenterWarned: false,
    goFlashTimer: 0,

    // Level clear transition timer
    clearTimer: 0,

    // Particles (lantern sparks & trail)
    particles: [],
    time: 0,
    proximity: 0,
    lastScareName: "",
  };

  // Best record persistence
  function loadBest() {
    try {
      const raw = localStorage.getItem("dttw_best_time");
      if (raw) {
        const val = parseFloat(raw);
        if (!Number.isNaN(val)) {
          hudBest.textContent = `BEST: ${val.toFixed(1)}s`;
          return val;
        }
      }
    } catch (_) {}
    hudBest.textContent = "BEST: --";
    return null;
  }

  function saveBest(seconds) {
    try {
      const prev = loadBest();
      if (prev === null || seconds < prev) {
        localStorage.setItem("dttw_best_time", seconds.toFixed(2));
        hudBest.textContent = `BEST: ${seconds.toFixed(1)}s`;
      }
    } catch (_) {}
  }

  // Load current level
  function loadCurrentLevel() {
    if (state.mode === "campaign") {
      const def = CAMPAIGN_LEVELS[state.levelIndex];
      state.levelData = buildLevelData(def);
    } else {
      state.levelData = generateEndlessLevel(state.endlessFloor);
    }
    hudFloor.textContent = state.levelData.def.name;
    state.particles = [];
    state.proximity = 0;
  }

  // Convert DOM pointer event to logical 320x200 coordinates
  function eventToLogical(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return [x, y];
  }

  // Check if cursor core (3x3 cross) touches wall or exit
  function sampleCollision(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix <= 1 || ix >= W - 2 || iy <= 1 || iy >= H - 2) {
      return { hitWall: true, hitExit: false };
    }
    const mask = state.levelData.mask;
    const offsets = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    let hitExit = false;
    for (let i = 0; i < offsets.length; i++) {
      const m = mask[(iy + offsets[i][1]) * W + (ix + offsets[i][0])];
      if (m === 0) {
        return { hitWall: true, hitExit: false };
      }
      if (m === 2) {
        hitExit = true;
      }
    }
    return { hitWall: false, hitExit };
  }

  // Raycast movement segment at 0.5px steps so fast mouse swings can never tunnel through walls
  function checkMovementSegment(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = x0 + dx * t;
      const sy = y0 + dy * t;
      const res = sampleCollision(sx, sy);
      if (res.hitWall) {
        return { hitWall: true, hitExit: false, x: sx, y: sy };
      }
      if (res.hitExit) {
        return { hitWall: false, hitExit: true, x: sx, y: sy };
      }
    }
    return { hitWall: false, hitExit: false, x: x1, y: y1 };
  }

  function isInsideCenterSanctuary(x, y) {
    const maxR = state.levelData.def.sanctuaryRadius - 2;
    return Math.hypot(x - CX, y - CY) <= maxR;
  }

  function setCursorHidden(hidden) {
    if (hidden) {
      canvas.classList.add("hide-cursor");
    } else {
      canvas.classList.remove("hide-cursor");
    }
  }

  // Show centered overlay (START / RETRY / NEXT FLOOR / VICTORY)
  function showReadyOverlay(opts) {
    overlayTitle.textContent = opts.title;
    overlaySubtitle.textContent = opts.subtitle;
    overlayNote.textContent = opts.note || "";
    btnStart.textContent = opts.buttonText || "START";

    if (opts.showExtraActions) {
      overlayActions.classList.remove("hidden");
    } else {
      overlayActions.classList.add("hidden");
    }

    overlay.classList.remove("hidden");
    countdownHud.classList.add("hidden");
    scareCaption.classList.add("hidden");
    setCursorHidden(false);
  }

  // Start Countdown (triggered by clicking exact-center START button)
  function beginCountdown(clickEvent) {
    audio.init();
    audio.playClick();

    // If clicked with mouse, seed mouse position immediately (right at center!)
    if (clickEvent && (clickEvent.clientX !== 0 || clickEvent.clientY !== 0)) {
      const [lx, ly] = eventToLogical(clickEvent);
      state.mouseX = lx;
      state.mouseY = ly;
      state.prevMouseX = lx;
      state.prevMouseY = ly;
      state.pointerInside = true;
    }

    if (state.phase === "VICTORY") {
      state.levelIndex = 0;
      state.totalCampaignTime = 0;
      state.deaths = 0;
      hudDeaths.textContent = "0";
      loadCurrentLevel();
    }

    state.phase = "COUNTDOWN";
    state.countdownVal = 3.0;
    state.lastCountdownInt = 4;
    state.outOfCenterWarned = false;
    state.runTime = 0;
    hudTime.textContent = "00.0s";

    overlay.classList.add("hidden");
    countdownHud.classList.remove("hidden");
    countdownNum.className = "";
    countdownNum.textContent = "3";
    countdownMsg.textContent = "KEEP MOUSE IN CENTER";
    setCursorHidden(true);
  }

  function triggerJumpscare(reasonCaption) {
    if (state.phase === "JUMPSCARE") return;

    state.phase = "JUMPSCARE";
    state.deaths++;
    hudDeaths.textContent = String(state.deaths);
    state.proximity = 0;
    audio.updateTension(0.016, 0, false);

    const scare = jumpscare.trigger(reasonCaption);
    state.lastScareName = scare.name;
    audio.playJumpscare(scare.id);

    countdownHud.classList.add("hidden");
    scareCaption.textContent = scare.caption;
    scareCaption.classList.remove("hidden");
    crtFrame.classList.add("shaking");
    setCursorHidden(false);
  }

  function finishJumpscare() {
    crtFrame.classList.remove("shaking");
    scareCaption.classList.add("hidden");
    state.phase = "READY";

    showReadyOverlay({
      title: `CAUGHT BY ${state.lastScareName}`,
      subtitle: "PUT YOUR MOUSE IN THE CENTER & PRESS START",
      note: `${state.levelData.def.name}  •  DEATHS: ${state.deaths}`,
      buttonText: "RETRY",
      showExtraActions: false,
    });
  }

  function triggerLevelClear() {
    state.phase = "LEVEL_CLEAR";
    state.clearTimer = 1.15;
    state.totalCampaignTime += state.runTime;
    audio.updateTension(0.016, 0, false);
    audio.playLevelClear();
    setCursorHidden(false);

    countdownHud.classList.remove("hidden");
    countdownNum.className = "go";
    countdownNum.textContent = "ESCAPED";
    countdownMsg.textContent = `${state.levelData.def.name} CLEARED IN ${state.runTime.toFixed(1)}s`;
  }

  function advanceAfterClear() {
    countdownHud.classList.add("hidden");

    if (state.mode === "campaign") {
      if (state.levelIndex + 1 < CAMPAIGN_LEVELS.length) {
        state.levelIndex++;
        loadCurrentLevel();
        state.phase = "READY";
        showReadyOverlay({
          title: state.levelData.def.name,
          subtitle: "MOVE MOUSE TO CENTER & PRESS START",
          note: state.levelData.def.subtitle,
          buttonText: "START",
          showExtraActions: false,
        });
      } else {
        // Campaign Beaten!
        saveBest(state.totalCampaignTime);
        state.phase = "VICTORY";
        showReadyOverlay({
          title: "YOU ESCAPED THE ABYSS",
          subtitle: `ALL 5 FLOORS CLEARED IN ${state.totalCampaignTime.toFixed(1)}s (${state.deaths} DEATHS)`,
          note: "DARE TO ENTER ENDLESS NIGHTMARE OR RUN THE CAMPAIGN AGAIN?",
          buttonText: "PLAY AGAIN",
          showExtraActions: true,
        });
      }
    } else {
      state.endlessFloor++;
      loadCurrentLevel();
      state.phase = "READY";
      showReadyOverlay({
        title: state.levelData.def.name,
        subtitle: "MOVE MOUSE TO CENTER & PRESS START",
        note: `ENDLESS STREAK: ${state.endlessFloor - 1} CLEARED  •  CORRIDORS TIGHTEN`,
        buttonText: "START",
        showExtraActions: false,
      });
    }
  }

  // Spawn glowing lantern dust/ember particles
  function spawnEmber(x, y, speed) {
    if (state.particles.length > 48) return;
    state.particles.push({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 8,
      vy: -4 - Math.random() * 10 - speed * 0.2,
      life: 0.35 + Math.random() * 0.45,
      maxLife: 0.8,
      color: Math.random() < 0.5 ? "#ffb85c" : "#ff5a3c",
    });
  }

  // ---------------- Pointer Events ----------------
  function handlePointerMove(e) {
    const [lx, ly] = eventToLogical(e);
    state.pointerInside = lx >= 0 && lx <= W && ly >= 0 && ly <= H;

    if (state.phase === "PLAYING") {
      const res = checkMovementSegment(state.mouseX, state.mouseY, lx, ly);
      state.prevMouseX = state.mouseX;
      state.prevMouseY = state.mouseY;
      state.mouseX = res.x;
      state.mouseY = res.y;

      const moved = Math.hypot(lx - state.prevMouseX, ly - state.prevMouseY);
      if (moved > 1.2 && Math.random() < 0.65) {
        spawnEmber(state.mouseX, state.mouseY, moved);
      }

      if (res.hitWall) {
        triggerJumpscare();
        return;
      }
      if (res.hitExit) {
        triggerLevelClear();
        return;
      }
    } else {
      state.prevMouseX = state.mouseX;
      state.prevMouseY = state.mouseY;
      state.mouseX = lx;
      state.mouseY = ly;
    }
  }

  function handlePointerLeave() {
    state.pointerInside = false;
    if (state.phase === "PLAYING") {
      // Classic maze horror anti-escape rule!
      triggerJumpscare("YOU CANNOT FLEE");
    }
  }

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  crtFrame.addEventListener("mouseleave", () => {
    if (state.phase === "PLAYING") {
      triggerJumpscare("YOU CANNOT FLEE");
    }
  });

  // UI Button Listeners
  btnStart.addEventListener("click", (e) => {
    beginCountdown(e);
  });

  btnMute.addEventListener("click", () => {
    audio.init();
    const nextMuted = !audio.muted;
    audio.setMuted(nextMuted);
    btnMute.textContent = nextMuted ? "SFX: OFF" : "SFX: ON";
  });

  volSlider.addEventListener("input", (e) => {
    audio.init();
    const val = parseFloat(e.target.value);
    audio.setVolume(val);
    if (val > 0 && audio.muted) {
      audio.setMuted(false);
      btnMute.textContent = "SFX: ON";
    }
  });

  btnStrobe.addEventListener("click", () => {
    audio.playClick();
    jumpscare.allowStrobe = !jumpscare.allowStrobe;
    btnStrobe.textContent = jumpscare.allowStrobe ? "FLASH: ON" : "FLASH: LOW";
  });

  function switchMode(targetMode) {
    audio.playClick();
    state.mode = targetMode;
    btnMode.textContent =
      state.mode === "campaign" ? "MODE: CAMPAIGN" : "MODE: ENDLESS";
    state.levelIndex = 0;
    state.endlessFloor = 1;
    state.deaths = 0;
    state.totalCampaignTime = 0;
    hudDeaths.textContent = "0";
    hudTime.textContent = "00.0s";
    crtFrame.classList.remove("shaking");
    loadCurrentLevel();
    state.phase = "READY";
    showReadyOverlay({
      title: state.levelData.def.name,
      subtitle: "MOVE MOUSE TO CENTER & PRESS START",
      note: state.levelData.def.subtitle,
      buttonText: "START",
      showExtraActions: false,
    });
  }

  btnMode.addEventListener("click", () => {
    switchMode(state.mode === "campaign" ? "endless" : "campaign");
  });

  btnRestartCampaign.addEventListener("click", () => switchMode("campaign"));
  btnTryEndless.addEventListener("click", () => switchMode("endless"));

  // ---------------- Update Loop ----------------
  function update(dt) {
    state.time += dt;

    // Update particles
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }

    if (state.phase === "COUNTDOWN") {
      const inCenter =
        state.pointerInside && isInsideCenterSanctuary(state.mouseX, state.mouseY);

      if (!inCenter) {
        // Pause & reset countdown until cursor is safely inside the center sanctuary!
        state.countdownVal = 3.0;
        state.lastCountdownInt = 4;
        countdownNum.className = "warn";
        countdownNum.textContent = "CENTER";
        countdownMsg.textContent = "RETURN MOUSE TO THE CENTER CIRCLE";
        if (!state.outOfCenterWarned) {
          audio.playWarn();
          state.outOfCenterWarned = true;
        }
        audio.updateTension(dt, 0.15, false);
        return;
      }

      state.outOfCenterWarned = false;
      state.countdownVal -= dt;
      const sec = Math.ceil(state.countdownVal);

      if (sec > 0) {
        countdownNum.className = "";
        countdownNum.textContent = String(sec);
        countdownMsg.textContent =
          sec === 3
            ? "HOLD STILL IN THE CENTER..."
            : sec === 2
            ? "STEADY YOUR HAND..."
            : "DON'T TOUCH THE WALLS!";

        if (sec < state.lastCountdownInt) {
          state.lastCountdownInt = sec;
          audio.playCountdown(sec);
        }
      } else {
        // GO! Begin active maze run!
        audio.playCountdown(0);
        state.phase = "PLAYING";
        state.goFlashTimer = 0.65;
        state.prevMouseX = state.mouseX;
        state.prevMouseY = state.mouseY;

        countdownNum.className = "go";
        countdownNum.textContent = "RUN";
        countdownMsg.textContent = "REACH THE GREEN EXIT!";
      }
      audio.updateTension(dt, 0.25, false);
    } else if (state.phase === "PLAYING") {
      state.runTime += dt;
      hudTime.textContent = `${state.runTime.toFixed(1)}s`;

      if (state.goFlashTimer > 0) {
        state.goFlashTimer -= dt;
        if (state.goFlashTimer <= 0) {
          countdownHud.classList.add("hidden");
        }
      }

      // Compute proximity dread from precomputed BFS wall distance field
      const ix = Math.max(0, Math.min(W - 1, Math.round(state.mouseX)));
      const iy = Math.max(0, Math.min(H - 1, Math.round(state.mouseY)));
      const wd = state.levelData.wallDist[iy * W + ix];
      const maxSafe = Math.max(4, state.levelData.def.corridorWidth * 0.55);
      const prox = Math.max(0, Math.min(1, 1 - (wd - 1) / maxSafe));
      state.proximity = prox;

      audio.updateTension(dt, prox, true);

      if (prox > 0.72) {
        hudProximity.textContent = "PULSE: PANIC!!";
        hudProximity.className = "danger";
      } else if (prox > 0.42) {
        hudProximity.textContent = "PULSE: RACING";
        hudProximity.className = "tense";
      } else {
        hudProximity.textContent = "PULSE: STEADY";
        hudProximity.className = "";
      }

      // Periodic lantern embers
      if (Math.random() < 0.22) {
        spawnEmber(state.mouseX, state.mouseY, 1);
      }
    } else if (state.phase === "JUMPSCARE") {
      const done = jumpscare.update(dt);
      if (done) {
        finishJumpscare();
      }
    } else if (state.phase === "LEVEL_CLEAR") {
      state.clearTimer -= dt;
      if (state.clearTimer <= 0) {
        advanceAfterClear();
      }
    } else {
      audio.updateTension(dt, 0, false);
      hudProximity.textContent = "PULSE: CALM";
      hudProximity.className = "";
    }
  }

  // ---------------- Rendering ----------------
  function drawWallEyes(focusX, focusY) {
    const eyes = state.levelData.eyes;
    for (let i = 0; i < eyes.length; i++) {
      const eye = eyes[i];
      // Occasional eerie blink
      const blink = Math.sin(state.time * 1.4 + eye.blinkPhase);
      if (blink > 0.94) continue;

      const dx = focusX - eye.x;
      const dy = focusY - eye.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Only clearly open when somewhat close to the lantern
      if (dist > 82) continue;

      const px = Math.round((dx / dist) * 1.4);
      const py = Math.round((dy / dist) * 0.8);

      // Socket
      ctx.fillStyle = "#080306";
      ctx.fillRect(eye.x - 4, eye.y - 2, 9, 5);
      // Sclera
      ctx.fillStyle = "#e6dcd0";
      ctx.fillRect(eye.x - 3, eye.y - 1, 7, 3);
      // Tracking iris/pupil
      ctx.fillStyle = eye.redIris ? "#c91426" : "#221018";
      ctx.fillRect(eye.x - 1 + px, eye.y - 1 + py, 3, 3);
      ctx.fillStyle = "#000";
      ctx.fillRect(eye.x + px, eye.y + py, 1, 1);
    }
  }

  function drawExitPortal() {
    const [ex, ey] = state.levelData.def.exitPos;
    const r = state.levelData.def.exitRadius;
    const pulse = Math.sin(state.time * 5.2);

    // Outer pulsing ritual glow
    ctx.fillStyle = "rgba(50, 225, 110, 0.22)";
    ctx.beginPath();
    ctx.arc(ex, ey, r + 3 + pulse * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Pixelated swirling exit core
    ctx.fillStyle = "#165c32";
    ctx.fillRect((ex - r + 1) | 0, (ey - r + 1) | 0, (r * 2 - 2) | 0, (r * 2 - 2) | 0);
    ctx.fillStyle = "#39d973";
    ctx.fillRect((ex - r + 3) | 0, (ey - r + 3) | 0, (r * 2 - 6) | 0, (r * 2 - 6) | 0);
    ctx.fillStyle = "#d9ffe6";
    const s = 3 + ((pulse > 0 ? 1 : 0) * 2);
    ctx.fillRect((ex - s / 2) | 0, (ey - s / 2) | 0, s, s);

    // Tiny pixel "EXIT" label nearby (clamped inside canvas)
    const lx = Math.max(14, Math.min(W - 22, ex));
    const ly = ey > 24 ? ey - r - 5 : ey + r + 9;
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(lx - 11, ly - 5, 22, 7);
    ctx.fillStyle = "#7bffa6";
    ctx.font = "bold 6px monospace";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", lx, ly + 1);
  }

  function drawCenterSanctuaryRing() {
    const r = state.levelData.def.sanctuaryRadius;
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 6);

    if (state.phase === "COUNTDOWN") {
      const inCenter =
        state.pointerInside && isInsideCenterSanctuary(state.mouseX, state.mouseY);
      ctx.strokeStyle = inCenter
        ? `rgba(255, 70, 82, ${0.55 + pulse * 0.4})`
        : `rgba(255, 196, 60, ${0.65 + pulse * 0.35})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(CX, CY, r - 1, 0, Math.PI * 2);
      ctx.stroke();

      // Countdown progress arc around center circle
      if (inCenter && state.countdownVal > 0) {
        const frac = state.countdownVal / 3.0;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(CX, CY, r + 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }
    } else if (state.phase === "TITLE" || state.phase === "READY") {
      ctx.strokeStyle = `rgba(255, 65, 80, ${0.35 + pulse * 0.45})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(CX, CY, r + pulse * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Bayer 4x4 ordered-dithered flashlight darkness overlay
  function drawDitheredLighting(lx, ly) {
    const def = state.levelData.def;
    const [ex, ey] = def.exitPos;

    // Lantern flickers subtly, and violently when close to a wall!
    const flicker =
      Math.sin(state.time * 23) * 1.4 +
      Math.sin(state.time * 47) * (0.8 + state.proximity * 3.8);

    // During TITLE/READY/COUNTDOWN, show a wider spooky preview glow from center
    const isPreview =
      state.phase === "TITLE" || state.phase === "READY" || state.phase === "COUNTDOWN";
    const radius = (isPreview ? def.lightRadius * 1.35 : def.lightRadius) + flicker;
    const ambient = isPreview ? Math.max(0.32, def.ambientLight + 0.1) : def.ambientLight;

    const data = lightImg.data;
    const halfLx = lx * 0.5;
    const halfLy = ly * 0.5;
    const halfEx = ex * 0.5;
    const halfEy = ey * 0.5;
    const halfRad = radius * 0.5;
    const invRad = 1 / Math.max(8, halfRad);

    for (let y = 0; y < LIGHT_H; y++) {
      const bRow = BAYER4[y & 3];
      const dy = y - halfLy;
      const edy = y - halfEy;
      for (let x = 0; x < LIGHT_W; x++) {
        const dx = x - halfLx;
        const dist = Math.hypot(dx, dy);
        let light = Math.max(0, 1 - dist * invRad);
        light = light * light; // smooth quadratic falloff

        // Faint eerie glow around the Exit Portal so player can navigate toward it
        const edist = Math.hypot(x - halfEx, edy);
        const exitLight = Math.max(0, 1 - edist / 16) * 0.65;

        const totalLight = Math.min(1, Math.max(ambient, light + exitLight));
        const darkness = 1 - totalLight;

        // Quantize alpha through 4x4 Bayer matrix for authentic pixel horror dithering
        const threshold = bRow[x & 3];
        const steps = 4;
        const q = Math.floor(darkness * steps + threshold) / steps;
        const alpha = Math.max(0, Math.min(242, (q * 246) | 0));

        const p = (y * LIGHT_W + x) * 4;
        data[p] = 4;
        data[p + 1] = 2;
        data[p + 2] = 6;
        data[p + 3] = alpha;
      }
    }

    lightCtx.putImageData(lightImg, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(lightCanvas, 0, 0, W, H);
  }

  function drawPlayerCursor() {
    if (state.phase !== "COUNTDOWN" && state.phase !== "PLAYING") return;

    const x = Math.round(state.mouseX);
    const y = Math.round(state.mouseY);

    // Subtle warm lantern aura
    const auraR = 8 + Math.sin(state.time * 28) * 1.2;
    ctx.fillStyle =
      state.proximity > 0.65
        ? "rgba(255, 60, 60, 0.25)"
        : "rgba(255, 200, 115, 0.2)";
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fill();

    // Exact 3x3 pixel hitbox core (dark 1px outline around bright soul pixel)
    ctx.fillStyle = "#000000";
    ctx.fillRect(x - 2, y - 2, 5, 5);

    ctx.fillStyle = state.proximity > 0.7 ? "#ff4048" : "#ffcb6b";
    ctx.fillRect(x - 1, y - 1, 3, 3);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, 1, 1);
  }

  function drawParticles() {
    for (let i = 0; i < state.particles.length; i++) {
      const p = state.particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    if (state.phase === "JUMPSCARE") {
      jumpscare.render(ctx);
      return;
    }

    // 1. Baked pixel-art maze layer
    ctx.drawImage(state.levelData.bakedCanvas, 0, 0);

    // 2. Creepy wall eyes tracking player's lantern
    const focusX =
      state.phase === "PLAYING" || state.phase === "COUNTDOWN" ? state.mouseX : CX;
    const focusY =
      state.phase === "PLAYING" || state.phase === "COUNTDOWN" ? state.mouseY : CY;
    drawWallEyes(focusX, focusY);

    // 3. Center sanctuary ritual seal
    drawCenterSanctuaryRing();

    // 4. Pulsing exit portal
    drawExitPortal();

    // 5. Lantern embers
    drawParticles();

    // 6. Bayer-dithered pixel flashlight darkness
    drawDitheredLighting(focusX, focusY);

    // 7. Player's crisp pixel hitbox cursor on top of darkness
    drawPlayerCursor();

    // 8. Danger crimson edge pulse when dangerously close to a wall
    if (state.phase === "PLAYING" && state.proximity > 0.55) {
      const pulse =
        (state.proximity - 0.55) * (0.45 + 0.35 * Math.sin(state.time * 18));
      ctx.strokeStyle = `rgba(220, 18, 34, ${Math.min(0.65, pulse)})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, W - 4, H - 4);
    }
  }

  // ---------------- Boot & RAF Loop ----------------
  let lastTs = performance.now();
  function frame(ts) {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  loadBest();
  loadCurrentLevel();
  showReadyOverlay({
    title: "DON'T TOUCH THE WALLS",
    subtitle: "PLACE YOUR MOUSE IN THE CENTER & PRESS START",
    note: "STAY INSIDE THE TIGHT CORRIDORS. HIT A WALL = RANDOM JUMPSCARE. AUDIO ON.",
    buttonText: "START",
    showExtraActions: false,
  });

  requestAnimationFrame(frame);
})(window);
