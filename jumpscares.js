/* ============================================================
   jumpscares.js — 6 Animated Full-Screen Pixel Horror Jumpscares
   ============================================================ */
(function (global) {
  "use strict";

  const W = 320;
  const H = 200;

  const SCARE_LIST = [
    { id: 0, name: "THE HOLLOW SMILE", caption: "IT SAW YOU FLINCH" },
    { id: 1, name: "THE PALE MASK", caption: "DON'T LOOK AWAY" },
    { id: 2, name: "THE SPIDER-EYE", caption: "IT'S IN THE WALLS" },
    { id: 3, name: "STATIC PHANTOM", caption: "SIGNAL CORRUPTED" },
    { id: 4, name: "THE SKINLESS SKULL", caption: "TOO CLOSE" },
    { id: 5, name: "THE SHADOW HAND", caption: "GOT YOU" },
  ];

  class JumpscareEngine {
    constructor() {
      this.bag = [];
      this.activeScare = null;
      this.elapsed = 0;
      this.duration = 1.35;
      this.allowStrobe = true;
    }

    nextRandom() {
      if (this.bag.length === 0) {
        this.bag = [0, 1, 2, 3, 4, 5];
        // Fisher-Yates shuffle
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = (Math.random() * (i + 1)) | 0;
          const tmp = this.bag[i];
          this.bag[i] = this.bag[j];
          this.bag[j] = tmp;
        }
      }
      const id = this.bag.pop();
      return SCARE_LIST[id];
    }

    trigger(customCaption) {
      const scare = this.nextRandom();
      this.activeScare = {
        ...scare,
        caption: customCaption || scare.caption,
      };
      this.elapsed = 0;
      return this.activeScare;
    }

    update(dt) {
      this.elapsed += dt;
      return this.elapsed >= this.duration;
    }

    // Crisp pixel ellipse helper (integer stepped)
    _pixEllipse(ctx, cx, cy, rx, ry, color) {
      ctx.fillStyle = color;
      const x0 = Math.floor(cx - rx);
      const x1 = Math.ceil(cx + rx);
      const y0 = Math.floor(cy - ry);
      const y1 = Math.ceil(cy + ry);
      const rx2 = rx * rx || 1;
      const ry2 = ry * ry || 1;
      for (let y = y0; y <= y1; y += 2) {
        const dy = y - cy;
        const term = 1 - (dy * dy) / ry2;
        if (term <= 0) continue;
        const span = Math.sqrt(term) * rx;
        const lx = Math.floor((cx - span) / 2) * 2;
        const rw = Math.max(2, Math.ceil((span * 2) / 2) * 2);
        ctx.fillRect(lx, y, rw, 2);
      }
    }

    render(ctx) {
      if (!this.activeScare) return;

      const t = Math.min(1, this.elapsed / this.duration);
      const frame = (this.elapsed * 30) | 0;
      const strobe = this.allowStrobe && frame % 3 === 0;
      const redFlash = this.allowStrobe && frame % 5 === 0;

      // Rapid lunge zoom + violent pixel jitter
      const lunge = 0.72 + Math.min(1, t * 4.2) * 0.45 + Math.sin(this.elapsed * 52) * 0.05;
      const jx = ((Math.random() - 0.5) * 18) | 0;
      const jy = ((Math.random() - 0.5) * 14) | 0;

      // Background strobe
      if (redFlash) {
        ctx.fillStyle = "#520008";
      } else if (strobe) {
        ctx.fillStyle = "#180408";
      } else {
        ctx.fillStyle = "#020103";
      }
      ctx.fillRect(0, 0, W, H);

      // Grainy static speckles in background
      for (let i = 0; i < 110; i++) {
        const sx = ((Math.random() * 160) | 0) * 2;
        const sy = ((Math.random() * 100) | 0) * 2;
        ctx.fillStyle = Math.random() < 0.35 ? "#aa1522" : "#2c2228";
        ctx.fillRect(sx, sy, 2, 2);
      }

      ctx.save();
      ctx.translate(W / 2 + jx, H / 2 + jy);
      ctx.scale(lunge, lunge);

      switch (this.activeScare.id) {
        case 0:
          this._drawHollowSmile(ctx, t, frame, strobe);
          break;
        case 1:
          this._drawPaleMask(ctx, t, frame, strobe);
          break;
        case 2:
          this._drawSpiderEye(ctx, t, frame, strobe);
          break;
        case 3:
          this._drawStaticPhantom(ctx, t, frame, strobe);
          break;
        case 4:
          this._drawSkinlessSkull(ctx, t, frame, strobe);
          break;
        case 5:
          this._drawShadowHand(ctx, t, frame, strobe);
          break;
      }

      ctx.restore();

      // Horizontal CRT glitch tear slices
      if (frame % 2 === 0) {
        for (let i = 0; i < 4; i++) {
          const sy = ((Math.random() * (H - 4)) | 0);
          const sh = Math.min(H - sy, 4 + ((Math.random() * 10) | 0));
          const shift = (((Math.random() - 0.5) * 32) | 0);
          ctx.drawImage(ctx.canvas, 0, sy, W, sh, shift, sy, W, sh);
        }
      }

      // Brief harsh white-red impact flash on first 60ms
      if (this.allowStrobe && this.elapsed < 0.07) {
        ctx.fillStyle = "rgba(255, 220, 220, 0.7)";
        ctx.fillRect(0, 0, W, H);
      }
    }

    // 0: THE HOLLOW SMILE — Pitch void silhouette, huge staring white eyes, jagged wide grin
    _drawHollowSmile(ctx, t, frame, strobe) {
      // Gaunt shadowed head
      this._pixEllipse(ctx, 0, -4, 72, 88, "#080408");
      this._pixEllipse(ctx, 0, -8, 64, 78, "#160d14");
      this._pixEllipse(ctx, 0, -10, 58, 70, "#241920");

      // Sunken black eye sockets
      this._pixEllipse(ctx, -28, -26, 22, 18, "#000");
      this._pixEllipse(ctx, 28, -26, 22, 18, "#000");

      // Huge bloodshot staring eyes
      const eyeColor = strobe ? "#ff2233" : "#f6efe8";
      this._pixEllipse(ctx, -28, -26, 15, 13, eyeColor);
      this._pixEllipse(ctx, 28, -26, 15, 13, eyeColor);

      // Twitching pinpoint pupils
      const px = ((Math.sin(frame * 1.9) * 3) | 0) * 2;
      const py = ((Math.cos(frame * 2.3) * 2) | 0) * 2;
      ctx.fillStyle = "#000";
      ctx.fillRect(-31 + px, -29 + py, 6, 6);
      ctx.fillRect(25 + px, -29 + py, 6, 6);
      ctx.fillStyle = "#ff1828";
      ctx.fillRect(-29 + px, -27 + py, 2, 2);
      ctx.fillRect(27 + px, -27 + py, 2, 2);

      // Bleeding streaks under eyes
      ctx.fillStyle = "#8a0814";
      for (let i = -38; i <= -18; i += 6) {
        ctx.fillRect(i, -12, 4, 14 + ((i * 7) & 10));
      }
      for (let i = 18; i <= 38; i += 6) {
        ctx.fillRect(i, -12, 4, 14 + ((i * 5) & 10));
      }

      // Massive unhinged gaping grin
      const jawOpen = 24 + Math.min(28, t * 50) + (frame % 2) * 4;
      this._pixEllipse(ctx, 0, 26, 54, jawOpen, "#000");
      this._pixEllipse(ctx, 0, 26, 48, jawOpen - 4, "#240206");

      // Jagged pixel teeth top & bottom
      ctx.fillStyle = strobe ? "#fff" : "#dfd2be";
      for (let x = -44; x <= 40; x += 8) {
        const len = 8 + ((Math.abs(x) * 3 + frame) % 7);
        ctx.fillRect(x, 26 - jawOpen + 2, 6, len);
        ctx.fillRect(x + 2, 26 + jawOpen - len - 2, 6, len);
      }
    }

    // 1: THE PALE MASK — Cracked porcelain mask with black weeping eyes & screaming mouth
    _drawPaleMask(ctx, t, frame, strobe) {
      const maskCol = strobe ? "#ffffff" : "#dcd3c6";
      const shadeCol = "#9c9188";

      // Mask silhouette
      this._pixEllipse(ctx, 0, 0, 62, 82, "#060408");
      this._pixEllipse(ctx, 0, -2, 56, 76, shadeCol);
      this._pixEllipse(ctx, 0, -6, 50, 70, maskCol);

      // Cracks across porcelain
      ctx.fillStyle = "#181014";
      ctx.fillRect(-4, -74, 2, 34);
      ctx.fillRect(-2, -48, 12, 2);
      ctx.fillRect(10, -48, 2, 18);
      ctx.fillRect(-34, -4, 18, 2);
      ctx.fillRect(-18, -4, 2, 26);

      // Deep hollow crying sockets
      this._pixEllipse(ctx, -22, -18, 14, 18, "#000");
      this._pixEllipse(ctx, 22, -18, 14, 18, "#000");

      // Glowing tiny spectral dots inside darkness
      ctx.fillStyle = "#ff2b3d";
      const tw = (frame % 2) * 2;
      ctx.fillRect(-24 + tw, -20, 4, 4);
      ctx.fillRect(20 - tw, -20, 4, 4);

      // Long dripping black tears
      ctx.fillStyle = "#080408";
      ctx.fillRect(-28, -2, 10, 46);
      ctx.fillRect(-24, 44, 4, 24);
      ctx.fillRect(18, -2, 10, 48);
      ctx.fillRect(22, 46, 4, 22);

      // Stretched screaming oval mouth
      const mh = 22 + Math.min(24, t * 44);
      this._pixEllipse(ctx, 0, 34, 24, mh, "#000");
      this._pixEllipse(ctx, 0, 34, 16, mh - 6, "#3a0309");
    }

    // 2: THE SPIDER-EYE — Cluster of 9 twitching bloodshot eyes + skittering legs
    _drawSpiderEye(ctx, t, frame, strobe) {
      // Skittering jagged legs reaching inward from screen borders
      ctx.fillStyle = "#14080e";
      const legOffsets = [-76, -42, -8, 28, 64];
      legOffsets.forEach((ly, i) => {
        const wig = Math.sin(frame * 1.4 + i * 2) * 10;
        // Left legs
        ctx.fillRect(-165, ly + wig, 95, 8);
        ctx.fillRect(-85, ly + wig, 14, 22);
        // Right legs
        ctx.fillRect(70, ly - wig, 95, 8);
        ctx.fillRect(72, ly - wig, 14, 22);
      });

      // Fleshy dark central mass
      this._pixEllipse(ctx, 0, 0, 76, 72, "#19060b");
      this._pixEllipse(ctx, 0, 0, 64, 60, "#380a14");

      // 9 asymmetric twitching pixel eyes
      const eyes = [
        [0, -10, 22],
        [-36, -24, 14],
        [36, -22, 15],
        [-42, 12, 12],
        [44, 10, 12],
        [-18, -44, 11],
        [20, -42, 10],
        [-22, 32, 13],
        [24, 30, 13],
      ];

      eyes.forEach(([ex, ey, er], idx) => {
        const jitterX = (((frame * 5 + idx * 13) % 3) - 1) * 2;
        const jitterY = (((frame * 7 + idx * 17) % 3) - 1) * 2;
        this._pixEllipse(ctx, ex, ey, er + 2, er + 2, "#000");
        this._pixEllipse(ctx, ex, ey, er, er, strobe ? "#ff4048" : "#f5ece2");
        this._pixEllipse(ctx, ex + jitterX, ey + jitterY, er * 0.55, er * 0.55, "#b80d22");
        this._pixEllipse(ctx, ex + jitterX, ey + jitterY, er * 0.28, er * 0.28, "#000");
        ctx.fillStyle = "#fff";
        ctx.fillRect((ex - er * 0.35) | 0, (ey - er * 0.35) | 0, 3, 3);
      });

      // Fanged mandibles snapping at bottom
      const snap = (frame % 2) * 8;
      ctx.fillStyle = "#e6d8c5";
      ctx.fillRect(-26 + snap, 48, 12, 26);
      ctx.fillRect(14 - snap, 48, 12, 26);
    }

    // 3: STATIC PHANTOM — High-contrast CRT ghost face with stretched jaw
    _drawStaticPhantom(ctx, t, frame, strobe) {
      // Heavy VHS static blocks
      for (let y = -100; y < 100; y += 4) {
        const bw = 60 + ((Math.sin(y * 0.4 + frame) * 40 + 40) | 0);
        ctx.fillStyle = (y + frame) % 8 === 0 ? "#ffffff" : "#3a323a";
        ctx.fillRect(-bw, y, bw * 2, 2);
      }

      // Stark high-contrast spectral visage
      const faceCol = strobe ? "#ff1f32" : "#efefef";
      this._pixEllipse(ctx, 0, -6, 54, 78, "#000");
      this._pixEllipse(ctx, 0, -8, 46, 68, faceCol);

      // Distorted long black eye smears
      ctx.fillStyle = "#000";
      ctx.fillRect(-34, -36, 22, 30);
      ctx.fillRect(12, -36, 22, 30);

      // White static pupils
      ctx.fillStyle = "#fff";
      ctx.fillRect(-26 + (frame % 3) * 2, -24, 6, 4);
      ctx.fillRect(18 - (frame % 3) * 2, -24, 6, 4);

      // Extremely stretched distorted black mouth
      const stretch = 34 + Math.min(36, t * 60);
      ctx.fillStyle = "#000";
      ctx.fillRect(-24, 6, 48, stretch);
      ctx.fillStyle = "#cc0018";
      ctx.fillRect(-16, 14, 32, stretch - 16);
    }

    // 4: THE SKINLESS SKULL — Crimson & bone anatomical pixel skull lunging
    _drawSkinlessSkull(ctx, t, frame, strobe) {
      const bone = strobe ? "#ffffff" : "#e3d6c0";
      const flesh = "#8f0e1c";

      // Exposed crimson neck & muscle cords
      ctx.fillStyle = flesh;
      ctx.fillRect(-44, 30, 88, 70);
      ctx.fillStyle = "#4d040c";
      ctx.fillRect(-30, 36, 14, 64);
      ctx.fillRect(16, 36, 14, 64);

      // Cranium
      this._pixEllipse(ctx, 0, -24, 62, 56, "#000");
      this._pixEllipse(ctx, 0, -24, 56, 50, bone);
      // Cheekbones
      this._pixEllipse(ctx, -40, 8, 22, 18, bone);
      this._pixEllipse(ctx, 40, 8, 22, 18, bone);

      // Blood smears on forehead
      ctx.fillStyle = flesh;
      ctx.fillRect(-32, -62, 18, 24);
      ctx.fillRect(14, -56, 12, 30);

      // Deep hollow skull eye sockets with burning embers
      this._pixEllipse(ctx, -24, -14, 17, 15, "#000");
      this._pixEllipse(ctx, 24, -14, 17, 15, "#000");
      ctx.fillStyle = frame % 2 === 0 ? "#ff2a2a" : "#ffaa22";
      ctx.fillRect(-26, -16, 6, 6);
      ctx.fillRect(20, -16, 6, 6);

      // Nasal cavity
      ctx.fillStyle = "#000";
      ctx.fillRect(-8, 2, 6, 16);
      ctx.fillRect(2, 2, 6, 16);

      // Snapping lower jaw
      const drop = 10 + (frame % 2) * 14 + Math.min(18, t * 28);
      ctx.fillStyle = "#000";
      ctx.fillRect(-36, 22, 72, 22 + drop);
      ctx.fillStyle = bone;
      ctx.fillRect(-34, 42 + drop, 68, 18);

      // Grinning skull teeth
      for (let x = -30; x <= 24; x += 9) {
        ctx.fillRect(x, 22, 7, 12);
        ctx.fillRect(x, 32 + drop, 7, 12);
      }
    }

    // 5: THE SHADOW HAND — Pale skeletal fingers slamming onto the glass + glowing eyes
    _drawShadowHand(ctx, t, frame, strobe) {
      // Looming shadow silhouette behind
      this._pixEllipse(ctx, 0, -22, 68, 76, "#070408");
      // Piercing white glowing eyes staring from behind the hand
      ctx.fillStyle = strobe ? "#ff2030" : "#ffffff";
      ctx.fillRect(-34, -46, 14, 6);
      ctx.fillRect(20, -46, 14, 6);
      ctx.fillStyle = "#000";
      ctx.fillRect(-28, -45, 4, 4);
      ctx.fillRect(24, -45, 4, 4);

      // Giant pale gnarled hand slamming right onto the camera lens
      const palm = strobe ? "#f7e6e6" : "#bdb2ab";
      const dark = "#382c32";
      const slamY = Math.max(0, (1 - t * 5) * 70);

      ctx.save();
      ctx.translate(0, slamY);

      // Palm
      this._pixEllipse(ctx, 0, 38, 46, 40, "#000");
      this._pixEllipse(ctx, 0, 38, 40, 34, palm);
      // Wrinkles / blood on palm
      ctx.fillStyle = "#8a0c1c";
      ctx.fillRect(-20, 26, 40, 12);
      ctx.fillStyle = dark;
      ctx.fillRect(-24, 38, 48, 4);

      // 5 elongated splayed claw fingers
      const fingers = [
        [-58, 12, -18, -50, 14],
        [-30, 8, -32, -84, 15],
        [-4, 4, 0, -92, 16],
        [22, 8, 30, -82, 15],
        [44, 18, 62, -52, 14],
      ];

      fingers.forEach(([x0, y0, x1, y1, w]) => {
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
          const f = i / steps;
          const fx = x0 + (x1 - x0) * f;
          const fy = y0 + (y1 - y0) * f;
          const fw = w * (1 - f * 0.32);
          ctx.fillStyle = "#000";
          ctx.fillRect((fx - fw / 2 - 2) | 0, (fy - fw / 2 - 2) | 0, (fw + 4) | 0, (fw + 4) | 0);
          ctx.fillStyle = i === steps ? "#6e0814" : palm;
          ctx.fillRect((fx - fw / 2) | 0, (fy - fw / 2) | 0, fw | 0, fw | 0);
        }
      });

      ctx.restore();
    }
  }

  global.JumpscareEngine = JumpscareEngine;
})(window);
