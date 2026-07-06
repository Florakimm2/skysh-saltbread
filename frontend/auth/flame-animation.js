/**
 * FireMascot / FlameAnimation
 *
 * The shared SVG rig is adapted directly from the provided flame-animation.js.
 * It keeps the same public modes and imperative instance API while packaging the
 * browser-only implementation as an ES module for the Next.js client.
 */

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
    outer: "#F04B35",
    middle: "#FF991A",
    inner: "#FFD34D",
    ink: "#3B3108",
  },
  scared: {
    outer: "#623B9B",
    middle: "#9B66D9",
    inner: "#DFC6FF",
    ink: "#2A1743",
  },
  curious: {
    outer: "#F05A3B",
    middle: "#FF9B24",
    inner: "#FFD45A",
    ink: "#24333B",
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
  { x: 0, y: 260, amplitude: 5.5, group: "lower" },
  { x: 69, y: 150, amplitude: 7, group: "middle" },
  { x: 138, y: 25, amplitude: 8.5, group: "upper" },
  { x: 207, y: -73, amplitude: 10, group: "top" },
  { x: 276, y: 25, amplitude: 8.5, group: "upper" },
  { x: 345, y: 150, amplitude: 7, group: "middle" },
  {
    x: 415.646,
    y: 260,
    width: 151,
    height: 260,
    path: SLANTED_PILLAR_PATH,
    amplitude: 5.5,
    group: "lower",
  },
];

const MIDDLE_PILLARS = [
  { x: 83, y: 287, amplitude: 5, group: "lower" },
  { x: 145, y: 185, amplitude: 7, group: "upper" },
  { x: 207, y: 97, amplitude: 9, group: "top" },
  { x: 270, y: 185, amplitude: 7, group: "upper" },
  { x: 333, y: 287, amplitude: 5, group: "lower" },
];

const GROUP_PHASE = {
  top: 0,
  upper: 0.24,
  middle: 0.48,
  lower: 0.7,
};

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : "default";
}

function normalizeSpeed(speed) {
  return SPEEDS[speed] ? speed : "normal";
}

function pillarMarkup(pillar, layer, index) {
  const color = layer === "outer" ? "outer" : "middle";
  const width = pillar.width || 150;
  const height = pillar.height || 259;

  return `
    <g data-flame-pillar data-x="${pillar.x}" data-y="${pillar.y}"
      data-width="${width}" data-height="${height}"
      data-amplitude="${pillar.amplitude}" data-group="${pillar.group}"
      data-layer="${layer}" data-index="${index}">
      <path d="${pillar.path || PILLAR_PATH}" fill="var(--flame-${color})" />
    </g>
  `;
}

function defaultEye(x, y) {
  return `
    <g data-flame-eye data-cx="${x + 18.5}" data-cy="${y + 36.5}">
      <path class="flame-ink-fill" transform="translate(${x} ${y})"
        d="${DEFAULT_EYE_PATH}" />
    </g>
  `;
}

function roundEye(x, y, width = 37, height = 70) {
  return `
    <g data-flame-eye data-cx="${x + width / 2}" data-cy="${y + height / 2}">
      <rect class="flame-ink-fill" x="${x}" y="${y}" width="${width}"
        height="${height}" rx="${width / 2}" />
    </g>
  `;
}

function expressionsMarkup() {
  return `
    <g class="flame-expression" data-expression="default">
      ${defaultEye(205, 410)}
      ${defaultEye(323, 410)}
      <g transform="translate(229 516.5)">
        <circle class="flame-ink-fill" cx="10.5" cy="10.5" r="10.5" />
        <circle class="flame-ink-fill" cx="93.5" cy="10.5" r="10.5" />
        <path d="${DEFAULT_MOUTH_PATH}" fill="none" stroke="var(--flame-ink)"
          stroke-width="21" />
      </g>
    </g>
    <g class="flame-expression" data-expression="sad">
      ${roundEye(205, 420)}
      ${roundEye(323, 420)}
      <path class="flame-ink-stroke" d="M248 555 Q282.5 529 317 555" />
    </g>
    <g class="flame-expression" data-expression="fastBurn">
      ${roundEye(209, 415, 32, 67)}
      ${roundEye(324, 415, 32, 67)}
      <circle class="flame-ink-fill" cx="282.5" cy="548" r="16" />
    </g>
    <g class="flame-expression" data-expression="surprised">
      ${roundEye(205, 393, 37, 92)}
      ${roundEye(323, 393, 37, 92)}
      <ellipse class="flame-ink-fill" cx="282.5" cy="548" rx="15" ry="20" />
    </g>
    <g class="flame-expression" data-expression="scared">
      ${roundEye(214, 408, 36, 76)}
      ${roundEye(315, 408, 36, 76)}
      <path class="flame-ink-stroke flame-mouth-thin"
        d="M255 550 Q267 538 279 550 Q291 562 310 548" />
    </g>
    <g class="flame-expression" data-expression="curious">
      ${roundEye(202, 399, 40, 77)}
      ${roundEye(324, 414, 35, 68)}
      <path class="flame-ink-stroke flame-mouth-thin"
        d="M246 532 Q276 559 316 529" />
    </g>
  `;
}

function createMarkup(instanceId) {
  const clipId = `fire-middle-clip-${instanceId}`;
  return `
    <svg class="flame-animation__svg" viewBox="${VIEWBOX}"
      preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="${clipId}">
          <rect x="80" y="-100" width="405" height="721" />
        </clipPath>
      </defs>
      <ellipse data-flame-shadow cx="282.5" cy="721" rx="116" ry="8"
        fill="var(--flame-ink)" opacity=".2" />
      <g data-flame-body>
        <g data-flame-outer>
          <rect x="129" y="186" width="304" height="333"
            fill="var(--flame-outer)" />
          ${OUTER_PILLARS.map((pillar, index) =>
            pillarMarkup(pillar, "outer", index),
          ).join("")}
          <rect x="-0.5" y="370" width="567" height="151"
            fill="var(--flame-outer)" />
          <path transform="translate(0 186)" d="${RED_BASE_PATH}"
            fill="var(--flame-outer)" />
        </g>
        <g data-flame-middle clip-path="url(#${clipId})">
          <rect x="207" y="408" width="148" height="137"
            fill="var(--flame-middle)" />
          ${MIDDLE_PILLARS.map((pillar, index) =>
            pillarMarkup(pillar, "middle", index),
          ).join("")}
          <rect x="79.5" y="503" width="406" height="108"
            fill="var(--flame-outer)" />
          <path transform="translate(83 285)" d="${MIDDLE_BASE_PATH}"
            fill="var(--flame-middle)" />
        </g>
        <g data-flame-core>
          <g transform="translate(241 251)">
            <path d="${CORE_SPIKE_PATH}" fill="var(--flame-inner)" />
          </g>
          <g transform="translate(120.5 320)">
            <path d="${CORE_LEFT_PATH}" fill="var(--flame-inner)" />
            <path d="${CORE_RIGHT_PATH}" fill="var(--flame-inner)" />
          </g>
          <g data-flame-face>${expressionsMarkup()}</g>
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
    .flame-animation {
      --flame-outer: ${PALETTES.default.outer};
      --flame-middle: ${PALETTES.default.middle};
      --flame-inner: ${PALETTES.default.inner};
      --flame-ink: ${PALETTES.default.ink};
      position: relative;
      display: inline-block;
      overflow: visible;
      contain: layout style;
    }
    .flame-animation__svg { display: block; width: 100%; height: 100%; overflow: visible; }
    .flame-animation path, .flame-animation rect, .flame-animation circle,
    .flame-animation ellipse { transition: fill 320ms ease, stroke 320ms ease; }
    .flame-ink-fill { fill: var(--flame-ink); }
    .flame-ink-stroke {
      fill: none;
      stroke: var(--flame-ink);
      stroke-width: 18;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .flame-mouth-thin { stroke-width: 14; }
    .flame-expression { opacity: 0; transition: opacity 180ms ease; }
    .flame-animation[data-flame-mode="default"] [data-expression="default"],
    .flame-animation[data-flame-mode="sad"] [data-expression="sad"],
    .flame-animation[data-flame-mode="fastBurn"] [data-expression="fastBurn"],
    .flame-animation[data-flame-mode="surprised"] [data-expression="surprised"],
    .flame-animation[data-flame-mode="scared"] [data-expression="scared"],
    .flame-animation[data-flame-mode="curious"] [data-expression="curious"] {
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}

let nextId = 0;

export function createFlameAnimation(target, options = {}) {
  if (!(target instanceof HTMLElement)) {
    throw new Error("FireMascot을 넣을 요소를 찾을 수 없습니다.");
  }

  installStyle();
  const host = target;
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let mode = normalizeMode(options.mode);
  let speed = normalizeSpeed(options.speed);
  let paused = options.paused === true;
  let elapsed = 0;
  let previousTime = 0;
  let frameId = 0;

  host.classList.add("flame-animation");
  host.dataset.flameMode = mode;
  host.setAttribute("role", "img");
  host.setAttribute("aria-label", options.label || "귀여운 불꽃 마스코트");
  host.innerHTML = createMarkup((nextId += 1));

  const body = host.querySelector("[data-flame-body]");
  const middle = host.querySelector("[data-flame-middle]");
  const core = host.querySelector("[data-flame-core]");
  const shadow = host.querySelector("[data-flame-shadow]");
  const eyes = Array.from(host.querySelectorAll("[data-flame-eye]"));
  const pillars = Array.from(host.querySelectorAll("[data-flame-pillar]")).map(
    (element) => ({
      element,
      x: Number(element.dataset.x),
      y: Number(element.dataset.y),
      width: Number(element.dataset.width),
      height: Number(element.dataset.height),
      amplitude: Number(element.dataset.amplitude),
      group: element.dataset.group,
      layer: element.dataset.layer,
    }),
  );

  function applyPalette() {
    const palette = PALETTES[mode];
    host.dataset.flameMode = mode;
    host.style.setProperty("--flame-outer", palette.outer);
    host.style.setProperty("--flame-middle", palette.middle);
    host.style.setProperty("--flame-inner", palette.inner);
    host.style.setProperty("--flame-ink", palette.ink);
  }

  function render(time) {
    const reduced = media.matches;
    const energy = mode === "fastBurn" ? 2.1 : mode === "sad" ? 0.45 : 1;
    const bounce = reduced ? 0 : Math.sin(time * 2.05) * 2.2 * energy;
    const tilt =
      reduced || mode === "scared"
        ? 0
        : Math.sin(time * 1.6 + 0.7) * (mode === "curious" ? 2.4 : 0.35);

    body.setAttribute(
      "transform",
      `translate(0 ${bounce.toFixed(3)}) rotate(${tilt.toFixed(3)} 282.5 690)`,
    );

    pillars.forEach((pillar) => {
      const phase = GROUP_PHASE[pillar.group] * TAU;
      const pulse =
        reduced
          ? 1
          : 1 +
            (Math.sin(time * (mode === "fastBurn" ? 7 : 2) + phase) *
              pillar.amplitude *
              energy) /
              pillar.height;
      const centerX = pillar.width / 2;
      pillar.element.setAttribute(
        "transform",
        `translate(${pillar.x} ${pillar.y}) translate(${centerX} ${pillar.height}) scale(1 ${pulse.toFixed(5)}) translate(${-centerX} ${-pillar.height})`,
      );
    });

    const innerPulse = reduced ? 1 : 1 + Math.sin(time * 1.9) * 0.007 * energy;
    middle.setAttribute(
      "transform",
      `translate(282.5 621) scale(${(2 - innerPulse).toFixed(5)} ${innerPulse.toFixed(5)}) translate(-282.5 -621)`,
    );
    core.setAttribute(
      "transform",
      `translate(282.5 621) scale(${innerPulse.toFixed(5)}) translate(-282.5 -621)`,
    );

    const blinkProgress = (time % 5.8) / 5.8;
    const blink =
      reduced || blinkProgress < 0.86 || blinkProgress > 0.91
        ? 1
        : 1 - Math.sin(((blinkProgress - 0.86) / 0.05) * Math.PI) * 0.86;
    eyes.forEach((eye) => {
      const cx = Number(eye.dataset.cx);
      const cy = Number(eye.dataset.cy);
      eye.setAttribute(
        "transform",
        `translate(${cx} ${cy}) scale(1 ${blink.toFixed(4)}) translate(${-cx} ${-cy})`,
      );
    });
    shadow.setAttribute(
      "transform",
      `translate(282.5 721) scale(${(1 - bounce * 0.02).toFixed(4)} 1) translate(-282.5 -721)`,
    );
  }

  function tick(timestamp) {
    if (paused || media.matches) return;
    if (!previousTime) previousTime = timestamp;
    const delta = Math.min(40, timestamp - previousTime);
    previousTime = timestamp;
    elapsed += (delta / 1000) * SPEEDS[speed];
    render(elapsed);
    frameId = window.requestAnimationFrame(tick);
  }

  function play() {
    paused = false;
    previousTime = 0;
    window.cancelAnimationFrame(frameId);
    frameId = window.requestAnimationFrame(tick);
  }

  function pause() {
    paused = true;
    window.cancelAnimationFrame(frameId);
  }

  function handleMotionChange() {
    if (media.matches) {
      window.cancelAnimationFrame(frameId);
      render(elapsed);
    } else if (!paused) {
      play();
    }
  }

  media.addEventListener?.("change", handleMotionChange);
  applyPalette();
  render(0);
  if (!paused && !media.matches) play();

  return {
    play,
    pause,
    setMode(nextMode) {
      mode = normalizeMode(nextMode);
      applyPalette();
      render(elapsed);
    },
    setSpeed(nextSpeed) {
      speed = normalizeSpeed(nextSpeed);
    },
    destroy() {
      pause();
      media.removeEventListener?.("change", handleMotionChange);
      host.innerHTML = "";
      host.classList.remove("flame-animation");
    },
  };
}
