const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// Create mock DOM environment
function createMockFloainoEnv() {
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
    toggle(c, force) {
      if (force !== undefined) {
        if (force) this.classes.add(c);
        else this.classes.delete(c);
        return force;
      }
      if (this.classes.has(c)) {
        this.classes.delete(c);
        return false;
      }
      this.classes.add(c);
      return true;
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
      this._textContent = '';
      this._innerHTML = '';
      this.className = '';
      this.classList = new MockClassList();
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.firstChild = null;
      this.lastChild = null;
    }

    get textContent() {
      return this._textContent;
    }
    set textContent(val) {
      this._textContent = String(val);
      if (!this._innerHTML) {
        this._innerHTML = String(val);
      }
    }

    get innerHTML() {
      return this._innerHTML;
    }
    set innerHTML(val) {
      this._innerHTML = String(val);
      this._textContent = String(val).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    setAttribute(name, val) {
      this.attributes.set(name, String(val));
      if (name.startsWith('data-')) {
        this.dataset = this.dataset || {};
        const key = name.slice(5);
        this.dataset[key] = String(val);
      }
    }

    getAttribute(name) {
      return this.attributes.get(name) || null;
    }

    addEventListener(event, fn) {
      const key = `${this.id || this.tagName}:${event}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    }

    trigger(event, evtObj = {}) {
      const key = `${this.id || this.tagName}:${event}`;
      const fns = listeners.get(key) || [];
      fns.forEach(fn => fn(evtObj));
    }

    appendChild(child) {
      this.children.push(child);
      this.firstChild = this.children[0];
      this.lastChild = this.children[this.children.length - 1];
      return child;
    }

    insertBefore(newNode, refNode) {
      const idx = this.children.indexOf(refNode);
      if (idx === -1) {
        return this.appendChild(newNode);
      }
      this.children.splice(idx, 0, newNode);
      this.firstChild = this.children[0];
      this.lastChild = this.children[this.children.length - 1];
      return newNode;
    }

    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx !== -1) {
        this.children.splice(idx, 1);
        this.firstChild = this.children[0] || null;
        this.lastChild = this.children[this.children.length - 1] || null;
      }
      return child;
    }
  }

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      elements.set(id, new MockElement(id, tag));
    }
    return elements.get(id);
  }

  // Pre-seed DOM elements needed for Floaino & core script
  getOrCreateElement('camera-status', 'div');
  getOrCreateElement('mqtt-status', 'div');
  getOrCreateElement('status-card', 'div');
  getOrCreateElement('pose-label', 'div');
  getOrCreateElement('advice', 'div');
  getOrCreateElement('angle-overlay', 'div');
  getOrCreateElement('angle-readings', 'div');
  getOrCreateElement('timer-display', 'div');
  getOrCreateElement('timer-count', 'span');
  getOrCreateElement('timer-target', 'span');
  getOrCreateElement('timer-progress-bar', 'div');

  const mockDocument = {
    getElementById: (id) => getOrCreateElement(id),
    createElement: (tag) => new MockElement('', tag),
    querySelector: (sel) => {
      const idMatch = sel.match(/^#([\w-]+)$/);
      if (idMatch) return getOrCreateElement(idMatch[1]);
      const dataMatch = sel.match(/\[data-pose-key="([\w-]+)"\]/);
      if (dataMatch) return getOrCreateElement(`btn-${dataMatch[1]}`);
      return new MockElement('', 'div');
    },
    querySelectorAll: (sel) => []
  };

  const mockWindow = {
    speechSynthesis: {
      cancel: () => {},
      speak: () => {}
    },
    addEventListener: () => {}
  };

  return {
    document: mockDocument,
    window: mockWindow,
    getElement: (id) => getOrCreateElement(id)
  };
}

test('Floaino AI & MQTT Integration Suite', async (t) => {
  const env = createMockFloainoEnv();
  global.document = env.document;
  global.window = env.window;

  // Load script
  delete require.cache[require.resolve('../public/script.js')];
  const app = require('../public/script.js');

  await t.test('1. Quote Stripping Utility (stripQuotes)', () => {
    assert.equal(app.stripQuotes('"true"'), 'true');
    assert.equal(app.stripQuotes('""false""'), 'false');
    assert.equal(app.stripQuotes("'154'"), '154');
    assert.equal(app.stripQuotes('"155.5"'), '155.5');
    assert.equal(app.stripQuotes('plain_value'), 'plain_value');
    assert.equal(app.stripQuotes(null), '');
    assert.equal(app.stripQuotes(undefined), '');
  });

  await t.test('2. Floaino Value Parser (parseFloainoValue)', () => {
    // Stringified booleans encased in quotes
    const trueParsed = app.parseFloainoValue('"true"');
    assert.equal(trueParsed.type, 'boolean');
    assert.equal(trueParsed.ok, true);

    const falseParsed = app.parseFloainoValue('"false"');
    assert.equal(falseParsed.type, 'boolean');
    assert.equal(falseParsed.ok, false);

    const oneParsed = app.parseFloainoValue('"1"');
    assert.equal(oneParsed.type, 'boolean');
    assert.equal(oneParsed.ok, true);

    const zeroParsed = app.parseFloainoValue('"0"');
    assert.equal(zeroParsed.type, 'boolean');
    assert.equal(zeroParsed.ok, false);

    // Numeric angles encased in quotes
    const num154 = app.parseFloainoValue('"154"');
    assert.equal(num154.type, 'number');
    assert.equal(num154.value, 154);

    const num85 = app.parseFloainoValue('"85"');
    assert.equal(num85.type, 'number');
    assert.equal(num85.value, 85);
  });

  await t.test('3. Clean UI Layout Verification (No manual engine switcher, compact simulation preserved)', () => {
    const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
    const cssPath = path.join(__dirname, '..', 'public', 'styles.css');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Manual switcher and large card removed
    assert.equal(html.includes('engine-switch-group'), false, 'index.html must not contain engine-switch-group');
    assert.equal(html.includes('engine-mediapipe-btn'), false, 'index.html must not contain engine-mediapipe-btn');
    assert.equal(html.includes('engine-floaino-btn'), false, 'index.html must not contain engine-floaino-btn');
    assert.equal(html.includes('id="floaino-card"'), false, 'index.html must not contain large floaino-card');
    assert.equal(css.includes('.engine-switch-group'), false, 'styles.css must not contain .engine-switch-group');

    // Compact simulation controls retained inside debug panel
    assert.ok(html.includes('debug-sim-box'), 'index.html must contain compact debug-sim-box');
    assert.ok(html.includes('simulateFloaino'), 'index.html must contain simulateFloaino buttons');
    assert.ok(css.includes('.badge-floaino'), 'styles.css must define .badge-floaino');
  });

  await t.test('4. Selective Processing: Floaino Packets Dropped When Non-Up Pose is Selected', () => {
    // Test with various non-up poses
    const nonUpPoses = ['t_pose', 'kae_kiat_forward', 'arms_down', 'kae_kiat_prep'];

    for (const poseKey of nonUpPoses) {
      app.selectPose(poseKey);
      assert.equal(app.isFloainoPose(poseKey), false, `${poseKey} must not be a Floaino pose`);
      assert.equal(app.getEngine(), 'mediapipe', `Engine must be mediapipe for ${poseKey}`);

      const adviceBefore = env.getElement('advice').textContent;

      // Send correct Floaino packet
      const res = app.handleFloainoPacket({
        timestamp: '10:00:00',
        topic: 'v1/devices/me/attributes',
        data: { Arm: '"160"' }
      });

      // Packet must be ignored / discarded
      assert.equal(res, null, `Floaino packet must return null (dropped) when ${poseKey} is active`);
      assert.equal(app.getState().isHolding, false, `Hold timer must not start for non-up pose ${poseKey}`);
      assert.equal(env.getElement('advice').textContent, adviceBefore, `Advice must not be altered by Floaino for ${poseKey}`);
    }

    // Also verify when no pose is selected (null)
    app.setState({ selectedPoseKey: null });
    const resNoPose = app.handleFloainoPacket({ data: { Arm: '"160"' } });
    assert.equal(resNoPose, null, 'Floaino packet must be dropped when no pose is selected');
  });

  await t.test('5. Up Pose Activation: kae_kiat_upward and arms_up process Floaino packets', () => {
    const upPoses = ['kae_kiat_upward', 'arms_up'];

    for (const upPoseKey of upPoses) {
      assert.ok(app.FLOAINO_UP_POSES.includes(upPoseKey), `${upPoseKey} must be in FLOAINO_UP_POSES`);
      assert.equal(app.isFloainoPose(upPoseKey), true, `isFloainoPose must return true for ${upPoseKey}`);

      app.selectPose(upPoseKey);
      assert.equal(app.getEngine(), 'floaino', `getEngine must return floaino for ${upPoseKey}`);

      // Initial state: Waiting for Floaino signal
      const adviceEl = env.getElement('advice');
      assert.ok(
        adviceEl.textContent.includes('รอรับสัญญาณมุมแขนจาก Floaino AI...'),
        `Initial advice for ${upPoseKey} must prompt for Floaino signal`
      );

      // Status card / pose label must display subtle Floaino badge
      const poseLabel = env.getElement('pose-label');
      assert.ok(
        poseLabel.innerHTML.includes('badge-floaino') || poseLabel.textContent.includes('Floaino AI'),
        `Pose label must display Floaino AI badge for ${upPoseKey}`
      );

      // Send valid Up pose packet (160° within 150°–180° range)
      const res = app.handleFloainoPacket({
        timestamp: '10:00:00',
        topic: 'v1/devices/me/attributes',
        data: { Arm: '"160"' }
      });

      assert.ok(res !== null, `Packet must be processed for ${upPoseKey}`);
      assert.equal(res.allCorrect, true, `160° must evaluate to allCorrect: true for ${upPoseKey}`);
      assert.equal(app.getState().isHolding, true, `Hold timer must start for ${upPoseKey}`);

      // Angle readings list must contain Floaino badge
      const angleReadings = env.getElement('angle-readings');
      assert.ok(
        angleReadings.innerHTML.includes('badge-floaino') || angleReadings.textContent.includes('Floaino AI'),
        `Angle readings list must show Floaino AI badge for ${upPoseKey}`
      );
    }
  });

  await t.test('6. Arm Angle Threshold Logic (150°–180° pass, <150° advice to raise arms)', () => {
    app.selectPose('kae_kiat_upward');

    // Passing threshold boundaries: 150°, 165°, 180°
    const passAngles = ['150', '165', '180'];
    for (const angleStr of passAngles) {
      const res = app.handleFloainoPacket({
        timestamp: '10:00:00',
        data: { Arm: `"${angleStr}"` }
      });
      assert.equal(res.allCorrect, true, `Angle ${angleStr}° must pass (150°–180°)`);
      assert.ok(res.feedback.includes('ถูกต้องตามเกณฑ์'), 'Passing feedback must confirm compliance');
      assert.equal(app.getState().isHolding, true);
    }

    // Failing low angles (< 150°): 85°, 140°
    const lowAngles = ['85', '140'];
    for (const angleStr of lowAngles) {
      const res = app.handleFloainoPacket({
        timestamp: '10:00:01',
        data: { Arm: `"${angleStr}"` }
      });
      assert.equal(res.allCorrect, false, `Angle ${angleStr}° must fail (< 150°)`);
      assert.ok(
        res.feedback.includes('ชูแขน') || res.feedback.includes('แนบใบหู'),
        `Feedback for ${angleStr}° must advise raising arms higher`
      );
      assert.equal(app.getState().isHolding, false, 'Hold timer must reset on incorrect angle');
      assert.equal(env.getElement('timer-count').textContent, '0');
    }

    // Failing high angle (> 180°): 195°
    const resHigh = app.handleFloainoPacket({
      timestamp: '10:00:02',
      data: { Arm: '"195"' }
    });
    assert.equal(resHigh.allCorrect, false);
    assert.ok(resHigh.feedback.includes('ลดแขน') || resHigh.feedback.includes('แนวตรง'));

    // Boolean true / false packets
    const resTrue = app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(resTrue.allCorrect, true);

    const resFalse = app.handleFloainoPacket({ data: { IOT_GATEWAY: '"false"' } });
    assert.equal(resFalse.allCorrect, false);
  });

  await t.test('7. Simulation Helper (simulateFloaino)', () => {
    // Start on a non-up pose
    app.selectPose('t_pose');
    assert.equal(app.getState().selectedPoseKey, 't_pose');

    // Calling simulateFloaino('160') automatically switches to an Up pose (kae_kiat_upward)
    app.simulateFloaino('160');
    assert.equal(app.isFloainoPose(app.getState().selectedPoseKey), true);
    assert.equal(app.getState().isHolding, true);

    // Simulating incorrect posture breaks hold
    app.simulateFloaino('85');
    assert.equal(app.getState().isHolding, false);
    assert.equal(env.getElement('status-card').className, 'status-card incorrect');

    // Simulating true resumes hold
    app.simulateFloaino('true');
    assert.equal(app.getState().isHolding, true);
  });

  await t.test('8. Floaino Hold Timer Completion Progression on Up Pose', () => {
    app.selectPose('kae_kiat_upward');
    app.setState({ targetHoldDuration: 2 });

    // Initial correct packet
    app.handleFloainoPacket({
      timestamp: '10:00:00',
      data: { Arm: '"165"' }
    });

    const midState = app.getState();
    assert.equal(midState.isHolding, true);
    assert.equal(midState.isCompleted, false);

    // Advance holdStartTime backwards by 2.5s (exceeding 2s target)
    app.setState({ holdStartTime: Date.now() - 2500 });

    // Next correct packet arrives
    app.handleFloainoPacket({
      timestamp: '10:00:02',
      data: { Arm: '"165"' }
    });

    const finalState = app.getState();
    assert.equal(finalState.isCompleted, true);
    assert.ok(finalState.completedPoses.has('kae_kiat_upward'));
    assert.equal(env.getElement('status-card').className, 'status-card correct completed');
  });

  await t.test('9. MQTT Status UI Updates (updateMqttStatusUI)', () => {
    app.updateMqttStatusUI({ connected: true });
    const mqttEl = env.getElement('mqtt-status');
    assert.ok(mqttEl.textContent.includes('เชื่อมต่อแล้ว'));
    assert.equal(mqttEl.className, 'badge connected');

    app.updateMqttStatusUI({ connected: false });
    assert.ok(mqttEl.textContent.includes('รอเชื่อมต่อ'));
    assert.equal(mqttEl.className, 'badge disconnected');
  });
});
