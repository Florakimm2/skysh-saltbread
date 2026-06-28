/**
 * Cute Idle Flame
 *
 * 사용법:
 *   <div id="my-flame"></div>
 *   <script src="./cute-idle-flame.js"></script>
 *   <script>
 *     const flame = new CuteIdleFlame("#my-flame", { mode: "default" });
 *     flame.setMode("blue"); // "default" | "blue" | "pink"
 *   </script>
 *
 * 또는 data 속성으로 자동 실행:
 *   <div data-cute-idle-flame data-flame-mode="blue"></div>
 */
(() => {
  "use strict";

  const STYLE_ID = "cute-idle-flame-style";
  const MODE_STYLES = {
    default: {
      outer: [255, 82, 73],
      inner: [255, 184, 38],
      face: [84, 47, 55],
      cheek: [255, 121, 92],
      sad: 0,
      fierce: 0,
      energy: 1,
    },
    blue: {
      outer: [48, 117, 255],
      inner: [44, 195, 255],
      face: [23, 59, 105],
      cheek: [30, 157, 232],
      sad: 1,
      fierce: 0,
      energy: 0.88,
    },
    pink: {
      outer: [255, 55, 143],
      inner: [255, 105, 184],
      face: [101, 20, 64],
      cheek: [225, 45, 128],
      sad: 0,
      fierce: 1,
      energy: 1.5,
    },
  };
  const OUTER_BARS = [
    { x: -84, height: 105, width: 48, phase: 0.2, amount: 17 },
    { x: -56, height: 150, width: 50, phase: 1.5, amount: 23 },
    { x: -28, height: 204, width: 52, phase: 2.8, amount: 29 },
    { x: 0, height: 245, width: 54, phase: 4.2, amount: 34 },
    { x: 28, height: 213, width: 52, phase: 0.9, amount: 30 },
    { x: 56, height: 161, width: 50, phase: 3.4, amount: 24 },
    { x: 84, height: 115, width: 48, phase: 5.1, amount: 18 },
  ];

  const INNER_BARS = [
    { x: -52, height: 100, width: 46, phase: 1.1, amount: 12 },
    { x: -26, height: 142, width: 48, phase: 2.0, amount: 17 },
    { x: 0, height: 178, width: 50, phase: 3.8, amount: 22 },
    { x: 26, height: 151, width: 48, phase: 0.4, amount: 18 },
    { x: 52, height: 110, width: 46, phase: 4.7, amount: 13 },
  ];

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [data-cute-idle-flame],
      .cute-idle-flame-host {
        position: relative;
        overflow: hidden;
      }

      .cute-idle-flame-canvas {
        position: absolute;
        inset: 0;
        display: block;
        width: 100%;
        height: 100%;
        user-select: none;
        pointer-events: none;
        -webkit-user-select: none;
      }
    `;
    document.head.appendChild(style);
  }

  function resolveTarget(target) {
    if (target instanceof HTMLElement) return target;
    if (typeof target === "string") return document.querySelector(target);
    return null;
  }

  function copyMode(mode) {
    const source = MODE_STYLES[mode];
    return {
      outer: [...source.outer],
      inner: [...source.inner],
      face: [...source.face],
      cheek: [...source.cheek],
      sad: source.sad,
      fierce: source.fierce,
      energy: source.energy,
    };
  }

  function colorString(color, alpha = 1) {
    const [red, green, blue] = color.map(Math.round);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  class CuteIdleFlame {
    constructor(target, options = {}) {
      const host = resolveTarget(target);
      if (!host) {
        throw new Error("CuteIdleFlame을 표시할 div를 찾을 수 없습니다.");
      }

      installStyle();

      this.host = host;
      this.mode = MODE_STYLES[options.mode] ? options.mode : "default";
      this.visual = copyMode(this.mode);
      this.targetVisual = copyMode(this.mode);
      this.canvas = document.createElement("canvas");
      this.canvas.className = "cute-idle-flame-canvas";
      this.canvas.setAttribute("role", "img");
      this.canvas.setAttribute(
        "aria-label",
        options.label || "귀엽고 둥근 불꽃 idle 애니메이션",
      );
      this.ctx = this.canvas.getContext("2d");
      this.running = true;
      this.frameId = 0;
      this.elapsed = 0;
      this.flameTime = 0;
      this.transition = null;
      this.surprise = 0;
      this.strain = 0;
      this.transitionPulse = 0;
      this.transitionStretch = 0;
      this.lastTime = performance.now();
      this.reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      );

      host.classList.add("cute-idle-flame-host");
      host.appendChild(this.canvas);

      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
      this.resize();
      this.draw(this.flameTime);
      this.tick = this.tick.bind(this);
      this.frameId = requestAnimationFrame(this.tick);
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = Math.max(rect.width, 1);
      this.height = Math.max(rect.height, 1);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw(this.flameTime);
    }

    roundedRect(x, y, width, height, radius) {
      const r = Math.min(radius, width / 2, height / 2);
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, width, height, r);
    }

    randomAt(point, seed) {
      const value = Math.sin(point * 127.1 + seed * 311.7) * 43758.5453;
      return value - Math.floor(value);
    }

    smoothNoise(value, seed) {
      const start = Math.floor(value);
      const progress = value - start;
      const eased = progress * progress * (3 - 2 * progress);
      const from = this.randomAt(start, seed);
      const to = this.randomAt(start + 1, seed);
      return from + (to - from) * eased;
    }

    keyframePulse(progress, peakAt, endAt) {
      if (progress <= 0 || progress >= endAt) return 0;
      const section =
        progress < peakAt
          ? progress / peakAt
          : 1 - (progress - peakAt) / (endAt - peakAt);
      const clamped = Math.max(0, Math.min(1, section));
      return clamped * clamped * (3 - 2 * clamped);
    }

    updateVisual(delta) {
      const amount = 1 - Math.exp(-delta * 5.2);
      const colorKeys = ["outer", "inner", "face", "cheek"];
      const numberKeys = ["sad", "fierce", "energy"];
      let effectiveTarget = this.targetVisual;

      if (this.transition?.mode === "blue") {
        const progress = Math.min(
          this.transition.elapsed / this.transition.duration,
          1,
        );

        if (progress < 0.43) {
          effectiveTarget = copyMode("default");
          effectiveTarget.energy = 0.72;
        }
      }

      colorKeys.forEach((key) => {
        this.visual[key] = this.visual[key].map(
          (channel, index) =>
            channel + (effectiveTarget[key][index] - channel) * amount,
        );
      });

      numberKeys.forEach((key) => {
        this.visual[key] +=
          (effectiveTarget[key] - this.visual[key]) * amount;
      });

      if (!this.transition) {
        this.surprise += (0 - this.surprise) * amount;
        this.strain += (0 - this.strain) * amount;
        this.transitionPulse += (0 - this.transitionPulse) * amount;
        this.transitionStretch += (0 - this.transitionStretch) * amount;
        return;
      }

      this.transition.elapsed += delta;
      const progress = Math.min(
        this.transition.elapsed / this.transition.duration,
        1,
      );

      if (this.transition.mode === "blue") {
        this.surprise = this.keyframePulse(progress, 0.28, 0.66);
        this.strain = 0;
        this.transitionPulse = this.surprise * 0.72;
        this.transitionStretch = this.surprise * 0.07;
      } else if (this.transition.mode === "pink") {
        const strain = this.keyframePulse(progress, 0.3, 0.62);
        const burstProgress = Math.max(0, (progress - 0.46) / 0.54);
        const burst = this.keyframePulse(burstProgress, 0.4, 1);
        this.surprise = 0;
        this.strain = strain;
        this.transitionPulse = strain * 0.18 + burst;
        this.transitionStretch = -strain * 0.075 + burst * 0.1;
      } else {
        this.surprise = 0;
        this.strain = 0;
        this.transitionPulse =
          this.keyframePulse(progress, 0.35, 0.8) * 0.45;
        this.transitionStretch = this.transitionPulse * 0.04;
      }

      if (progress >= 1) {
        this.transition = null;
        this.surprise = 0;
        this.strain = 0;
        this.transitionPulse = 0;
        this.transitionStretch = 0;
      }
    }

    setMode(mode) {
      if (!MODE_STYLES[mode]) {
        throw new Error(
          `알 수 없는 불꽃 모드입니다: ${mode}. default, blue, pink 중 하나를 사용하세요.`,
        );
      }

      if (this.mode === mode && !this.transition) return this;

      this.mode = mode;
      this.targetVisual = copyMode(mode);
      this.transition = {
        mode,
        elapsed: 0,
        duration: mode === "pink" ? 1.25 : mode === "blue" ? 1.3 : 0.85,
      };
      this.host.dataset.flameMode = mode;
      return this;
    }

    organicHeight(bar, time, index, totalBars) {
      const seed = index * 7.31 + bar.phase * 3.17;
      const sharedSurge = this.smoothNoise(time * 1.7, 41.2) * 2 - 1;
      const localFlame = this.smoothNoise(time * 3.8, seed) * 2 - 1;
      const fastFlicker =
        this.smoothNoise(time * 7.2, seed + 19.4) * 2 - 1;
      const center = (totalBars - 1) / 2;
      const distance = Math.abs(index - center);
      const travelingWave = Math.sin(
        time * 3.15 - distance * 0.72 + bar.phase * 0.18,
      );
      const lickWave = Math.max(
        0,
        Math.sin(time * 2.45 + bar.phase * 1.13 + index * 0.21),
      );
      const flameLick = Math.pow(lickWave, 5);
      const motion =
        sharedSurge * 0.24 +
        localFlame * 0.34 +
        fastFlicker * 0.13 +
        travelingWave * 0.14 +
        flameLick * 0.58 -
        0.1;
      const intensity =
        1 + this.visual.fierce * 0.32 + this.transitionPulse * 0.48;
      return bar.height + bar.amount * motion * intensity;
    }

    drawBars(bars, time, baseY, color) {
      const { ctx } = this;
      ctx.fillStyle = color;

      bars.forEach((bar, index) => {
        const height = this.organicHeight(bar, time, index, bars.length);
        const widthPulseAmount = 1 + this.visual.fierce * 0.45;
        const widthPulse =
          1 +
          Math.sin(time * 2.05 + bar.phase) *
            0.012 *
            widthPulseAmount +
          (this.smoothNoise(time * 3.1, index + 70) - 0.5) *
            0.012 *
            widthPulseAmount;
        const width = bar.width * widthPulse;
        this.roundedRect(
          bar.x - width / 2,
          baseY - height,
          width,
          height,
          width / 2,
        );
        ctx.fill();
      });
    }

    drawFace(time, compact) {
      const { ctx } = this;
      const { sad, fierce } = this.visual;
      const faceColor = colorString(this.visual.face);
      const eyeColor = "#302b31";
      const surprise = this.surprise;
      const strain = this.strain;
      const settledSad = sad * (1 - surprise) * (1 - strain);
      const settledFierce = fierce * (1 - strain) * (1 - surprise);
      const blinkCycle = time % 4.8;
      const blinking =
        blinkCycle > 4.62 && settledFierce < 0.45 && surprise < 0.2;
      const bob =
        Math.sin(time * 1.9) * 0.8 +
        (this.smoothNoise(time * 2.4, 103) - 0.5) * 1.4;

      ctx.save();
      ctx.translate(0, bob);

      if (!compact) {
        ctx.fillStyle = colorString(this.visual.cheek, 0.72);
        this.roundedRect(-57, 68, 13, 16, 6.5);
        ctx.fill();
        this.roundedRect(44, 68, 13, 16, 6.5);
        ctx.fill();
      }

      const normalEyeAlpha = 1 - strain;
      ctx.globalAlpha = normalEyeAlpha;
      ctx.fillStyle = eyeColor;
      const eyeWidth = 15 + surprise * 2;
      const eyeHeight = blinking ? 7 : 30 + surprise * 9;
      const eyeY = blinking ? 50 : 34 - surprise * 6;
      const eyeAngle = settledFierce * 0.24;

      ctx.save();
      ctx.translate(-24, eyeY + eyeHeight / 2);
      ctx.rotate(-eyeAngle);
      this.roundedRect(
        -eyeWidth / 2,
        -eyeHeight / 2,
        eyeWidth,
        eyeHeight,
        eyeWidth / 2,
      );
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(24, eyeY + eyeHeight / 2);
      ctx.rotate(eyeAngle);
      this.roundedRect(
        -eyeWidth / 2,
        -eyeHeight / 2,
        eyeWidth,
        eyeHeight,
        eyeWidth / 2,
      );
      ctx.fill();
      ctx.restore();

      ctx.globalAlpha = strain;
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = compact ? 11 : 9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-40, 39);
      ctx.lineTo(-25, 51);
      ctx.lineTo(-10, 38);
      ctx.moveTo(10, 38);
      ctx.lineTo(25, 51);
      ctx.lineTo(40, 39);
      ctx.stroke();

      ctx.globalAlpha = settledSad;
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = compact ? 9 : 7;
      ctx.beginPath();
      ctx.moveTo(-40, 30);
      ctx.lineTo(-14, 21);
      ctx.moveTo(14, 21);
      ctx.lineTo(40, 30);
      ctx.stroke();

      ctx.strokeStyle = faceColor;
      ctx.globalAlpha =
        (1 - settledFierce) * (1 - surprise) * (1 - strain);
      ctx.lineWidth = compact ? 10 : 8;
      ctx.beginPath();
      ctx.moveTo(-18, 82);
      ctx.quadraticCurveTo(0, 99 - settledSad * 35, 18, 82);
      ctx.stroke();

      ctx.globalAlpha = surprise;
      ctx.fillStyle = faceColor;
      ctx.beginPath();
      ctx.ellipse(0, 86, 11, 15, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = strain;
      this.roundedRect(-15, 82, 30, 9, 4.5);
      ctx.fill();

      ctx.globalAlpha = settledFierce;
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = compact ? 12 : 10;
      ctx.beginPath();
      ctx.moveTo(-41, 24);
      ctx.lineTo(-10, 39);
      ctx.moveTo(10, 39);
      ctx.lineTo(41, 24);
      ctx.stroke();

      ctx.fillStyle = faceColor;
      ctx.beginPath();
      ctx.ellipse(0, 86, 12, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.restore();
    }

    draw(time) {
      if (!this.ctx || !this.width || !this.height) return;

      const { ctx, width, height } = this;
      const safeTime = this.reducedMotion.matches ? 0.8 : time;
      const shortSide = Math.min(width, height);
      const scale = shortSide / 340;
      const compact = shortSide < 96;
      const sharedPulse =
        this.smoothNoise(safeTime * 1.7, 41.2) * 2 - 1;
      const breathe = 1 + sharedPulse * 0.009;
      const outerColor = colorString(this.visual.outer);
      const innerColor = colorString(this.visual.inner);
      const stretch = this.transitionStretch;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(
        width / 2,
        height / 2 + (10 - stretch * 100) * scale,
      );
      ctx.scale(
        scale * breathe * (1 - stretch * 0.3),
        (scale / breathe) * (1 + stretch),
      );
      this.drawBars(OUTER_BARS, safeTime, 112, outerColor);

      ctx.fillStyle = outerColor;
      ctx.beginPath();
      ctx.ellipse(0, 83, 108, 72, 0, 0, Math.PI * 2);
      ctx.fill();

      this.drawBars(INNER_BARS, safeTime + 0.18, 117, innerColor);

      ctx.fillStyle = innerColor;
      ctx.beginPath();
      ctx.ellipse(0, 78, 75, 62, 0, 0, Math.PI * 2);
      ctx.fill();

      this.drawFace(safeTime, compact);
      ctx.restore();
    }

    tick(now) {
      if (!this.running) return;
      const delta = Math.min((now - this.lastTime) / 1000, 0.05);
      this.lastTime = now;
      this.elapsed += delta;
      this.updateVisual(delta);
      this.flameTime += delta * this.visual.energy;
      this.draw(this.flameTime);
      this.frameId = requestAnimationFrame(this.tick);
    }

    play() {
      if (this.running) return;
      this.running = true;
      this.lastTime = performance.now();
      this.frameId = requestAnimationFrame(this.tick);
    }

    pause() {
      this.running = false;
      cancelAnimationFrame(this.frameId);
    }

    destroy() {
      this.pause();
      this.resizeObserver.disconnect();
      this.canvas.remove();
      this.host.classList.remove("cute-idle-flame-host");
      delete this.host.dataset.flameMounted;
    }
  }

  function autoMount() {
    const flames = [];
    document.querySelectorAll("[data-cute-idle-flame]").forEach((element) => {
      if (!element.dataset.flameMounted) {
        element.dataset.flameMounted = "true";
        flames.push(
          new CuteIdleFlame(element, {
            mode: element.dataset.flameMode || "default",
          }),
        );
      }
    });
    window.cuteIdleFlames = flames;
  }

  window.CuteIdleFlame = CuteIdleFlame;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  } else {
    autoMount();
  }
})();
