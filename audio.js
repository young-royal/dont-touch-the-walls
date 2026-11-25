/* ============================================================
   audio.js — Procedural Web Audio API Horror Sound Engine
   ============================================================ */
(function (global) {
  "use strict";

  class HorrorAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.compressor = null;
      this.noiseBuffer = null;

      this.muted = false;
      this.volume = 0.8;
      this.initialized = false;

      // Ambient nodes
      this.ambientRunning = false;
      this.droneGain = null;
      this.tensionGain = null;
      this.tensionOsc = null;

      // Heartbeat scheduling
      this.heartbeatTimer = 0;
      this.proximityLevel = 0; // 0 (calm) .. 1 (touching wall)
    }

    init() {
      if (this.initialized) {
        if (this.ctx && this.ctx.state === "suspended") {
          this.ctx.resume().catch(() => {});
        }
        return;
      }

      const AudioCtx = global.AudioContext || global.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();

      // Compressor so loud jumpscares hit hard without harsh clipping
      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(16, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(10, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.002, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);

      this.compressor.connect(this.master);
      this.master.connect(this.ctx.destination);

      this._createNoiseBuffer();
      this._startAmbient();

      this.initialized = true;
    }

    _createNoiseBuffer() {
      const sampleRate = this.ctx.sampleRate;
      const length = sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }

    _makeDistortionCurve(amount) {
      const n = 256;
      const curve = new Float32Array(n);
      const deg = Math.PI / 180;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }

    setVolume(v) {
      this.volume = Math.max(0, Math.min(1, v));
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.muted ? 0 : this.volume,
          this.ctx.currentTime,
          0.03
        );
      }
    }

    setMuted(m) {
      this.muted = !!m;
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(
          this.muted ? 0 : this.volume,
          this.ctx.currentTime,
          0.02
        );
      }
    }

    _startAmbient() {
      if (!this.ctx || this.ambientRunning) return;
      this.ambientRunning = true;

      const now = this.ctx.currentTime;

      // Deep dark sub-drone (binaural beating at 41Hz & 42.3Hz)
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = "sawtooth";
      osc2.type = "triangle";
      osc1.frequency.setValueAtTime(41, now);
      osc2.frequency.setValueAtTime(42.4, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(140, now);
      filter.Q.setValueAtTime(4.5, now);

      // Slow creepy filter LFO
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.11, now);
      lfoGain.gain.setValueAtTime(55, now);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);

      this.droneGain = this.ctx.createGain();
      this.droneGain.gain.setValueAtTime(0.14, now);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(this.droneGain);
      this.droneGain.connect(this.compressor);

      osc1.start(now);
      osc2.start(now);
      lfo.start(now);

      // Eerie high tension violin/tinnitus whine driven by wall proximity
      this.tensionOsc = this.ctx.createOscillator();
      this.tensionOsc.type = "sawtooth";
      this.tensionOsc.frequency.setValueAtTime(540, now);

      const tFilter = this.ctx.createBiquadFilter();
      tFilter.type = "bandpass";
      tFilter.frequency.setValueAtTime(1100, now);
      tFilter.Q.setValueAtTime(8, now);

      this.tensionGain = this.ctx.createGain();
      this.tensionGain.gain.setValueAtTime(0.0001, now);

      this.tensionOsc.connect(tFilter);
      tFilter.connect(this.tensionGain);
      this.tensionGain.connect(this.compressor);
      this.tensionOsc.start(now);
    }

    // Called every frame while playing with proximity 0..1
    updateTension(dt, proximity, active) {
      if (!this.initialized || !this.ctx) return;

      const targetProx = active ? Math.max(0, Math.min(1, proximity)) : 0;
      this.proximityLevel += (targetProx - this.proximityLevel) * Math.min(1, dt * 8);

      const now = this.ctx.currentTime;
      if (this.tensionGain && this.tensionOsc) {
        const gain = active ? Math.pow(this.proximityLevel, 2) * 0.14 : 0.0001;
        this.tensionGain.gain.setTargetAtTime(gain, now, 0.06);
        this.tensionOsc.frequency.setTargetAtTime(
          460 + this.proximityLevel * 620 + Math.sin(now * 19) * 14 * this.proximityLevel,
          now,
          0.06
        );
      }

      if (active) {
        const interval = 1.05 - this.proximityLevel * 0.68; // 1.05s calm -> 0.37s panic
        this.heartbeatTimer -= dt;
        if (this.heartbeatTimer <= 0) {
          this.heartbeatTimer = Math.max(0.32, interval);
          this.playHeartbeat(0.14 + this.proximityLevel * 0.32);
        }
      } else {
        this.heartbeatTimer = 0.2;
      }
    }

    playHeartbeat(strength = 0.25) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      const thump = (offset, freq, vol) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + offset);
        osc.frequency.exponentialRampToValueAtTime(28, now + offset + 0.14);

        g.gain.setValueAtTime(0.0001, now + offset);
        g.gain.linearRampToValueAtTime(vol, now + offset + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);

        osc.connect(g);
        g.connect(this.compressor);
        osc.start(now + offset);
        osc.stop(now + offset + 0.18);
      };

      thump(0, 74, strength);
      thump(0.14, 58, strength * 0.72);
    }

    playClick() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(90, now + 0.06);
      g.gain.setValueAtTime(0.16, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(g);
      g.connect(this.compressor);
      osc.start(now);
      osc.stop(now + 0.08);
    }

    // Countdown tick: step = 3, 2, 1, or 0 (GO!)
    playCountdown(step) {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      if (step > 0) {
        // Deep ominous strike + metallic clock tick
        const baseFreq = step === 3 ? 110 : step === 2 ? 138.6 : 164.8;
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const g = this.ctx.createGain();

        osc.type = "triangle";
        osc2.type = "sawtooth";
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, now + 0.42);
        osc2.frequency.setValueAtTime(baseFreq * 2.02, now);

        const filt = this.ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.setValueAtTime(900, now);
        filt.frequency.exponentialRampToValueAtTime(160, now + 0.42);

        g.gain.setValueAtTime(0.32, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(filt);
        osc2.connect(filt);
        filt.connect(g);
        g.connect(this.compressor);

        osc.start(now);
        osc2.start(now);
        osc.stop(now + 0.48);
        osc2.stop(now + 0.48);

        this.playHeartbeat(0.3);
      } else {
        // Seal shatter + RUN cue
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.35);

        g.gain.setValueAtTime(0.28, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

        osc.connect(g);
        g.connect(this.compressor);
        osc.start(now);
        osc.stop(now + 0.4);

        // Air whoosh
        if (this.noiseBuffer) {
          const src = this.ctx.createBufferSource();
          src.buffer = this.noiseBuffer;
          const bf = this.ctx.createBiquadFilter();
          bf.type = "bandpass";
          bf.frequency.setValueAtTime(1400, now);
          bf.frequency.exponentialRampToValueAtTime(260, now + 0.32);
          const ng = this.ctx.createGain();
          ng.gain.setValueAtTime(0.22, now);
          ng.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
          src.connect(bf);
          bf.connect(ng);
          ng.connect(this.compressor);
          src.start(now);
          src.stop(now + 0.35);
        }
      }
    }

    playWarn() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.setValueAtTime(115, now + 0.08);
      g.gain.setValueAtTime(0.18, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.connect(g);
      g.connect(this.compressor);
      osc.start(now);
      osc.stop(now + 0.24);
    }

    playDashCue() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.16);
      osc.frequency.exponentialRampToValueAtTime(190, now + 0.34);

      const filt = this.ctx.createBiquadFilter();
      filt.type = "bandpass";
      filt.frequency.setValueAtTime(1200, now);
      filt.Q.setValueAtTime(3, now);

      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.22, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

      osc.connect(filt);
      filt.connect(g);
      g.connect(this.compressor);
      osc.start(now);
      osc.stop(now + 0.38);
    }

    // Eerie Spirit-like spectral phase whoosh (DbD Spirit phasing cue)
    playPhaseCue(manifesting) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const dur = 0.55;

      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      if (manifesting) {
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(760, now + 0.14);
        osc.frequency.exponentialRampToValueAtTime(210, now + dur);
      } else {
        osc.frequency.setValueAtTime(620, now);
        osc.frequency.exponentialRampToValueAtTime(175, now + dur);
      }

      g.gain.setValueAtTime(0.001, now);
      g.gain.linearRampToValueAtTime(0.16, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, now + dur);

      osc.connect(g);
      g.connect(this.compressor);
      osc.start(now);
      osc.stop(now + dur + 0.02);

      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(manifesting ? 1800 : 900, now);
        bp.frequency.exponentialRampToValueAtTime(manifesting ? 550 : 2100, now + dur);
        bp.Q.setValueAtTime(5.5, now);

        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.001, now);
        ng.gain.linearRampToValueAtTime(0.24, now + 0.08);
        ng.gain.exponentialRampToValueAtTime(0.001, now + dur);

        src.connect(bp);
        bp.connect(ng);
        ng.connect(this.compressor);
        src.start(now);
        src.stop(now + dur + 0.02);
      }
    }

    // Deep ominous whisper & phantom bell swell for Act finale opening announcements
    playAnnouncement() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const dur = 2.6;

      // Deep sub-bass drop
      const sub = this.ctx.createOscillator();
      const subG = this.ctx.createGain();
      sub.type = "sine";
      sub.frequency.setValueAtTime(64, now);
      sub.frequency.exponentialRampToValueAtTime(30, now + dur);
      subG.gain.setValueAtTime(0.001, now);
      subG.gain.linearRampToValueAtTime(0.45, now + 0.2);
      subG.gain.exponentialRampToValueAtTime(0.001, now + dur);
      sub.connect(subG);
      subG.connect(this.compressor);
      sub.start(now);
      sub.stop(now + dur + 0.05);

      // Eerie dissonant phantom chord (minor second)
      [220, 233.08].forEach((freq) => {
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.linearRampToValueAtTime(freq * 0.96, now + dur);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.11, now + 0.35);
        g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
        osc.connect(g);
        g.connect(this.compressor);
        osc.start(now);
        osc.stop(now + dur + 0.05);
      });

      // Breathy dark whisper noise sweep
      if (this.noiseBuffer) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const bp = this.ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.setValueAtTime(600, now);
        bp.frequency.exponentialRampToValueAtTime(1600, now + 1.0);
        bp.frequency.exponentialRampToValueAtTime(420, now + dur);
        bp.Q.setValueAtTime(4.5, now);

        const ng = this.ctx.createGain();
        ng.gain.setValueAtTime(0.001, now);
        ng.gain.linearRampToValueAtTime(0.16, now + 0.4);
        ng.gain.exponentialRampToValueAtTime(0.001, now + dur);

        src.connect(bp);
        bp.connect(ng);
        ng.connect(this.compressor);
        src.start(now);
        src.stop(now + dur);
      }
    }

    // Haunting, cathartic ethereal chord fanfare for completing all 9 chapters
    playVictory() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;

      // Ethereal rising bell arpeggio resolving from D minor into bright D major9
      const notes = [293.66, 349.23, 440.0, 554.37, 587.33, 739.99, 880.0];
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.16;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.22, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0006, t + 2.4);
        osc.connect(g);
        g.connect(this.compressor);
        osc.start(t);
        osc.stop(t + 2.5);
      });

      // Warm dark-to-dawn pad swell
      [146.83, 220.0, 369.99].forEach((freq) => {
        const osc = this.ctx.createOscillator();
        const filt = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, now);
        filt.type = "lowpass";
        filt.frequency.setValueAtTime(220, now);
        filt.frequency.exponentialRampToValueAtTime(980, now + 1.4);
        filt.frequency.exponentialRampToValueAtTime(320, now + 3.6);
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.09, now + 0.7);
        g.gain.exponentialRampToValueAtTime(0.0008, now + 3.7);
        osc.connect(filt);
        filt.connect(g);
        g.connect(this.compressor);
        osc.start(now);
        osc.stop(now + 3.8);
      });
    }

    playLevelClear() {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [293.66, 349.23, 440.0, 587.33]; // D minor eerie ascent
      notes.forEach((freq, idx) => {
        const t = now + idx * 0.11;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(0.24, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.9);
        osc.connect(g);
        g.connect(this.compressor);
        osc.start(t);
        osc.stop(t + 0.95);
      });
    }

    // 6 distinct terrifying synthesized jumpscare sounds
    playJumpscare(variantIndex) {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const dur = 1.25;

      // Always add a massive sub-bass slam at t=0
      const slam = this.ctx.createOscillator();
      const slamG = this.ctx.createGain();
      slam.type = "sine";
      slam.frequency.setValueAtTime(135, now);
      slam.frequency.exponentialRampToValueAtTime(24, now + 0.45);
      slamG.gain.setValueAtTime(0.95, now);
      slamG.gain.exponentialRampToValueAtTime(0.001, now + 0.52);
      slam.connect(slamG);
      slamG.connect(this.compressor);
      slam.start(now);
      slam.stop(now + 0.55);

      const dist = this.ctx.createWaveShaper();
      dist.curve = this._makeDistortionCurve(80);
      dist.oversample = "2x";

      const outGain = this.ctx.createGain();
      outGain.gain.setValueAtTime(0.92, now);
      outGain.gain.setValueAtTime(0.88, now + 0.65);
      outGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

      dist.connect(outGain);
      outGain.connect(this.compressor);

      const v = Math.abs(variantIndex) % 6;

      if (v === 0) {
        // 0: HOLLOW SMILE — Piercing FM shriek + dissonant tritone cluster
        const freqs = [780, 1103, 1480, 2110];
        freqs.forEach((f, i) => {
          const osc = this.ctx.createOscillator();
          osc.type = i % 2 === 0 ? "sawtooth" : "square";
          osc.frequency.setValueAtTime(f * 0.7, now);
          osc.frequency.exponentialRampToValueAtTime(f * 1.35, now + 0.14);
          osc.frequency.linearRampToValueAtTime(f * 0.85, now + dur);

          // Fast scream vibrato
          const vib = this.ctx.createOscillator();
          const vibG = this.ctx.createGain();
          vib.frequency.setValueAtTime(28 + i * 7, now);
          vibG.gain.setValueAtTime(95, now);
          vib.connect(vibG);
          vibG.connect(osc.frequency);

          osc.connect(dist);
          osc.start(now);
          vib.start(now);
          osc.stop(now + dur);
          vib.stop(now + dur);
        });
      } else if (v === 1) {
        // 1: PALE MASK — Banshee wail with formant sweep
        [520, 543, 1085].forEach((f) => {
          const osc = this.ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(f, now);
          osc.frequency.exponentialRampToValueAtTime(f * 1.9, now + 0.25);
          osc.frequency.exponentialRampToValueAtTime(f * 0.65, now + dur);

          const bp = this.ctx.createBiquadFilter();
          bp.type = "bandpass";
          bp.frequency.setValueAtTime(1600, now);
          bp.frequency.exponentialRampToValueAtTime(2900, now + 0.3);
          bp.frequency.exponentialRampToValueAtTime(900, now + dur);
          bp.Q.setValueAtTime(3.2, now);

          osc.connect(bp);
          bp.connect(dist);
          osc.start(now);
          osc.stop(now + dur);
        });
      } else if (v === 2) {
        // 2: SPIDER-EYE — Rapid metallic chittering + shrieking swarm
        const carrier = this.ctx.createOscillator();
        carrier.type = "sawtooth";
        carrier.frequency.setValueAtTime(1350, now);
        carrier.frequency.exponentialRampToValueAtTime(2600, now + 0.2);
        carrier.frequency.linearRampToValueAtTime(880, now + dur);

        const amOsc = this.ctx.createOscillator();
        const amGain = this.ctx.createGain();
        amOsc.type = "square";
        amOsc.frequency.setValueAtTime(42, now);
        amGain.gain.setValueAtTime(0.5, now);

        const modNode = this.ctx.createGain();
        modNode.gain.setValueAtTime(0.5, now);
        amOsc.connect(amGain);
        amGain.connect(modNode.gain);

        carrier.connect(modNode);
        modNode.connect(dist);
        carrier.start(now);
        amOsc.start(now);
        carrier.stop(now + dur);
        amOsc.stop(now + dur);
      } else if (v === 3) {
        // 3: STATIC PHANTOM — Violent VHS static + glitch frequency jumps
        const glitch = this.ctx.createOscillator();
        glitch.type = "square";
        for (let step = 0; step < 20; step++) {
          glitch.frequency.setValueAtTime(
            240 + Math.random() * 2200,
            now + step * 0.055
          );
        }
        glitch.connect(dist);
        glitch.start(now);
        glitch.stop(now + dur);
      } else if (v === 4) {
        // 4: SKINLESS SKULL — Brutal demonic roar + metallic horn blast
        [110, 116.5, 233, 666].forEach((f) => {
          const osc = this.ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(f * 1.4, now);
          osc.frequency.exponentialRampToValueAtTime(f * 0.62, now + dur);
          osc.connect(dist);
          osc.start(now);
          osc.stop(now + dur);
        });
      } else {
        // 5: SHADOW HAND — Glass slam + horror chord stab
        [311.13, 329.63, 466.16, 932.33, 1396.9].forEach((f) => {
          const osc = this.ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(f, now);
          osc.frequency.linearRampToValueAtTime(f * 0.94, now + dur);
          osc.connect(dist);
          osc.start(now);
          osc.stop(now + dur);
        });
      }

      // Add harsh bandpassed noise burst for raw scream texture on ALL variants
      if (this.noiseBuffer) {
        const nSrc = this.ctx.createBufferSource();
        nSrc.buffer = this.noiseBuffer;
        const nFilt = this.ctx.createBiquadFilter();
        nFilt.type = "bandpass";
        nFilt.frequency.setValueAtTime(v === 3 ? 2600 : 1950, now);
        nFilt.Q.setValueAtTime(v === 3 ? 0.8 : 1.8, now);

        const nGain = this.ctx.createGain();
        nGain.gain.setValueAtTime(v === 3 ? 0.95 : 0.62, now);
        nGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

        nSrc.connect(nFilt);
        nFilt.connect(nGain);
        nGain.connect(this.compressor);
        nSrc.start(now);
        nSrc.stop(now + dur);
      }
    }
  }

  global.HorrorAudio = HorrorAudio;
})(window);
