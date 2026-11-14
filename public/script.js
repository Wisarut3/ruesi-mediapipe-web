// ─── State ────────────────────────────────────────────────────────────────────
let selectedPoseKey = null;
let posesData = {};
let ttsEnabled = false;
let lastSpokenAt = 0;
const TTS_DEBOUNCE_MS = 3000;

// Pose Hold Timer State (R1, R2, R3)
let targetHoldDuration = 10;
let holdStartTime = null;
let isHolding = false;
let isCompleted = false;
let autoAdvanceEnabled = false;
let autoAdvanceTimer = null;
const completedPoses = new Set();

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const videoEl            = typeof document !== 'undefined' ? document.getElementById('webcam') : null;
const canvasEl           = typeof document !== 'undefined' ? document.getElementById('output-canvas') : null;
const ctx                = canvasEl && canvasEl.getContext ? canvasEl.getContext('2d') : null;
const cameraStatusEl     = typeof document !== 'undefined' ? document.getElementById('camera-status') : null;
const poseListEl         = typeof document !== 'undefined' ? document.getElementById('pose-list') : null;
const statusCardEl       = typeof document !== 'undefined' ? document.getElementById('status-card') : null;
const poseLabelEl        = typeof document !== 'undefined' ? document.getElementById('pose-label') : null;
const adviceEl           = typeof document !== 'undefined' ? document.getElementById('advice') : null;
const angleOverlayEl     = typeof document !== 'undefined' ? document.getElementById('angle-overlay') : null;
const angleListEl        = typeof document !== 'undefined' ? document.getElementById('angle-readings') : null;
const ttsBtn             = typeof document !== 'undefined' ? document.getElementById('tts-toggle') : null;
const timerDisplayEl     = typeof document !== 'undefined' ? document.getElementById('timer-display') : null;
const timerCountEl       = typeof document !== 'undefined' ? document.getElementById('timer-count') : null;
const timerTargetEl      = typeof document !== 'undefined' ? document.getElementById('timer-target') : null;
const timerProgressBarEl = typeof document !== 'undefined' ? document.getElementById('timer-progress-bar') : null;
const durationInputEl    = typeof document !== 'undefined' ? document.getElementById('duration-input') : null;
const autoAdvanceToggle  = typeof document !== 'undefined' ? document.getElementById('auto-advance-toggle') : null;

// ─── Load Poses ───────────────────────────────────────────────────────────────
if (typeof fetch === 'function') {
  fetch('poses.json')
    .then(r => r.json())
    .then(data => {
      posesData = data;
      renderPoseButtons();
    })
    .catch(() => {
      if (poseListEl) poseListEl.innerHTML = '<p style="color:#fca5a5">โหลด poses.json ไม่ได้</p>';
    });
}

function renderPoseButtons() {
  if (!poseListEl) return;
  poseListEl.innerHTML = '';
  Object.entries(posesData).forEach(([key, pose]) => {
    const btn = document.createElement('button');
    btn.className = 'pose-btn';
    btn.dataset.poseKey = key;
    btn.setAttribute('data-pose-key', key);
    if (completedPoses.has(key)) {
      btn.classList.add('completed');
    }
    btn.innerHTML = `
      <span class="pose-name">${pose.name}</span>
      <span class="pose-desc">${pose.description}</span>
    `;
    btn.addEventListener('click', () => selectPose(key, btn));
    poseListEl.appendChild(btn);
  });
}

function selectPose(key, btn) {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  resetHoldTimer();
  isCompleted = false;
  selectedPoseKey = key;

  if (typeof document !== 'undefined') {
    document.querySelectorAll('.pose-btn').forEach(b => b.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    } else {
      const matchedBtn = document.querySelector(`.pose-btn[data-pose-key="${key}"]`);
      if (matchedBtn) matchedBtn.classList.add('active');
    }
  }

  if (statusCardEl) statusCardEl.className = 'status-card waiting';
  if (poseLabelEl) poseLabelEl.textContent = posesData[key] ? posesData[key].name : key;
  if (adviceEl) adviceEl.textContent = 'กำลังวิเคราะห์ท่าทาง...';
  if (angleOverlayEl) angleOverlayEl.innerHTML = '';
  if (angleListEl) angleListEl.innerHTML = '';
  updateTimerUI(0);
}

// ─── Timer Functions (R1, R2, R3) ─────────────────────────────────────────────
function resetHoldTimer() {
  isHolding = false;
  holdStartTime = null;
}

function updateTimerUI(seconds) {
  const current = Math.max(0, Math.min(targetHoldDuration, seconds));
  const s = Math.floor(current);
  if (timerCountEl) timerCountEl.textContent = s;
  if (timerTargetEl) timerTargetEl.textContent = targetHoldDuration;
  if (timerProgressBarEl) {
    const pct = targetHoldDuration > 0 ? (current / targetHoldDuration) * 100 : 0;
    timerProgressBarEl.style.width = `${Math.min(100, pct)}%`;
  }
}

function onPoseComplete() {
  if (statusCardEl) statusCardEl.className = 'status-card correct completed';
  if (adviceEl) adviceEl.textContent = '🎉 ท่าทางสำเร็จ! ยอดเยี่ยมมาก';
  updateTimerUI(targetHoldDuration);

  completedPoses.add(selectedPoseKey);

  if (typeof document !== 'undefined') {
    const activeBtn = document.querySelector(`.pose-btn[data-pose-key="${selectedPoseKey}"]`);
    if (activeBtn) {
      activeBtn.classList.add('completed');
    }
  }

  // Announce completion bypassing debounce (R2)
  speak('ท่าทางสำเร็จ!', true);

  // Auto-advance to next pose if setting is enabled (R2)
  if (autoAdvanceEnabled) {
    const keys = Object.keys(posesData);
    const currIdx = keys.indexOf(selectedPoseKey);
    if (currIdx !== -1 && keys.length > 1) {
      const nextIdx = (currIdx + 1) % keys.length;
      const nextKey = keys[nextIdx];
      autoAdvanceTimer = setTimeout(() => {
        autoAdvanceTimer = null;
        const nextBtn = typeof document !== 'undefined' ?
          document.querySelector(`.pose-btn[data-pose-key="${nextKey}"]`) : null;
        selectPose(nextKey, nextBtn);
      }, 1200);
    }
  }
}

// ─── Settings Listeners (R2, R3) ──────────────────────────────────────────────
if (durationInputEl) {
  const handleDurationChange = (e) => {
    let val = parseInt(e.target.value, 10);
    if (isNaN(val) || val < 1) val = 1;
    targetHoldDuration = val;
    e.target.value = val;
    if (timerTargetEl) timerTargetEl.textContent = targetHoldDuration;
    resetHoldTimer();
    isCompleted = false;
    updateTimerUI(0);
  };
  durationInputEl.addEventListener('input', handleDurationChange);
  durationInputEl.addEventListener('change', handleDurationChange);
}

if (autoAdvanceToggle) {
  autoAdvanceToggle.addEventListener('change', (e) => {
    autoAdvanceEnabled = Boolean(e.target.checked);
    if (!autoAdvanceEnabled && autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
  });
}

// ─── TTS ──────────────────────────────────────────────────────────────────────
if (ttsBtn) {
  ttsBtn.addEventListener('click', () => {
    ttsEnabled = !ttsEnabled;
    ttsBtn.textContent = ttsEnabled ? '🔊 เสียงแนะนำ: เปิด' : '🔊 เสียงแนะนำ: ปิด';
  });
}

function speak(text, bypassDebounce = false) {
  if (!ttsEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const now = Date.now();
  if (!bypassDebounce && (now - lastSpokenAt < TTS_DEBOUNCE_MS)) return;
  lastSpokenAt = now;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'th-TH';
  window.speechSynthesis.speak(u);
}

// ─── Angle Calculation ────────────────────────────────────────────────────────
// Calculates the interior angle (degrees) at point B in the triangle A-B-C
function calcAngle(A, B, C) {
  if (typeof PoseEvaluator !== 'undefined' && PoseEvaluator.calcAngle) {
    return PoseEvaluator.calcAngle(A, B, C);
  }
  const radians =
    Math.atan2(C.y - B.y, C.x - B.x) -
    Math.atan2(A.y - B.y, A.x - B.x);
  let angle = Math.abs(radians * 180 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return Math.round(angle);
}

// ─── Pose Evaluation ──────────────────────────────────────────────────────────
function evaluatePose(landmarks) {
  const pose = posesData[selectedPoseKey];
  if (!pose) return;

  let allCorrect = true;
  const overlayChips = [];
  const listRows = [];
  const feedbacks = [];

  pose.rules.forEach(rule => {
    const res = (typeof PoseEvaluator !== 'undefined' && PoseEvaluator.evaluateRule)
      ? PoseEvaluator.evaluateRule(rule, landmarks)
      : (() => {
          const [ai, bi, ci] = rule.landmarks;
          const A = landmarks[ai];
          const B = landmarks[bi];
          const C = landmarks[ci];
          const lowVis = !A || !B || !C || A.visibility < 0.5 || B.visibility < 0.5 || C.visibility < 0.5;
          if (lowVis) return { rule, ok: false, lowVis: true, angle: null, feedback: 'ไม่เห็นชัด' };
          const angle = calcAngle(A, B, C);
          const ok = angle >= rule.min && angle <= rule.max;
          return { rule, ok, lowVis: false, angle, feedback: ok ? null : (angle < rule.min ? rule.feedback_low : rule.feedback_high) };
        })();

    if (res.lowVis) {
      overlayChips.push(`<div class="chip low-vis">${rule.label}: ?°</div>`);
      listRows.push(`<div class="row"><span class="key">${rule.label}</span><span class="val">ไม่เห็นชัด</span></div>`);
      allCorrect = false;
      return;
    }

    if (!res.ok) {
      allCorrect = false;
      if (res.feedback) {
        feedbacks.push(res.feedback);
      }
    }

    const cls = res.ok ? 'ok' : 'bad';
    overlayChips.push(`<div class="chip ${cls}">${rule.label}: ${res.angle}°</div>`);
    listRows.push(`<div class="row ${cls}"><span class="key">${rule.label}</span><span class="val">${res.angle}° <small>(${rule.min}–${rule.max})</small></span></div>`);
  });

  // Update overlays
  if (angleOverlayEl) angleOverlayEl.innerHTML = overlayChips.join('');
  if (angleListEl) angleListEl.innerHTML = listRows.join('');

  // Update status card & hold timer logic (R1, R2, R3)
  if (allCorrect) {
    if (!isCompleted) {
      if (statusCardEl) statusCardEl.className = 'status-card correct';
      const now = Date.now();
      if (!isHolding) {
        isHolding = true;
        holdStartTime = now;
      }
      const elapsed = (now - holdStartTime) / 1000;
      updateTimerUI(elapsed);

      if (elapsed >= targetHoldDuration) {
        isCompleted = true;
        isHolding = false;
        onPoseComplete();
      } else {
        const msg = `ท่าทางถูกต้อง! ค้างท่าไว้ ${targetHoldDuration} วินาที และหายใจเข้า-ออกช้าๆ`;
        if (adviceEl) adviceEl.textContent = msg;
        speak(msg);
      }
    } else {
      if (statusCardEl) statusCardEl.className = 'status-card correct completed';
      updateTimerUI(targetHoldDuration);
    }
  } else {
    if (statusCardEl) statusCardEl.className = 'status-card incorrect';
    resetHoldTimer();
    isCompleted = false;
    updateTimerUI(0);
    const msg = feedbacks.join(' และ ') || 'ปรับท่าทางตามคำแนะนำ';
    if (adviceEl) adviceEl.textContent = msg;
    speak(msg);
  }
}

// ─── MediaPipe Pose Setup ─────────────────────────────────────────────────────
let pose = null;
if (typeof Pose !== 'undefined') {
  pose = new Pose({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });

  pose.setOptions({
    modelComplexity: 1,       // 0=lite, 1=full, 2=heavy
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  pose.onResults(results => {
    if (!canvasEl || !videoEl) return;
    // Sync canvas size to video
    canvasEl.width  = videoEl.videoWidth  || 640;
    canvasEl.height = videoEl.videoHeight || 480;

    ctx.save();
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

    // Mirror the canvas so the user sees themselves naturally (like a mirror)
    ctx.translate(canvasEl.width, 0);
    ctx.scale(-1, 1);

    // Draw camera frame
    ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);

    if (results.poseLandmarks) {
      // Draw skeleton
      if (typeof drawConnectors !== 'undefined' && typeof POSE_CONNECTIONS !== 'undefined') {
        drawConnectors(ctx, results.poseLandmarks, POSE_CONNECTIONS, {
          color: '#38bdf8', lineWidth: 3
        });
      }
      if (typeof drawLandmarks !== 'undefined') {
        drawLandmarks(ctx, results.poseLandmarks, {
          color: '#f43f5e', lineWidth: 2, radius: 5
        });
      }

      ctx.restore();

      // Evaluate against selected pose rules
      if (selectedPoseKey) {
        evaluatePose(results.poseLandmarks);
      }
    } else {
      ctx.restore();
      if (selectedPoseKey) {
        if (angleOverlayEl) angleOverlayEl.innerHTML = '<div class="chip low-vis">ไม่พบตัวบุคคล</div>';
        resetHoldTimer();
        isCompleted = false;
        updateTimerUI(0);
        if (statusCardEl) statusCardEl.className = 'status-card waiting';
        if (adviceEl) adviceEl.textContent = 'ไม่พบตัวบุคคล กรุณากลับมายืนในระยะกล้อง';
      }
    }
  });
}

// ─── Camera ───────────────────────────────────────────────────────────────────
if (typeof Camera !== 'undefined' && videoEl && pose) {
  const camera = new Camera(videoEl, {
    onFrame: async () => {
      await pose.send({ image: videoEl });
    },
    width: 640,
    height: 480,
  });

  camera.start()
    .then(() => {
      if (cameraStatusEl) {
        cameraStatusEl.textContent = '📷 กล้องพร้อม';
        cameraStatusEl.className = 'badge connected';
      }
    })
    .catch(err => {
      if (cameraStatusEl) {
        cameraStatusEl.textContent = `❌ กล้องไม่พร้อม: ${err.message}`;
        cameraStatusEl.className = 'badge disconnected';
      }
    });
}

// ─── Exports for Testing ──────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calcAngle,
    evaluatePose,
    speak,
    selectPose,
    resetHoldTimer,
    updateTimerUI,
    onPoseComplete,
    renderPoseButtons,
    getState: () => ({
      selectedPoseKey,
      posesData,
      ttsEnabled,
      lastSpokenAt,
      targetHoldDuration,
      holdStartTime,
      isHolding,
      isCompleted,
      autoAdvanceEnabled,
      autoAdvanceTimer,
      completedPoses,
    }),
    setState: (updates) => {
      if (updates.selectedPoseKey !== undefined) selectedPoseKey = updates.selectedPoseKey;
      if (updates.posesData !== undefined) posesData = updates.posesData;
      if (updates.ttsEnabled !== undefined) ttsEnabled = updates.ttsEnabled;
      if (updates.lastSpokenAt !== undefined) lastSpokenAt = updates.lastSpokenAt;
      if (updates.targetHoldDuration !== undefined) targetHoldDuration = updates.targetHoldDuration;
      if (updates.holdStartTime !== undefined) holdStartTime = updates.holdStartTime;
      if (updates.isHolding !== undefined) isHolding = updates.isHolding;
      if (updates.isCompleted !== undefined) isCompleted = updates.isCompleted;
      if (updates.autoAdvanceEnabled !== undefined) autoAdvanceEnabled = updates.autoAdvanceEnabled;
      if (updates.autoAdvanceTimer !== undefined) autoAdvanceTimer = updates.autoAdvanceTimer;
    }
  };
}
