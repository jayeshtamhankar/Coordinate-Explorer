/* =========================================================
   Coordinate Explorer
   A small interactive lesson on the Cartesian plane.
   Everything below is vanilla JS + SVG, no build step.
   ========================================================= */

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  // ---- Grid configuration ----------------------------------------------
  const X_MIN = -10, X_MAX = 10;
  const Y_MIN = -7, Y_MAX = 7;
  const UNIT = 40;                     // px per coordinate unit inside the viewBox
  const VIEW_W = (X_MAX - X_MIN) * UNIT;
  const VIEW_H = (Y_MAX - Y_MIN) * UNIT;
  const ORIGIN_X = (0 - X_MIN) * UNIT;
  const ORIGIN_Y = VIEW_H - (0 - Y_MIN) * UNIT; // SVG y grows downward

  // ---- State -------------------------------------------------------------
  let pos = { x: 0, y: 0 };
  let challenge = null; // { x, y } while active, null when idle/solved

  // ---- DOM references -----------------------------------------------------
  const svg = document.getElementById("plane");
  const gTints = document.getElementById("quadrant-tints");
  const gGrid = document.getElementById("grid-lines");
  const gAxes = document.getElementById("axes");
  const gTicks = document.getElementById("ticks");
  const gQuadLabels = document.getElementById("quadrant-labels");
  const gGuides = document.getElementById("guides");
  const gTarget = document.getElementById("target-marker");
  const gRover = document.getElementById("rover");

  const elPosX = document.getElementById("pos-x");
  const elPosY = document.getElementById("pos-y");
  const elXValue = document.getElementById("x-value");
  const elYValue = document.getElementById("y-value");
  const elQuadrantName = document.getElementById("quadrant-name");
  const elExplainText = document.getElementById("explain-text");

  const elChallengeIdle = document.getElementById("challenge-idle");
  const elChallengeActive = document.getElementById("challenge-active");
  const elChallengeSuccess = document.getElementById("challenge-success");
  const elChallengeTarget = document.getElementById("challenge-target");
  const elChallengeCurrent = document.getElementById("challenge-current");
  const elSuccessText = document.getElementById("success-text");

  const btnUp = document.getElementById("btn-up");
  const btnDown = document.getElementById("btn-down");
  const btnLeft = document.getElementById("btn-left");
  const btnRight = document.getElementById("btn-right");
  const btnReset = document.getElementById("btn-reset");
  const btnChallenge = document.getElementById("btn-challenge");
  const btnSound = document.getElementById("btn-sound");
  const btnNextChallenge = document.getElementById("btn-next-challenge");
  const btnKeepExploring = document.getElementById("btn-keep-exploring");

  const confettiCanvas = document.getElementById("confetti-canvas");
  const boundaryToast = document.getElementById("boundary-toast");
  const prankToast = document.getElementById("prank-toast");
  const celebrationOverlay = document.getElementById("celebration-overlay");
  const celebrationResult = document.getElementById("celebration-result");
  const celebrationHowto = document.getElementById("celebration-howto");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Sound engine (Web Audio API, no audio files, no autoplay) ----------
  // Browsers block audio until the user interacts with the page, so the
  // AudioContext is created lazily on the very first button press or key.
  let soundOn = true; // remembered only for this page session, per the brief
  let audioCtx = null;

  function ensureAudioContext() {
    if (!soundOn) return null;
    if (!audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // A single short tone with a quick attack/decay envelope, so nothing clicks
  // or overstays its welcome.
  function playTone(freq, duration, opts) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const options = opts || {};
    const type = options.type || "sine";
    const peakGain = options.peakGain != null ? options.peakGain : 0.16;
    const delay = options.delay || 0;
    const startAt = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function playMoveSound() {
    playTone(520, 0.09, { type: "sine", peakGain: 0.14 });
  }

  function playBoundarySound() {
    playTone(180, 0.16, { type: "sine", peakGain: 0.11 });
  }

  function playSuccessSound() {
    // a short cheerful arpeggio, one note after another
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => {
      playTone(freq, 0.18, { type: "triangle", peakGain: 0.15, delay: i * 0.11 });
    });
  }

  // Short, quiet, cartoon-ish sounds for prank movements — always shorter
  // and quieter than playSuccessSound() above, and silent when sound is off
  // (ensureAudioContext() returns null in that case, so this just no-ops).
  function playPrankSound(kind) {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    const startAt = ctx.currentTime;

    if (kind === "whoosh") {
      // quick descending sweep — something skipped past you
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(900, startAt);
      osc.frequency.exponentialRampToValueAtTime(220, startAt + 0.18);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.22);
    } else if (kind === "oops") {
      // two-note dip, like a gentle "wrong buzzer"
      playTone(420, 0.1, { type: "square", peakGain: 0.07 });
      playTone(300, 0.14, { type: "square", peakGain: 0.07, delay: 0.1 });
    } else if (kind === "boing") {
      // bouncy up-down warble for the extra-step prank
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(360, startAt);
      osc.frequency.exponentialRampToValueAtTime(620, startAt + 0.12);
      osc.frequency.exponentialRampToValueAtTime(420, startAt + 0.24);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.26);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.28);
    } else if (kind === "plotTwist") {
      // a playful "surprise" sting: a quick rising whoosh into a comedic
      // two-note "womp womp" dip — clearly its own thing, still short and quiet.
      const rise = ctx.createOscillator();
      const riseGain = ctx.createGain();
      rise.type = "triangle";
      rise.frequency.setValueAtTime(300, startAt);
      rise.frequency.exponentialRampToValueAtTime(900, startAt + 0.15);
      riseGain.gain.setValueAtTime(0.0001, startAt);
      riseGain.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
      riseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.17);
      rise.connect(riseGain);
      riseGain.connect(ctx.destination);
      rise.start(startAt);
      rise.stop(startAt + 0.18);

      [440, 349.23].forEach((freq, i) => {
        playTone(freq, 0.16, { type: "square", peakGain: 0.07, delay: 0.2 + i * 0.18 });
      });
    }
  }

  function speak(message) {
    if (!soundOn) return;
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1;
    utterance.pitch = 1.05;
    utterance.volume = 0.8;
    window.speechSynthesis.speak(utterance);
  }

  function setSoundOn(value) {
    soundOn = value;
    btnSound.textContent = soundOn ? "🔊 Sound on" : "🔇 Sound off";
    btnSound.setAttribute("aria-pressed", String(soundOn));
    if (soundOn) ensureAudioContext();
  }

  btnSound.addEventListener("click", () => setSoundOn(!soundOn));

  // ---- Boundary toast ("you reached the edge of the map!") ----------------
  let boundaryToastTimer = null;
  function showBoundaryToast() {
    boundaryToast.classList.add("show");
    clearTimeout(boundaryToastTimer);
    boundaryToastTimer = setTimeout(() => boundaryToast.classList.remove("show"), 1500);
  }

  // ---- Prank toast (short funny messages, separate from the boundary one) -
  let prankToastTimer = null;
  function showPrankToast(message, durationMs) {
    prankToast.textContent = message;
    prankToast.classList.add("show");
    clearTimeout(prankToastTimer);
    prankToastTimer = setTimeout(() => prankToast.classList.remove("show"), durationMs || 1500);
  }

  // ---- Confetti (canvas-based, no external library) -----------------------
  let confettiRafId = null;
  let confettiStopTimer = null;
  const CONFETTI_COLORS = ["#f2a93b", "#ef6f6c", "#2f9e8f", "#8b7fd1", "#3fa66b", "#f4d35e"];

  function launchConfetti() {
    if (prefersReducedMotion) return; // keep the celebration text, skip the motion

    const rect = confettiCanvas.parentElement.getBoundingClientRect();
    confettiCanvas.width = rect.width;
    confettiCanvas.height = rect.height;
    confettiCanvas.classList.remove("hidden");

    const ctx2d = confettiCanvas.getContext("2d");
    const particleCount = 90;
    const particles = [];
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * confettiCanvas.width,
        y: -20 - Math.random() * confettiCanvas.height * 0.5,
        size: 5 + Math.random() * 5,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        speedY: 2 + Math.random() * 2.5,
        speedX: (Math.random() - 0.5) * 2,
        rotation: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3
      });
    }

    const startTime = performance.now();
    const durationMs = 2600;

    function frame(now) {
      const elapsed = now - startTime;
      ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

      particles.forEach((p) => {
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.spin;

        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rotation);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx2d.restore();
      });

      if (elapsed < durationMs) {
        confettiRafId = requestAnimationFrame(frame);
      } else {
        stopConfetti();
      }
    }

    cancelAnimationFrame(confettiRafId);
    clearTimeout(confettiStopTimer);
    confettiRafId = requestAnimationFrame(frame);
  }

  function stopConfetti() {
    cancelAnimationFrame(confettiRafId);
    const ctx2d = confettiCanvas.getContext("2d");
    ctx2d.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiCanvas.classList.add("hidden");
  }

  // ---- Fit the coordinate plane to whatever space it's given --------------
  // The SVG's internal viewBox coordinate system never changes, so the
  // rover/grid math below stays exactly the same at any screen size — this
  // only decides how large that fixed coordinate system is drawn on screen.
  function fitPlaneToContainer() {
    const wrap = svg.parentElement; // .plane-wrap
    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (availW <= 0 || availH <= 0) return;

    const scale = Math.min(availW / VIEW_W, availH / VIEW_H);
    const renderW = Math.max(1, Math.floor(VIEW_W * scale));
    const renderH = Math.max(1, Math.floor(VIEW_H * scale));

    svg.style.width = renderW + "px";
    svg.style.height = renderH + "px";
  }

  // ---- Coordinate <-> screen helpers --------------------------------------
  function toScreen(x, y) {
    return { sx: ORIGIN_X + x * UNIT, sy: ORIGIN_Y - y * UNIT };
  }

  function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key in attrs) node.setAttribute(key, attrs[key]);
    return node;
  }

  // ---- Build the static parts of the grid (runs once) ---------------------
  function buildGrid() {
    // Quadrant tints (four rectangles behind the grid lines)
    const q1 = toScreen(0, Y_MAX), q1b = toScreen(X_MAX, 0);
    const q2 = toScreen(X_MIN, Y_MAX), q2b = toScreen(0, 0);
    const q3 = toScreen(X_MIN, 0), q3b = toScreen(0, Y_MIN);
    const q4 = toScreen(0, 0), q4b = toScreen(X_MAX, Y_MIN);

    gTints.appendChild(el("rect", { x: q1.sx, y: q1.sy, width: q1b.sx - q1.sx, height: q1b.sy - q1.sy, class: "quadrant-tint-1" }));
    gTints.appendChild(el("rect", { x: q2.sx, y: q2.sy, width: q2b.sx - q2.sx, height: q2b.sy - q2.sy, class: "quadrant-tint-2" }));
    gTints.appendChild(el("rect", { x: q3.sx, y: q3.sy, width: q3b.sx - q3.sx, height: q3b.sy - q3.sy, class: "quadrant-tint-3" }));
    gTints.appendChild(el("rect", { x: q4.sx, y: q4.sy, width: q4b.sx - q4.sx, height: q4b.sy - q4.sy, class: "quadrant-tint-4" }));

    // Grid lines (every integer unit)
    for (let x = X_MIN; x <= X_MAX; x++) {
      const top = toScreen(x, Y_MAX), bottom = toScreen(x, Y_MIN);
      gGrid.appendChild(el("line", { x1: top.sx, y1: top.sy, x2: bottom.sx, y2: bottom.sy, class: "grid-line" }));
    }
    for (let y = Y_MIN; y <= Y_MAX; y++) {
      const left = toScreen(X_MIN, y), right = toScreen(X_MAX, y);
      gGrid.appendChild(el("line", { x1: left.sx, y1: left.sy, x2: right.sx, y2: right.sy, class: "grid-line" }));
    }

    // Axes (drawn slightly past the grid edge, with an arrowhead)
    const xAxisStart = toScreen(X_MIN, 0), xAxisEnd = toScreen(X_MAX, 0);
    const yAxisStart = toScreen(0, Y_MIN), yAxisEnd = toScreen(0, Y_MAX);

    gAxes.appendChild(el("line", { x1: xAxisStart.sx, y1: xAxisStart.sy, x2: xAxisEnd.sx, y2: xAxisEnd.sy, class: "axis-line" }));
    gAxes.appendChild(el("line", { x1: yAxisStart.sx, y1: yAxisStart.sy, x2: yAxisEnd.sx, y2: yAxisEnd.sy, class: "axis-line" }));

    // Arrowheads pointing toward positive x and positive y
    gAxes.appendChild(el("polygon", {
      points: `${xAxisEnd.sx},${xAxisEnd.sy} ${xAxisEnd.sx - 12},${xAxisEnd.sy - 6} ${xAxisEnd.sx - 12},${xAxisEnd.sy + 6}`,
      class: "axis-arrow"
    }));
    gAxes.appendChild(el("polygon", {
      points: `${yAxisEnd.sx},${yAxisEnd.sy} ${yAxisEnd.sx - 6},${yAxisEnd.sy + 12} ${yAxisEnd.sx + 6},${yAxisEnd.sy + 12}`,
      class: "axis-arrow"
    }));

    // Tick labels along each axis (skip 0, it's labelled at the origin instead)
    for (let x = X_MIN; x <= X_MAX; x++) {
      if (x === 0) continue;
      const p = toScreen(x, 0);
      gTicks.appendChild(el("text", { x: p.sx, y: p.sy + 16, class: "tick-label", "text-anchor": "middle" })).textContent = x;
    }
    for (let y = Y_MIN; y <= Y_MAX; y++) {
      if (y === 0) continue;
      const p = toScreen(0, y);
      gTicks.appendChild(el("text", { x: p.sx - 10, y: p.sy + 4, class: "tick-label", "text-anchor": "end" })).textContent = y;
    }

    // Origin marker + label
    const originScreen = toScreen(0, 0);
    gTicks.appendChild(el("circle", { cx: originScreen.sx, cy: originScreen.sy, r: 4, class: "origin-dot" }));
    gTicks.appendChild(el("text", {
      x: originScreen.sx - 8, y: originScreen.sy + 16, class: "tick-label", "text-anchor": "end"
    })).textContent = "0";

    // Quadrant labels (subtle, tucked into each corner)
    const labelPositions = [
      { text: "I", x: X_MAX - 1, y: Y_MAX - 1 },
      { text: "II", x: X_MIN + 1, y: Y_MAX - 1 },
      { text: "III", x: X_MIN + 1, y: Y_MIN + 1 },
      { text: "IV", x: X_MAX - 1, y: Y_MIN + 1 }
    ];
    labelPositions.forEach((l) => {
      const p = toScreen(l.x, l.y);
      gQuadLabels.appendChild(el("text", {
        x: p.sx, y: p.sy, class: "quadrant-label", "text-anchor": "middle"
      })).textContent = l.text;
    });

    buildRover();
  }

  // ---- Build the rover character (a small friendly rover) ----------------
  function buildRover() {
    gRover.setAttribute("id", "rover");
    const shape = el("g", { id: "rover-shape" });

    shape.appendChild(el("circle", { cx: 0, cy: 0, r: 20, class: "rover-glow" }));
    shape.appendChild(el("line", { x1: 0, y1: -14, x2: 0, y2: -22, class: "rover-antenna" }));
    shape.appendChild(el("circle", { cx: 0, cy: -22, r: 2.5, fill: "#d98e21" }));
    shape.appendChild(el("rect", { x: -13, y: -11, width: 26, height: 22, rx: 7, class: "rover-body" }));
    shape.appendChild(el("circle", { cx: 0, cy: -2, r: 6, class: "rover-window" }));
    shape.appendChild(el("circle", { cx: -9, cy: 11, r: 3.5, class: "rover-body" }));
    shape.appendChild(el("circle", { cx: 9, cy: 11, r: 3.5, class: "rover-body" }));

    gRover.appendChild(shape);
    positionRover();
  }

  function positionRover() {
    const p = toScreen(pos.x, pos.y);
    gRover.setAttribute("transform", `translate(${p.sx}, ${p.sy})`);
  }

  // ---- Guides (dashed lines from each axis to the rover) ------------------
  function renderGuides() {
    gGuides.innerHTML = "";
    if (pos.x === 0 && pos.y === 0) return; // nothing to guide at the origin

    const roverScreen = toScreen(pos.x, pos.y);
    const onXAxisPoint = toScreen(pos.x, 0);
    const onYAxisPoint = toScreen(0, pos.y);

    if (pos.y !== 0) {
      gGuides.appendChild(el("line", {
        x1: onYAxisPoint.sx, y1: onYAxisPoint.sy, x2: roverScreen.sx, y2: roverScreen.sy, class: "guide-line"
      }));
    }
    if (pos.x !== 0) {
      gGuides.appendChild(el("line", {
        x1: onXAxisPoint.sx, y1: onXAxisPoint.sy, x2: roverScreen.sx, y2: roverScreen.sy, class: "guide-line"
      }));
    }
  }

  // ---- Quadrant + explanation text ----------------------------------------
  function quadrantName(x, y) {
    if (x === 0 && y === 0) return "Origin";
    if (y === 0) return "On the x-axis";
    if (x === 0) return "On the y-axis";
    if (x > 0 && y > 0) return "Quadrant I";
    if (x < 0 && y > 0) return "Quadrant II";
    if (x < 0 && y < 0) return "Quadrant III";
    return "Quadrant IV";
  }

  function explanationText(x, y) {
    if (x === 0 && y === 0) {
      return "The rover is parked right on the origin, where the axes cross.";
    }
    const xPart = x === 0 ? "" : `move ${Math.abs(x)} unit${Math.abs(x) === 1 ? "" : "s"} ${x > 0 ? "right" : "left"} on the x-axis`;
    const yPart = y === 0 ? "" : `move ${Math.abs(y)} unit${Math.abs(y) === 1 ? "" : "s"} ${y > 0 ? "up" : "down"} on the y-axis`;
    if (xPart && yPart) return `From the origin, ${xPart}, then ${yPart}.`;
    return `From the origin, ${xPart || yPart}.`;
  }

  function movementSummary(x, y) {
    if (x === 0 && y === 0) return "You started and finished right on the origin.";
    const xPart = x === 0 ? "" : `${Math.abs(x)} unit${Math.abs(x) === 1 ? "" : "s"} ${x > 0 ? "right" : "left"}`;
    const yPart = y === 0 ? "" : `${Math.abs(y)} unit${Math.abs(y) === 1 ? "" : "s"} ${y > 0 ? "up" : "down"}`;
    if (xPart && yPart) return `You moved ${xPart} and ${yPart}.`;
    return `You moved ${xPart || yPart}.`;
  }

  // ---- Main render: sync all UI to the current state ----------------------
  function render() {
    elPosX.textContent = pos.x;
    elPosY.textContent = pos.y;
    elXValue.textContent = pos.x;
    elYValue.textContent = pos.y;
    elQuadrantName.textContent = quadrantName(pos.x, pos.y);
    elExplainText.textContent = explanationText(pos.x, pos.y);

    positionRover();
    renderGuides();

    if (challenge) {
      elChallengeCurrent.textContent = `(${pos.x}, ${pos.y})`;
      if (pos.x === challenge.x && pos.y === challenge.y) {
        handleChallengeSolved();
      }
    }
  }

  // ---- Movement -------------------------------------------------------------
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function move(dx, dy) {
    // Ignore input while the completion modal is up, or while a last-moment
    // target-change prank is transitioning — both are brief, self-resolving
    // moments where a move could otherwise race the challenge state.
    if (!celebrationOverlay.classList.contains("hidden")) return;
    if (lastMomentPrankActive) return;

    const normalNextX = clamp(pos.x + dx, X_MIN, X_MAX);
    const normalNextY = clamp(pos.y + dy, Y_MIN, Y_MAX);

    if (normalNextX === pos.x && normalNextY === pos.y) {
      // blocked by the edge of the grid — give a small bump for feedback.
      // A blocked move never pranks; there's nowhere for a prank to go.
      gRover.classList.add("bump");
      setTimeout(() => gRover.classList.remove("bump"), 300);
      playBoundarySound();
      showBoundaryToast();
      return;
    }

    // A prank is only ever considered when: a challenge is active, no other
    // prank is currently playing, we're not in the one-move grace period
    // right after starting a new challenge, and this normal move wouldn't
    // already land exactly on the target (so completion is never hijacked).
    const reachesTargetNormally = !!challenge && normalNextX === challenge.x && normalNextY === challenge.y;
    const grace = prankGraceMove;
    prankGraceMove = false;

    let outcome = null;
    if (challenge && !reachesTargetNormally && !prankActive && !grace && Math.random() < PRANK_CHANCE) {
      outcome = computePrankOutcome(dx, dy, pos.x, pos.y);
    }

    if (outcome) {
      pos = { x: outcome.x, y: outcome.y };
      runPrankMovement(outcome, dx, dy);
    } else {
      pos = { x: normalNextX, y: normalNextY };
      playMoveSound();
    }

    render();

    // Completion is checked and resolved inside render() (it nulls
    // `challenge` when solved), so this only ever runs for an unsolved,
    // still-active challenge — satisfying "completion check happens before
    // the prank check". Skipped on a move that just ran a movement prank,
    // so the two prank systems never animate on top of each other.
    if (challenge && !outcome) {
      maybeTriggerLastMomentPrank();
    }
  }

  function resetPosition() {
    pos = { x: 0, y: 0 };
    cancelActivePrank();
    render();
  }

  // ---- Prank system -------------------------------------------------------
  // Occasionally, during an active challenge, a movement press produces an
  // unexpected result instead of the normal single step: the rover skips
  // extra squares, moves the wrong way, or takes an extra step. The prank
  // NEVER changes the target, NEVER hides the true coordinate, and NEVER
  // pushes the rover outside the grid — it only ever changes which square
  // a single button press lands on. Tune the chances below as needed.
  const PRANK_CHANCE = 0.12;             // ~12% of valid moves during a challenge
  const SKIP_CHANCE = 0.50;              // within a prank: skip extra squares forward
  const WRONG_DIRECTION_CHANCE = 0.30;   // within a prank: move the opposite way
  const EXTRA_STEP_CHANCE = 0.20;        // within a prank: one extra step forward
  const RARE_TRIPLE_SKIP_CHANCE = 0.15;  // within a skip: rarely skip two extra squares

  let prankActive = false;     // true while a prank's animation/message is playing
  let prankGraceMove = false;  // true for the first move after "New challenge"
  let prankTimer = null;       // clears the animation class + prankActive flag

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  const PRANK_MESSAGES = {
    skip: ["😂 Oops! I got carried away!", "🌀 I got confused!", "😅 That wasn't supposed to happen!"],
    wrongDirection: ["🤪 Hey! I went the wrong way!", "😈 Hehe... got you!", "🤖 My robot brain glitched!"],
    extraStep: ["🚀 Too much energy!", "😂 Oops! I skipped a step!", "🚀 Too fast!"]
  };

  // Works out whether this particular move should be a prank, and if so,
  // where it actually lands. Returns null if the roll picks a prank that
  // would push the rover off the grid — in that case the caller falls back
  // to the normal single-step move instead of cancelling movement entirely.
  function computePrankOutcome(dx, dy, x0, y0) {
    const roll = Math.random();
    const type = roll < SKIP_CHANCE
      ? "skip"
      : roll < SKIP_CHANCE + WRONG_DIRECTION_CHANCE
        ? "wrongDirection"
        : "extraStep";

    let magnitude;
    if (type === "skip") {
      magnitude = Math.random() < RARE_TRIPLE_SKIP_CHANCE ? 3 : 2;
    } else if (type === "extraStep") {
      magnitude = 2;
    } else {
      magnitude = 1; // wrong-direction: one full step the other way
    }

    const stepDx = type === "wrongDirection" ? -dx : dx;
    const stepDy = type === "wrongDirection" ? -dy : dy;

    const rawX = x0 + stepDx * magnitude;
    const rawY = y0 + stepDy * magnitude;
    const clampedX = clamp(rawX, X_MIN, X_MAX);
    const clampedY = clamp(rawY, Y_MIN, Y_MAX);

    // The prank would run off the edge of the grid — cancel it so the
    // caller performs a normal move instead.
    if (clampedX !== rawX || clampedY !== rawY) return null;

    return { type, x: clampedX, y: clampedY, message: pickRandom(PRANK_MESSAGES[type]) };
  }

  function prankAnimationClass(type) {
    if (type === "skip") return "prank-skip";
    if (type === "wrongDirection") return "prank-wrong";
    return "prank-extra";
  }

  function prankSoundKind(type) {
    if (type === "skip") return "whoosh";
    if (type === "wrongDirection") return "oops";
    return "boing";
  }

  function runPrankMovement(outcome, dx, dy) {
    prankActive = true;
    const animClass = prankAnimationClass(outcome.type);
    gRover.classList.add(animClass);
    playPrankSound(prankSoundKind(outcome.type));
    showPrankToast(outcome.message, 1400);

    clearTimeout(prankTimer);
    prankTimer = setTimeout(() => {
      gRover.classList.remove(animClass);
      prankActive = false;
    }, 500);
  }

  // Used by Reset / giving up on a challenge, so a prank mid-animation never
  // gets left in a stuck visual state when the player jumps away from it.
  function cancelActivePrank() {
    clearTimeout(prankTimer);
    gRover.classList.remove("prank-skip", "prank-wrong", "prank-extra", "prank-surprised");
    gTarget.classList.remove("target-shake");
    prankActive = false;
    lastMomentPrankActive = false;
    prankToast.classList.remove("show");
  }

  // ---- Last-moment target-change prank -------------------------------------
  // A separate, rarer prank: only considered once the student is genuinely
  // close to the target, and at most once per challenge. It never touches
  // the rover's coordinate — it only ever swaps out the target the student
  // is solving for, and only on a move that didn't already reach it.
  const LAST_MOMENT_DISTANCE = 2;          // Manhattan-distance threshold to be "close"
  const LAST_MOMENT_PRANK_CHANCE = 0.30;   // ~30% chance, each qualifying move, until it fires once

  let lastMomentPrankUsed = false;   // caps this at one per challenge
  let lastMomentPrankActive = false; // true while the target-change transition is running

  const CLOSE_MESSAGES = ["🔥 SO CLOSE!", "😎 Almost there!"];
  const PLOT_TWIST_MESSAGES = [
    "😂 HAHA! Not so fast!",
    "😈 Gotcha!",
    "🤪 Plot twist!",
    "🚨 NEW MISSION!",
    "👀 You thought you were done!",
    "🧠 Pay attention!"
  ];

  function maybeTriggerLastMomentPrank() {
    if (!challenge || lastMomentPrankUsed || lastMomentPrankActive) return;

    const distance = Math.abs(pos.x - challenge.x) + Math.abs(pos.y - challenge.y);
    if (distance > LAST_MOMENT_DISTANCE) return;

    showPrankToast(pickRandom(CLOSE_MESSAGES), 1000);

    if (Math.random() < LAST_MOMENT_PRANK_CHANCE) {
      lastMomentPrankActive = true;
      setTimeout(runLastMomentPrank, 700);
    }
  }

  function runLastMomentPrank() {
    // The challenge may have ended (completed / given up) during the short
    // delay above — bail out cleanly rather than reviving it.
    if (!challenge) { lastMomentPrankActive = false; return; }

    lastMomentPrankUsed = true;
    showPrankToast("🚨 PLOT TWIST! 🚨", 950);
    playPrankSound("plotTwist");
    gTarget.classList.add("target-shake");

    setTimeout(() => {
      gTarget.classList.remove("target-shake");

      if (!challenge) { lastMomentPrankActive = false; return; }

      // A brand-new target: inside the grid, different from the old one,
      // and not the student's current square. The rover's coordinate is
      // never touched here.
      const oldX = challenge.x, oldY = challenge.y;
      let tx, ty;
      do {
        tx = Math.floor(Math.random() * (X_MAX - X_MIN + 1)) + X_MIN;
        ty = Math.floor(Math.random() * (Y_MAX - Y_MIN + 1)) + Y_MIN;
      } while ((tx === oldX && ty === oldY) || (tx === pos.x && ty === pos.y));

      challenge = { x: tx, y: ty };
      elChallengeTarget.textContent = `(${tx}, ${ty})`;
      drawTargetMarker(tx, ty, true);

      gRover.classList.add("prank-surprised");
      setTimeout(() => gRover.classList.remove("prank-surprised"), 500);

      showPrankToast(pickRandom(PLOT_TWIST_MESSAGES), 1700);
      lastMomentPrankActive = false;
    }, 500);
  }

  // ---- Challenge mode ---------------------------------------------------------
  function startChallenge() {
    let tx, ty;
    do {
      tx = Math.floor(Math.random() * (X_MAX - X_MIN + 1)) + X_MIN;
      ty = Math.floor(Math.random() * (Y_MAX - Y_MIN + 1)) + Y_MIN;
    } while (tx === pos.x && ty === pos.y);

    challenge = { x: tx, y: ty };
    cancelActivePrank();
    prankGraceMove = true; // no prank on the very next move after "New challenge"
    lastMomentPrankUsed = false;

    elChallengeIdle.classList.add("hidden");
    elChallengeSuccess.classList.add("hidden");
    elChallengeActive.classList.remove("hidden");
    elChallengeTarget.textContent = `(${tx}, ${ty})`;
    elChallengeCurrent.textContent = `(${pos.x}, ${pos.y})`;
    btnChallenge.textContent = "Give up on this one";

    drawTargetMarker(tx, ty);
  }

  function drawTargetMarker(x, y, popIn) {
    gTarget.innerHTML = "";
    gTarget.classList.remove("hidden");
    const p = toScreen(x, y);
    const ringClass = popIn ? "target-ring target-pop" : "target-ring";
    gTarget.appendChild(el("circle", { cx: p.sx, cy: p.sy, r: 14, class: ringClass }));
  }

  function clearTargetMarker() {
    gTarget.innerHTML = "";
    gTarget.classList.add("hidden");
  }

  function handleChallengeSolved() {
    const solved = challenge;
    challenge = null;
    cancelActivePrank();
    clearTargetMarker();

    elChallengeActive.classList.add("hidden");
    elChallengeSuccess.classList.remove("hidden");
    elSuccessText.textContent = "✅ Completed!";
    btnChallenge.textContent = "🎯 New challenge";

    gRover.classList.add("celebrate");
    setTimeout(() => gRover.classList.remove("celebrate"), 700);

    celebrationResult.textContent = `Excellent! You reached (${solved.x}, ${solved.y})!`;
    celebrationHowto.textContent = movementSummary(solved.x, solved.y);
    celebrationOverlay.classList.remove("hidden");

    launchConfetti();
    playSuccessSound();
    speak("Excellent! Challenge completed!");
  }

  function closeCelebration() {
    celebrationOverlay.classList.add("hidden");
    stopConfetti();
  }

  function onChallengeButtonClick() {
    if (challenge) {
      // giving up on the current one — just clear it and go idle
      challenge = null;
      cancelActivePrank();
      clearTargetMarker();
      elChallengeActive.classList.add("hidden");
      elChallengeIdle.classList.remove("hidden");
      elChallengeSuccess.classList.add("hidden");
      btnChallenge.textContent = "New challenge";
      return;
    }
    startChallenge();
  }

  // ---- Wire up controls -----------------------------------------------------
  btnUp.addEventListener("click", () => move(0, 1));
  btnDown.addEventListener("click", () => move(0, -1));
  btnLeft.addEventListener("click", () => move(-1, 0));
  btnRight.addEventListener("click", () => move(1, 0));
  btnReset.addEventListener("click", resetPosition);
  btnChallenge.addEventListener("click", onChallengeButtonClick);
  btnNextChallenge.addEventListener("click", () => {
    closeCelebration();
    startChallenge();
  });
  btnKeepExploring.addEventListener("click", closeCelebration);

  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp": e.preventDefault(); move(0, 1); break;
      case "ArrowDown": e.preventDefault(); move(0, -1); break;
      case "ArrowLeft": e.preventDefault(); move(-1, 0); break;
      case "ArrowRight": e.preventDefault(); move(1, 0); break;
      default: break;
    }
  });

  // ---- Init -------------------------------------------------------------------
  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  buildGrid();
  render();
  fitPlaneToContainer();

  // Keep the plane sized to its container whenever that container changes —
  // window resize, orientation change, or the mobile browser chrome
  // (address bar) showing/hiding all count.
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(() => fitPlaneToContainer());
    resizeObserver.observe(svg.parentElement);
  } else {
    window.addEventListener("resize", fitPlaneToContainer);
  }
  window.addEventListener("orientationchange", () => {
    // Give the browser a moment to settle the new viewport before measuring.
    setTimeout(fitPlaneToContainer, 100);
  });
})();
