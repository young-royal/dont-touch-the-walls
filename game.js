/* ============================================================
   game.js — Main Loop, Mouse Raycast Collision & Horror Rendering
   ============================================================ */
(function (global) {
  "use strict";

  const { W, H, CX, CY, CATEGORIES, CAMPAIGN_LEVELS, getCategory, buildLevelData } =
    global.MazeLevels;

  const CENTER_PROMPT = "MOVE YOUR MOUSE TO THE CENTER & PRESS START";

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
  const overlayCategory = document.getElementById("overlay-category");
  const overlayTitle = document.getElementById("overlay-title");
  const overlaySubtitle = document.getElementById("overlay-subtitle");
  const overlayNote = document.getElementById("overlay-note");

  const btnStart = document.getElementById("btn-start");

  const countdownHud = document.getElementById("countdown-hud");
  const countdownNum = document.getElementById("countdown-num");
  const countdownMsg = document.getElementById("countdown-msg");
  const scareCaption = document.getElementById("scare-caption");
  const actAnnouncement = document.getElementById("act-announcement");
  const actAnnouncementText = document.getElementById("act-announcement-text");

  const victoryScreen = document.getElementById("victory-screen");
  const btnPlayAgain = document.getElementById("btn-play-again");

  const timerBar = document.getElementById("timer-bar");
  const timerBarFill = document.getElementById("timer-bar-fill");

  const adminBar = document.getElementById("admin-bar");
  const adminLevels = document.getElementById("admin-levels");
  const btnAdminInvincible = document.getElementById("btn-admin-invincible");
  const btnAdminClose = document.getElementById("btn-admin-close");

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
    phase: "TITLE", // TITLE | READY | COUNTDOWN | PLAYING | JUMPSCARE | LEVEL_CLEAR | VICTORY
    levelIndex: 0,
    levelData: null,

    deaths: 0,
    runTime: 0,
    totalCampaignTime: 0,

    // Mouse logical coordinates (320x200)
    mouseX: CX,
    mouseY: CY,
    prevMouseX: CX,
    prevMouseY: CY,
    lastTickX: CX,
    lastTickY: CY,
    mouseVx: 0,
    mouseVy: 0,
    pointerInside: false,

    // Countdown timer (adaptive: 3.0s on 1st try per floor, 1.05s on retries)
    levelAttempts: 0,
    countdownDuration: 3.0,
    countdownStepDuration: 1.0,
    countdownVal: 3.0,
    lastCountdownInt: 4,
    outOfCenterWarned: false,
    goFlashTimer: 0,

    // Level clear & act announcement timers
    clearTimer: 0,
    announceTimer: 0,

    // Particles & hunting mobs (Act III)
    particles: [],
    mobs: [],
    time: 0,
    proximity: 0,
    lastScareName: "",

    // Secret Admin Mode
    adminEnabled: false,
    adminInvincible: false,
    keyBuffer: "",

    // Phone / touch blocker
    mobileBlocked: window.matchMedia("(hover: none), (pointer: coarse)").matches,
  };

  function blockTouchDevice() {
    if (state.mobileBlocked) return;
    state.mobileBlocked = true;
    document.body.classList.add("mobile-blocked");
    crtFrame.classList.remove("shaking");
    resetTimerBar();
    setCursorHidden(false);
    audio.updateTension(0.016, 0, false);
    state.phase = "TITLE";
  }

  if (state.mobileBlocked) {
    document.body.classList.add("mobile-blocked");
  }

  function spawnLevelMobs() {
    const specs = (state.levelData && state.levelData.def.mobs) || [];
    state.mobs = specs.map((m, i) => ({
      type: m.type,
      x: m.x,
      y: m.y,
      speed: m.speed,
      dashSpeed: m.dashSpeed || 110,
      phaseSpeed: m.phaseSpeed || 38,
      radius: m.radius || 5,
      phase: i * 1.7,
      dashState: "stalk", // "stalk" | "windup" | "dash"
      dashTimer: 1.4 + (i % 3) * 0.75,
      dashDirX: 0,
      dashDirY: 0,
      // Spirit teleport state ("visible" | "fadeout" | "fadein" | "enraged" | "return_fade")
      spiritState: "visible",
      spiritTimer: 9.0,
      spiritAlpha: 1,
      returnX: m.x,
      returnY: m.y,
      husk: null,
      trail: [],
    }));
  }

  // Load current level
  function loadCurrentLevel() {
    const def = CAMPAIGN_LEVELS[state.levelIndex];
    state.levelData = buildLevelData(def);
    state.levelAttempts = 0;
    state.particles = [];
    state.proximity = 0;
    spawnLevelMobs();
    syncAdminButtons();
  }

  function resetTimerBar() {
    timerBar.classList.add("hidden");
    timerBar.classList.remove("pulsing");
    timerBarFill.style.width = "0%";
  }

  function updateTimerBar(progress) {
    const clamped = Math.max(0, Math.min(1, progress));
    timerBar.classList.remove("hidden");
    timerBarFill.style.width = `${(clamped * 100).toFixed(2)}%`;
    if (clamped >= 0.72) {
      timerBar.classList.add("pulsing");
    } else {
      timerBar.classList.remove("pulsing");
    }
  }

  // Convert DOM pointer event to logical 320x200 coordinates
  function eventToLogical(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return [x, y];
  }

  // Check if cursor core (3x3 cross) touches wall, fake exit hole, or exit
  function sampleCollision(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix <= 1 || ix >= W - 2 || iy <= 1 || iy >= H - 2) {
      return { hitWall: true, hitExit: false, hitFakeExit: false };
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
    let hitFakeExit = false;
    for (let i = 0; i < offsets.length; i++) {
      const m = mask[(iy + offsets[i][1]) * W + (ix + offsets[i][0])];
      if (m === 0) {
        return { hitWall: true, hitExit: false, hitFakeExit: false };
      }
      if (m === 2) {
        hitExit = true;
      } else if (m === 3) {
        hitFakeExit = true;
      }
    }
    return { hitWall: false, hitExit, hitFakeExit };
  }

  // Raycast movement segment at 0.5px steps so fast mouse swings can never tunnel through walls
  function checkMovementSegment(x0, y0, x1, y1, ignoreWalls) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist * 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sx = x0 + dx * t;
      const sy = y0 + dy * t;
      const res = sampleCollision(sx, sy);
      if (res.hitExit) {
        return { hitWall: false, hitExit: true, hitFakeExit: false, x: sx, y: sy };
      }
      if (!ignoreWalls && res.hitFakeExit) {
        return { hitWall: false, hitExit: false, hitFakeExit: true, x: sx, y: sy };
      }
      if (!ignoreWalls && res.hitWall) {
        return { hitWall: true, hitExit: false, hitFakeExit: false, x: sx, y: sy };
      }
    }
    return { hitWall: false, hitExit: false, hitFakeExit: false, x: x1, y: y1 };
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
    const catName =
      opts.category !== undefined
        ? opts.category
        : getCategory(state.levelData.def.category).name;
    overlayCategory.textContent = catName;
    overlayTitle.textContent = opts.title;
    overlaySubtitle.textContent = opts.subtitle;
    overlayNote.textContent = opts.note || "";
    btnStart.textContent = opts.buttonText || "START";

    overlay.classList.remove("hidden");
    countdownHud.classList.add("hidden");
    scareCaption.classList.add("hidden");
    actAnnouncement.classList.add("hidden");
    victoryScreen.classList.add("hidden");
    setCursorHidden(false);
  }

  function showVictoryScreen() {
    state.phase = "VICTORY";
    overlay.classList.add("hidden");
    countdownHud.classList.add("hidden");
    scareCaption.classList.add("hidden");
    actAnnouncement.classList.add("hidden");
    crtFrame.classList.remove("shaking");
    resetTimerBar();
    setCursorHidden(false);
    audio.updateTension(0.016, 0, false);
    audio.playVictory();
    victoryScreen.classList.remove("hidden");

    // Seed celebratory rising dawn embers
    state.particles = [];
    for (let i = 0; i < 36; i++) {
      state.particles.push({
        x: 60 + Math.random() * 200,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 6,
        vy: -8 - Math.random() * 14,
        life: 1 + Math.random() * 2,
        maxLife: 3,
        color: Math.random() < 0.55 ? "#7bffa6" : "#ffe6a3",
      });
    }
  }

  function presentCurrentChapter(allowAnnouncement) {
    const def = state.levelData.def;
    if (allowAnnouncement && def.announcement) {
      state.phase = "ANNOUNCEMENT";
      state.announceTimer = 2.8;
      overlay.classList.add("hidden");
      countdownHud.classList.add("hidden");
      scareCaption.classList.add("hidden");
      victoryScreen.classList.add("hidden");
      setCursorHidden(false);

      // Restart CSS fade animation cleanly
      actAnnouncementText.style.animation = "none";
      void actAnnouncementText.offsetWidth;
      actAnnouncementText.style.animation = "";
      actAnnouncementText.textContent = def.announcement;
      actAnnouncement.classList.remove("hidden");

      audio.playAnnouncement();
      return;
    }

    actAnnouncement.classList.add("hidden");
    state.phase = "READY";
    showReadyOverlay({
      title: def.name,
      subtitle: CENTER_PROMPT,
      note: def.subtitle,
      buttonText: "START",
    });
  }

  // Start Countdown (triggered by clicking exact-center START button)
  function beginCountdown(clickEvent) {
    if (state.mobileBlocked) return;
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
      loadCurrentLevel();
    }

    state.levelAttempts++;
    const isRetry = state.levelAttempts > 1;
    state.countdownStepDuration = isRetry ? 0.35 : 1.0;
    state.countdownDuration = state.countdownStepDuration * 3;

    state.phase = "COUNTDOWN";
    state.countdownVal = state.countdownDuration;
    state.lastCountdownInt = 4;
    state.outOfCenterWarned = false;
    state.runTime = 0;
    state.lastTickX = state.mouseX;
    state.lastTickY = state.mouseY;
    state.mouseVx = 0;
    state.mouseVy = 0;
    spawnLevelMobs();
    resetTimerBar();

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
    state.proximity = 0;
    resetTimerBar();
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
      subtitle: CENTER_PROMPT,
      note: `${state.levelData.def.name}  •  DEATHS: ${state.deaths}`,
      buttonText: "RETRY",
    });
  }

  function triggerLevelClear() {
    state.phase = "LEVEL_CLEAR";
    state.clearTimer = 1.15;
    state.totalCampaignTime += state.runTime;
    resetTimerBar();
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

    if (state.levelIndex + 1 < CAMPAIGN_LEVELS.length) {
      state.levelIndex++;
      loadCurrentLevel();
      presentCurrentChapter(true);
    } else {
      // All 9 chapters cleared — launch special Victory Screen!
      showVictoryScreen();
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
    if (e.pointerType === "touch") {
      blockTouchDevice();
      return;
    }
    if (state.mobileBlocked) return;

    const [lx, ly] = eventToLogical(e);
    state.pointerInside = lx >= 0 && lx <= W && ly >= 0 && ly <= H;

    if (state.phase === "PLAYING") {
      const invincible = state.adminInvincible;
      const res = checkMovementSegment(
        state.mouseX,
        state.mouseY,
        lx,
        ly,
        invincible
      );
      state.prevMouseX = state.mouseX;
      state.prevMouseY = state.mouseY;
      state.mouseX = res.x;
      state.mouseY = res.y;

      const moved = Math.hypot(lx - state.prevMouseX, ly - state.prevMouseY);
      if (moved > 1.2 && Math.random() < 0.65) {
        spawnEmber(state.mouseX, state.mouseY, moved);
      }

      if (res.hitWall && !invincible) {
        triggerJumpscare();
        return;
      }
      if (res.hitFakeExit && !invincible) {
        triggerJumpscare("FALSE EXIT");
        return;
      }
      if (!invincible && state.mobs.length > 0) {
        // Prevent tunneling through a hunting mob with a fast mouse swipe
        const segDx = state.mouseX - state.prevMouseX;
        const segDy = state.mouseY - state.prevMouseY;
        const segLen2 = segDx * segDx + segDy * segDy;
        for (let i = 0; i < state.mobs.length; i++) {
          const mob = state.mobs[i];
          const t =
            segLen2 > 0
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((mob.x - state.prevMouseX) * segDx +
                      (mob.y - state.prevMouseY) * segDy) /
                      segLen2
                  )
                )
              : 0;
          const cx = state.prevMouseX + segDx * t;
          const cy = state.prevMouseY + segDy * t;
          if (Math.hypot(mob.x - cx, mob.y - cy) <= mob.radius + 1.5) {
            triggerJumpscare("HUNTED DOWN");
            return;
          }
        }
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
    if (state.phase === "PLAYING" && !state.adminInvincible) {
      // Classic maze horror anti-escape rule!
      triggerJumpscare("YOU CANNOT FLEE");
    }
  }

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch") {
        blockTouchDevice();
      }
    },
    true
  );

  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerLeave);
  crtFrame.addEventListener("mouseleave", () => {
    if (state.phase === "PLAYING" && !state.adminInvincible) {
      triggerJumpscare("YOU CANNOT FLEE");
    }
  });

  // UI Button Listeners
  btnStart.addEventListener("click", (e) => {
    beginCountdown(e);
  });

  btnPlayAgain.addEventListener("click", () => {
    audio.playClick();
    victoryScreen.classList.add("hidden");
    state.levelIndex = 0;
    state.totalCampaignTime = 0;
    state.deaths = 0;
    state.runTime = 0;
    resetTimerBar();
    loadCurrentLevel();
    state.phase = "READY";
    showReadyOverlay({
      title: "DON'T TOUCH THE WALLS",
      subtitle: CENTER_PROMPT,
      note: "HEADPHONES RECOMMENDED — PLAY WITH AUDIO ON FOR THE BEST EXPERIENCE.",
      buttonText: "START",
    });
  });

  // ---------------- Secret Admin Mode ("g a y") ----------------
  const ADMIN_CODE = "gay";

  function syncAdminButtons() {
    const btns = adminLevels.querySelectorAll(".admin-lvl-btn");
    btns.forEach((b) => {
      const idx = parseInt(b.dataset.index, 10);
      if (idx === state.levelIndex) {
        b.classList.add("active");
      } else {
        b.classList.remove("active");
      }
    });
  }

  function syncInvincibleButton() {
    if (state.adminInvincible) {
      btnAdminInvincible.textContent = "INVINCIBLE (I): ON";
      btnAdminInvincible.classList.add("active");
    } else {
      btnAdminInvincible.textContent = "INVINCIBLE (I): OFF";
      btnAdminInvincible.classList.remove("active");
    }
  }

  function toggleAdminInvincible() {
    audio.playClick();
    state.adminInvincible = !state.adminInvincible;
    syncInvincibleButton();

    if (!state.adminInvincible && state.phase === "PLAYING") {
      const c = sampleCollision(state.mouseX, state.mouseY);
      if (!state.pointerInside) {
        triggerJumpscare("YOU CANNOT FLEE");
      } else if (c.hitWall) {
        triggerJumpscare();
      } else if (c.hitFakeExit) {
        triggerJumpscare("FALSE EXIT");
      }
    }
  }

  function jumpToLevel(idx) {
    if (idx < 0 || idx >= CAMPAIGN_LEVELS.length) return;
    audio.playClick();
    crtFrame.classList.remove("shaking");
    scareCaption.classList.add("hidden");
    countdownHud.classList.add("hidden");
    audio.updateTension(0.016, 0, false);

    state.levelIndex = idx;
    state.runTime = 0;
    resetTimerBar();
    loadCurrentLevel();
    presentCurrentChapter(true);
  }

  function setAdminMode(enabled) {
    state.adminEnabled = !!enabled;
    if (state.adminEnabled) {
      adminBar.classList.remove("hidden");
      syncAdminButtons();
      syncInvincibleButton();
      audio.playClick();
    } else {
      adminBar.classList.add("hidden");
    }
  }

  // Build admin level selector buttons grouped by the 3 Categories
  CATEGORIES.forEach((cat) => {
    const group = document.createElement("div");
    group.className = "admin-cat-group";

    const label = document.createElement("span");
    label.className = "admin-cat-label";
    label.textContent = `${cat.short}:`;
    label.title = cat.name;
    group.appendChild(label);

    CAMPAIGN_LEVELS.forEach((lvl, idx) => {
      if (lvl.category !== cat.id) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pixel-btn small admin-lvl-btn";
      btn.dataset.index = String(idx);
      btn.textContent = String(idx + 1);
      btn.title = `${cat.name} — ${lvl.name}`;
      btn.addEventListener("click", () => jumpToLevel(idx));
      group.appendChild(btn);
    });

    adminLevels.appendChild(group);
  });

  btnAdminInvincible.addEventListener("click", toggleAdminInvincible);
  btnAdminClose.addEventListener("click", () => setAdminMode(false));

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();

    // Quick shortcuts when Admin Mode is active
    if (state.adminEnabled) {
      if (key >= "1" && key <= String(CAMPAIGN_LEVELS.length)) {
        jumpToLevel(parseInt(key, 10) - 1);
        return;
      }
      if (key === "i") {
        toggleAdminInvincible();
        return;
      }
    }

    if (key.length === 1 && key >= "a" && key <= "z") {
      state.keyBuffer = (state.keyBuffer + key).slice(-ADMIN_CODE.length);
      if (state.keyBuffer === ADMIN_CODE) {
        state.keyBuffer = "";
        setAdminMode(!state.adminEnabled);
      }
    }
  });

  // Update hunting mobs (Act III — Chapters 7, 8, 9)
  function updateMobs(dt) {
    if (state.mobs.length === 0) return { hitPlayer: false, nearestDist: 999 };

    // Track smoothed player velocity for interceptor mobs
    const rawVx = (state.mouseX - state.lastTickX) / Math.max(dt, 0.008);
    const rawVy = (state.mouseY - state.lastTickY) / Math.max(dt, 0.008);
    state.lastTickX = state.mouseX;
    state.lastTickY = state.mouseY;
    state.mouseVx = state.mouseVx * 0.8 + Math.max(-180, Math.min(180, rawVx)) * 0.2;
    state.mouseVy = state.mouseVy * 0.8 + Math.max(-180, Math.min(180, rawVy)) * 0.2;

    let nearestDist = 999;

    for (let i = 0; i < state.mobs.length; i++) {
      const mob = state.mobs[i];

      // Save smoky afterimage trail (only while moving)
      const isStandingSpirit =
        mob.type === "spirit" &&
        mob.spiritState !== "visible" &&
        mob.spiritState !== "enraged";
      if (!isStandingSpirit && Math.random() < 0.45) {
        mob.trail.push({
          x: mob.x,
          y: mob.y,
          life: 0.28,
          enraged: mob.type === "spirit" && mob.spiritState === "enraged",
        });
        if (mob.trail.length > 8) mob.trail.shift();
      }
      for (let t = mob.trail.length - 1; t >= 0; t--) {
        mob.trail[t].life -= dt;
        if (mob.trail[t].life <= 0) mob.trail.splice(t, 1);
      }

      // Decay Spirit's left-behind static husk
      if (mob.husk) {
        mob.husk.life -= dt;
        if (mob.husk.life <= 0) mob.husk = null;
      }

      let vx = 0;
      let vy = 0;

      if (mob.type === "dasher") {
        mob.dashTimer -= dt;
        if (mob.dashState === "stalk") {
          const dx = state.mouseX - mob.x;
          const dy = state.mouseY - mob.y;
          const d = Math.hypot(dx, dy) || 1;
          vx = (dx / d) * mob.speed;
          vy = (dy / d) * mob.speed;

          if (mob.dashTimer <= 0 && d < 165) {
            mob.dashState = "windup";
            mob.dashTimer = 0.48;
            mob.dashDirX = dx / d;
            mob.dashDirY = dy / d;
            audio.playDashCue();
          }
        } else if (mob.dashState === "windup") {
          // Lock onto player during early windup, freeze just before lunge
          if (mob.dashTimer > 0.16) {
            const dx = state.mouseX - mob.x;
            const dy = state.mouseY - mob.y;
            const d = Math.hypot(dx, dy) || 1;
            mob.dashDirX = dx / d;
            mob.dashDirY = dy / d;
          }
          if (mob.dashTimer <= 0) {
            mob.dashState = "dash";
            mob.dashTimer = 0.44;
          }
        } else if (mob.dashState === "dash") {
          vx = mob.dashDirX * mob.dashSpeed;
          vy = mob.dashDirY * mob.dashSpeed;
          if (mob.dashTimer <= 0) {
            mob.dashState = "stalk";
            mob.dashTimer = 1.85 + Math.random() * 0.9;
          }
        }
      } else if (mob.type === "intercept") {
        // Predict ahead of player's movement to cut off escape routes
        const leadX = Math.max(12, Math.min(W - 12, state.mouseX + state.mouseVx * 0.42));
        const leadY = Math.max(12, Math.min(H - 12, state.mouseY + state.mouseVy * 0.42));
        const dx = leadX - mob.x;
        const dy = leadY - mob.y;
        const d = Math.hypot(dx, dy) || 1;
        vx = (dx / d) * mob.speed;
        vy = (dy / d) * mob.speed;
      } else if (mob.type === "spirit") {
        // Chapter 9 — Purple Stalker:
        // Follows like lvl 7 -> after 9s (then every 6s), blinks out, teleports nearer &
        // speeds up for 3s -> if it doesn't catch you, returns back & slows down
        mob.spiritTimer -= dt;
        if (mob.spiritState === "visible") {
          mob.spiritAlpha = 1;
          const dx = state.mouseX - mob.x;
          const dy = state.mouseY - mob.y;
          const d = Math.hypot(dx, dy) || 1;
          const sway = Math.sin(state.time * 4.8 + mob.phase) * 0.22;
          vx = ((dx / d) - (dy / d) * sway) * mob.speed;
          vy = ((dy / d) + (dx / d) * sway) * mob.speed;

          if (mob.spiritTimer <= 0) {
            mob.returnX = mob.x;
            mob.returnY = mob.y;
            mob.spiritState = "fadeout";
            mob.spiritTimer = 0.6;
            mob.husk = { x: mob.x, y: mob.y, life: 4.5, maxLife: 4.5 };
            audio.playPhaseCue(false);
          }
        } else if (mob.spiritState === "fadeout") {
          // Stands in place blinking/fading out before teleporting nearer
          vx = 0;
          vy = 0;
          mob.spiritAlpha = Math.max(0, mob.spiritTimer / 0.6);

          if (mob.spiritTimer <= 0) {
            let tx = mob.x;
            let ty = mob.y;
            for (let attempt = 0; attempt < 24; attempt++) {
              const ang = Math.random() * Math.PI * 2;
              const dist = 58 + Math.random() * 24;
              const cx = Math.max(16, Math.min(W - 16, state.mouseX + Math.cos(ang) * dist));
              const cy = Math.max(16, Math.min(H - 16, state.mouseY + Math.sin(ang) * dist));
              if (Math.hypot(cx - state.mouseX, cy - state.mouseY) >= 52) {
                tx = cx;
                ty = cy;
                break;
              }
            }
            mob.x = tx;
            mob.y = ty;
            mob.trail = [];
            mob.spiritState = "fadein";
            mob.spiritTimer = 0.35;
            mob.spiritAlpha = 0;
            audio.playPhaseCue(true);
          }
        } else if (mob.spiritState === "fadein") {
          // Blinks/fades in at the closer spot before speeding up
          vx = 0;
          vy = 0;
          mob.spiritAlpha = Math.min(1, 1 - mob.spiritTimer / 0.35);

          if (mob.spiritTimer <= 0) {
            mob.spiritState = "enraged";
            mob.spiritTimer = 3.0;
            mob.spiritAlpha = 1;
          }
        } else if (mob.spiritState === "enraged") {
          // Speeds up and chases aggressively for 3 seconds
          mob.spiritAlpha = 1;
          const dx = state.mouseX - mob.x;
          const dy = state.mouseY - mob.y;
          const d = Math.hypot(dx, dy) || 1;
          const sway = Math.sin(state.time * 7.5 + mob.phase) * 0.14;
          vx = ((dx / d) - (dy / d) * sway) * mob.phaseSpeed;
          vy = ((dy / d) + (dx / d) * sway) * mob.phaseSpeed;

          if (mob.spiritTimer <= 0) {
            mob.spiritState = "return_fade";
            mob.spiritTimer = 0.45;
            audio.playPhaseCue(false);
          }
        } else if (mob.spiritState === "return_fade") {
          // Failed to catch within 3s -> blinks out and snaps back to previous position
          vx = 0;
          vy = 0;
          mob.spiritAlpha = Math.max(0, mob.spiritTimer / 0.45);

          if (mob.spiritTimer <= 0) {
            mob.x = mob.returnX;
            mob.y = mob.returnY;
            mob.trail = [];
            mob.husk = null;
            mob.spiritState = "visible";
            mob.spiritTimer = 6.0;
            mob.spiritAlpha = 1;
            audio.playPhaseCue(true);
          }
        }
      } else {
        // Relentless Stalker Wraith with eerie lateral sway
        const dx = state.mouseX - mob.x;
        const dy = state.mouseY - mob.y;
        const d = Math.hypot(dx, dy) || 1;
        const sway = Math.sin(state.time * 4.5 + mob.phase) * 0.25;
        vx = ((dx / d) - (dy / d) * sway) * mob.speed;
        vy = ((dy / d) + (dx / d) * sway) * mob.speed;
      }

      // Soft separation between mobs so they flank instead of stacking
      for (let j = 0; j < state.mobs.length; j++) {
        if (i === j) continue;
        const other = state.mobs[j];
        const sdx = mob.x - other.x;
        const sdy = mob.y - other.y;
        const sd = Math.hypot(sdx, sdy);
        if (sd > 0.1 && sd < 18) {
          const push = ((18 - sd) / 18) * 28;
          vx += (sdx / sd) * push;
          vy += (sdy / sd) * push;
        }
      }

      mob.x = Math.max(8, Math.min(W - 8, mob.x + vx * dt));
      mob.y = Math.max(8, Math.min(H - 8, mob.y + vy * dt));

      const distToPlayer = Math.hypot(state.mouseX - mob.x, state.mouseY - mob.y);
      if (distToPlayer < nearestDist) nearestDist = distToPlayer;

      if (!state.adminInvincible && distToPlayer <= mob.radius + 1.5) {
        return { hitPlayer: true, nearestDist: 0 };
      }
    }

    return { hitPlayer: false, nearestDist };
  }

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
        state.countdownVal = state.countdownDuration;
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
      const step = Math.ceil(state.countdownVal / state.countdownStepDuration);

      if (step > 0) {
        countdownNum.className = "";
        countdownNum.textContent = String(step);
        countdownMsg.textContent =
          step === 3
            ? "HOLD STILL IN THE CENTER..."
            : step === 2
            ? "STEADY YOUR HAND..."
            : "DON'T TOUCH THE WALLS!";

        if (step < state.lastCountdownInt) {
          state.lastCountdownInt = step;
          audio.playCountdown(step);
        }
      } else {
        // GO! Begin active maze run!
        audio.playCountdown(0);
        state.phase = "PLAYING";
        state.goFlashTimer = 0.65;
        state.prevMouseX = state.mouseX;
        state.prevMouseY = state.mouseY;
        updateTimerBar(0);

        countdownNum.className = "go";
        countdownNum.textContent = "RUN";
        countdownMsg.textContent = "REACH THE GREEN EXIT!";
      }
      audio.updateTension(dt, 0.25, false);
    } else if (state.phase === "PLAYING") {
      state.runTime += dt;
      const timeLimit = state.levelData.def.timeLimit;
      const timeProgress = state.runTime / timeLimit;
      updateTimerBar(timeProgress);

      if (state.runTime >= timeLimit && !state.adminInvincible) {
        triggerJumpscare("TIME'S UP");
        return;
      }

      if (state.goFlashTimer > 0) {
        state.goFlashTimer -= dt;
        if (state.goFlashTimer <= 0) {
          countdownHud.classList.add("hidden");
        }
      }

      // Update hunting mobs (Chapters 7, 8, 9)
      const mobRes = updateMobs(dt);
      if (mobRes.hitPlayer) {
        triggerJumpscare("HUNTED DOWN");
        return;
      }

      // Compute proximity dread from precomputed BFS wall distance field + nearest mob
      const ix = Math.max(0, Math.min(W - 1, Math.round(state.mouseX)));
      const iy = Math.max(0, Math.min(H - 1, Math.round(state.mouseY)));
      const wd = state.levelData.wallDist[iy * W + ix];
      const maxSafe = Math.max(4, state.levelData.def.corridorWidth * 0.55);
      const wallProx = Math.max(0, Math.min(1, 1 - (wd - 1) / maxSafe));
      const mobProx =
        state.mobs.length > 0
          ? Math.max(0, Math.min(1, 1 - (mobRes.nearestDist - 8) / 56))
          : 0;
      const prox = Math.max(wallProx, mobProx);
      state.proximity = prox;

      // Blend timer urgency near expiry into heartbeat & tension audio
      const timeUrgency = timeProgress > 0.72 ? (timeProgress - 0.72) / 0.28 : 0;
      audio.updateTension(dt, Math.max(prox, timeUrgency * 0.9), true);

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
    } else if (state.phase === "ANNOUNCEMENT") {
      state.announceTimer -= dt;
      audio.updateTension(dt, 0, false);
      if (state.announceTimer <= 0) {
        presentCurrentChapter(false);
      }
    } else if (state.phase === "VICTORY") {
      audio.updateTension(dt, 0, false);
      // Keep gentle golden/emerald embers drifting upward in the open dawn archway
      if (state.particles.length < 40 && Math.random() < 0.45) {
        state.particles.push({
          x: 75 + Math.random() * 170,
          y: H + 2,
          vx: (Math.random() - 0.5) * 6,
          vy: -10 - Math.random() * 14,
          life: 2.2 + Math.random() * 1.4,
          maxLife: 3.6,
          color: Math.random() < 0.55 ? "#7bffa6" : "#ffe6a3",
        });
      }
    } else {
      audio.updateTension(dt, 0, false);
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

  function drawExitPortal(focusX, focusY) {
    if (state.phase !== "PLAYING") return;

    const def = state.levelData.def;
    const [ex, ey] = def.exitPos;
    const r = def.exitRadius;

    // On Chapter 6, real exit stays blank/empty until you get close, then lights up green!
    let alpha = 1;
    if (def.revealExitDist) {
      const distToExit = Math.hypot(focusX - ex, focusY - ey);
      if (distToExit > def.revealExitDist) return;
      alpha = Math.min(1, (def.revealExitDist - distToExit) / 14);
    }

    const pulse = Math.sin(state.time * 5.2);
    ctx.save();
    ctx.globalAlpha = alpha;

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
    ctx.restore();
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
        const frac = state.countdownVal / state.countdownDuration;
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

    const exitRevealFactor =
      state.phase !== "PLAYING"
        ? 0
        : def.revealExitDist
        ? Math.max(0, Math.min(1, (def.revealExitDist - Math.hypot(lx - ex, ly - ey)) / 14))
        : def.hideExitGlow
        ? 0
        : 1;

    for (let y = 0; y < LIGHT_H; y++) {
      const bRow = BAYER4[y & 3];
      const dy = y - halfLy;
      const edy = y - halfEy;
      for (let x = 0; x < LIGHT_W; x++) {
        const dx = x - halfLx;
        const dist = Math.hypot(dx, dy);
        let light = Math.max(0, 1 - dist * invRad);
        light = light * light; // smooth quadratic falloff

        // Faint eerie glow around the Exit Portal (lights up on Chapter 6 only when you get close)
        let exitLight = 0;
        if (exitRevealFactor > 0) {
          const edist = Math.hypot(x - halfEx, edy);
          exitLight = Math.max(0, 1 - edist / 16) * 0.65 * exitRevealFactor;
        }

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
    const invincible = state.adminInvincible;

    // Subtle warm lantern aura (or cyan shield aura when invincible)
    const auraR = 8 + Math.sin(state.time * 28) * 1.2;
    ctx.fillStyle = invincible
      ? "rgba(92, 242, 255, 0.28)"
      : state.proximity > 0.65
      ? "rgba(255, 60, 60, 0.25)"
      : "rgba(255, 200, 115, 0.2)";
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fill();

    if (invincible) {
      ctx.strokeStyle = "#5cf2ff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Exact 3x3 pixel hitbox core (dark 1px outline around bright soul pixel)
    ctx.fillStyle = "#000000";
    ctx.fillRect(x - 2, y - 2, 5, 5);

    ctx.fillStyle = invincible
      ? "#5cf2ff"
      : state.proximity > 0.7
      ? "#ff4048"
      : "#ffcb6b";
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

  // Render smoky pixel bodies of hunting mobs (under lighting)
  function drawMobsBody() {
    for (let i = 0; i < state.mobs.length; i++) {
      const mob = state.mobs[i];
      const bob = Math.sin(state.time * 7 + mob.phase) * 1.4;
      const mx = Math.round(mob.x);
      const my = Math.round(mob.y + bob);

      // Draw Spirit's lingering purple static husk left where she started phasing
      if (mob.type === "spirit" && mob.husk) {
        const ha = Math.max(0, (mob.husk.life / mob.husk.maxLife) * 0.55);
        const hx = Math.round(mob.husk.x);
        const hy = Math.round(mob.husk.y);
        const jx = Math.random() < 0.35 ? ((Math.random() - 0.5) * 3) | 0 : 0;
        ctx.save();
        ctx.globalAlpha = ha;
        ctx.fillStyle = "#4d146b";
        ctx.fillRect(hx - 4 + jx, hy - 4, 8, 8);
        ctx.fillStyle = "#c86dff";
        ctx.fillRect(hx - 3 + jx, hy - 2, 2, 1);
        ctx.fillRect(hx + 1 + jx, hy - 2, 2, 1);
        ctx.restore();
      }

      // Smoky shadow trail
      for (let t = 0; t < mob.trail.length; t++) {
        const tr = mob.trail[t];
        const frac = tr.life / 0.28;
        if (mob.type === "spirit") {
          ctx.fillStyle = tr.enraged
            ? `rgba(215, 95, 255, ${frac * 0.65})`
            : `rgba(135, 40, 210, ${frac * 0.5})`;
          ctx.fillRect((tr.x - 2) | 0, (tr.y - 2) | 0, 4, 4);
        } else {
          ctx.fillStyle =
            mob.type === "dasher"
              ? `rgba(170, 18, 34, ${frac * 0.45})`
              : `rgba(28, 10, 26, ${frac * 0.5})`;
          ctx.fillRect((tr.x - 3) | 0, (tr.y - 3) | 0, 6, 6);
        }
      }

      // Spirit blinking-fading visibility during teleport / return
      let alpha = 1;
      let glitchX = 0;
      if (mob.type === "spirit") {
        alpha = mob.spiritAlpha;
        const blinking =
          mob.spiritState === "fadeout" ||
          mob.spiritState === "fadein" ||
          mob.spiritState === "return_fade";
        if (blinking) {
          glitchX = (((Math.random() - 0.5) * 4) | 0);
          if (Math.floor(state.time * 24) % 2 === 0) alpha *= 0.2;
        }
        if (alpha <= 0.02) continue;
      }

      ctx.save();
      ctx.globalAlpha = alpha;

      // Dark gaunt pixel wraith body
      ctx.fillStyle = mob.type === "spirit" ? "#160521" : "#060208";
      ctx.fillRect(mx - 5 + glitchX, my - 5, 10, 10);
      ctx.fillStyle =
        mob.type === "spirit"
          ? "#4b126e"
          : mob.type === "dasher"
          ? "#3b060f"
          : mob.type === "intercept"
          ? "#260b30"
          : "#1a0a16";
      ctx.fillRect(mx - 4 + glitchX, my - 4, 8, 8);

      // Ragged floating bottom tendrils
      const f = ((state.time * 12 + i) | 0) % 2;
      ctx.fillStyle = mob.type === "spirit" ? "#2d0845" : "#08020a";
      ctx.fillRect(mx - 4 + glitchX, my + 4, 2, 2 + f);
      ctx.fillRect(mx - 1 + glitchX, my + 4, 2, 3 - f);
      ctx.fillRect(mx + 2 + glitchX, my + 4, 2, 2 + f);

      ctx.restore();
    }
  }

  // Render glowing hunter eyes + lunge telegraph ABOVE darkness so you can dodge them!
  function drawMobsGlow() {
    for (let i = 0; i < state.mobs.length; i++) {
      const mob = state.mobs[i];
      const bob = Math.sin(state.time * 7 + mob.phase) * 1.4;
      const mx = Math.round(mob.x);
      const my = Math.round(mob.y + bob);

      // Spirit blinking-fading & enraged glow
      if (mob.type === "spirit") {
        const blinking =
          mob.spiritState === "fadeout" ||
          mob.spiritState === "fadein" ||
          mob.spiritState === "return_fade";
        const enraged = mob.spiritState === "enraged";
        const glitchX = blinking ? (((Math.random() - 0.5) * 4) | 0) : 0;
        const blinkMul =
          blinking && Math.floor(state.time * 24) % 2 === 0 ? 0.2 : 1;
        const glowAlpha = mob.spiritAlpha * blinkMul;
        if (glowAlpha <= 0.02) continue;

        ctx.save();
        ctx.globalAlpha = glowAlpha;

        ctx.fillStyle = enraged
          ? "rgba(220, 95, 255, 0.38)"
          : "rgba(180, 65, 255, 0.22)";
        ctx.beginPath();
        ctx.arc(mx + glitchX, my, mob.radius + (enraged ? 5 : 3), 0, Math.PI * 2);
        ctx.fill();

        // Piercing spectral violet/white eyes (bright white-violet while sped up!)
        ctx.fillStyle =
          enraged || mob.spiritState === "fadein" ? "#ffffff" : "#e38cff";
        ctx.fillRect(mx - 3 + glitchX, my - 2, 2, 2);
        ctx.fillRect(mx + 1 + glitchX, my - 2, 2, 2);
        ctx.restore();
        continue;
      }

      // Dash Hound lunge telegraph sightline during windup
      if (mob.type === "dasher" && mob.dashState === "windup") {
        const flash = Math.floor(state.time * 24) % 2 === 0;
        ctx.strokeStyle = flash
          ? "rgba(255, 50, 65, 0.85)"
          : "rgba(255, 190, 90, 0.6)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, my);
        ctx.lineTo(mx + mob.dashDirX * 52, my + mob.dashDirY * 52);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Faint ominous aura around mob
      ctx.fillStyle =
        mob.type === "dasher"
          ? mob.dashState === "windup" || mob.dashState === "dash"
            ? "rgba(255, 40, 55, 0.34)"
            : "rgba(220, 35, 50, 0.16)"
          : mob.type === "intercept"
          ? "rgba(195, 70, 255, 0.16)"
          : "rgba(255, 45, 65, 0.14)";
      ctx.beginPath();
      ctx.arc(mx, my, mob.radius + 3, 0, Math.PI * 2);
      ctx.fill();

      // Piercing glowing pixel eyes visible through the dark
      const eyeColor =
        mob.type === "dasher"
          ? mob.dashState === "windup"
            ? "#ffffff"
            : "#ff3344"
          : mob.type === "intercept"
          ? "#e070ff"
          : "#ff4b58";
      ctx.fillStyle = eyeColor;
      ctx.fillRect(mx - 3, my - 2, 2, 2);
      ctx.fillRect(mx + 1, my - 2, 2, 2);

      // Tiny jagged mouth flash when lunging
      if (mob.type === "dasher" && mob.dashState === "dash") {
        ctx.fillStyle = "#ffcccc";
        ctx.fillRect(mx - 2, my + 2, 4, 1);
      }
    }
  }

  // Animated pixel-art dawn archway escape backdrop for Victory Screen
  function drawVictoryScene() {
    // Deep night-to-emerald-dawn gradient bands (pixel-stepped)
    const skyBands = ["#040706", "#07100c", "#0b1a13", "#122b1e", "#1d402c"];
    for (let i = 0; i < skyBands.length; i++) {
      ctx.fillStyle = skyBands[i];
      ctx.fillRect(0, i * 40, W, 40);
    }

    // Soft pulsing light beam streaming down from the open exit archway
    const pulse = 0.5 + 0.5 * Math.sin(state.time * 2.2);
    ctx.fillStyle = `rgba(110, 245, 155, ${0.08 + pulse * 0.06})`;
    ctx.beginPath();
    ctx.moveTo(118, 22);
    ctx.lineTo(202, 22);
    ctx.lineTo(260, H);
    ctx.lineTo(60, H);
    ctx.closePath();
    ctx.fill();

    // Stone tunnel framing the open archway
    ctx.fillStyle = "#0b090d";
    ctx.fillRect(0, 0, 86, H);
    ctx.fillRect(234, 0, 86, H);
    ctx.fillRect(86, 0, 148, 26);

    // Pixel stone brick edge details along archway
    ctx.fillStyle = "#1c1821";
    for (let y = 26; y < H; y += 12) {
      ctx.fillRect(80, y, 8, 10);
      ctx.fillRect(232, y, 8, 10);
    }
    ctx.fillStyle = "#2b2533";
    ctx.fillRect(86, 22, 148, 6);

    // Distant stone steps ascending into the light
    for (let step = 0; step < 6; step++) {
      const sy = 186 - step * 14;
      const sw = 148 - step * 14;
      const sx = CX - sw / 2;
      ctx.fillStyle = step % 2 === 0 ? "#122018" : "#182b20";
      ctx.fillRect(sx | 0, sy, sw | 0, 14);
      ctx.fillStyle = "rgba(130, 255, 175, 0.16)";
      ctx.fillRect(sx | 0, sy, sw | 0, 2);
    }

    // Faint receding eyes far in the dark corners — watching you escape
    const eyeFade = Math.max(0.15, 0.55 - Math.sin(state.time * 1.3) * 0.2);
    ctx.fillStyle = `rgba(255, 50, 65, ${eyeFade})`;
    ctx.fillRect(32, 74, 2, 2);
    ctx.fillRect(37, 74, 2, 2);
    ctx.fillRect(278, 118, 2, 2);
    ctx.fillRect(283, 118, 2, 2);

    // Rising dawn embers & dust motes
    drawParticles();
  }

  function render() {
    if (state.phase === "JUMPSCARE") {
      jumpscare.render(ctx);
      return;
    }

    if (state.phase === "VICTORY") {
      drawVictoryScene();
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

    // 4. Exit portal (empty blank holes on Chapter 6)
    drawExitPortal(focusX, focusY);

    // 5. Hunting mob bodies (Act III)
    drawMobsBody();

    // 6. Lantern embers
    drawParticles();

    // 7. Bayer-dithered pixel flashlight darkness
    drawDitheredLighting(focusX, focusY);

    // 8. Glowing mob eyes & dash telegraphs piercing the dark
    drawMobsGlow();

    // 9. Player's crisp pixel hitbox cursor on top of darkness
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

  loadCurrentLevel();
  showReadyOverlay({
    title: "DON'T TOUCH THE WALLS",
    subtitle: CENTER_PROMPT,
    note: "HEADPHONES RECOMMENDED — PLAY WITH AUDIO ON FOR THE BEST EXPERIENCE.",
    buttonText: "START",
  });

  requestAnimationFrame(frame);
})(window);
