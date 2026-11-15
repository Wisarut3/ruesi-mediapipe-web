// ─── Evaluator Dependency ─────────────────────────────────────────────────────
let poseEvaluatorModule = (typeof PoseEvaluator !== 'undefined') ? PoseEvaluator : null;
if (!poseEvaluatorModule && typeof require === 'function') {
  try {
    poseEvaluatorModule = require('./pose-evaluator.js');
  } catch (e) {}
}

// ─── State ────────────────────────────────────────────────────────────────────
let selectedPoseKey = null;
let posesData = {};
if (typeof require === 'function') {
  try {
    posesData = require('./poses.json');
  } catch (e) {}
}
let ttsEnabled = false;
let lastSpokenAt = 0;
const TTS_DEBOUNCE_MS = 3000;

// Pose Hold Timer State (R1, R2, R3)
const GRACE_PERIOD_MS = 450;
let targetHoldDuration = 10;
let holdStartTime = null;
let lastFormBreakTime = null;
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
const healthInfoCardEl     = typeof document !== 'undefined' ? document.getElementById('health-info-card') : null;
const healthBenefitsListEl = typeof document !== 'undefined' ? document.getElementById('health-benefits-list') : null;
const cautionElderlyEl     = typeof document !== 'undefined' ? document.getElementById('caution-elderly-text') : null;
const cautionPregnantEl    = typeof document !== 'undefined' ? document.getElementById('caution-pregnant-text') : null;
const cautionGeneralEl     = typeof document !== 'undefined' ? document.getElementById('caution-general-text') : null;
const poseRefCardEl        = typeof document !== 'undefined' ? (document.getElementById('pose-reference-card') || document.querySelector('.pose-reference-card')) : null;
const poseRefImgEl         = typeof document !== 'undefined' ? (document.getElementById('reference-pose-img') || document.getElementById('pose-ref-img')) : null;
const poseRefCaptionEl     = typeof document !== 'undefined' ? document.getElementById('pose-ref-caption') : null;
const poseRefHudEl         = typeof document !== 'undefined' ? (document.getElementById('pose-guide-pip') || document.getElementById('pose-ref-hud')) : null;
const refHudImgEl          = typeof document !== 'undefined' ? (document.getElementById('pose-guide-img') || document.getElementById('ref-hud-img')) : null;
const poseGuidePipToggleEl = typeof document !== 'undefined' ? document.getElementById('pose-guide-pip-toggle') : null;
const poseGuidanceTipEl    = typeof document !== 'undefined' ? (document.getElementById('pose-guidance-tip') || document.querySelector('.pose-guidance-tip')) : null;

// Contextual Guidance Tip Configuration (R4)
const ANGLED_GUIDANCE_POSES = ['kae_kiat_forward', 'kae_kiat_left', 'kae_kiat_right'];
const GUIDANCE_TIP_TEXT = '💡 คำแนะนำ: ยืนเอียงเฉียง 30°–45° กับกล้อง เพื่อให้กล้องจับความยาวแขนได้ชัดเจนที่สุด';

function updateGuidanceTipUI(poseKey) {
  const el = (typeof document !== 'undefined' && (document.getElementById('pose-guidance-tip') || document.querySelector('.pose-guidance-tip'))) || poseGuidanceTipEl;
  if (!el) return;

  if (ANGLED_GUIDANCE_POSES.includes(poseKey)) {
    el.textContent = GUIDANCE_TIP_TEXT;
    el.style.display = 'flex';
    if (el.classList) el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.style.display = 'none';
    if (el.classList) el.classList.add('hidden');
  }
}

// ─── Load Poses ───────────────────────────────────────────────────────────────
if (typeof fetch === 'function') {
  fetch('poses.json')
    .then(r => r.json())
    .then(data => {
      posesData = data;
      renderPoseButtons();
      updateHealthInfoUI(selectedPoseKey ? posesData[selectedPoseKey] : null);
      updateVisualReferenceUI(selectedPoseKey ? posesData[selectedPoseKey] : null);
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
      <span class="pose-name">${escapeHtml(pose.name)}</span>
      <span class="pose-desc">${escapeHtml(pose.description)}</span>
    `;
    btn.addEventListener('click', () => selectPose(key, btn));
    poseListEl.appendChild(btn);
  });
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function updateVisualReferenceUI(pose) {
  const fallbackSrc = 'images/poses/placeholder.svg';
  const targetSrc = (pose && pose.image) ? pose.image : fallbackSrc;
  const targetAlt = (pose && pose.image_alt) ? pose.image_alt : (pose && pose.name ? `ภาพ ${pose.name}` : 'ภาพท่าทางต้นแบบ');

  const refImgs = [
    typeof document !== 'undefined' ? document.getElementById('reference-pose-img') : null,
    typeof document !== 'undefined' ? document.getElementById('pose-ref-img') : null,
    typeof document !== 'undefined' ? document.getElementById('pose-guide-img') : null,
    typeof document !== 'undefined' ? document.getElementById('ref-hud-img') : null,
    poseRefImgEl,
    refHudImgEl
  ].filter(Boolean);

  // Eliminate duplicates if any
  const uniqueImgs = Array.from(new Set(refImgs));
  uniqueImgs.forEach(img => {
    img.src = targetSrc;
    img.alt = targetAlt;
    img.onerror = () => {
      img.onerror = null;
      img.src = fallbackSrc;
    };
  });

  const refCaption = (typeof document !== 'undefined' && document.getElementById('pose-ref-caption')) || poseRefCaptionEl;
  if (refCaption) {
    if (pose && pose.name) {
      refCaption.textContent = pose.name.includes('—') ? pose.name.split('—')[1].trim() : pose.name;
    } else {
      refCaption.textContent = 'รอเลือกท่า...';
    }
  }

  const refTitle = typeof document !== 'undefined' ? document.getElementById('reference-pose-title') : null;
  if (refTitle) {
    refTitle.textContent = pose ? pose.name : 'เลือกท่าทางเพื่อดูภาพตัวอย่าง';
  }

  const refDesc = typeof document !== 'undefined' ? document.getElementById('reference-pose-desc') : null;
  if (refDesc) {
    refDesc.textContent = pose ? pose.description : 'แสดงสรีระและมุมเป้าหมายตามแบบแผนฤๅษีดัดตน';
  }

  const guideLabel = typeof document !== 'undefined' ? document.getElementById('pose-guide-label') : null;
  if (guideLabel && pose) {
    guideLabel.textContent = '🧘 ท่าต้นแบบ';
  }
}

function updateHealthInfoUI(pose) {
  const benefitsListEl = (typeof document !== 'undefined' && document.getElementById('health-benefits-list')) || healthBenefitsListEl;
  const cautionElderly = (typeof document !== 'undefined' && document.getElementById('caution-elderly-text')) || cautionElderlyEl;
  const cautionPregnant = (typeof document !== 'undefined' && document.getElementById('caution-pregnant-text')) || cautionPregnantEl;
  const cautionGeneral = (typeof document !== 'undefined' && document.getElementById('caution-general-text')) || cautionGeneralEl;

  if (!pose || !pose.health_context) {
    if (benefitsListEl) {
      benefitsListEl.innerHTML = pose ? '<li>ไม่มีข้อมูลทางสุขภาพ</li>' : '<li>เลือกท่าทางเพื่อดูสรรพคุณทางสุขภาพ</li>';
    }
    if (cautionElderly) cautionElderly.textContent = '-';
    if (cautionPregnant) cautionPregnant.textContent = '-';
    if (cautionGeneral) cautionGeneral.textContent = '-';
    return;
  }

  const { benefits, cautions } = pose.health_context;

  if (benefitsListEl) {
    if (Array.isArray(benefits) && benefits.length > 0) {
      benefitsListEl.innerHTML = benefits.map(b => `<li>${escapeHtml(b)}</li>`).join('');
    } else {
      benefitsListEl.innerHTML = '<li>ไม่มีข้อมูลทางสุขภาพ</li>';
    }
  }

  if (cautionElderly) {
    cautionElderly.textContent = (cautions && typeof cautions.elderly === 'string') ? cautions.elderly : '-';
  }
  if (cautionPregnant) {
    cautionPregnant.textContent = (cautions && typeof cautions.pregnant === 'string') ? cautions.pregnant : '-';
  }
  if (cautionGeneral) {
    cautionGeneral.textContent = (cautions && typeof cautions.general === 'string') ? cautions.general : '-';
  }
}

function selectPose(key, btn) {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
  resetHoldTimer();
  isCompleted = false;
  selectedPoseKey = (key && typeof key === 'object') ? (key.id || key.key || null) : key;

  if (typeof document !== 'undefined') {
    document.querySelectorAll('.pose-btn').forEach(b => b.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    } else if (selectedPoseKey) {
      const matchedBtn = document.querySelector(`.pose-btn[data-pose-key="${selectedPoseKey}"]`);
      if (matchedBtn) matchedBtn.classList.add('active');
    }
  }

  const activePose = (key && typeof key === 'object') ? key : (posesData ? posesData[key] : null);

  if (statusCardEl) statusCardEl.className = 'status-card waiting';
  if (poseLabelEl) poseLabelEl.textContent = activePose ? activePose.name : (selectedPoseKey || '');
  if (adviceEl) adviceEl.textContent = 'กำลังวิเคราะห์ท่าทาง...';
  if (angleOverlayEl) angleOverlayEl.innerHTML = '';
  if (angleListEl) angleListEl.innerHTML = '';
  updateTimerUI(0);
  updateHealthInfoUI(activePose);
  updateVisualReferenceUI(activePose);
  updateGuidanceTipUI(selectedPoseKey);
}

// ─── Timer Functions (R1, R2, R3) ─────────────────────────────────────────────
function resetHoldTimer() {
  isHolding = false;
  holdStartTime = null;
  lastFormBreakTime = null;
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
    if (autoAdvanceTimer) {
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
    }
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

// ─── PiP Reference Guide Toggle (R1) ──────────────────────────────────────────
const pipToggleBtnEl = (typeof document !== 'undefined' && document.getElementById('pose-guide-pip-toggle')) || poseGuidePipToggleEl;
const pipOverlayElement = (typeof document !== 'undefined' && (document.getElementById('pose-guide-pip') || document.getElementById('pose-ref-hud'))) || poseRefHudEl;

if (pipToggleBtnEl && pipOverlayElement) {
  pipToggleBtnEl.addEventListener('click', () => {
    const isMinimized = pipOverlayElement.classList.toggle('minimized');
    pipToggleBtnEl.textContent = isMinimized ? '+' : '−';
    pipToggleBtnEl.title = isMinimized ? 'ขยายภาพต้นแบบ' : 'ย่อภาพต้นแบบ';
    pipToggleBtnEl.setAttribute('aria-expanded', String(!isMinimized));
  });
}

// ─── PiP In-Camera Sizing Controls (S / M / L / XL) ───────────────────────────
const pipSizeToggleBtn = typeof document !== 'undefined' ? document.getElementById('pip-size-toggle') : null;
const pipSizeButtons = typeof document !== 'undefined' ? (document.querySelectorAll('.btn-pip-size') || []) : [];
const pipSizes = ['sm', 'md', 'lg', 'xl'];
let currentPipSize = 'md';

function setPipSize(size) {
  if (!pipSizes.includes(size)) return;
  currentPipSize = size;
  const overlay = (typeof document !== 'undefined' && (document.getElementById('pose-guide-pip') || document.getElementById('pose-ref-hud'))) || poseRefHudEl;
  if (overlay && overlay.classList) {
    pipSizes.forEach(s => overlay.classList.remove(`size-${s}`));
    overlay.classList.add(`size-${size}`);
  }
  if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
    const btns = document.querySelectorAll('.btn-pip-size');
    if (btns && typeof btns.forEach === 'function') {
      btns.forEach(btn => {
        if (btn.classList && typeof btn.classList.toggle === 'function') {
          btn.classList.toggle('active', btn.getAttribute('data-size') === size);
        }
      });
    }
  }
}

if (pipSizeButtons && typeof pipSizeButtons.forEach === 'function') {
  pipSizeButtons.forEach(btn => {
    if (btn && typeof btn.addEventListener === 'function') {
      btn.addEventListener('click', (e) => {
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
        const size = btn.getAttribute('data-size');
        if (size) setPipSize(size);
      });
    }
  });
}

if (pipSizeToggleBtn && typeof pipSizeToggleBtn.addEventListener === 'function') {
  pipSizeToggleBtn.addEventListener('click', (e) => {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    const nextIdx = (pipSizes.indexOf(currentPipSize) + 1) % pipSizes.length;
    setPipSize(pipSizes[nextIdx]);
  });
}

// ─── Interactive Reference Zoom Modal ────────────────────────────────────────
let currentZoomScale = 1;
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 3.5;
const ZOOM_STEP = 0.25;

const zoomModalEl = typeof document !== 'undefined' ? document.getElementById('pose-zoom-modal') : null;
const zoomModalImgEl = typeof document !== 'undefined' ? document.getElementById('zoom-modal-img') : null;
const zoomModalTitleEl = typeof document !== 'undefined' ? document.getElementById('zoom-modal-title') : null;
const zoomModalDescEl = typeof document !== 'undefined' ? document.getElementById('zoom-modal-desc') : null;
const zoomModalCloseBtn = typeof document !== 'undefined' ? document.getElementById('zoom-modal-close') : null;
const zoomModalBackdrop = typeof document !== 'undefined' ? document.getElementById('zoom-modal-backdrop') : null;
const zoomInBtn = typeof document !== 'undefined' ? document.getElementById('zoom-in-btn') : null;
const zoomOutBtn = typeof document !== 'undefined' ? document.getElementById('zoom-out-btn') : null;
const zoomResetBtn = typeof document !== 'undefined' ? document.getElementById('zoom-reset-btn') : null;
const zoomViewportEl = typeof document !== 'undefined' ? document.getElementById('zoom-viewport') : null;

function setZoomScale(scale) {
  currentZoomScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(scale * 100) / 100));
  if (zoomModalImgEl) {
    zoomModalImgEl.style.transform = `scale(${currentZoomScale})`;
  }
  if (zoomResetBtn) {
    zoomResetBtn.textContent = `↺ ${Math.round(currentZoomScale * 100)}%`;
  }
  return currentZoomScale;
}

function openZoomModal(pose) {
  if (!zoomModalEl) return;
  const targetPose = pose || (selectedPoseKey && posesData[selectedPoseKey]);
  const fallbackSrc = 'images/poses/placeholder.svg';
  let src = fallbackSrc;
  if (targetPose && targetPose.image) {
    src = targetPose.image;
  } else if (poseRefImgEl && poseRefImgEl.src) {
    src = poseRefImgEl.src;
  } else if (refHudImgEl && refHudImgEl.src) {
    src = refHudImgEl.src;
  }

  const title = (targetPose && targetPose.name) ? targetPose.name : 'ภาพท่าทางต้นแบบ';
  const desc = (targetPose && targetPose.description) ? targetPose.description : 'แสดงสรีระและมุมเป้าหมายตามแบบแผนฤๅษีดัดตน';

  if (zoomModalImgEl) {
    zoomModalImgEl.src = src;
    zoomModalImgEl.alt = title;
  }
  if (zoomModalTitleEl) zoomModalTitleEl.textContent = title;
  if (zoomModalDescEl) zoomModalDescEl.textContent = desc;

  setZoomScale(1);
  zoomModalEl.classList.add('active');
  zoomModalEl.setAttribute('aria-hidden', 'false');
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = 'hidden';
  }
}

function closeZoomModal() {
  if (!zoomModalEl) return;
  zoomModalEl.classList.remove('active');
  zoomModalEl.setAttribute('aria-hidden', 'true');
  if (typeof document !== 'undefined' && document.body) {
    document.body.style.overflow = '';
  }
}

// Bind zoom modal controls
if (zoomInBtn && typeof zoomInBtn.addEventListener === 'function') {
  zoomInBtn.addEventListener('click', () => setZoomScale(currentZoomScale + ZOOM_STEP));
}
if (zoomOutBtn && typeof zoomOutBtn.addEventListener === 'function') {
  zoomOutBtn.addEventListener('click', () => setZoomScale(currentZoomScale - ZOOM_STEP));
}
if (zoomResetBtn && typeof zoomResetBtn.addEventListener === 'function') {
  zoomResetBtn.addEventListener('click', () => setZoomScale(1));
}
if (zoomModalCloseBtn && typeof zoomModalCloseBtn.addEventListener === 'function') {
  zoomModalCloseBtn.addEventListener('click', closeZoomModal);
}
if (zoomModalBackdrop && typeof zoomModalBackdrop.addEventListener === 'function') {
  zoomModalBackdrop.addEventListener('click', closeZoomModal);
}

// Wheel zoom in modal viewport
if (zoomViewportEl && typeof zoomViewportEl.addEventListener === 'function') {
  zoomViewportEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoomScale(currentZoomScale + delta);
  }, { passive: false });
}

// Keyboard ESC to close
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && zoomModalEl && zoomModalEl.classList && typeof zoomModalEl.classList.contains === 'function' && zoomModalEl.classList.contains('active')) {
      closeZoomModal();
    }
  });
}

// Attach zoom triggers to reference images and buttons
if (typeof document !== 'undefined') {
  const zoomTriggers = [
    typeof document.getElementById === 'function' ? document.getElementById('pose-guide-zoom-btn') : null,
    typeof document.getElementById === 'function' ? document.getElementById('card-zoom-btn') : null,
    typeof document.getElementById === 'function' ? document.getElementById('pip-img-container') : null,
    typeof document.getElementById === 'function' ? document.getElementById('pose-ref-img-wrap') : null,
    typeof document.getElementById === 'function' ? document.getElementById('pose-guide-img') : null,
    typeof document.getElementById === 'function' ? document.getElementById('reference-pose-img') : null,
    poseRefImgEl,
    refHudImgEl
  ].filter(el => el && typeof el.addEventListener === 'function');

  Array.from(new Set(zoomTriggers)).forEach(el => {
    el.addEventListener('click', (e) => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      openZoomModal();
    });
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
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'th-TH';
    window.speechSynthesis.speak(u);
  } catch (err) {
    console.warn('Speech synthesis error:', err);
  }
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
  if (!pose) return { allCorrect: false, feedbacks: [], results: [] };

  const activePose = { ...pose, id: pose.id || selectedPoseKey, key: selectedPoseKey };
  const evaluator = poseEvaluatorModule || (typeof PoseEvaluator !== 'undefined' ? PoseEvaluator : null);

  let allCorrect = true;
  let feedbacks = [];
  let results = [];

  if (evaluator && typeof evaluator.evaluatePose === 'function') {
    const evalRes = evaluator.evaluatePose(activePose, landmarks);
    allCorrect = evalRes.allCorrect;
    feedbacks = evalRes.feedbacks;
    results = evalRes.results;
  } else {
    pose.rules.forEach(rule => {
      const [ai, bi, ci] = rule.landmarks;
      const A = landmarks[ai];
      const B = landmarks[bi];
      const C = landmarks[ci];
      const lowVis = !A || !B || !C || A.visibility < 0.5 || B.visibility < 0.5 || C.visibility < 0.5;
      if (lowVis) {
        results.push({ rule, ok: false, lowVis: true, angle: null, feedback: 'ไม่เห็นชัด' });
        allCorrect = false;
        return;
      }
      const angle = calcAngle(A, B, C);
      const ok = angle >= rule.min && angle <= rule.max;
      const feedback = ok ? null : (angle < rule.min ? rule.feedback_low : rule.feedback_high);
      results.push({ rule, ok, lowVis: false, angle, feedback });
      if (!ok) {
        allCorrect = false;
        if (feedback) feedbacks.push(feedback);
      }
    });
  }

  const overlayChips = [];
  const listRows = [];

  results.forEach(res => {
    const rule = res.rule;
    if (res.occludedFallback) {
      overlayChips.push(`<div class="chip ok">${rule.label}: บังลำตัว (ผ่าน)</div>`);
      listRows.push(`<div class="row ok"><span class="key">${rule.label}</span><span class="val">ผ่าน (ประเมินแขนหน้า)</span></div>`);
    } else if (res.lowVis) {
      overlayChips.push(`<div class="chip low-vis">${rule.label}: ?°</div>`);
      listRows.push(`<div class="row"><span class="key">${rule.label}</span><span class="val">ไม่เห็นชัด</span></div>`);
    } else {
      const cls = res.ok ? 'ok' : 'bad';
      overlayChips.push(`<div class="chip ${cls}">${rule.label}: ${res.angle}°</div>`);
      listRows.push(`<div class="row ${cls}"><span class="key">${rule.label}</span><span class="val">${res.angle}° <small>(${rule.min}–${rule.max})</small></span></div>`);
    }
  });

  // Update overlays
  if (angleOverlayEl) angleOverlayEl.innerHTML = overlayChips.join('');
  if (angleListEl) angleListEl.innerHTML = listRows.join('');

  // Update status card & hold timer logic with Anti-Jitter Grace Period (R1, R2, R3)
  const now = Date.now();

  if (allCorrect) {
    if (lastFormBreakTime !== null) {
      if (holdStartTime !== null) {
        holdStartTime += (now - lastFormBreakTime);
      }
      lastFormBreakTime = null;
    }

    if (!isCompleted) {
      if (statusCardEl) statusCardEl.className = 'status-card correct';
      if (!isHolding) {
        isHolding = true;
        holdStartTime = now;
      }
      const elapsed = (now - holdStartTime) / 1000;
      updateTimerUI(elapsed);

      const effectiveDuration = Math.max(1, targetHoldDuration || 3);
      if (elapsed >= effectiveDuration) {
        isCompleted = true;
        isHolding = false;
        lastFormBreakTime = null;
        onPoseComplete();
      } else {
        const msg = `ท่าทางถูกต้อง! ค้างท่าไว้ ${effectiveDuration} วินาที และหายใจเข้า-ออกช้าๆ`;
        if (adviceEl) adviceEl.textContent = msg;
        speak(msg);
      }
    } else {
      if (statusCardEl) statusCardEl.className = 'status-card correct completed';
      const effectiveDuration = Math.max(1, targetHoldDuration || 3);
      updateTimerUI(effectiveDuration);
    }
  } else {
    // Check if grace period applies to active hold
    if (isHolding && !isCompleted) {
      if (lastFormBreakTime === null) {
        lastFormBreakTime = now;
      }
      const breakDuration = now - lastFormBreakTime;
      if (breakDuration <= GRACE_PERIOD_MS) {
        if (statusCardEl) statusCardEl.className = 'status-card correct';
        const heldSeconds = holdStartTime !== null ? (lastFormBreakTime - holdStartTime) / 1000 : 0;
        updateTimerUI(heldSeconds);
        return {
          allCorrect,
          feedbacks,
          results
        };
      }
    }

    // Grace period expired or not holding: reset immediately
    if (statusCardEl) statusCardEl.className = 'status-card incorrect';
    resetHoldTimer();
    isCompleted = false;
    updateTimerUI(0);
    const msg = feedbacks.join(' และ ') || 'ปรับท่าทางตามคำแนะนำ';
    if (adviceEl) adviceEl.textContent = msg;
    speak(msg);
  }

  return {
    allCorrect,
    feedbacks,
    results
  };
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
      // Invert execution order: evaluate the pose before skeleton drawing
      const activePose = selectedPoseKey ? posesData[selectedPoseKey] : null;
      let evalResult = null;
      if (selectedPoseKey) {
        evalResult = evaluatePose(results.poseLandmarks);
      }

      // Draw skeleton connectors with dynamic error highlighting
      renderSkeletonConnectors(ctx, results.poseLandmarks, evalResult, activePose);

      if (typeof drawLandmarks !== 'undefined') {
        drawLandmarks(ctx, results.poseLandmarks, {
          color: '#f43f5e', lineWidth: 2, radius: 5
        });
      }

      ctx.restore();
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

// ─── Skeleton Connector Rendering & Highlight Engine (R2) ─────────────────────
// Standard MediaPipe POSE_CONNECTIONS index pairs
const DEFAULT_POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32]
];

/**
 * Renders skeleton connector lines with real-time error highlighting.
 * - Failed connectors: bright red (#ef4444, lineWidth 5)
 * - Conforming connectors: emerald green (#10b981, lineWidth 3)
 * - Unmonitored connectors: sky blue (#38bdf8, lineWidth 3)
 *
 * @param {CanvasRenderingContext2D} ctx - 2D canvas context
 * @param {Array<Object>} landmarks - MediaPipe pose landmarks
 * @param {Object|null} evalResult - Evaluation result from evaluatePose
 * @param {Object|null} pose - Active pose definition
 */
function renderSkeletonConnectors(ctx, landmarks, evalResult, pose) {
  if (!ctx || !landmarks) return;

  const connections = (typeof POSE_CONNECTIONS !== 'undefined')
    ? POSE_CONNECTIONS
    : DEFAULT_POSE_CONNECTIONS;

  const pe = (typeof PoseEvaluator !== 'undefined' ? PoseEvaluator : poseEvaluatorModule);
  const statusMap = (pe && pe.getConnectorStatusMap)
    ? pe.getConnectorStatusMap(pose, evalResult ? evalResult.results : null)
    : { failedEdges: new Set(), conformingEdges: new Set(), allMonitoredEdges: new Set() };

  const { failedEdges, conformingEdges } = statusMap;

  const failed = [];
  const conforming = [];
  const unmonitored = [];

  for (const conn of connections) {
    const key = conn[0] < conn[1] ? `${conn[0]}-${conn[1]}` : `${conn[1]}-${conn[0]}`;
    if (failedEdges.has(key)) {
      failed.push(conn);
    } else if (conformingEdges.has(key)) {
      conforming.push(conn);
    } else {
      unmonitored.push(conn);
    }
  }

  function drawGroup(group, color, lineWidth) {
    if (!group || group.length === 0) return;
    if (typeof drawConnectors !== 'undefined') {
      drawConnectors(ctx, landmarks, group, { color, lineWidth });
      return;
    }

    // Canvas 2D fallback line-drawing mechanism when drawConnectors is undefined
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    const w = (ctx && ctx.canvas) ? ctx.canvas.width : (typeof canvasEl !== 'undefined' && canvasEl ? canvasEl.width : 640);
    const h = (ctx && ctx.canvas) ? ctx.canvas.height : (typeof canvasEl !== 'undefined' && canvasEl ? canvasEl.height : 480);

    for (const [i, j] of group) {
      const p1 = landmarks[i];
      const p2 = landmarks[j];
      if (!p1 || !p2) continue;
      if ((p1.visibility !== undefined && p1.visibility < 0.5) ||
          (p2.visibility !== undefined && p2.visibility < 0.5)) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 1. Unmonitored lines (sky blue)
  drawGroup(unmonitored, '#38bdf8', 3);

  // 2. Conforming lines (emerald green)
  drawGroup(conforming, '#10b981', 3);

  // 3. Failed lines (bright red, thicker)
  drawGroup(failed, '#ef4444', 5);
}

if (typeof window !== 'undefined') {
  window.renderSkeletonConnectors = renderSkeletonConnectors;
  window.DEFAULT_POSE_CONNECTIONS = DEFAULT_POSE_CONNECTIONS;
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
    renderSkeletonConnectors,
    DEFAULT_POSE_CONNECTIONS,
    speak,
    selectPose,
    resetHoldTimer,
    updateTimerUI,
    updateHealthInfoUI,
    updateVisualReferenceUI,
    updateGuidanceTipUI,
    ANGLED_GUIDANCE_POSES,
    GUIDANCE_TIP_TEXT,
    GRACE_PERIOD_MS,
    openZoomModal,
    closeZoomModal,
    setZoomScale,
    setPipSize,
    escapeHtml,
    onPoseComplete,
    renderPoseButtons,
    getState: () => ({
      selectedPoseKey,
      posesData,
      ttsEnabled,
      lastSpokenAt,
      targetHoldDuration,
      holdStartTime,
      lastFormBreakTime,
      isHolding,
      isCompleted,
      autoAdvanceEnabled,
      autoAdvanceTimer,
      completedPoses,
      GRACE_PERIOD_MS,
    }),
    setState: (updates) => {
      if (updates.selectedPoseKey !== undefined) selectedPoseKey = updates.selectedPoseKey;
      if (updates.posesData !== undefined) posesData = updates.posesData;
      if (updates.ttsEnabled !== undefined) ttsEnabled = updates.ttsEnabled;
      if (updates.lastSpokenAt !== undefined) lastSpokenAt = updates.lastSpokenAt;
      if (updates.targetHoldDuration !== undefined) targetHoldDuration = updates.targetHoldDuration;
      if (updates.holdStartTime !== undefined) holdStartTime = updates.holdStartTime;
      if (updates.lastFormBreakTime !== undefined) lastFormBreakTime = updates.lastFormBreakTime;
      if (updates.isHolding !== undefined) isHolding = updates.isHolding;
      if (updates.isCompleted !== undefined) isCompleted = updates.isCompleted;
      if (updates.autoAdvanceEnabled !== undefined) autoAdvanceEnabled = updates.autoAdvanceEnabled;
      if (updates.autoAdvanceTimer !== undefined) autoAdvanceTimer = updates.autoAdvanceTimer;
    }
  };
}
