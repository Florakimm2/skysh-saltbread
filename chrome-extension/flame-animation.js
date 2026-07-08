/**
 * FireMascot / FlameAnimation
 *
 * 하나의 공용 SVG rig로 6개 감정 모드를 표현한다.
 *
 * const mascot = createFlameAnimation("#mascot", {
 *   size: 240,
 *   mode: "sad",
 *   speed: "normal",
 *   paused: false,
 * });
 *
 * @typedef {"default"|"sad"|"fastBurn"|"surprised"|"scared"|"curious"} MascotMode
 * @typedef {"slow"|"normal"|"fast"} MascotSpeed
 * @typedef {Object} FireMascotProps
 * @property {number} [size]
 * @property {MascotMode} [mode="default"]
 * @property {MascotSpeed} [speed="normal"]
 * @property {boolean} [paused=false]
 * @property {boolean} [reducedMotion=false]
 * @property {string} [className]
 * @property {string} [aria-label]
 */
(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const STYLE_ID = "fire-mascot-style";
  const VIEWBOX = "-10 -87 585 825";
  const MODES = [
    "default",
    "sad",
    "fastBurn",
    "surprised",
    "scared",
    "curious",
  ];

  const PALETTES = {
    default: {
      outer: "#FF503C",
      middle: "#FFA61A",
      inner: "#FFC93E",
      ink: "#24333B",
    },
    sad: {
      outer: "#236BCA",
      middle: "#48A8F4",
      inner: "#C7F2FF",
      ink: "#16355A",
    },
    fastBurn: {
      outer: "#F0448E",
      middle: "#FF78B4",
      inner: "#FFD0E3",
      ink: "#46213A",
    },
    surprised: {
      outer: "#F4B000",
      middle: "#FFD84A",
      inner: "#FFF0A5",
      ink: "#3B3108",
    },
    scared: {
      outer: "#623B9B",
      middle: "#9B66D9",
      inner: "#DFC6FF",
      ink: "#2A1743",
    },
    curious: {
      outer: "#4D9E48",
      middle: "#9BD45E",
      inner: "#E8FFB0",
      ink: "#1F4424",
    },
  };

  const SPEEDS = {
    slow: 0.75,
    normal: 1,
    fast: 1.35,
  };

  const PILLAR_PATH =
    "M0.0028 86.6233V258.623H149.037L147.003 86.6233C147.003 -28.8744 -0.7462 -28.8744 0.0028 86.6233Z";
  const SLANTED_PILLAR_PATH =
    "M0.0175 87.4288L1.6174 259.672L150.608 258.288L146.975 86.0638C145.9 -29.5971 -1.8056 -28.2252 0.0175 87.4288Z";
  const RED_BASE_PATH =
    "M0 332.375C49.0867 589.708 516.913 589.708 566 332.375H0Z";
  const MIDDLE_BASE_PATH =
    "M0 218C34.6035 372.667 364.396 372.667 399 218H0Z";
  const CORE_LEFT_PATH =
    "M161.541 2.60465C-11.4592 -32.8594 -92.4597 305.643 161.541 300.105V2.60465Z";
  const CORE_RIGHT_PATH =
    "M161.541 2.74527C334.541 -32.7187 415.542 305.784 161.541 300.245V2.74527Z";
  const CORE_SPIKE_PATH =
    "M0.0039 76.3663V223.866H82.5039V76.3663C82.5039 -25.4554 -0.6545 -25.4554 0.0039 76.3663Z";
  const DEFAULT_EYE_PATH =
    "M37 16.7533C37 -5.85294 0 -5.3143 0 16.7533V59.2747C0 77.5751 37 77.5751 37 59.2747V16.7533Z";
  const DEFAULT_MOUTH_PATH =
    "M9 9.5C42.5978 34.9853 61.2416 34.3551 94.5 9.5";

  const OUTER_PILLARS = [
    { x: 0, y: 260, amplitude: 5.5, group: "lower", side: -1 },
    { x: 69, y: 150, amplitude: 7, group: "middle", side: -1 },
    { x: 138, y: 25, amplitude: 8.5, group: "upper", side: -1 },
    { x: 207, y: -73, amplitude: 10, group: "top", side: 0 },
    { x: 276, y: 25, amplitude: 8.5, group: "upper", side: 1 },
    { x: 345, y: 150, amplitude: 7, group: "middle", side: 1 },
    {
      x: 415.646,
      y: 260,
      width: 151,
      height: 260,
      path: SLANTED_PILLAR_PATH,
      amplitude: 5.5,
      group: "lower",
      side: 1,
    },
  ];

  const MIDDLE_PILLARS = [
    { x: 83, y: 287, amplitude: 5, group: "lower", side: -1 },
    { x: 145, y: 185, amplitude: 7, group: "upper", side: -1 },
    { x: 207, y: 97, amplitude: 9, group: "top", side: 0 },
    { x: 270, y: 185, amplitude: 7, group: "upper", side: 1 },
    { x: 333, y: 287, amplitude: 5, group: "lower", side: 1 },
  ];

  const GROUP_PHASE = {
    top: 0,
    upper: 0.24,
    middle: 0.48,
    lower: 0.7,
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => 0.5 - Math.cos(clamp(t, 0, 1) * Math.PI) / 2;
  const cycle = (time, duration) => ((time % duration) + duration) % duration / duration;

  function frame(progress, values, times) {
    const p = clamp(progress, 0, 1);
    for (let index = 0; index < times.length - 1; index += 1) {
      if (p <= times[index + 1]) {
        const local =
          (p - times[index]) / Math.max(0.0001, times[index + 1] - times[index]);
        return mix(values[index], values[index + 1], easeInOut(local));
      }
    }
    return values[values.length - 1];
  }

  function normalizeMode(mode) {
    return MODES.includes(mode) ? mode : "default";
  }

  function normalizeSpeed(speed) {
    if (typeof speed === "string" && SPEEDS[speed]) return speed;
    const numeric = Number(speed);
    if (!Number.isFinite(numeric)) return "normal";
    if (numeric < 0.9) return "slow";
    if (numeric > 1.15) return "fast";
    return "normal";
  }

  function pillarMarkup(pillar, layer, index) {
    const color = layer === "outer" ? "outer" : "middle";
    const width = pillar.width || 150;
    const height = pillar.height || 259;
    return `
      <g
        class="flame-part flame-pillar flame-pillar--${layer}"
        data-flame-pillar
        data-x="${pillar.x}"
        data-y="${pillar.y}"
        data-width="${width}"
        data-height="${height}"
        data-amplitude="${pillar.amplitude}"
        data-group="${pillar.group}"
        data-side="${pillar.side}"
        data-layer="${layer}"
        data-index="${index}"
      >
        <path class="flame-paint" d="${pillar.path || PILLAR_PATH}" fill="var(--flame-${color})" />
      </g>
    `;
  }

  function eye(x, y, width, height) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    return `
      <g data-flame-eye data-cx="${cx}" data-cy="${cy}">
        <rect
          class="flame-paint flame-ink-fill"
          x="${x}" y="${y}" width="${width}" height="${height}"
          rx="${width / 2}"
        />
      </g>
    `;
  }

  function defaultEye(x, y) {
    const cx = x + 18.5;
    const cy = y + 36.5;
    return `
      <g data-flame-eye data-cx="${cx}" data-cy="${cy}">
        <path class="flame-paint flame-ink-fill"
          transform="translate(${x} ${y})" d="${DEFAULT_EYE_PATH}" />
      </g>
    `;
  }

  function expressionMarkup() {
    return `
      <g class="flame-expression" data-expression="default">
        ${defaultEye(205, 410)}
        ${defaultEye(323, 410)}
        <g transform="translate(229 516.5)">
          <circle class="flame-paint flame-ink-fill" cx="10.5" cy="10.5" r="10.5" />
          <circle class="flame-paint flame-ink-fill" cx="93.5" cy="10.5" r="10.5" />
          <path class="flame-paint" d="${DEFAULT_MOUTH_PATH}"
            fill="none" stroke="var(--flame-ink)" stroke-width="21" />
        </g>
      </g>

      <g class="flame-expression" data-expression="sad">
        ${eye(205, 420, 37, 70)}
        ${eye(323, 420, 37, 70)}
        <path class="flame-paint flame-ink-stroke" d="M248 555 Q282.5 529 317 555" />
      </g>

      <g class="flame-expression" data-expression="fastBurn">
        ${eye(209, 415, 32, 67)}
        ${eye(324, 415, 32, 67)}
        <circle class="flame-paint flame-ink-fill" cx="282.5" cy="548" r="16" />
      </g>

      <g class="flame-expression" data-expression="surprised">
        ${eye(205, 393, 37, 92)}
        ${eye(323, 393, 37, 92)}
        <ellipse class="flame-paint flame-ink-fill" cx="282.5" cy="548" rx="15" ry="20" />
      </g>

      <g class="flame-expression" data-expression="scared">
        ${eye(214, 408, 36, 76)}
        ${eye(315, 408, 36, 76)}
        <path class="flame-paint flame-ink-stroke flame-mouth--thin"
          d="M255 550 Q267 538 279 550 Q291 562 310 548" />
      </g>

      <g class="flame-expression" data-expression="curious">
        ${eye(202, 399, 40, 77)}
        ${eye(324, 414, 35, 68)}
        <path class="flame-paint flame-ink-stroke flame-mouth--thin"
          d="M246 532 Q276 559 316 529" />
      </g>
    `;
  }

  function fxMarkup() {
    return `
      <g class="flame-fx" data-fx="sad">
        <path class="flame-paint" data-fx-part data-fx-index="0"
          d="M479 420 C461 446 462 463 479 466 C496 463 497 446 479 420Z"
          fill="var(--flame-middle)" opacity=".42" />
      </g>

      <g class="flame-fx" data-fx="fastBurn">
        <circle class="flame-paint" data-fx-part data-fx-index="0"
          cx="128" cy="256" r="9" fill="var(--flame-middle)" />
        <circle class="flame-paint" data-fx-part data-fx-index="1"
          cx="174" cy="176" r="7" fill="var(--flame-inner)" />
        <circle class="flame-paint" data-fx-part data-fx-index="2"
          cx="440" cy="235" r="8" fill="var(--flame-middle)" />
      </g>

      <g class="flame-fx" data-fx="surprised">
        <path class="flame-paint flame-ink-stroke flame-fx-line" data-fx-part
          d="M86 330 L57 306 M92 286 L71 250" />
        <path class="flame-paint flame-ink-stroke flame-fx-line" data-fx-part
          d="M479 330 L508 306 M473 286 L494 250" />
      </g>

      <g class="flame-fx" data-fx="scared">
        <path class="flame-paint flame-ink-stroke flame-fx-line" data-fx-part
          d="M103 420 L88 411 M107 445 L90 442" />
        <path class="flame-paint flame-ink-stroke flame-fx-line" data-fx-part
          d="M462 420 L477 411 M458 445 L475 442" />
      </g>

      <g class="flame-fx" data-fx="curious">
        <circle class="flame-paint" data-fx-part cx="469" cy="350" r="10"
          fill="var(--flame-middle)" />
      </g>
    `;
  }

  function createMarkup(instanceId) {
    const middleClipId = `fire-middle-clip-${instanceId}`;
    return `
      <svg class="flame-animation__svg" viewBox="${VIEWBOX}"
        preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <defs>
          <clipPath id="${middleClipId}">
            <rect x="80" y="-100" width="405" height="721" />
          </clipPath>
        </defs>

        <ellipse class="flame-shadow" data-flame-shadow
          cx="282.5" cy="721" rx="116" ry="8"
          fill="var(--flame-ink)" opacity=".2" />

        <g class="flame-mascot-root" data-flame-body>
          <g class="flame-layer flame-layer--outer" data-flame-outer>
            <!-- red-base.svg: central fill -->
            <rect class="flame-paint" x="129" y="186" width="304" height="333"
              fill="var(--flame-outer)" />
            ${OUTER_PILLARS.map((pillar, index) =>
              pillarMarkup(pillar, "outer", index)
            ).join("")}
            <!-- red-base.svg: animated pillars 위의 gap filler + round base -->
            <g class="flame-base-pieces flame-base-pieces--outer"
              data-flame-base="outer">
              <rect class="flame-paint flame-outer-connector"
                x="-0.5" y="370" width="567" height="151"
                fill="var(--flame-outer)" />
              <path class="flame-paint" transform="translate(0 186)"
                d="${RED_BASE_PATH}" fill="var(--flame-outer)" />
            </g>
          </g>

          <g class="flame-layer flame-layer--middle" data-flame-middle
            clip-path="url(#${middleClipId})">
            <!-- orange-base.svg: central fill -->
            <rect class="flame-paint" x="207" y="408" width="148" height="137"
              fill="var(--flame-middle)" />
            ${MIDDLE_PILLARS.map((pillar, index) =>
              pillarMarkup(pillar, "middle", index)
            ).join("")}
            <!-- orange-base.svg: outer-color gap filler + orange round base -->
            <g class="flame-base-pieces flame-base-pieces--middle"
              data-flame-base="middle">
              <rect class="flame-paint flame-middle-gap-mask"
                x="79.5" y="503" width="406" height="108"
                fill="var(--flame-outer)" />
              <path class="flame-paint" transform="translate(83 285)"
                d="${MIDDLE_BASE_PATH}" fill="var(--flame-middle)" />
            </g>
          </g>

          <g class="flame-core" data-flame-core>
            <g transform="translate(241 251)">
              <path class="flame-paint" d="${CORE_SPIKE_PATH}" fill="var(--flame-inner)" />
            </g>
            <!-- yellow-base.svg -->
            <g transform="translate(120.5 320)">
              <path class="flame-paint" d="${CORE_LEFT_PATH}" fill="var(--flame-inner)" />
              <path class="flame-paint" d="${CORE_RIGHT_PATH}" fill="var(--flame-inner)" />
            </g>

            <g class="flame-face" data-flame-face>
              ${expressionMarkup()}
            </g>
          </g>

          <g class="flame-fx-root" data-flame-fx-root>
            ${fxMarkup()}
          </g>
        </g>
      </svg>
    `;
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @property --flame-outer {
        syntax: "<color>";
        inherits: true;
        initial-value: ${PALETTES.default.outer};
      }

      @property --flame-middle {
        syntax: "<color>";
        inherits: true;
        initial-value: ${PALETTES.default.middle};
      }

      @property --flame-inner {
        syntax: "<color>";
        inherits: true;
        initial-value: ${PALETTES.default.inner};
      }

      @property --flame-ink {
        syntax: "<color>";
        inherits: true;
        initial-value: ${PALETTES.default.ink};
      }

      .flame-animation {
        --flame-outer: ${PALETTES.default.outer};
        --flame-middle: ${PALETTES.default.middle};
        --flame-inner: ${PALETTES.default.inner};
        --flame-ink: ${PALETTES.default.ink};
        position: relative;
        display: block;
        overflow: visible;
        contain: layout style;
        transition:
          --flame-outer 320ms ease,
          --flame-middle 320ms ease,
          --flame-inner 320ms ease,
          --flame-ink 320ms ease;
      }

      .flame-animation__svg {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
      }

      .flame-part,
      .flame-mascot-root,
      .flame-layer,
      .flame-core,
      .flame-face,
      .flame-shadow {
        transform-box: fill-box;
        transform-origin: center bottom;
        will-change: transform, opacity;
      }

      .flame-paint {
        transition:
          fill 320ms ease,
          stroke 320ms ease,
          opacity 180ms ease;
      }

      .flame-no-transition .flame-paint,
      .flame-no-transition .flame-expression,
      .flame-no-transition .flame-fx {
        transition: none !important;
      }

      .flame-animation.flame-no-transition {
        transition: none !important;
      }

      .flame-ink-fill {
        fill: var(--flame-ink);
      }

      .flame-ink-stroke {
        fill: none;
        stroke: var(--flame-ink);
        stroke-width: 18;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .flame-mouth--thin {
        stroke-width: 14;
      }

      .flame-expression,
      .flame-fx {
        opacity: 0;
        transition: opacity 180ms ease;
        pointer-events: none;
      }

      .flame-animation[data-flame-mode="default"] [data-expression="default"],
      .flame-animation[data-flame-mode="sad"] [data-expression="sad"],
      .flame-animation[data-flame-mode="fastBurn"] [data-expression="fastBurn"],
      .flame-animation[data-flame-mode="surprised"] [data-expression="surprised"],
      .flame-animation[data-flame-mode="scared"] [data-expression="scared"],
      .flame-animation[data-flame-mode="curious"] [data-expression="curious"] {
        opacity: 1;
      }

      .flame-fx-line {
        stroke-width: 10;
      }

      @media (prefers-reduced-motion: reduce) {
        .flame-paint,
        .flame-expression,
        .flame-fx {
          transition-duration: 120ms !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function resolveTarget(target) {
    if (target instanceof HTMLElement) return target;
    if (typeof target === "string") return document.querySelector(target);
    return null;
  }

  function getRootMotion(mode, time, modeElapsed) {
    if (mode === "sad") {
      const p = cycle(time, 3.6);
      return {
        x: 0,
        y: frame(p, [0, 2, 1, 0], [0, 0.34, 0.68, 1]),
        scaleX: 1,
        scaleY: frame(p, [1, 0.975, 0.99, 1], [0, 0.34, 0.68, 1]),
        rotate: frame(p, [0, -0.4, 0.2, 0], [0, 0.34, 0.68, 1]),
        duration: 3.6,
      };
    }

    if (mode === "fastBurn") {
      const p = cycle(time, 3.3);
      const times = [0, 0.1, 0.18, 0.34, 0.46, 0.56, 1];
      return {
        x: 0,
        y: frame(p, [0, -3, 2, 0, -4, 1, 0], times),
        scaleX: 1,
        scaleY: frame(p, [1, 1.08, 0.97, 1, 1.06, 0.98, 1], times),
        rotate: 0,
        duration: 3.3,
      };
    }

    if (mode === "surprised") {
      if (modeElapsed < 0.55) {
        const p = modeElapsed / 0.55;
        const times = [0, 0.18, 0.42, 0.7, 1];
        const scale = frame(p, [1, 1.13, 0.93, 1.04, 1], times);
        return {
          x: 0,
          y: frame(p, [0, -10, 4, -2, 0], times),
          scaleX: scale,
          scaleY: scale,
          rotate: 0,
          duration: 2.4,
        };
      }
      const p = cycle(time, 2.4);
      return {
        x: 0,
        y: Math.sin(p * TAU) * 0.5,
        scaleX: 1,
        scaleY: 1,
        rotate: Math.max(0, Math.sin(p * TAU)) * 0.5,
        duration: 2.4,
      };
    }

    if (mode === "scared") {
      const p = cycle(time, 2.1);
      const times = [0, 0.06, 0.13, 0.2, 0.28, 0.35, 1];
      return {
        x: frame(p, [0, -1.5, 1.2, -1, 1.4, 0, 0], times),
        y: frame(p, [0, 1, 0, 1, 0, 0, 0], times),
        scaleX: frame(p, [1, 0.985, 1.01, 0.99, 1.005, 1, 1], times),
        scaleY: 1,
        rotate: 0,
        duration: 2.1,
      };
    }

    if (mode === "curious") {
      const p = cycle(time, 2.8);
      const times = [0, 0.24, 0.48, 0.7, 1];
      return {
        x: frame(p, [0, -2, -2, 1, 0], times),
        y: frame(p, [0, -2, -2, -1, 0], times),
        scaleX: 1,
        scaleY: 1,
        rotate: frame(p, [0, -3.5, -3.5, 1.5, 0], times),
        duration: 2.8,
      };
    }

    const p = cycle(time, 3.2);
    return {
      x: 0,
      y: Math.sin(p * TAU) * -2.2,
      scaleX: 1,
      scaleY: 1,
      rotate: Math.sin(p * TAU + 0.7) * 0.28,
      duration: 3.2,
    };
  }

  class FireMascot {
    constructor(target, options = {}) {
      const host = resolveTarget(target);
      if (!host) throw new Error("FireMascot을 넣을 요소를 찾을 수 없습니다.");

      installStyle();
      this.host = host;
      this.instanceId = FireMascot.nextId += 1;
      this.mode = normalizeMode(options.mode ?? host.dataset.flameMode);
      this.speedName = normalizeSpeed(options.speed ?? host.dataset.flameSpeed);
      this.intensity = clamp(
        Number(options.intensity ?? host.dataset.flameIntensity ?? 1),
        0,
        2
      );
      this.paused =
        options.paused === true || host.dataset.flamePaused === "true";
      this.reducedMotionOverride =
        options.reducedMotion === true ||
        host.dataset.flameReducedMotion === "true";
      this.elapsed = 0;
      this.modeElapsed = 0;
      this.previousTime = 0;
      this.frame = 0;
      this.running = false;
      this.mediaReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      );
      this.handleMediaChange = () => {
        if (this.isReducedMotion()) {
          this.running = false;
          cancelAnimationFrame(this.frame);
          this.render(this.elapsed);
        } else if (!this.paused) {
          this.start();
        }
      };
      this.mediaReducedMotion.addEventListener?.(
        "change",
        this.handleMediaChange
      );

      host.classList.add("flame-animation");
      if (options.className) {
        String(options.className)
          .split(/\s+/)
          .filter(Boolean)
          .forEach((className) => host.classList.add(className));
      }
      host.dataset.flameMounted = "true";
      host.setAttribute("role", "img");
      host.setAttribute(
        "aria-label",
        options["aria-label"] ||
          options.label ||
          host.dataset.flameLabel ||
          "귀여운 불꽃 마스코트"
      );
      host.innerHTML = createMarkup(this.instanceId);

      this.body = host.querySelector("[data-flame-body]");
      this.outer = host.querySelector("[data-flame-outer]");
      this.middle = host.querySelector("[data-flame-middle]");
      this.core = host.querySelector("[data-flame-core]");
      this.face = host.querySelector("[data-flame-face]");
      this.shadow = host.querySelector("[data-flame-shadow]");
      this.fxGroups = Array.from(host.querySelectorAll("[data-fx]"));
      this.eyes = Array.from(host.querySelectorAll("[data-flame-eye]"));
      this.pillars = Array.from(
        host.querySelectorAll("[data-flame-pillar]")
      ).map((element) => ({
        element,
        x: Number(element.dataset.x),
        y: Number(element.dataset.y),
        width: Number(element.dataset.width),
        height: Number(element.dataset.height),
        amplitude: Number(element.dataset.amplitude),
        group: element.dataset.group,
        side: Number(element.dataset.side),
        layer: element.dataset.layer,
      }));

      this.tick = this.tick.bind(this);
      if (options.size != null) this.setSize(options.size);
      this.applyMode(false);
      this.render(0);

      if (!this.paused && !this.isReducedMotion()) this.start();
    }

    isReducedMotion() {
      return this.reducedMotionOverride || this.mediaReducedMotion.matches;
    }

    applyMode(animate = true) {
      const palette = PALETTES[this.mode];
      if (!animate) this.host.classList.add("flame-no-transition");
      this.host.dataset.flameMode = this.mode;
      this.host.style.setProperty("--flame-outer", palette.outer);
      this.host.style.setProperty("--flame-middle", palette.middle);
      this.host.style.setProperty("--flame-inner", palette.inner);
      this.host.style.setProperty("--flame-ink", palette.ink);
      if (!animate) {
        requestAnimationFrame(() =>
          this.host.classList.remove("flame-no-transition")
        );
      }
    }

    pillarScale(pillar, time) {
      const delay = GROUP_PHASE[pillar.group];
      const layerFactor = pillar.layer === "middle" ? 0.86 : 1;

      if (this.mode === "fastBurn") {
        const p = cycle(time - delay * 0.056, 0.76);
        const pulse = frame(
          p,
          [1, 1.17, 0.92, 1, 1.12, 0.95, 1],
          [0, 0.1, 0.18, 0.34, 0.46, 0.56, 1]
        );
        const idle =
          (Math.sin(time * (TAU / 0.92) + delay * TAU) *
            pillar.amplitude *
            1.58 *
            layerFactor *
            this.intensity) /
          pillar.height;
        return 1 + (pulse - 1) * 0.58 * layerFactor * this.intensity + idle;
      }

      const duration =
        this.mode === "sad"
          ? 3.6
          : this.mode === "scared"
            ? 2.1
            : this.mode === "curious"
              ? 2.8
              : 3.2;
      const local = time * (TAU / duration) + delay * TAU;
      let strength = 1;
      if (this.mode === "sad") strength = 0.46;
      if (this.mode === "scared") strength = 0.28;
      if (this.mode === "surprised") strength = 0.42;
      if (this.mode === "curious" && pillar.group === "top") strength = 1.3;

      const droop =
        this.mode === "sad" && pillar.group !== "lower" ? -0.015 : 0;
      return (
        1 +
        droop +
        (Math.sin(local) * pillar.amplitude * strength * layerFactor * this.intensity) /
          pillar.height
      );
    }

    blinkScale(time) {
      if (this.isReducedMotion()) return 1;
      if (this.mode === "scared") {
        const p = cycle(time, 4.4);
        const first = p > 0.72 && p < 0.77;
        const second = p > 0.8 && p < 0.85;
        if (first) return 1 - Math.sin(((p - 0.72) / 0.05) * Math.PI) * 0.82;
        if (second) return 1 - Math.sin(((p - 0.8) / 0.05) * Math.PI) * 0.82;
        return 1;
      }
      const p = cycle(time, 6.2);
      if (p < 0.82 || p > 0.88) return 1;
      return 1 - Math.sin(((p - 0.82) / 0.06) * Math.PI) * 0.86;
    }

    renderFx(time) {
      const reduced = this.isReducedMotion();
      this.fxGroups.forEach((group) => {
        const active =
          group.dataset.fx === this.mode && this.modeElapsed >= 0.12 && !reduced;
        group.style.opacity = active ? "1" : "0";
      });
      if (reduced) return;

      const group = this.fxGroups.find((item) => item.dataset.fx === this.mode);
      if (!group) return;
      const parts = Array.from(group.querySelectorAll("[data-fx-part]"));

      if (this.mode === "sad") {
        const p = cycle(time, 3.6);
        const y = p * 18;
        parts[0].setAttribute("transform", `translate(0 ${y.toFixed(2)})`);
        parts[0].style.opacity = String(0.42 * Math.sin(p * Math.PI));
      } else if (this.mode === "fastBurn") {
        parts.forEach((part, index) => {
          const p = cycle(time - index * 0.14, 1.65);
          const active = p < 0.34;
          const local = p / 0.34;
          part.setAttribute(
            "transform",
            `translate(0 ${(-28 * local).toFixed(2)}) scale(${(0.7 + local * 0.45).toFixed(3)})`
          );
          part.style.opacity = active ? String(1 - local) : "0";
        });
      } else if (this.mode === "surprised") {
        const p = clamp((this.modeElapsed - 0.12) / 0.55, 0, 1);
        const scale = frame(p, [0, 1, 0.8], [0, 0.38, 1]);
        group.setAttribute(
          "transform",
          `translate(282.5 350) scale(${scale.toFixed(3)}) translate(-282.5 -350)`
        );
        group.style.opacity = String(1 - p * 0.35);
      } else if (this.mode === "scared") {
        const x = Math.sin(time * 24) * 1.4;
        group.setAttribute("transform", `translate(${x.toFixed(2)} 0)`);
        group.style.opacity = String(0.42 + Math.abs(Math.sin(time * 10)) * 0.25);
      } else if (this.mode === "curious") {
        const p = cycle(time, 2.8);
        const x = Math.cos(p * TAU) * 20;
        const y = Math.sin(p * TAU) * 12;
        parts[0].setAttribute(
          "transform",
          `translate(${x.toFixed(2)} ${y.toFixed(2)})`
        );
        parts[0].style.opacity = "0.72";
      }
    }

    render(time) {
      const reduced = this.isReducedMotion();
      const motion = reduced
        ? {
            x: 0,
            y: 0,
            scaleX: 1,
            scaleY: 1,
            rotate: 0,
          }
        : getRootMotion(this.mode, time, this.modeElapsed);
      const rootPivotY = this.mode === "surprised" ? 595 : 690;

      this.body.setAttribute(
        "transform",
        [
          `translate(${motion.x.toFixed(3)} ${motion.y.toFixed(3)})`,
          `rotate(${motion.rotate.toFixed(3)} 282.5 ${rootPivotY})`,
          `translate(282.5 ${rootPivotY})`,
          `scale(${motion.scaleX.toFixed(5)} ${motion.scaleY.toFixed(5)})`,
          `translate(-282.5 ${-rootPivotY})`,
        ].join(" ")
      );

      this.pillars.forEach((pillar) => {
        const scaleY = reduced ? 1 : this.pillarScale(pillar, time);
        const phase = GROUP_PHASE[pillar.group] * TAU;
        const horizontalSpeed = this.mode === "fastBurn" ? 5.25 : 1.05;
        const scaleX = reduced
          ? 1
          : 1 +
            Math.sin(time * horizontalSpeed + phase) *
              0.004 *
              this.intensity;
        const centerX = pillar.width / 2;
        pillar.element.setAttribute(
          "transform",
          [
            `translate(${pillar.x} ${pillar.y})`,
            `translate(${centerX} ${pillar.height})`,
            `scale(${scaleX.toFixed(5)} ${scaleY.toFixed(5)})`,
            `translate(${-centerX} ${-pillar.height})`,
          ].join(" ")
        );
      });

      let middleScale = 1;
      let coreScale = 1;
      if (!reduced) {
        const baseWave = Math.sin(time * 1.75 + 0.5);
        middleScale += baseWave * 0.006 * this.intensity;
        coreScale += Math.sin(time * 1.9 + 1.1) * 0.007 * this.intensity;
        if (this.mode === "sad") {
          middleScale -= 0.01;
          coreScale -= 0.006;
        }
        if (this.mode === "fastBurn") {
          const p = cycle(time, 3.3);
          middleScale +=
            (frame(p, [1, 1.08, 0.98, 1], [0, 0.12, 0.28, 1]) - 1) * 0.5;
        }
      }

      this.middle.setAttribute(
        "transform",
        `translate(282.5 621) scale(${(2 - middleScale).toFixed(5)} ${middleScale.toFixed(5)}) translate(-282.5 -621)`
      );
      this.core.setAttribute(
        "transform",
        `translate(282.5 621) scale(${(2 - coreScale).toFixed(5)} ${coreScale.toFixed(5)}) translate(-282.5 -621)`
      );

      const faceX =
        this.mode === "curious" && !reduced
          ? frame(cycle(time, 2.8), [0, 2, 2, 0, 0], [0, 0.24, 0.48, 0.7, 1])
          : 0;
      const faceY = this.mode === "sad" && !reduced ? 2 : 0;
      this.face.setAttribute(
        "transform",
        `translate(${faceX.toFixed(2)} ${faceY.toFixed(2)})`
      );

      const blink = this.blinkScale(time);
      this.eyes.forEach((eyeNode) => {
        const cx = Number(eyeNode.dataset.cx);
        const cy = Number(eyeNode.dataset.cy);
        eyeNode.setAttribute(
          "transform",
          `translate(${cx} ${cy}) scale(1 ${blink.toFixed(4)}) translate(${-cx} ${-cy})`
        );
      });

      const shadowScale = reduced
        ? 1
        : clamp(1 + motion.y * 0.025 - (motion.scaleY - 1) * 1.7, 0.82, 1.08);
      this.shadow.setAttribute(
        "transform",
        `translate(282.5 721) scale(${shadowScale.toFixed(4)} 1) translate(-282.5 -721)`
      );
      this.shadow.style.opacity = String(
        this.mode === "sad" ? 0.23 : this.mode === "fastBurn" ? 0.18 : 0.25
      );
      this.renderFx(time);
    }

    tick(timestamp) {
      if (!this.running) return;
      if (!this.previousTime) this.previousTime = timestamp;
      const delta = Math.min(40, timestamp - this.previousTime);
      this.previousTime = timestamp;
      const seconds = delta / 1000;
      this.elapsed += seconds * SPEEDS[this.speedName];
      this.modeElapsed += seconds;
      this.render(this.elapsed);
      this.frame = requestAnimationFrame(this.tick);
    }

    start() {
      if (this.running || this.paused || this.isReducedMotion()) return this;
      this.running = true;
      this.previousTime = 0;
      this.frame = requestAnimationFrame(this.tick);
      return this;
    }

    play() {
      this.paused = false;
      this.host.dataset.flamePaused = "false";
      return this.start();
    }

    pause() {
      this.paused = true;
      this.running = false;
      this.host.dataset.flamePaused = "true";
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      return this;
    }

    setMode(mode) {
      const nextMode = normalizeMode(mode);
      if (nextMode === this.mode) return this;
      this.mode = nextMode;
      this.modeElapsed = 0;
      this.applyMode(true);
      this.render(this.elapsed);
      return this;
    }

    setSpeed(speed) {
      this.speedName = normalizeSpeed(speed);
      this.host.dataset.flameSpeed = this.speedName;
      return this;
    }

    setSize(size) {
      const pixels = clamp(Number(size) || 240, 24, 1000);
      this.host.style.width = `${pixels}px`;
      this.host.style.height = `${pixels}px`;
      return this;
    }

    setIntensity(intensity) {
      this.intensity = clamp(Number(intensity) || 0, 0, 2);
      this.render(this.elapsed);
      return this;
    }

    setReducedMotion(value) {
      this.reducedMotionOverride = Boolean(value);
      this.host.dataset.flameReducedMotion = String(this.reducedMotionOverride);
      if (this.isReducedMotion()) {
        this.running = false;
        cancelAnimationFrame(this.frame);
        this.render(this.elapsed);
      } else if (!this.paused) {
        this.start();
      }
      return this;
    }

    destroy() {
      this.pause();
      this.mediaReducedMotion.removeEventListener?.(
        "change",
        this.handleMediaChange
      );
      this.host.innerHTML = "";
      this.host.classList.remove("flame-animation");
      delete this.host.dataset.flameMounted;
    }
  }

  FireMascot.nextId = 0;

  function createFlameAnimation(target, options) {
    return new FireMascot(target, options);
  }

  function autoMount() {
    const instances = [];
    document.querySelectorAll("[data-flame-animation]").forEach((host) => {
      if (host.dataset.flameMounted === "true") return;
      instances.push(
        createFlameAnimation(host, {
          mode: host.dataset.flameMode,
          speed: host.dataset.flameSpeed,
          paused: host.dataset.flamePaused === "true",
          reducedMotion: host.dataset.flameReducedMotion === "true",
        })
      );
    });
    window.flameAnimations = instances;
  }

  window.FireMascot = FireMascot;
  window.FlameAnimation = FireMascot;
  window.createFlameAnimation = createFlameAnimation;
  window.FIRE_MASCOT_MODES = [...MODES];

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount, { once: true });
  } else {
    autoMount();
  }
})();
