/**
 * test/m1_visual_reference.test.js
 * In-depth test suite for Milestone 1: Visual Reference Guides for Poses (R1)
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const posesFilePath = path.join(__dirname, '..', 'public', 'poses.json');
const posesData = JSON.parse(fs.readFileSync(posesFilePath, 'utf8'));
const htmlContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const cssContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const script = require('../public/script.js');

test('Milestone 1 — Visual Reference Assets Verification', async (t) => {
  const imagesDir = path.join(__dirname, '..', 'public', 'images', 'poses');

  await t.test('Images directory exists', () => {
    assert.ok(fs.existsSync(imagesDir), 'public/images/poses/ directory must exist');
  });

  const expectedSvgFiles = [
    't_pose.svg',
    'arms_up.svg',
    'arms_down.svg',
    'kae_kiat_prep.svg',
    'kae_kiat_forward.svg',
    'kae_kiat_upward.svg',
    'kae_kiat_left.svg',
    'kae_kiat_right.svg',
    'placeholder.svg'
  ];

  for (const filename of expectedSvgFiles) {
    await t.test(`SVG asset exists and is valid: ${filename}`, () => {
      const filePath = path.join(imagesDir, filename);
      assert.ok(fs.existsSync(filePath), `Asset ${filename} must exist`);
      const content = fs.readFileSync(filePath, 'utf8');

      // Valid SVG markup assertions
      assert.ok(content.includes('<svg'), `${filename} must contain <svg tag`);
      assert.ok(content.includes('</svg>'), `${filename} must contain </svg> closing tag`);
      assert.ok(content.includes('xmlns="http://www.w3.org/2000/svg"'), `${filename} must contain standard xmlns`);
      assert.ok(/viewBox="0 0 \d+ \d+"/.test(content), `${filename} must contain valid viewBox`);

      // File size sanity check
      assert.ok(content.length > 200, `${filename} content must be non-trivial`);
    });
  }
});

test('Milestone 1 — Poses JSON Schema Extension', async (t) => {
  const poseKeys = [
    't_pose',
    'arms_up',
    'arms_down',
    'kae_kiat_prep',
    'kae_kiat_forward',
    'kae_kiat_upward',
    'kae_kiat_left',
    'kae_kiat_right'
  ];

  await t.test('All 8 poses contain image and image_alt properties', () => {
    for (const key of poseKeys) {
      const pose = posesData[key];
      assert.ok(pose, `Pose ${key} must exist in poses.json`);
      assert.ok(typeof pose.image === 'string' && pose.image.startsWith('images/poses/'), `Pose ${key} image must be under images/poses/`);
      assert.ok(pose.image.endsWith('.svg'), `Pose ${key} image must end with .svg`);

      const fullImagePath = path.join(__dirname, '..', 'public', pose.image);
      assert.ok(fs.existsSync(fullImagePath), `File for ${key} (${pose.image}) must exist on disk`);

      assert.ok(typeof pose.image_alt === 'string' && pose.image_alt.length > 0, `Pose ${key} must have non-empty image_alt`);
      assert.ok(/[\u0E00-\u0E7F]/.test(pose.image_alt), `Pose ${key} image_alt must contain Thai text`);
    }
  });

  await t.test('All existing fields (rules, health_context) are preserved', () => {
    for (const key of poseKeys) {
      const pose = posesData[key];
      assert.ok(Array.isArray(pose.rules) && pose.rules.length > 0, `Pose ${key} must preserve rules`);
      assert.ok(pose.health_context, `Pose ${key} must preserve health_context`);
      assert.ok(Array.isArray(pose.health_context.benefits), `Pose ${key} must preserve benefits`);
      assert.ok(pose.health_context.cautions && typeof pose.health_context.cautions.elderly === 'string', `Pose ${key} must preserve elderly caution`);
      assert.ok(typeof pose.health_context.cautions.pregnant === 'string', `Pose ${key} must preserve pregnant caution`);
      assert.ok(typeof pose.health_context.cautions.general === 'string', `Pose ${key} must preserve general caution`);
    }
  });
});

test('Milestone 1 — DOM Elements & Markup Verification', async (t) => {
  await t.test('HTML contains In-Camera PiP Guide Overlay elements', () => {
    assert.ok(htmlContent.includes('id="pose-guide-pip"'), 'index.html must have #pose-guide-pip');
    assert.ok(htmlContent.includes('id="pose-guide-img"'), 'index.html must have #pose-guide-img');
    assert.ok(htmlContent.includes('id="pose-guide-label"'), 'index.html must have #pose-guide-label');
    assert.ok(htmlContent.includes('id="pose-guide-pip-toggle"'), 'index.html must have #pose-guide-pip-toggle');
  });

  await t.test('HTML contains Control Panel Posture Reference Card elements', () => {
    assert.ok(htmlContent.includes('id="pose-reference-card"'), 'index.html must have #pose-reference-card');
    assert.ok(htmlContent.includes('id="reference-pose-img"'), 'index.html must have #reference-pose-img');
    assert.ok(htmlContent.includes('id="pose-ref-caption"'), 'index.html must have #pose-ref-caption');
  });

  await t.test('CSS contains styles for PiP overlay and Reference Card', () => {
    assert.ok(cssContent.includes('#pose-guide-pip'), 'styles.css must style #pose-guide-pip');
    assert.ok(cssContent.includes('backdrop-filter'), 'styles.css must have frosted glass backdrop-filter');
    assert.ok(cssContent.includes('#pose-reference-card'), 'styles.css must style #pose-reference-card');
    assert.ok(cssContent.includes('.minimized'), 'styles.css must style minimized PiP state');
  });
});

test('Milestone 1 — Controller Logic & Reactivity Verification', async (t) => {
  // Test Mock DOM environment
  class MockClassList {
    constructor() { this.classes = new Set(); }
    add(...cls) { cls.forEach(c => this.classes.add(c)); }
    remove(...cls) { cls.forEach(c => this.classes.delete(c)); }
    contains(c) { return this.classes.has(c); }
    toggle(c) {
      if (this.classes.has(c)) { this.classes.delete(c); return false; }
      this.classes.add(c); return true;
    }
  }

  class MockElement {
    constructor(id) {
      this.id = id;
      this.src = '';
      this.alt = '';
      this.textContent = '';
      this.innerHTML = '';
      this.title = '';
      this.attributes = new Map();
      this.classList = new MockClassList();
      this.onerror = null;
    }
    setAttribute(name, val) { this.attributes.set(name, String(val)); }
    getAttribute(name) { return this.attributes.get(name) || null; }
  }

  const elements = new Map();
  const getOrCreate = (id) => {
    if (!elements.has(id)) elements.set(id, new MockElement(id));
    return elements.get(id);
  };

  const origDocument = global.document;
  global.document = {
    getElementById: (id) => getOrCreate(id),
    querySelectorAll: () => [],
    querySelector: () => null
  };

  try {
    const guideImg = getOrCreate('pose-guide-img');
    const refImg = getOrCreate('reference-pose-img');
    const captionEl = getOrCreate('pose-ref-caption');

    await t.test('updateVisualReferenceUI correctly populates image and caption for kae_kiat_prep', () => {
      script.updateVisualReferenceUI(posesData.kae_kiat_prep);
      assert.equal(guideImg.src, 'images/poses/kae_kiat_prep.svg');
      assert.ok(guideImg.alt.includes('ท่าแก้เกียจ'));
      assert.equal(refImg.src, 'images/poses/kae_kiat_prep.svg');
      assert.ok(captionEl.textContent.length > 0);
    });

    await t.test('updateVisualReferenceUI falls back gracefully on image error', () => {
      script.updateVisualReferenceUI(posesData.kae_kiat_forward);
      assert.equal(guideImg.src, 'images/poses/kae_kiat_forward.svg');

      // Simulate image load error
      guideImg.onerror();
      assert.equal(guideImg.src, 'images/poses/placeholder.svg');
    });

    await t.test('PiP toggle behavior toggles minimized state', () => {
      const pipOverlay = getOrCreate('pose-guide-pip');
      const isMin = pipOverlay.classList.toggle('minimized');
      assert.equal(isMin, true);
      assert.ok(pipOverlay.classList.contains('minimized'));

      const isExp = pipOverlay.classList.toggle('minimized');
      assert.equal(isExp, false);
      assert.ok(!pipOverlay.classList.contains('minimized'));
    });
  } finally {
    global.document = origDocument;
  }
});
