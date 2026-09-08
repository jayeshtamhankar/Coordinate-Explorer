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
    const nextX = clamp(pos.x + dx, X_MIN, X_MAX);
    const nextY = clamp(pos.y + dy, Y_MIN, Y_MAX);

    if (nextX === pos.x && nextY === pos.y) {
      // blocked by the edge of the grid — give a small bump for feedback
      gRover.classList.add("bump");
      setTimeout(() => gRover.classList.remove("bump"), 300);
      playBoundarySound();
      showBoundaryToast();
      return;
    }

    pos = { x: nextX, y: nextY };
    playMoveSound();
    render();
  }

  function resetPosition() {
    pos = { x: 0, y: 0 };
    render();
  }

  // ---- Challenge mode ---------------------------------------------------------
  function startChallenge() {
    let tx, ty;
    do {
      tx = Math.floor(Math.random() * (X_MAX - X_MIN + 1)) + X_MIN;
      ty = Math.floor(Math.random() * (Y_MAX - Y_MIN + 1)) + Y_MIN;
    } while (tx === pos.x && ty === pos.y);

    challenge = { x: tx, y: ty };

    elChallengeIdle.classList.add("hidden");
    elChallengeSuccess.classList.add("hidden");
    elChallengeActive.classList.remove("hidden");
    elChallengeTarget.textContent = `(${tx}, ${ty})`;
    elChallengeCurrent.textContent = `(${pos.x}, ${pos.y})`;
    btnChallenge.textContent = "Give up on this one";

    drawTargetMarker(tx, ty);
  }

  function drawTargetMarker(x, y) {
    gTarget.innerHTML = "";
    gTarget.classList.remove("hidden");
    const p = toScreen(x, y);
    gTarget.appendChild(el("circle", { cx: p.sx, cy: p.sy, r: 14, class: "target-ring" }));
  }

  function clearTargetMarker() {
    gTarget.innerHTML = "";
    gTarget.classList.add("hidden");
  }

  function handleChallengeSolved() {
    const solved = challenge;
    challenge = null;
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
  buildGrid();
  render();
})();
