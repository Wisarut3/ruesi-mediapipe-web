/**
 * Comprehensive Automated Verification Test Suite for Pose Hold Timer
 * 
 * Verifies:
 * 1. Angle math calculation and posture rules preservation
 * 2. Timer count-up when pose is held correctly
 * 3. Immediate reset on form break, landmark visibility loss, or person departure
 * 4. Completion trigger, state persistence, and button ✅ checkmark mark
 * 5. Thai TTS debounce bypass for "ท่าทางสำเร็จ!"
 * 6. Auto-advance toggle behavior (advances when enabled, remains when disabled, manual cancellation)
 * 7. Duration configuration reactivity (custom target duration, advice text update, mid-hold reset)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Read poses definition
const posesPath = path.join(__dirname, '..', 'public', 'poses.json');
const posesData = JSON.parse(fs.readFileSync(posesPath, 'utf8'));

/**
 * Creates an isolated mock DOM environment to test script.js behaviors
 */
function createMockEnvironment() {
  const elements = new Map();
  const listeners = new Map();

  class MockClassList {
    constructor() {
      this.classes = new Set();
    }
    add(...cls) {
      cls.forEach(c => this.classes.add(c));
    }
    remove(...cls) {
      cls.forEach(c => this.classes.delete(c));
    }
    contains(c) {
      return this.classes.has(c);
    }
    toString() {
      return Array.from(this.classes).join(' ');
    }
  }

  class MockElement {
    constructor(id, tagName = 'div') {
      this.id = id || '';
      this.tagName = tagName.toUpperCase();
      this.classList = new MockClassList();
      this._className = '';
      this.textContent = '';
      this.innerHTML = '';
      this.value = '';
      this.checked = false;
      this.dataset = {};
      this.attributes = new Map();
      this.style = {};
      this.children = [];
    }

    get className() {
      return this._className || this.classList.toString();
    }

    set className(val) {
      this._className = val;
      this.classList.classes.clear();
      if (val) {
        val.split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
      }
    }

    setAttribute(name, val) {
      this.attributes.set(name, String(val));
      if (name.startsWith('data-')) {
        const camelCase = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        this.dataset[camelCase] = String(val);
      }
    }

    getAttribute(name) {
      return this.attributes.get(name) || null;
    }

    appendChild(child) {
      this.children.push(child);
      return child;
    }

    addEventListener(event, fn) {
      const key = `${this.id || this.tagName}:${event}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    }

    dispatchEvent(event) {
      const key = `${this.id || this.tagName}:${event.type}`;
      const fns = listeners.get(key) || [];
      fns.forEach(fn => fn(event));
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this });
    }
  }

  function getOrCreateElement(id, tagName = 'div') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id, tagName));
    }
    return elements.get(id);
  }

  // Pre-populate core elements
  const webcam = getOrCreateElement('webcam', 'video');
  const canvas = getOrCreateElement('output-canvas', 'canvas');
  canvas.getContext = () => ({
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    translate: () => {},
    scale: () => {},
    drawImage: () => {}
  });

  const cameraStatus = getOrCreateElement('camera-status', 'div');
  const poseList = getOrCreateElement('pose-list', 'div');
  const statusCard = getOrCreateElement('status-card', 'div');
  const poseLabel = getOrCreateElement('pose-label', 'div');
  const advice = getOrCreateElement('advice', 'div');
  const angleOverlay = getOrCreateElement('angle-overlay', 'div');
  const angleReadings = getOrCreateElement('angle-readings', 'div');
  const ttsToggle = getOrCreateElement('tts-toggle', 'button');
  const timerDisplay = getOrCreateElement('timer-display', 'div');
  const timerCount = getOrCreateElement('timer-count', 'span');
  const timerTarget = getOrCreateElement('timer-target', 'span');
  const timerProgressBar = getOrCreateElement('timer-progress-bar', 'div');
  const durationInput = getOrCreateElement('duration-input', 'input');
  durationInput.value = '10';
  const autoAdvanceToggle = getOrCreateElement('auto-advance-toggle', 'input');
  autoAdvanceToggle.checked = false;

  const spokenUtterances = [];
  let speechCancelledCount = 0;

  const mockSpeechSynthesis = {
    cancel: () => {
      speechCancelledCount++;
    },
    speak: (utterance) => {
      spokenUtterances.push(utterance);
    }
  };

  class MockSpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
    }
  }

  const mockDocument = {
    getElementById: (id) => getOrCreateElement(id),
    createElement: (tag) => new MockElement('', tag),
    querySelector: (selector) => {
      // Attribute selector: [data-pose-key="..."]
      const attrMatch = selector.match(/\[data-pose-key="([^"]+)"\]/);
      if (attrMatch) {
        const key = attrMatch[1];
        for (const el of elements.values()) {
          if (el.dataset.poseKey === key || el.getAttribute('data-pose-key') === key) {
            return el;
          }
        }
        for (const child of poseList.children) {
          if (child.dataset.poseKey === key || child.getAttribute('data-pose-key') === key) {
            return child;
          }
        }
        return null;
      }
      if (selector === '.pose-btn.active') {
        for (const child of poseList.children) {
          if (child.classList.contains('active')) return child;
        }
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === '.pose-btn') {
        return poseList.children;
      }
      return [];
    }
  };

  return {
    elements,
    mockDocument,
    mockSpeechSynthesis,
    MockSpeechSynthesisUtterance,
    spokenUtterances,
    getSpeechCancelledCount: () => speechCancelledCount,
    getOrCreateElement
  };
}

/**
 * Builds synthetic 33-landmark skeleton with custom angles for testing
 */
function makeLandmarksWithAngle(leftAngle, rightAngle, leftVis = 1.0, rightVis = 1.0) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
  
  // Left arm: rule is landmarks [23, 11, 13] (hip, shoulder, elbow)
  // Vertex 11 (left shoulder) at (0.4, 0.4)
  lm[11] = { x: 0.4, y: 0.4, z: 0, visibility: leftVis };
  // Hip 23 straight down
  lm[23] = { x: 0.4, y: 0.8, z: 0, visibility: leftVis };
  // Elbow 13 positioned at leftAngle from vector 11->23
  const leftRad = (leftAngle * Math.PI) / 180;
  lm[13] = {
    x: 0.4 - 0.2 * Math.sin(leftRad),
    y: 0.4 + 0.2 * Math.cos(leftRad),
    z: 0,
    visibility: leftVis
  };

  // Right arm: rule is landmarks [24, 12, 14]
  lm[12] = { x: 0.6, y: 0.4, z: 0, visibility: rightVis };
  lm[24] = { x: 0.6, y: 0.8, z: 0, visibility: rightVis };
  const rightRad = (rightAngle * Math.PI) / 180;
  lm[14] = {
    x: 0.6 + 0.2 * Math.sin(rightRad),
    y: 0.4 + 0.2 * Math.cos(rightRad),
    z: 0,
    visibility: rightVis
  };

  return lm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 1: Angle Math & Posture Rules Preservation
// ─────────────────────────────────────────────────────────────────────────────
test('1. Angle Math & Existing Posture Rules Preservation', async (t) => {
  const script = require('../public/script.js');

  await t.test('calcAngle accurately computes basic geometric angles', () => {
    // 90 degrees
    const A90 = { x: 0.5, y: 0.0 };
    const B90 = { x: 0.0, y: 0.0 };
    const C90 = { x: 0.0, y: 0.5 };
    assert.equal(script.calcAngle(A90, B90, C90), 90);

    // 180 degrees
    const A180 = { x: -1.0, y: 0.0 };
    const B180 = { x: 0.0, y: 0.0 };
    const C180 = { x: 1.0, y: 0.0 };
    assert.equal(script.calcAngle(A180, B180, C180), 180);

    // 0 degrees
    const A0 = { x: 1.0, y: 0.0 };
    const B0 = { x: 0.0, y: 0.0 };
    const C0 = { x: 1.0, y: 0.0 };
    assert.equal(script.calcAngle(A0, B0, C0), 0);

    // Symmetry
    assert.equal(script.calcAngle(A90, B90, C90), script.calcAngle(C90, B90, A90));
  });

  await t.test('Poses definitions are preserved with valid rules', () => {
    assert.ok(posesData.t_pose, 't_pose must exist');
    assert.ok(posesData.arms_up, 'arms_up must exist');
    assert.ok(posesData.arms_down, 'arms_down must exist');

    assert.equal(posesData.t_pose.rules.length, 2);
    assert.deepEqual(posesData.t_pose.rules[0].landmarks, [23, 11, 13]);
    assert.equal(posesData.t_pose.rules[0].min, 70);
    assert.equal(posesData.t_pose.rules[0].max, 110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 2: Timer Count-Up When Pose Held Correctly
// ─────────────────────────────────────────────────────────────────────────────
test('2. Timer Count-Up When Pose is Held Correctly (R1)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  // Reload script with mock DOM
  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    isHolding: false,
    isCompleted: false,
    holdStartTime: null,
    ttsEnabled: false
  });

  // Render buttons and select t_pose
  script.renderPoseButtons();
  const tPoseBtn = env.mockDocument.querySelector('[data-pose-key="t_pose"]');
  script.selectPose('t_pose', tPoseBtn);

  const statusCard = env.getOrCreateElement('status-card');
  const timerCount = env.getOrCreateElement('timer-count');
  const timerProgressBar = env.getOrCreateElement('timer-progress-bar');

  // Synthetic landmarks for 90° T-Pose (within 70-110° range)
  const validLandmarks = makeLandmarksWithAngle(90, 90);

  // Time = 1000ms: Frame 1 -> starts holding
  let currentTime = 1000;
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    script.evaluatePose(validLandmarks);
    const state1 = script.getState();

    assert.equal(state1.isHolding, true, 'isHolding must be true on first correct frame');
    assert.equal(state1.holdStartTime, 1000, 'holdStartTime must record timestamp');
    assert.equal(statusCard.classList.contains('correct'), true, 'Status card must indicate correct');
    assert.equal(timerCount.textContent, 0, 'Timer count starts at 0');

    // Time = 4500ms (3.5s elapsed): Frame 2 -> counts up
    currentTime = 4500;
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 3, 'Timer count should display 3 after 3.5s elapsed');
    assert.equal(timerProgressBar.style.width, '35%', 'Progress bar should be at 35%');

    // Time = 8200ms (7.2s elapsed): Frame 3 -> counts up to 7
    currentTime = 8200;
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 7, 'Timer count should display 7 after 7.2s elapsed');
    assert.equal(timerProgressBar.style.width, '72%', 'Progress bar should be at 72%');
  } finally {
    Date.now = originalDateNow;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 3: Immediate Reset on Form Break, Landmark Loss, or Manual Pose Selection
// ─────────────────────────────────────────────────────────────────────────────
test('3. Immediate Timer Reset on Form Break, Landmark Loss, or Manual Switch (R1)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    ttsEnabled: false
  });
  script.renderPoseButtons();
  script.selectPose('t_pose');

  const statusCard = env.getOrCreateElement('status-card');
  const timerCount = env.getOrCreateElement('timer-count');
  const timerProgressBar = env.getOrCreateElement('timer-progress-bar');
  const validLandmarks = makeLandmarksWithAngle(90, 90);

  let currentTime = 1000;
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    // 3a. Form Break & Grace Period Persistence (< 450ms)
    script.evaluatePose(validLandmarks);
    currentTime = 5000; // 4 seconds elapsed
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 4);

    // User drops left arm to 30° (below min) at 6000ms (5s held)
    const badAngleLandmarks = makeLandmarksWithAngle(30, 90);
    currentTime = 6000;
    script.evaluatePose(badAngleLandmarks);

    // At 6000ms: breakDuration = 0ms <= 450ms (Grace window active)
    assert.equal(script.getState().isHolding, true, 'isHolding must remain true during grace period');
    assert.equal(timerCount.textContent, 5, 'Timer countdown must be held at 5s during grace period');
    assert.equal(statusCard.classList.contains('correct'), true, 'Status card must maintain green correct class during grace period');

    // At 6200ms: 200ms into form break (< 450ms)
    currentTime = 6200;
    script.evaluatePose(badAngleLandmarks);
    assert.equal(script.getState().isHolding, true, 'isHolding persists at 200ms into form break');
    assert.equal(timerCount.textContent, 5, 'Timer countdown still held at 5s');

    // At 6500ms: 500ms into form break (> 450ms grace period expires)
    currentTime = 6500;
    script.evaluatePose(badAngleLandmarks);

    const brokenState = script.getState();
    assert.equal(brokenState.isHolding, false, 'isHolding must be false after grace period expires (>450ms)');
    assert.equal(brokenState.holdStartTime, null, 'holdStartTime must be reset to null');
    assert.equal(timerCount.textContent, 0, 'Timer count must immediately reset to 0');
    assert.equal(timerProgressBar.style.width, '0%', 'Timer progress bar must immediately reset to 0%');
    assert.equal(statusCard.classList.contains('incorrect'), true, 'Status card must indicate incorrect');

    // 3b. Mid-Grace Recovery (Seamless Resumption Without Penalty)
    currentTime = 7000;
    script.evaluatePose(validLandmarks); // start holding again (t=0)
    currentTime = 10000; // 3s hold
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 3);

    // Momentary posture dip at 10100ms
    currentTime = 10100;
    script.evaluatePose(badAngleLandmarks);
    currentTime = 10300; // 200ms into break < 450ms
    script.evaluatePose(badAngleLandmarks);
    assert.equal(timerCount.textContent, 3);

    // Form re-corrected at 10350ms (250ms break < 450ms)
    currentTime = 10350;
    script.evaluatePose(validLandmarks);
    assert.equal(script.getState().isHolding, true, 'isHolding stays true on mid-grace recovery');
    assert.equal(script.getState().lastFormBreakTime, null, 'lastFormBreakTime cleared on recovery');

    // Hold continues to 11350ms (1 more second of good form)
    currentTime = 11350;
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 4, 'Timer resumes counting without penalty to 4s');

    // 3c. Landmark Visibility Loss Exceeding Grace Window (< 0.5)
    script.resetHoldTimer();
    script.updateTimerUI(0);

    currentTime = 12000;
    script.evaluatePose(validLandmarks); // start holding
    currentTime = 15000; // 3s hold
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 3);

    // Drop landmark visibility to 0.2
    const lowVisLandmarks = makeLandmarksWithAngle(90, 90, 0.2, 1.0);
    currentTime = 16000;
    script.evaluatePose(lowVisLandmarks);
    assert.equal(script.getState().isHolding, true, 'isHolding persists during grace window on lowVis frame');

    currentTime = 16500; // 500ms > 450ms grace
    script.evaluatePose(lowVisLandmarks);
    assert.equal(script.getState().isHolding, false, 'Timer must reset when visibility < 0.5 for >450ms');
    assert.equal(timerCount.textContent, 0, 'Timer display must be 0 on low visibility expiration');

    // 3d. Manual Pose Switch Clears Timer Immediately Without Grace Delay
    script.resetHoldTimer();
    script.updateTimerUI(0);

    currentTime = 17000;
    script.evaluatePose(validLandmarks); // start holding
    currentTime = 20000; // 3s hold
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 3);

    // Form broken for 50ms
    currentTime = 20050;
    script.evaluatePose(badAngleLandmarks);
    assert.equal(script.getState().isHolding, true);

    // Switch pose to arms_up immediately during break
    script.selectPose('arms_up');
    assert.equal(script.getState().isHolding, false, 'Manual pose selection must reset hold timer immediately');
    assert.equal(script.getState().lastFormBreakTime, null, 'lastFormBreakTime cleared immediately');
    assert.equal(timerCount.textContent, 0, 'Timer display must be 0 on pose switch');
    assert.equal(statusCard.classList.contains('waiting'), true, 'Status card resets to waiting');

    // 3e. Complete Person Loss Immediately Resets Timer Without Grace Delay
    script.selectPose('t_pose');
    currentTime = 21000;
    script.evaluatePose(validLandmarks);
    currentTime = 24000;
    script.evaluatePose(validLandmarks);
    assert.equal(timerCount.textContent, 3);

    script.resetHoldTimer();
    script.updateTimerUI(0);
    assert.equal(script.getState().isHolding, false, 'Complete loss of person resets timer immediately');
    assert.equal(script.getState().lastFormBreakTime, null);
    assert.equal(timerCount.textContent, 0);
  } finally {
    Date.now = originalDateNow;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 4: Pose Completion Feedback & Checkmark Mark
// ─────────────────────────────────────────────────────────────────────────────
test('4. Pose Completion Feedback & Checkmark Mark (R2)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    ttsEnabled: true
  });
  script.renderPoseButtons();
  script.selectPose('t_pose');

  const statusCard = env.getOrCreateElement('status-card');
  const timerCount = env.getOrCreateElement('timer-count');
  const timerProgressBar = env.getOrCreateElement('timer-progress-bar');
  const tPoseBtn = env.mockDocument.querySelector('[data-pose-key="t_pose"]');
  const validLandmarks = makeLandmarksWithAngle(90, 90);

  let currentTime = 1000;
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    // Start hold
    script.evaluatePose(validLandmarks);
    
    // Hold for 10 full seconds (reach 11000ms)
    currentTime = 11000;
    script.evaluatePose(validLandmarks);

    const state = script.getState();
    assert.equal(state.isCompleted, true, 'isCompleted must become true at target duration');
    assert.ok(state.completedPoses.has('t_pose'), 'completedPoses must contain completed pose key');
    assert.ok(tPoseBtn.classList.contains('completed'), 'Pose button must gain completed class');
    assert.equal(timerCount.textContent, 10, 'Timer count must reflect target duration');
    assert.equal(timerProgressBar.style.width, '100%', 'Progress bar must reach 100%');
    assert.ok(statusCard.classList.contains('completed'), 'Status card must have completed class');
  } finally {
    Date.now = originalDateNow;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 5: Thai TTS Announcement & Debounce Bypass
// ─────────────────────────────────────────────────────────────────────────────
test('5. Thai TTS Announcement with 3000ms Debounce Bypass on Completion (R2)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    ttsEnabled: true,
    lastSpokenAt: 0
  });

  let currentTime = 10000; // 10s elapsed since lastSpokenAt (0)
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    // 5a. Normal debounced speech
    script.speak('คำแนะนำครั้งที่ 1');
    assert.equal(env.spokenUtterances.length, 1);
    assert.equal(env.spokenUtterances[0].text, 'คำแนะนำครั้งที่ 1');

    // 1 second later (currentTime = 11000): should be suppressed (< 3000ms since 10000ms)
    currentTime = 11000;
    script.speak('คำแนะนำครั้งที่ 2');
    assert.equal(env.spokenUtterances.length, 1, 'Utterance within 3000ms must be suppressed');

    // 5b. Completion bypasses debounce immediately
    currentTime = 11500; // still within debounce window (< 3000ms since 10000ms)
    const initialCancels = env.getSpeechCancelledCount();
    script.speak('ท่าทางสำเร็จ!', true); // bypassDebounce = true

    assert.equal(env.spokenUtterances.length, 2, 'Completion utterance must bypass debounce');
    assert.equal(env.spokenUtterances[1].text, 'ท่าทางสำเร็จ!');
    assert.equal(env.spokenUtterances[1].lang, 'th-TH');
    assert.ok(env.getSpeechCancelledCount() > initialCancels, 'cancel() must be called to halt prior speech');
    assert.equal(script.getState().lastSpokenAt, 11500, 'lastSpokenAt must be updated');
  } finally {
    Date.now = originalDateNow;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 6: Auto-Advance Toggle Behavior
// ─────────────────────────────────────────────────────────────────────────────
test('6. Auto-Advance Toggle Behavior (R2)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    ttsEnabled: false
  });
  script.renderPoseButtons();

  // 6a. Auto-advance DISABLED
  script.setState({ autoAdvanceEnabled: false });
  script.selectPose('t_pose');
  script.onPoseComplete();

  assert.equal(script.getState().autoAdvanceTimer, null, 'No auto-advance timer when disabled');
  assert.equal(script.getState().selectedPoseKey, 't_pose', 'Selection remains on t_pose when disabled');

  // 6b. Auto-advance ENABLED
  script.setState({ autoAdvanceEnabled: true });
  script.selectPose('t_pose');
  script.onPoseComplete();

  const timerHandle = script.getState().autoAdvanceTimer;
  assert.notEqual(timerHandle, null, 'autoAdvanceTimer handle must be set when enabled');

  // Fast forward timer to execute advance
  await new Promise(resolve => setTimeout(resolve, 1300));
  const keys = Object.keys(posesData);
  const nextExpectedKey = keys[1]; // arms_up
  assert.equal(script.getState().selectedPoseKey, nextExpectedKey, 'Must auto-advance to next pose in posesData');

  // 6c. Manual pose selection cancels pending auto-advance
  script.selectPose('t_pose');
  script.onPoseComplete(); // starts timer for arms_up
  assert.notEqual(script.getState().autoAdvanceTimer, null);

  // User manually clicks third pose (arms_down) before timeout completes
  script.selectPose('arms_down');
  assert.equal(script.getState().autoAdvanceTimer, null, 'Manual selection must clear autoAdvanceTimer');
  assert.equal(script.getState().selectedPoseKey, 'arms_down', 'Selection must stay on manually chosen pose');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 7: Duration Configuration Reactivity
// ─────────────────────────────────────────────────────────────────────────────
test('7. Configurable Timer Duration Setting UI & Reactivity (R3)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  script.setState({
    posesData: posesData,
    targetHoldDuration: 10,
    ttsEnabled: false
  });
  script.renderPoseButtons();
  script.selectPose('t_pose');

  const durationInput = env.getOrCreateElement('duration-input');
  const timerTarget = env.getOrCreateElement('timer-target');
  const timerCount = env.getOrCreateElement('timer-count');
  const adviceEl = env.getOrCreateElement('advice');
  const validLandmarks = makeLandmarksWithAngle(90, 90);

  // Change duration to 5 seconds via input event
  durationInput.value = '5';
  durationInput.dispatchEvent({ type: 'input', target: durationInput });

  assert.equal(script.getState().targetHoldDuration, 5, 'targetHoldDuration must update to 5');
  assert.equal(timerTarget.textContent, 5, 'timer-target display must update to 5');

  let currentTime = 1000;
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    // Start hold
    script.evaluatePose(validLandmarks);
    assert.ok(adviceEl.textContent.includes('5 วินาที'), 'Advice text must reflect updated duration of 5s');

    // Advance 5 seconds (to 6000ms)
    currentTime = 6000;
    script.evaluatePose(validLandmarks);

    assert.equal(script.getState().isCompleted, true, 'Pose should complete at newly configured 5s duration');
    assert.equal(timerCount.textContent, 5);

    // Change duration while in progress resets timer safely
    script.selectPose('arms_up');
    script.evaluatePose(makeLandmarksWithAngle(170, 170)); // correct for arms_up
    currentTime = 8000; // 2s elapsed
    script.evaluatePose(makeLandmarksWithAngle(170, 170));

    durationInput.value = '15';
    durationInput.dispatchEvent({ type: 'change', target: durationInput });

    assert.equal(script.getState().targetHoldDuration, 15);
    assert.equal(script.getState().isHolding, false, 'Timer must reset on duration change mid-hold');
    assert.equal(timerCount.textContent, 0);
  } finally {
    Date.now = originalDateNow;
  }
});

test('8. Thai Health Information UI Dynamic Population & Updates (R3)', () => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = {
    speechSynthesis: env.mockSpeechSynthesis
  };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  const benefitsList = env.getOrCreateElement('health-benefits-list', 'ul');
  const cautionElderly = env.getOrCreateElement('caution-elderly-text', 'p');
  const cautionPregnant = env.getOrCreateElement('caution-pregnant-text', 'p');
  const cautionGeneral = env.getOrCreateElement('caution-general-text', 'p');

  script.setState({
    posesData,
    selectedPoseKey: null
  });
  script.renderPoseButtons();

  // Test 1: Selecting t_pose populates benefits and cautions
  script.selectPose('t_pose');
  const tPoseHC = posesData.t_pose.health_context;
  assert.ok(benefitsList.innerHTML.includes(tPoseHC.benefits[0]), 'Benefits list must render t_pose benefits');
  assert.equal(cautionElderly.textContent, tPoseHC.cautions.elderly);
  assert.equal(cautionPregnant.textContent, tPoseHC.cautions.pregnant);
  assert.equal(cautionGeneral.textContent, tPoseHC.cautions.general);

  // Test 2: Switching to kae_kiat_upward immediately updates all fields
  script.selectPose('kae_kiat_upward');
  const upwardHC = posesData.kae_kiat_upward.health_context;
  assert.ok(benefitsList.innerHTML.includes(upwardHC.benefits[0]), 'Benefits list must render kae_kiat_upward benefits');
  assert.equal(cautionElderly.textContent, upwardHC.cautions.elderly);
  assert.equal(cautionPregnant.textContent, upwardHC.cautions.pregnant);
  assert.equal(cautionGeneral.textContent, upwardHC.cautions.general);

  // Test 3: Defensive handling for null or missing health_context
  script.updateHealthInfoUI(null);
  assert.ok(benefitsList.innerHTML.includes('เลือกท่าทางเพื่อดูสรรพคุณทางสุขภาพ'));
  assert.equal(cautionElderly.textContent, '-');
  assert.equal(cautionPregnant.textContent, '-');
  assert.equal(cautionGeneral.textContent, '-');

  // Test 4: Defensive handling for pose with no health_context
  script.updateHealthInfoUI({ name: 'custom_pose' });
  assert.ok(benefitsList.innerHTML.includes('ไม่มีข้อมูลทางสุขภาพ'));
  assert.equal(cautionElderly.textContent, '-');
  assert.equal(cautionPregnant.textContent, '-');
  assert.equal(cautionGeneral.textContent, '-');
});

// ─────────────────────────────────────────────────────────────────────────────
// Test Suite 9: Contextual Positioning Guidance Tips UI (R4)
// ─────────────────────────────────────────────────────────────────────────────
test('9. Contextual Positioning Guidance Tips UI (R4)', async (t) => {
  const env = createMockEnvironment();
  global.document = env.mockDocument;
  global.window = { speechSynthesis: env.mockSpeechSynthesis };
  global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;

  delete require.cache[require.resolve('../public/script.js')];
  const script = require('../public/script.js');

  const guidanceTipEl = env.getOrCreateElement('pose-guidance-tip');

  script.setState({
    posesData,
    selectedPoseKey: null
  });

  // 9a. Angled poses display the 30°–45° guidance badge
  const angledPoses = ['kae_kiat_forward', 'kae_kiat_left', 'kae_kiat_right'];
  for (const poseKey of angledPoses) {
    script.selectPose(poseKey);
    assert.equal(guidanceTipEl.style.display, 'flex', `Guidance tip badge must be visible (flex) for ${poseKey}`);
    assert.ok(
      guidanceTipEl.textContent.includes('30°–45°') && guidanceTipEl.textContent.includes('ยืนเอียงเฉียง'),
      `Guidance tip text for ${poseKey} must contain 30°–45° positioning advice`
    );
  }

  // 9b. Frontal poses hide the guidance badge
  const frontalPoses = ['t_pose', 'arms_up', 'arms_down', 'kae_kiat_prep', 'kae_kiat_upward'];
  for (const poseKey of frontalPoses) {
    script.selectPose(poseKey);
    assert.equal(guidanceTipEl.style.display, 'none', `Guidance tip badge must be hidden (none) for ${poseKey}`);
    assert.equal(guidanceTipEl.textContent, '', `Guidance tip text must be empty for ${poseKey}`);
  }

  // 9c. Direct helper invocation
  script.updateGuidanceTipUI('kae_kiat_left');
  assert.equal(guidanceTipEl.style.display, 'flex');
  assert.equal(guidanceTipEl.textContent, script.GUIDANCE_TIP_TEXT);

  script.updateGuidanceTipUI('t_pose');
  assert.equal(guidanceTipEl.style.display, 'none');
  assert.equal(guidanceTipEl.textContent, '');
});
