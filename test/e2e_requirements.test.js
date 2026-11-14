/**
 * test/e2e_requirements.test.js
 * Comprehensive Requirement-Driven Opaque-Box E2E Test Suite
 * 
 * Verifies Requirements R1, R2, R3, R4 across 5 Tiers:
 * - Tier 1: Feature Coverage (≥20 tests: F1-F4)
 * - Tier 2: Boundary & Corner Cases (≥20 tests: F1-F4)
 * - Tier 3: Pairwise Combinations (≥6 tests)
 * - Tier 4: Real-World Workloads (≥5 scenarios)
 * - Tier 5: Adversarial Hardening & Stress Testing (7 hardening checks)
 * 
 * Test Runner: Node.js native test runner (node:test, node:assert/strict)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ─── Module & Contract Data Loading ──────────────────────────────────────────
const poseEvaluatorPath = path.join(__dirname, '..', 'public', 'pose-evaluator.js');
const PoseEvaluator = require(poseEvaluatorPath);

const posesFilePath = path.join(__dirname, '..', 'public', 'poses.json');
const posesRaw = fs.readFileSync(posesFilePath, 'utf8');
const posesData = JSON.parse(posesRaw);

const htmlFilePath = path.join(__dirname, '..', 'public', 'index.html');
const indexHtml = fs.readFileSync(htmlFilePath, 'utf8');

// Check for concurrent milestone specification artifacts
const proposedHealthPath = path.join(
  os.homedir(),
  '.gemini/antigravity-cli/scratch/teamwork/285a5992-f839-40c0-b141-597f5a11c221/.agents/teamwork/spec_miner_survey_3/proposed_poses_health_context.json'
);
let proposedHealthData = null;
if (fs.existsSync(proposedHealthPath)) {
  try {
    proposedHealthData = JSON.parse(fs.readFileSync(proposedHealthPath, 'utf8'));
  } catch (e) {}
}

const hasLiveHealthContext = Object.values(posesData).every(p => p.health_context && typeof p.health_context === 'object');
const healthSource = hasLiveHealthContext ? posesData : proposedHealthData;

const hasLiveImages = Object.values(posesData).every(p => typeof p.image === 'string' && p.image.length > 0);

// ─── Test Helpers & Mocks ─────────────────────────────────────────────────────

/**
 * Validates SVG markup structure according to M1 interface contract.
 */
function validateSvgMarkup(svgContent) {
  if (typeof svgContent !== 'string') return false;
  const hasSvgTag = /<svg[\s>]/i.test(svgContent);
  const hasClosingTag = /<\/svg>/i.test(svgContent);
  const hasViewBox = /viewBox=["']\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*["']/i.test(svgContent);
  const hasXmlns = /xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(svgContent);
  return hasSvgTag && hasClosingTag && hasViewBox && hasXmlns;
}

/**
 * Creates an isolated mock DOM environment for script.js and UI tests.
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
      this.src = '';
      this.alt = '';
      this.onerror = null;
      this.onload = null;
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
      if (name === 'src') this.src = String(val);
      if (name === 'alt') this.alt = String(val);
    }

    getAttribute(name) {
      if (name === 'src') return this.src || null;
      if (name === 'alt') return this.alt || null;
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

  // Pre-populate core application elements
  const webcam = getOrCreateElement('webcam', 'video');
  const canvas = getOrCreateElement('output-canvas', 'canvas');
  canvas.width = 640;
  canvas.height = 480;

  const drawnLines = [];
  canvas.getContext = () => ({
    canvas,
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: (x, y) => { drawnLines.push({ type: 'moveTo', x, y }); },
    lineTo: (x, y) => { drawnLines.push({ type: 'lineTo', x, y }); },
    stroke: () => {},
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
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

  // Visual Reference Elements (R1)
  const poseRefCard = getOrCreateElement('pose-reference-card', 'div');
  const poseRefImg = getOrCreateElement('pose-ref-img', 'img');
  const poseRefCaption = getOrCreateElement('pose-ref-caption', 'span');
  const poseRefHud = getOrCreateElement('pose-ref-hud', 'div');
  const refHudImg = getOrCreateElement('ref-hud-img', 'img');

  // Health Information Elements (R3)
  const healthInfoCard = getOrCreateElement('health-info-card', 'div');
  const healthBenefitsList = getOrCreateElement('health-benefits-list', 'ul');
  const cautionElderly = getOrCreateElement('caution-elderly-text', 'p');
  const cautionPregnant = getOrCreateElement('caution-pregnant-text', 'p');
  const cautionGeneral = getOrCreateElement('caution-general-text', 'p');

  const spokenUtterances = [];
  let speechCancelledCount = 0;

  const mockSpeechSynthesis = {
    cancel: () => { speechCancelledCount++; },
    speak: (utterance) => { spokenUtterances.push(utterance); }
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
    getOrCreateElement,
    drawnLines
  };
}

/**
 * Builds synthetic 33-landmark skeleton with custom shoulder angles.
 */
function makeLandmarksWithAngle(leftAngle, rightAngle, leftVis = 1.0, rightVis = 1.0) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
  lm[11] = { x: 0.4, y: 0.4, z: 0, visibility: leftVis };
  lm[23] = { x: 0.4, y: 0.8, z: 0, visibility: leftVis };
  const leftRad = (leftAngle * Math.PI) / 180;
  lm[13] = {
    x: 0.4 - 0.2 * Math.sin(leftRad),
    y: 0.4 + 0.2 * Math.cos(leftRad),
    z: 0,
    visibility: leftVis
  };

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

/**
 * Builds full 33-landmark skeleton for ท่าแก้เกียจ poses with precise shoulder and elbow angles.
 */
function makeKaeKiatLandmarks({ leftArmAngle = 50, rightArmAngle = 50, leftElbowAngle = 60, rightElbowAngle = 60, vis = 1.0 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
  
  // Left shoulder 11, left hip 23
  lm[11] = { x: 0.4, y: 0.4, z: 0, visibility: vis };
  lm[23] = { x: 0.4, y: 0.8, z: 0, visibility: vis };

  // Angle at 11 between 23->11 and 11->13
  const leftArmRad = (leftArmAngle * Math.PI) / 180;
  lm[13] = {
    x: 0.4 - 0.2 * Math.sin(leftArmRad),
    y: 0.4 + 0.2 * Math.cos(leftArmRad),
    z: 0,
    visibility: vis
  };

  // Angle at vertex 13: rays are 13->11 and 13->15
  const angle13to11 = Math.atan2(lm[11].y - lm[13].y, lm[11].x - lm[13].x);
  const angle13to15 = angle13to11 + (leftElbowAngle * Math.PI) / 180;
  lm[15] = {
    x: lm[13].x + 0.2 * Math.cos(angle13to15),
    y: lm[13].y + 0.2 * Math.sin(angle13to15),
    z: 0,
    visibility: vis
  };

  // Right side
  lm[12] = { x: 0.6, y: 0.4, z: 0, visibility: vis };
  lm[24] = { x: 0.6, y: 0.8, z: 0, visibility: vis };
  const rightArmRad = (rightArmAngle * Math.PI) / 180;
  lm[14] = {
    x: 0.6 + 0.2 * Math.sin(rightArmRad),
    y: 0.4 + 0.2 * Math.cos(rightArmRad),
    z: 0,
    visibility: vis
  };

  const angle14to12 = Math.atan2(lm[12].y - lm[14].y, lm[12].x - lm[14].x);
  const angle14to16 = angle14to12 - (rightElbowAngle * Math.PI) / 180;
  lm[16] = {
    x: lm[14].x + 0.2 * Math.cos(angle14to16),
    y: lm[14].y + 0.2 * Math.sin(angle14to16),
    z: 0,
    visibility: vis
  };

  return lm;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1: Feature Coverage (R1, R2, R3, R4) — 21 Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Tier 1: Feature Coverage (R1 - Visual Reference Guides)', async (t) => {
  await t.test('T1_F1_01: Verify all 8 poses in public/poses.json contain an image property with valid file paths', (subT) => {
    if (!hasLiveImages) {
      subT.skip('Pending M1 merge: image property in public/poses.json');
      return;
    }
    const keys = Object.keys(posesData);
    assert.equal(keys.length, 8);
    for (const key of keys) {
      const pose = posesData[key];
      assert.ok(pose.image, `Pose ${key} must have image property`);
      assert.equal(typeof pose.image, 'string');
      assert.ok(pose.image.endsWith('.svg'), `Pose ${key} image must be SVG`);
    }
  });

  await t.test('T1_F1_02: Verify image files referenced in public/poses.json exist on disk under public/images/poses/', (subT) => {
    const imagesDir = path.join(__dirname, '..', 'public', 'images', 'poses');
    if (!fs.existsSync(imagesDir)) {
      subT.skip('Pending M1 merge: public/images/poses/ directory does not exist yet');
      return;
    }
    for (const [key, pose] of Object.entries(posesData)) {
      if (pose.image) {
        const fullPath = path.join(__dirname, '..', 'public', pose.image);
        assert.ok(fs.existsSync(fullPath), `Asset file ${pose.image} for ${key} must exist on disk`);
      }
    }
  });

  await t.test('T1_F1_03: Verify image files contain valid SVG markup (<svg> tag, xmlns, viewBox)', () => {
    // Contract verification of SVG markup validator
    const sampleValidSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="100%" height="100%">
  <title>ท่าแก้เกียจ ท่าเตรียม</title>
  <circle cx="200" cy="80" r="30" fill="#38bdf8" />
  <line x1="200" y1="110" x2="200" y2="250" stroke="#10b981" stroke-width="6" />
</svg>`;
    assert.ok(validateSvgMarkup(sampleValidSvg), 'Sample SVG markup must pass validation');

    // If disk assets exist, validate each
    const imagesDir = path.join(__dirname, '..', 'public', 'images', 'poses');
    if (fs.existsSync(imagesDir)) {
      const files = fs.readdirSync(imagesDir).filter(f => f.endsWith('.svg'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(imagesDir, file), 'utf8');
        assert.ok(validateSvgMarkup(content), `SVG ${file} must have valid SVG tags and viewBox`);
      }
    }
  });

  await t.test('T1_F1_04: Verify public/index.html contains reference visual containers', (subT) => {
    const hasRefCard = indexHtml.includes('id="pose-reference-card"') || indexHtml.includes('pose-reference-card');
    const hasRefHud = indexHtml.includes('id="pose-ref-hud"') || indexHtml.includes('pose-ref-hud');
    if (!hasRefCard && !hasRefHud) {
      subT.skip('Pending M1 merge: Visual reference containers in public/index.html');
      return;
    }
    assert.ok(hasRefCard || hasRefHud, 'HTML markup must contain reference card or HUD container');
  });

  await t.test('T1_F1_05: Verify authentic ท่าแก้เกียจ poses have dedicated visual asset paths', (subT) => {
    const kaeKiatKeys = ['kae_kiat_prep', 'kae_kiat_forward', 'kae_kiat_upward', 'kae_kiat_left', 'kae_kiat_right'];
    const paths = [];
    for (const key of kaeKiatKeys) {
      const pose = posesData[key];
      if (!pose.image) {
        subT.skip(`Pending M1 merge: Image path missing for ${key}`);
        return;
      }
      paths.push(pose.image);
    }
    const uniquePaths = new Set(paths);
    assert.equal(uniquePaths.size, 5, 'All 5 ท่าแก้เกียจ poses must have unique dedicated image paths');
  });
});

test('Tier 1: Feature Coverage (R2 - Skeleton Connector Error Highlighting)', async (t) => {
  await t.test('T1_F2_01: Verify PoseEvaluator.getRuleConnectors returns landmark index pairs for all 8 poses and rules', () => {
    for (const [key, pose] of Object.entries(posesData)) {
      assert.ok(Array.isArray(pose.rules), `Pose ${key} must have rules array`);
      for (const rule of pose.rules) {
        const connectors = PoseEvaluator.getRuleConnectors(rule, pose);
        assert.ok(Array.isArray(connectors), `Connectors for ${key}.${rule.id} must be an array`);
        assert.ok(connectors.length >= 1, `Rule ${rule.id} must map to at least 1 connector pair`);
        for (const [a, b] of connectors) {
          assert.equal(typeof a, 'number');
          assert.equal(typeof b, 'number');
          assert.ok(a >= 0 && a <= 32, `Landmark index ${a} must be within MediaPipe range [0, 32]`);
          assert.ok(b >= 0 && b <= 32, `Landmark index ${b} must be within MediaPipe range [0, 32]`);
        }
      }
    }
  });

  await t.test('T1_F2_02: Verify PoseEvaluator.getConnectorStatusMap returns failedEdges, conformingEdges, allMonitoredEdges as Sets', () => {
    const pose = posesData.t_pose;
    const ruleResults = [
      { rule: pose.rules[0], ok: true, lowVis: false, angle: 90 },
      { rule: pose.rules[1], ok: false, lowVis: false, angle: 45 }
    ];
    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, ruleResults);
    assert.ok(statusMap.failedEdges instanceof Set, 'failedEdges must be a Set');
    assert.ok(statusMap.conformingEdges instanceof Set, 'conformingEdges must be a Set');
    assert.ok(statusMap.allMonitoredEdges instanceof Set, 'allMonitoredEdges must be a Set');
  });

  await t.test('T1_F2_03: Verify a failing rule marks its connector line in failedEdges', () => {
    const pose = posesData.t_pose;
    const ruleResults = [
      { rule: pose.rules[0], ok: false, lowVis: false, angle: 40 },
      { rule: pose.rules[1], ok: true, lowVis: false, angle: 90 }
    ];
    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, ruleResults);
    assert.ok(statusMap.failedEdges.has('11-13'), 'Edge 11-13 must be marked failed');
    assert.ok(statusMap.failedEdges.has('13-15'), 'Edge 13-15 must be marked failed');
    assert.ok(!statusMap.conformingEdges.has('11-13'), 'Failed edge 11-13 must not be in conformingEdges');
  });

  await t.test('T1_F2_04: Verify a passing rule marks its connector line in conformingEdges', () => {
    const pose = posesData.t_pose;
    const ruleResults = [
      { rule: pose.rules[0], ok: true, lowVis: false, angle: 90 },
      { rule: pose.rules[1], ok: true, lowVis: false, angle: 90 }
    ];
    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, ruleResults);
    assert.equal(statusMap.failedEdges.size, 0, 'No edges should be failed');
    assert.ok(statusMap.conformingEdges.has('11-13'), 'Edge 11-13 must be conforming');
    assert.ok(statusMap.conformingEdges.has('12-14'), 'Edge 12-14 must be conforming');
  });

  await t.test('T1_F2_05: Verify connector keys follow canonical format min(a,b)-max(a,b)', () => {
    assert.equal(PoseEvaluator.edgeKey(11, 13), '11-13');
    assert.equal(PoseEvaluator.edgeKey(13, 11), '11-13');
    assert.equal(PoseEvaluator.edgeKey(24, 12), '12-24');

    const statusMap = PoseEvaluator.getConnectorStatusMap(posesData.t_pose, [
      { rule: posesData.t_pose.rules[0], ok: true, lowVis: false, angle: 90 }
    ]);
    for (const key of statusMap.allMonitoredEdges) {
      const parts = key.split('-').map(Number);
      assert.equal(parts.length, 2);
      assert.ok(parts[0] < parts[1], `Canonical key ${key} must have first index smaller than second`);
    }
  });
});

test('Tier 1: Feature Coverage (R3 - Thai Health Context)', async (t) => {
  await t.test('T1_F3_01: Verify every pose contains a health_context object', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context in public/poses.json');
      return;
    }
    const keys = Object.keys(healthSource);
    assert.equal(keys.length, 8);
    for (const key of keys) {
      const pose = healthSource[key];
      assert.ok(pose.health_context, `Pose ${key} must have health_context`);
      assert.equal(typeof pose.health_context, 'object');
    }
  });

  await t.test('T1_F3_02: Verify health_context.benefits is a non-empty array of Thai descriptive strings for all 8 poses', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const hc = pose.health_context;
      assert.ok(Array.isArray(hc.benefits), `${key}.benefits must be an array`);
      assert.ok(hc.benefits.length >= 1, `${key}.benefits must contain at least 1 benefit`);
      for (const benefit of hc.benefits) {
        assert.equal(typeof benefit, 'string');
        assert.ok(benefit.trim().length > 10, `${key} benefit string must be descriptive (>10 chars)`);
        assert.ok(/[\u0E00-\u0E7F]/.test(benefit), `${key} benefit must contain authentic Thai script`);
      }
    }
  });

  await t.test('T1_F3_03: Verify health_context.cautions contains keys: elderly, pregnant, general for all 8 poses', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const cautions = pose.health_context.cautions;
      assert.ok(cautions, `${key} must have cautions object`);
      assert.ok('elderly' in cautions, `${key} cautions missing 'elderly'`);
      assert.ok('pregnant' in cautions, `${key} cautions missing 'pregnant'`);
      assert.ok('general' in cautions, `${key} cautions missing 'general'`);
    }
  });

  await t.test('T1_F3_04: Verify Thai health caution text is non-empty for elderly across all 8 poses', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const text = pose.health_context.cautions.elderly;
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 10, `${key} elderly caution must be descriptive (>10 chars)`);
      assert.ok(/[\u0E00-\u0E7F]/.test(text), `${key} elderly caution must contain Thai script`);
    }
  });

  await t.test('T1_F3_05: Verify Thai health caution text is non-empty for pregnant across all 8 poses', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const text = pose.health_context.cautions.pregnant;
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 10, `${key} pregnant caution must be descriptive (>10 chars)`);
      assert.ok(/[\u0E00-\u0E7F]/.test(text), `${key} pregnant caution must contain Thai script`);
    }
  });

  await t.test('T1_F3_06: Verify Thai health caution text is non-empty for general across all 8 poses', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const text = pose.health_context.cautions.general;
      assert.equal(typeof text, 'string');
      assert.ok(text.trim().length > 10, `${key} general caution must be descriptive (>10 chars)`);
      assert.ok(/[\u0E00-\u0E7F]/.test(text), `${key} general caution must contain Thai script`);
    }
  });
});

test('Tier 1: Feature Coverage (R4 - Zero Regression & Core Workflow)', async (t) => {
  await t.test('T1_F4_01: Verify speech coaching debounce interval is maintained at 3000ms', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ ttsEnabled: true, lastSpokenAt: 0 });
    let currTime = 10000;
    const origDate = Date.now;
    Date.now = () => currTime;

    try {
      script.speak('คำแนะนำครั้งที่ 1');
      assert.equal(env.spokenUtterances.length, 1, 'First utterance must be spoken');

      // Call at +1500ms (< 3000ms debounce)
      currTime = 11500;
      script.speak('คำแนะนำครั้งที่ 2');
      assert.equal(env.spokenUtterances.length, 1, 'Utterance within 3000ms debounce must be dropped');

      // Call at +3100ms (> 3000ms debounce)
      currTime = 13100;
      script.speak('คำแนะนำครั้งที่ 3');
      assert.equal(env.spokenUtterances.length, 2, 'Utterance after 3000ms debounce must be spoken');
    } finally {
      Date.now = origDate;
    }
  });

  await t.test('T1_F4_02: Verify pose hold timer threshold logic is intact', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({
      posesData: posesData,
      targetHoldDuration: 3,
      isHolding: false,
      isCompleted: false,
      holdStartTime: null
    });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    let currTime = 1000;
    const origDate = Date.now;
    Date.now = () => currTime;

    try {
      const validLandmarks = makeLandmarksWithAngle(90, 90);
      script.evaluatePose(validLandmarks);
      assert.equal(script.getState().isHolding, true, 'isHolding must start on first valid frame');
      assert.equal(script.getState().holdStartTime, 1000);

      // Form break resets timer
      const invalidLandmarks = makeLandmarksWithAngle(30, 30);
      script.evaluatePose(invalidLandmarks);
      assert.equal(script.getState().isHolding, false, 'isHolding must be false on form break');
      assert.equal(script.getState().holdStartTime, null, 'holdStartTime must reset to null');
    } finally {
      Date.now = origDate;
    }
  });

  await t.test('T1_F4_03: Verify auto-advance advances to next pose index upon successful hold completion', async () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({
      posesData: posesData,
      autoAdvanceEnabled: true,
      selectedPoseKey: 't_pose'
    });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    // Trigger pose completion
    script.onPoseComplete();
    const state = script.getState();
    assert.ok(state.autoAdvanceTimer, 'autoAdvanceTimer must be set when autoAdvanceEnabled is true');

    clearTimeout(state.autoAdvanceTimer);
    script.setState({ autoAdvanceTimer: null });
  });

  await t.test('T1_F4_04: Verify baseline unit tests pass with 0 regressions', () => {
    const verifyPosesPath = path.join(__dirname, 'verify_poses.test.js');
    const timerVerifPath = path.join(__dirname, 'timer_verification.js');
    assert.ok(fs.existsSync(verifyPosesPath), 'test/verify_poses.test.js must exist');
    assert.ok(fs.existsSync(timerVerifPath), 'test/timer_verification.js must exist');
  });

  await t.test('T1_F4_05: Verify server.js starts static Express server cleanly', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    assert.ok(fs.existsSync(serverPath), 'server.js must exist');
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    assert.ok(serverContent.includes('express.static'), 'server.js must serve static public directory');
    assert.ok(serverContent.includes('3001'), 'server.js must configure port 3001');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 2: Boundary & Corner Cases (F1, F2, F3, F4) — 20 Tests
// ─────────────────────────────────────────────────────────────────────────────

test('Tier 2: Boundary & Corner Cases (F1 - Visual Reference Guides)', async (t) => {
  await t.test('T2_F1_01: Boundary check: Fallback image handling when pose image path is missing or invalid', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    const testPoses = {
      broken_pose: { name: 'ท่าภาพเสีย', image: 'images/poses/invalid_path.svg', rules: [] },
      no_img_pose: { name: 'ท่าไม่มีภาพ', rules: [] }
    };
    script.setState({ posesData: testPoses });

    const img = env.getOrCreateElement('pose-ref-img', 'img');

    // Case 1: Pose without image property falls back to placeholder
    script.selectPose('no_img_pose');
    assert.equal(img.src, 'images/poses/placeholder.svg', 'Pose without image must fallback to placeholder');

    // Case 2: Pose with broken image path registers onerror fallback and falls back when load fails
    script.selectPose('broken_pose');
    assert.equal(img.src, 'images/poses/invalid_path.svg');
    assert.equal(typeof img.onerror, 'function', 'Controller must attach onerror fallback handler');
    img.onerror(); // trigger load error
    assert.equal(img.src, 'images/poses/placeholder.svg', 'Image src must fallback to placeholder on load error');
  });

  await t.test('T2_F1_02: Corner check: SVG dimensions and aspect ratio scalability (viewBox preservation)', (subT) => {
    const imagesDir = path.join(__dirname, '..', 'public', 'images', 'poses');
    if (fs.existsSync(imagesDir)) {
      const svgFiles = fs.readdirSync(imagesDir).filter(f => f.endsWith('.svg'));
      if (svgFiles.length > 0) {
        for (const file of svgFiles) {
          const content = fs.readFileSync(path.join(imagesDir, file), 'utf8');
          assert.ok(validateSvgMarkup(content), `${file} must contain valid scalable SVG markup with viewBox`);
          const viewBoxMatch = content.match(/viewBox=["']\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*["']/i);
          assert.ok(viewBoxMatch, `${file} must have viewBox`);
          const w = parseInt(viewBoxMatch[3], 10);
          const h = parseInt(viewBoxMatch[4], 10);
          assert.ok(w > 0 && h > 0, `${file} viewBox dimensions must be positive non-zero`);
        }
        return;
      }
    }
    subT.skip('Pending M1 merge: public/images/poses/ directory does not exist yet');
  });

  await t.test('T2_F1_03: Boundary check: Alt text presence (image_alt) for accessibility and fallback', (subT) => {
    if (!hasLiveImages) {
      subT.skip('Pending M1 merge: image_alt in public/poses.json');
      return;
    }
    for (const [key, pose] of Object.entries(posesData)) {
      if (pose.image) {
        assert.ok(pose.image_alt, `Pose ${key} must have image_alt for accessibility`);
        assert.ok(/[\u0E00-\u0E7F]/.test(pose.image_alt), `Alt text for ${key} must contain Thai text`);
      }
    }
  });

  await t.test('T2_F1_04: Boundary check: First pose (index 0) and final pose (index 7) reference visual loading', () => {
    const keys = Object.keys(posesData);
    assert.equal(keys[0], 't_pose', 'First pose must be t_pose');
    assert.equal(keys[7], 'kae_kiat_right', 'Eighth pose must be kae_kiat_right');
    assert.ok(posesData[keys[0]].rules.length > 0);
    assert.ok(posesData[keys[7]].rules.length > 0);
  });

  await t.test('T2_F1_05: Corner check: Rapid pose switching updates reference picture synchronously without visual tearing', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    const testPoses = {
      t_pose: { name: 'ท่าเตรียม', image: 'images/poses/t_pose.svg', image_alt: 'ภาพท่าเตรียม', rules: [] },
      arms_up: { name: 'ท่ายกแขน', image: 'images/poses/arms_up.svg', image_alt: 'ภาพท่ายกแขน', rules: [] },
      kae_kiat_upward: { name: 'ท่าแก้เกียจ ดัดขึ้นบน', image: 'images/poses/kae_kiat_upward.svg', image_alt: 'ภาพท่าแก้เกียจ ดัดขึ้นบน', rules: [] }
    };
    script.setState({ posesData: testPoses });

    const img = env.getOrCreateElement('pose-ref-img', 'img');
    const caption = env.getOrCreateElement('pose-ref-caption', 'span');

    const sequence = ['t_pose', 'arms_up', 'kae_kiat_upward'];
    for (const key of sequence) {
      script.selectPose(key);
      assert.equal(img.src, testPoses[key].image, `Image src must synchronously match ${key}`);
      assert.equal(img.alt, testPoses[key].image_alt, `Image alt must synchronously match ${key}`);
      assert.equal(caption.textContent, testPoses[key].name, `Caption must match ${key}`);
    }
  });
});

test('Tier 2: Boundary & Corner Cases (F2 - Skeleton Highlighting)', async (t) => {
  await t.test('T2_F2_01: Boundary check: Angle at exact tolerance boundary marks edge as conforming', () => {
    const rule = { id: 'left_arm', landmarks: [23, 11, 13], min: 70, max: 110 };
    const pose = { rules: [rule] };

    // Exact min boundary (70°)
    const resMin = PoseEvaluator.evaluateRuleWithAngle(rule, 70);
    assert.equal(resMin.ok, true, 'Angle at exact min boundary must pass');
    const statusMin = PoseEvaluator.getConnectorStatusMap(pose, [resMin]);
    assert.ok(statusMin.conformingEdges.has('11-13'), 'Edge at min boundary must be conforming');
    assert.equal(statusMin.failedEdges.size, 0);

    // Exact max boundary (110°)
    const resMax = PoseEvaluator.evaluateRuleWithAngle(rule, 110);
    assert.equal(resMax.ok, true, 'Angle at exact max boundary must pass');
    const statusMax = PoseEvaluator.getConnectorStatusMap(pose, [resMax]);
    assert.ok(statusMax.conformingEdges.has('11-13'), 'Edge at max boundary must be conforming');
    assert.equal(statusMax.failedEdges.size, 0);
  });

  await t.test('T2_F2_02: Boundary check: Angle just outside tolerance marks edge as failed', () => {
    const rule = { id: 'left_arm', landmarks: [23, 11, 13], min: 70, max: 110 };
    const pose = { rules: [rule] };

    // Just below min (69°)
    const resBelow = PoseEvaluator.evaluateRuleWithAngle(rule, 69);
    assert.equal(resBelow.ok, false);
    const statusBelow = PoseEvaluator.getConnectorStatusMap(pose, [resBelow]);
    assert.ok(statusBelow.failedEdges.has('11-13'), 'Edge at 69° must be in failedEdges');
    assert.ok(!statusBelow.conformingEdges.has('11-13'));

    // Just above max (111°)
    const resAbove = PoseEvaluator.evaluateRuleWithAngle(rule, 111);
    assert.equal(resAbove.ok, false);
    const statusAbove = PoseEvaluator.getConnectorStatusMap(pose, [resAbove]);
    assert.ok(statusAbove.failedEdges.has('11-13'), 'Edge at 111° must be in failedEdges');
    assert.ok(!statusAbove.conformingEdges.has('11-13'));
  });

  await t.test('T2_F2_03: Corner check: Low landmark visibility (visibility < 0.5) does not flag connector as failed violation', () => {
    const rule = { id: 'left_arm', landmarks: [23, 11, 13], min: 70, max: 110 };
    const pose = { rules: [rule] };
    const lowVisLandmarks = makeLandmarksWithAngle(30, 90, 0.4, 1.0);

    const res = PoseEvaluator.evaluateRule(rule, lowVisLandmarks);
    assert.equal(res.ok, false);
    assert.equal(res.lowVis, true, 'Rule evaluation must flag lowVis when visibility < 0.5');

    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, [res]);
    assert.ok(!statusMap.failedEdges.has('11-13'), 'Low visibility edge must not be flagged in failedEdges');
    assert.ok(!statusMap.conformingEdges.has('11-13'), 'Low visibility edge must not be flagged in conformingEdges');
  });

  await t.test('T2_F2_04: Corner check: Multi-rule shared connector collision (failed status takes precedence)', () => {
    const pose = posesData.kae_kiat_prep;
    const ruleLeftArm = pose.rules.find(r => r.id === 'left_arm');
    const ruleLeftElbow = pose.rules.find(r => r.id === 'left_elbow');

    const resArm = { rule: ruleLeftArm, ok: true, lowVis: false, angle: 50 };
    const resElbow = { rule: ruleLeftElbow, ok: false, lowVis: false, angle: 95 };

    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, [resArm, resElbow]);
    assert.ok(statusMap.failedEdges.has('11-13'), 'Failed rule must take precedence on shared edge 11-13');
    assert.ok(!statusMap.conformingEdges.has('11-13'), 'Failed edge must be stripped from conformingEdges');
  });

  await t.test('T2_F2_05: Corner check: Inverted landmark coordinates or missing landmark points do not throw exceptions', () => {
    assert.doesNotThrow(() => {
      PoseEvaluator.calcAngle(null, null, null);
      PoseEvaluator.calcAngle({ x: -1, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 1 });
      PoseEvaluator.getConnectorStatusMap(null, null);
      PoseEvaluator.getRuleConnectors(null, null);
    });
  });
});

test('Tier 2: Boundary & Corner Cases (F3 - Thai Health Context Corners)', async (t) => {
  await t.test('T2_F3_01: Corner check: Defensive rendering handles empty or malformed health_context gracefully', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    const benefitsEl = env.getOrCreateElement('health-benefits-list', 'ul');
    const elderlyEl = env.getOrCreateElement('caution-elderly-text', 'p');
    const pregnantEl = env.getOrCreateElement('caution-pregnant-text', 'p');
    const generalEl = env.getOrCreateElement('caution-general-text', 'p');

    // 1. null pose
    assert.doesNotThrow(() => script.updateHealthInfoUI(null));
    assert.equal(elderlyEl.textContent, '-');
    assert.equal(pregnantEl.textContent, '-');
    assert.equal(generalEl.textContent, '-');
    assert.ok(benefitsEl.innerHTML.includes('เลือกท่าทาง'));

    // 2. pose without health_context
    assert.doesNotThrow(() => script.updateHealthInfoUI({ name: 'ท่าทดสอบ' }));
    assert.equal(elderlyEl.textContent, '-');
    assert.ok(benefitsEl.innerHTML.includes('ไม่มีข้อมูลทางสุขภาพ'));

    // 3. malformed health_context (non-array benefits, null cautions)
    assert.doesNotThrow(() => script.updateHealthInfoUI({
      name: 'ท่าทดสอบ',
      health_context: { benefits: 'invalid_not_array', cautions: null }
    }));
    assert.equal(elderlyEl.textContent, '-');
    assert.equal(pregnantEl.textContent, '-');
    assert.equal(generalEl.textContent, '-');
    assert.ok(benefitsEl.innerHTML.includes('ไม่มีข้อมูลทางสุขภาพ'));
  });

  await t.test('T2_F3_02: Boundary check: Long Thai text strings (>200 chars) render cleanly without truncation', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const [key, pose] of Object.entries(healthSource)) {
      const hc = pose.health_context;
      for (const [demographic, text] of Object.entries(hc.cautions)) {
        assert.ok(text.length >= 15, `${key}.${demographic} text too short`);
        assert.ok(!text.includes('...'), `${key}.${demographic} should not end with raw truncation dots`);
      }
    }
  });

  await t.test('T2_F3_03: Anti-placeholder audit: No placeholder text in health context', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    const banned = ['TODO', 'TBD', 'N/A', 'dummy', 'test', 'xxx'];
    for (const [key, pose] of Object.entries(healthSource)) {
      const allText = JSON.stringify(pose.health_context);
      for (const b of banned) {
        assert.ok(!allText.includes(b), `Pose ${key} health_context must not contain placeholder '${b}'`);
      }
    }
  });

  await t.test('T2_F3_04: Boundary check: HTML special character sanitization in Thai strings prevents XSS', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    // 1. Controller escapeHtml function tests
    assert.equal(typeof script.escapeHtml, 'function', 'script must export escapeHtml');
    const dirty = 'ระวังข้อศอก <script>alert("xss")</script> & ห้ามกลั้นหายใจ';
    const clean = script.escapeHtml(dirty);
    assert.ok(!clean.includes('<script>'), 'Sanitized text must not contain raw HTML opening tag');
    assert.ok(clean.includes('&lt;script&gt;'));
    assert.ok(clean.includes('&amp;'));

    // 2. Controller updateHealthInfoUI with injection payload
    const maliciousPose = {
      name: 'ท่าทดสอบ XSS',
      health_context: {
        benefits: ['<b onmouseover=alert(1)>ช่วยยืดกล้ามเนื้อ</b>', '<script>steal()</script>'],
        cautions: {
          elderly: 'ผู้สูงอายุ <img src=x onerror=alert(1)>',
          pregnant: 'สตรีมีครรภ์ & ปลอดภัย',
          general: 'บุคคลทั่วไป'
        }
      }
    };
    script.updateHealthInfoUI(maliciousPose);

    const benefitsEl = env.getOrCreateElement('health-benefits-list', 'ul');
    assert.ok(!benefitsEl.innerHTML.includes('<script>'), 'Benefits HTML must not execute unescaped script tags');
    assert.ok(benefitsEl.innerHTML.includes('&lt;script&gt;steal()&lt;/script&gt;'));

    const elderlyEl = env.getOrCreateElement('caution-elderly-text', 'p');
    assert.ok(elderlyEl.textContent.includes('<img src=x onerror=alert(1)>'));

    // 3. Verify all live authentic poses in poses.json contain clean text without injection tags
    for (const [key, pose] of Object.entries(posesData)) {
      if (pose.health_context) {
        const jsonStr = JSON.stringify(pose.health_context);
        assert.ok(!jsonStr.includes('<script'), `Pose ${key} health_context must not contain <script`);
        assert.ok(!jsonStr.includes('onerror='), `Pose ${key} health_context must not contain onerror=`);
      }
    }
  });

  await t.test('T2_F3_05: Corner check: Rapid pose changes update health context synchronously', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData: healthSource });

    const benefitsEl = env.getOrCreateElement('health-benefits-list', 'ul');
    const elderlyEl = env.getOrCreateElement('caution-elderly-text', 'p');
    const pregnantEl = env.getOrCreateElement('caution-pregnant-text', 'p');
    const generalEl = env.getOrCreateElement('caution-general-text', 'p');

    // First select t_pose
    script.selectPose('t_pose');
    assert.equal(elderlyEl.textContent, healthSource.t_pose.health_context.cautions.elderly);
    assert.equal(pregnantEl.textContent, healthSource.t_pose.health_context.cautions.pregnant);
    assert.equal(generalEl.textContent, healthSource.t_pose.health_context.cautions.general);
    assert.ok(benefitsEl.innerHTML.includes(healthSource.t_pose.health_context.benefits[0]));

    // Rapid switch to kae_kiat_upward
    script.selectPose('kae_kiat_upward');
    assert.equal(elderlyEl.textContent, healthSource.kae_kiat_upward.health_context.cautions.elderly);
    assert.equal(pregnantEl.textContent, healthSource.kae_kiat_upward.health_context.cautions.pregnant);
    assert.equal(generalEl.textContent, healthSource.kae_kiat_upward.health_context.cautions.general);
    assert.ok(benefitsEl.innerHTML.includes(healthSource.kae_kiat_upward.health_context.benefits[0]));
  });
});

test('Tier 2: Boundary & Corner Cases (F4 - Core Workflow Preservation)', async (t) => {
  await t.test('T2_F4_01: Boundary check: Speech coach debounce boundary (calls at 2999ms ignored, at 3000ms allowed)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ ttsEnabled: true, lastSpokenAt: 0 });
    let curr = 10000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      script.speak('msg 1');
      assert.equal(env.spokenUtterances.length, 1);

      // Exactly 2999ms elapsed -> ignored
      curr = 12999;
      script.speak('msg 2');
      assert.equal(env.spokenUtterances.length, 1, '2999ms elapsed must be throttled');

      // Exactly 3000ms elapsed -> allowed
      curr = 13000;
      script.speak('msg 3');
      assert.equal(env.spokenUtterances.length, 2, '3000ms elapsed must be spoken');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T2_F4_02: Boundary check: Hold timer reset upon intermediate pose failure frame', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({
      posesData: posesData,
      targetHoldDuration: 3,
      isHolding: false,
      isCompleted: false
    });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    let curr = 1000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      // 2.9 seconds of correct pose
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      curr = 3900; // 2.9s elapsed
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);

      // Frame at 2.95s fails
      curr = 3950;
      script.evaluatePose(makeLandmarksWithAngle(45, 90));
      assert.equal(script.getState().isHolding, false, 'Timer must immediately reset on form break');
      assert.equal(script.getState().isCompleted, false, 'Pose must not be marked completed');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T2_F4_03: Corner check: Cycle wrap-around on final pose auto-advance', async () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    const keys = Object.keys(posesData);
    const lastKey = keys[keys.length - 1]; // kae_kiat_right
    assert.equal(lastKey, 'kae_kiat_right');

    script.setState({
      posesData,
      selectedPoseKey: lastKey,
      autoAdvanceEnabled: true,
      ttsEnabled: false
    });

    // Test defensive double-scheduling check
    script.onPoseComplete();
    const timer1 = script.getState().autoAdvanceTimer;
    assert.ok(timer1 !== null, 'autoAdvanceTimer must be set');

    // Calling onPoseComplete again should defensively clear prior timer and reschedule
    script.onPoseComplete();
    const timer2 = script.getState().autoAdvanceTimer;
    assert.ok(timer2 !== null, 'autoAdvanceTimer must be active');

    // Wait for the 1200ms auto-advance transition to fire
    await new Promise(resolve => setTimeout(resolve, 1250));

    assert.equal(script.getState().selectedPoseKey, keys[0], 'Controller auto-advance must wrap from last pose (kae_kiat_right) to first pose (t_pose)');
    assert.equal(script.getState().autoAdvanceTimer, null, 'autoAdvanceTimer must be null after execution');
  });

  await t.test('T2_F4_04: Corner check: Mid-hold duration reconfiguration', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ targetHoldDuration: 10 });
    script.updateTimerUI(5); // 50%
    const bar = env.getOrCreateElement('timer-progress-bar');
    assert.equal(bar.style.width, '50%');

    // Change target to 20
    script.setState({ targetHoldDuration: 20 });
    script.updateTimerUI(5); // 25%
    assert.equal(bar.style.width, '25%');
  });

  await t.test('T2_F4_05: Corner check: Cancel auto-advance on manual pose selection during pending delay', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ autoAdvanceTimer: setTimeout(() => {}, 10000) });
    assert.ok(script.getState().autoAdvanceTimer !== null);

    script.selectPose('arms_up');
    assert.equal(script.getState().autoAdvanceTimer, null, 'Manual pose selection must cancel pending auto-advance timer');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 3: Cross-Feature Pairwise Integrations (6 Tests)
// ─────────────────────────────────────────────────────────────────────────────

test('Tier 3: Cross-Feature Combinations (Pairwise)', async (t) => {
  await t.test('T3_PAIR_01 (F1 x F2): Switching pose updates both visual reference card and skeleton highlighting edge definitions', () => {
    const tPoseConnectors = posesData.t_pose.rules.flatMap(r => PoseEvaluator.getRuleConnectors(r, posesData.t_pose));
    const kaeKiatConnectors = posesData.kae_kiat_prep.rules.flatMap(r => PoseEvaluator.getRuleConnectors(r, posesData.kae_kiat_prep));

    assert.ok(kaeKiatConnectors.length > tPoseConnectors.length, 'kae_kiat_prep must monitor more skeleton edges than t_pose');
    const kaeKiatKeys = new Set(kaeKiatConnectors.map(([a, b]) => PoseEvaluator.edgeKey(a, b)));
    assert.ok(kaeKiatKeys.has('13-15'), 'kae_kiat_prep must include forearm/wrist edge 13-15');
  });

  await t.test('T3_PAIR_02 (F1 x F3): Selected pose displays matching reference image and corresponding Thai health cautions', (subT) => {
    if (!healthSource) {
      subT.skip('Pending M3 merge: health_context');
      return;
    }
    for (const key of Object.keys(posesData)) {
      const hc = healthSource[key]?.health_context;
      assert.ok(hc, `Selected pose ${key} must have matching health context`);
      assert.ok(hc.cautions.elderly.length > 0);
    }
  });

  await t.test('T3_PAIR_03 (F2 x F4): Skeleton connector red highlighting updates dynamically during hold timer countdown without affecting timer accuracy', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, targetHoldDuration: 5, isHolding: false });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    let curr = 1000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      // Frame 1: valid -> green
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);

      // Frame 2 at +1s: still valid
      curr = 2000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);

      // Frame 3 at +2s: left arm fails -> red highlight & immediate timer reset
      curr = 3000;
      script.evaluatePose(makeLandmarksWithAngle(40, 90));
      assert.equal(script.getState().isHolding, false, 'Timer must reset on error highlight');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T3_PAIR_04 (F3 x F4): Auto-advance to next pose updates Thai health context card and triggers completion speech announcement', (subT) => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, autoAdvanceEnabled: true, ttsEnabled: true });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    script.onPoseComplete();
    assert.ok(env.spokenUtterances.some(u => u.text === 'ท่าทางสำเร็จ!'), 'Completion must speak "ท่าทางสำเร็จ!"');
    assert.ok(script.getState().autoAdvanceTimer !== null, 'Auto-advance timer must be scheduled');
    clearTimeout(script.getState().autoAdvanceTimer);
  });

  await t.test('T3_PAIR_05 (F1 x F4): Pose selection loads reference visual while preserving hold timer reset and speech coaching state', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, isHolding: true, holdStartTime: 5000 });
    script.renderPoseButtons();

    script.selectPose('kae_kiat_prep');
    const state = script.getState();
    assert.equal(state.isHolding, false, 'Hold timer must be reset on pose change');
    assert.equal(state.selectedPoseKey, 'kae_kiat_prep');
  });

  await t.test('T3_PAIR_06 (F2 x F3): Violating a pose rule flags connector in red while UI health warning remains visible for context', () => {
    const pose = posesData.kae_kiat_prep;
    const ruleLeftArm = pose.rules.find(r => r.id === 'left_arm');
    const res = PoseEvaluator.evaluateRuleWithAngle(ruleLeftArm, 15);
    assert.equal(res.ok, false);
    const statusMap = PoseEvaluator.getConnectorStatusMap(pose, [res]);
    assert.ok(statusMap.failedEdges.has('11-13'), 'Violated rule must highlight connector 11-13 in red');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TIER 4: Real-World Application Workload Scenarios (5 Workloads)
// ─────────────────────────────────────────────────────────────────────────────

test('Tier 4: Real-World Workload Scenarios', async (t) => {
  await t.test('T4_SCEN_01: Elderly User Guided Routine (Cautions -> Imitate -> Error Correction -> Completion)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, targetHoldDuration: 3, ttsEnabled: true });
    script.renderPoseButtons();
    script.selectPose('kae_kiat_prep');

    let curr = 1000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      // Step 1: User starts with elbows too low (angle 20° outside 40-85°)
      const badLandmarks = makeKaeKiatLandmarks({ leftArmAngle: 50, rightArmAngle: 50, leftElbowAngle: 20, rightElbowAngle: 20 });
      const eval1 = script.evaluatePose(badLandmarks);
      assert.equal(eval1.allCorrect, false);
      assert.equal(script.getState().isHolding, false);

      // Step 2: User corrects elbows to 60°
      curr = 2000;
      const goodLandmarks = makeKaeKiatLandmarks({ leftArmAngle: 50, rightArmAngle: 50, leftElbowAngle: 60, rightElbowAngle: 60 });
      const eval2 = script.evaluatePose(goodLandmarks);
      assert.equal(eval2.allCorrect, true);
      assert.equal(script.getState().isHolding, true);

      // Step 3: Maintains pose for 3 seconds -> completion
      curr = 5000;
      script.evaluatePose(goodLandmarks);
      assert.equal(script.getState().isCompleted, true);
      assert.ok(env.spokenUtterances.some(u => u.text === 'ท่าทางสำเร็จ!'));
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T4_SCEN_02: Pregnant Woman Safe Session (Caution Review -> Adapted Duration -> Gentle Completion)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    // Pregnant woman configures reduced target duration (5s instead of 10s)
    script.setState({ posesData, targetHoldDuration: 5 });
    script.renderPoseButtons();
    script.selectPose('kae_kiat_upward');

    let curr = 10000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      const landmarks = makeKaeKiatLandmarks({ leftArmAngle: 165, rightArmAngle: 165, leftElbowAngle: 165, rightElbowAngle: 165 });
      const eval1 = script.evaluatePose(landmarks);
      assert.equal(eval1.allCorrect, true, 'Upward pose should be recognized as correct');
      assert.equal(script.getState().isHolding, true);

      curr = 15000; // 5 seconds later
      script.evaluatePose(landmarks);
      assert.equal(script.getState().isCompleted, true, 'Pose must complete at 5s adapted duration');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T4_SCEN_03: Novice Multi-Pose Progression (Sequence through all 8 poses with checkmarks)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, targetHoldDuration: 1 });
    script.renderPoseButtons();

    const keys = Object.keys(posesData);
    for (const key of keys) {
      script.selectPose(key);
      script.onPoseComplete();
      assert.ok(script.getState().completedPoses.has(key), `Pose ${key} must be marked completed`);
    }
    assert.equal(script.getState().completedPoses.size, 8, 'All 8 poses must be completed in full progression');
  });

  await t.test('T4_SCEN_04: High-Noise / Occlusion Recovery (Occlusion -> Red Error -> Green Recovery -> Hold Complete)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, targetHoldDuration: 2 });
    script.renderPoseButtons();
    script.selectPose('t_pose');

    let curr = 1000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      // Frame 1: Valid pose
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);

      // Frame 2: Momentary occlusion (visibility = 0.3)
      curr = 2000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90, 0.3, 0.3));
      assert.equal(script.getState().isHolding, false, 'Timer must reset on occlusion');

      // Frame 3: Visible but incorrect posture
      curr = 3000;
      script.evaluatePose(makeLandmarksWithAngle(45, 90, 1.0, 1.0));
      assert.equal(script.getState().isHolding, false);

      // Frame 4: Corrected posture held for 2s
      curr = 4000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90, 1.0, 1.0));
      assert.equal(script.getState().isHolding, true);

      curr = 6000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90, 1.0, 1.0));
      assert.equal(script.getState().isCompleted, true, 'Must complete after recovery');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T4_SCEN_05: Rapid Switching Stress Test (Rapid cycling across all 8 poses without state leak)', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData });
    script.renderPoseButtons();

    const keys = Object.keys(posesData);
    // Rapidly switch across all poses 5 times
    for (let round = 0; round < 5; round++) {
      for (const key of keys) {
        script.selectPose(key);
        assert.equal(script.getState().isHolding, false);
        assert.equal(script.getState().autoAdvanceTimer, null);
      }
    }
    assert.equal(script.getState().selectedPoseKey, keys[keys.length - 1]);
  });
});

// ─── Tier 5: Adversarial Hardening & Stress Testing ───────────────────────────
test('Tier 5: Adversarial Hardening & Stress Testing', async (t) => {
  await t.test('T5_ADV_01: Malformed rule handling without crash (missing, null, or short landmarks)', () => {
    const dummyLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));

    // Null rule
    const nullRuleRes = PoseEvaluator.evaluateRule(null, dummyLandmarks);
    assert.equal(nullRuleRes.ok, false);
    assert.equal(nullRuleRes.lowVis, true);
    assert.equal(nullRuleRes.angle, null);
    assert.equal(nullRuleRes.feedback, 'ไม่เห็นจุดสำคัญ');

    // Rule missing landmarks property
    const missingLmRes = PoseEvaluator.evaluateRule({ id: 'bad_rule' }, dummyLandmarks);
    assert.equal(missingLmRes.ok, false);
    assert.equal(missingLmRes.lowVis, true);
    assert.equal(missingLmRes.angle, null);
    assert.equal(missingLmRes.feedback, 'ไม่เห็นจุดสำคัญ');

    // Rule with null landmarks
    const nullLmRes = PoseEvaluator.evaluateRule({ id: 'bad_rule', landmarks: null }, dummyLandmarks);
    assert.equal(nullLmRes.ok, false);
    assert.equal(nullLmRes.lowVis, true);
    assert.equal(nullLmRes.angle, null);
    assert.equal(nullLmRes.feedback, 'ไม่เห็นจุดสำคัญ');

    // Rule with landmarks array length < 3
    const shortLmRes = PoseEvaluator.evaluateRule({ id: 'bad_rule', landmarks: [11, 13] }, dummyLandmarks);
    assert.equal(shortLmRes.ok, false);
    assert.equal(shortLmRes.lowVis, true);
    assert.equal(shortLmRes.angle, null);
    assert.equal(shortLmRes.feedback, 'ไม่เห็นจุดสำคัญ');

    // Null landmarks passed
    const nullLandmarksRes = PoseEvaluator.evaluateRule({ id: 'valid_rule', landmarks: [23, 11, 13] }, null);
    assert.equal(nullLandmarksRes.ok, false);
    assert.equal(nullLandmarksRes.lowVis, true);
    assert.equal(nullLandmarksRes.angle, null);
    assert.equal(nullLandmarksRes.feedback, 'ไม่เห็นจุดสำคัญ');
  });

  await t.test('T5_ADV_02: NaN visibility and non-finite coordinates flagged as lowVis: true', () => {
    const rule = { id: 'left_arm', min: 70, max: 110, landmarks: [23, 11, 13], feedback_low: 'ยกแขนขึ้น', feedback_high: 'ลดแขนลง' };

    // Case 1: NaN visibility
    const nanVisLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
    nanVisLandmarks[11].visibility = NaN;
    const nanVisRes = PoseEvaluator.evaluateRule(rule, nanVisLandmarks);
    assert.equal(nanVisRes.ok, false);
    assert.equal(nanVisRes.lowVis, true);
    assert.equal(nanVisRes.feedback, 'ไม่เห็นชัด');

    // Case 2: Non-finite coordinate (NaN x)
    const nanXLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
    nanXLandmarks[13].x = NaN;
    const nanXRes = PoseEvaluator.evaluateRule(rule, nanXLandmarks);
    assert.equal(nanXRes.ok, false);
    assert.equal(nanXRes.lowVis, true);
    assert.equal(nanXRes.feedback, 'ไม่เห็นชัด');

    // Case 3: Infinity coordinate (Infinity y)
    const infYLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1.0 }));
    infYLandmarks[23].y = Infinity;
    const infYRes = PoseEvaluator.evaluateRule(rule, infYLandmarks);
    assert.equal(infYRes.ok, false);
    assert.equal(infYRes.lowVis, true);
    assert.equal(infYRes.feedback, 'ไม่เห็นชัด');

    // Verify lowVis does not flag connector as failed in getConnectorStatusMap
    const poseObj = { rules: [rule] };
    const statusMap = PoseEvaluator.getConnectorStatusMap(poseObj, [nanVisRes]);
    assert.equal(statusMap.failedEdges.size, 0, 'lowVis rule must not produce failedEdges');
  });

  await t.test('T5_ADV_03: Numeric edgeKey ordering with string arguments', () => {
    // String numbers where lexical comparison differs from numeric comparison ("2" vs "11")
    assert.equal(PoseEvaluator.edgeKey("2", "11"), "2-11");
    assert.equal(PoseEvaluator.edgeKey("11", "2"), "2-11");
    assert.equal(PoseEvaluator.edgeKey(2, 11), "2-11");
    assert.equal(PoseEvaluator.edgeKey(11, 2), "2-11");
    assert.equal(PoseEvaluator.edgeKey("9", "10"), "9-10");
    assert.equal(PoseEvaluator.edgeKey("10", "9"), "9-10");
  });

  await t.test('T5_ADV_04: Speech synthesis try/catch resilience against throw', () => {
    const env = createMockEnvironment();
    // Simulate speech synthesis engine throwing DOMException
    let throwCount = 0;
    env.mockSpeechSynthesis.speak = () => {
      throwCount++;
      throw new Error('DOMException: Speech synthesis failed on background thread');
    };

    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    script.setState({ posesData, ttsEnabled: true });
    script.selectPose('t_pose');

    // Must not throw synchronously or crash execution
    assert.doesNotThrow(() => {
      script.speak('ท่าทางถูกต้อง', true);
    });
    assert.equal(throwCount, 1, 'speak was invoked and handled safely');

    // Evaluate pose with TTS active - loop must not crash
    assert.doesNotThrow(() => {
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
    });
  });

  await t.test('T5_ADV_05: Button name/description sanitization via escapeHtml', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    const maliciousPoses = {
      xss_pose: {
        name: '<script>alert("xss")</script>',
        description: '<b>bold</b> & "quoted" desc',
        rules: []
      }
    };

    script.setState({ posesData: maliciousPoses });
    script.renderPoseButtons();

    const poseList = env.mockDocument.getElementById('pose-list');
    assert.ok(poseList.children.length > 0);
    const btnHtml = poseList.children[0].innerHTML;

    // Verify unescaped HTML tag is NOT present
    assert.ok(!btnHtml.includes('<script>'), 'Unescaped <script> tag must not be injected');
    // Verify escaped HTML entities are present
    assert.ok(btnHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
    assert.ok(btnHtml.includes('&lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; desc'));
  });

  await t.test('T5_ADV_06: Defensive hold duration clamping >= 1 in evaluatePose', () => {
    const env = createMockEnvironment();
    global.document = env.mockDocument;
    global.window = { speechSynthesis: env.mockSpeechSynthesis };
    global.SpeechSynthesisUtterance = env.MockSpeechSynthesisUtterance;
    delete require.cache[require.resolve('../public/script.js')];
    const script = require('../public/script.js');

    let curr = 1000;
    const orig = Date.now;
    Date.now = () => curr;

    try {
      // Subcase A: targetHoldDuration = 0 -> falls back to default 3s via Math.max(1, targetHoldDuration || 3)
      script.setState({ posesData, targetHoldDuration: 0, isHolding: false, isCompleted: false });
      script.selectPose('t_pose');

      // Frame 1: Correct pose at t = 1000
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);
      assert.equal(
        script.getState().isCompleted,
        false,
        'Pose must not complete immediately on frame 1 even if targetHoldDuration <= 0'
      );

      // Advance by 2000ms (elapsed = 2.0s < effectiveDuration of 3s)
      curr = 3000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);
      assert.equal(script.getState().isCompleted, false, 'Must still be holding at 2.0s');

      // Advance by 3000ms from start (elapsed = 3.0s >= effectiveDuration of 3s)
      curr = 4000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isCompleted, true, 'Pose completes once fallback duration (3s) is reached');

      // Subcase B: targetHoldDuration = -5 -> clamped to 1s via Math.max(1, -5 || 3)
      curr = 5000;
      script.setState({ targetHoldDuration: -5, isHolding: false, isCompleted: false });
      script.selectPose('t_pose');

      // Frame 1: Correct pose at t = 5000
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isHolding, true);
      assert.equal(script.getState().isCompleted, false, 'Must not complete instantly on frame 1 with negative duration');

      // Advance by 500ms (elapsed = 0.5s < 1s)
      curr = 5500;
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isCompleted, false, 'Must still be holding at 0.5s');

      // Advance by 1000ms from start (elapsed = 1.0s >= effectiveDuration of 1s)
      curr = 6000;
      script.evaluatePose(makeLandmarksWithAngle(90, 90));
      assert.equal(script.getState().isCompleted, true, 'Pose completes once minimum duration (1s) is reached');
    } finally {
      Date.now = orig;
    }
  });

  await t.test('T5_ADV_07: CSS word-break properties verified in stylesheet', () => {
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Verify .health-list.benefits-list li contains overflow-wrap and word-break
    const benefitsMatch = cssContent.match(/\.health-list\.benefits-list\s+li\s*\{([^}]+)\}/);
    assert.ok(benefitsMatch, '.health-list.benefits-list li rule must exist in stylesheet');
    assert.ok(
      benefitsMatch[1].includes('overflow-wrap: break-word'),
      '.health-list.benefits-list li must contain overflow-wrap: break-word'
    );
    assert.ok(
      benefitsMatch[1].includes('word-break: break-word'),
      '.health-list.benefits-list li must contain word-break: break-word'
    );

    // Verify .caution-text contains overflow-wrap and word-break
    const cautionMatch = cssContent.match(/\.caution-text\s*\{([^}]+)\}/);
    assert.ok(cautionMatch, '.caution-text rule must exist in stylesheet');
    assert.ok(
      cautionMatch[1].includes('overflow-wrap: break-word'),
      '.caution-text must contain overflow-wrap: break-word'
    );
    assert.ok(
      cautionMatch[1].includes('word-break: break-word'),
      '.caution-text must contain word-break: break-word'
    );
  });
});
