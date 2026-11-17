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

  const webcam = getOrCreateElement('webcam', 'video');
  webcam.videoWidth = 640;
  webcam.videoHeight = 480;

  const canvas = getOrCreateElement('output-canvas', 'canvas');
  canvas.width = 640;
  canvas.height = 480;
  canvas.getContext = () => ({
    canvas,
    save: () => {},
    restore: () => {},
    clearRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    drawImage: () => {},
    translate: () => {},
    scale: () => {},
    strokeStyle: '#000',
    lineWidth: 1
  });

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
        poseLabel.innerHTML.includes('badge-floaino'),
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
        angleReadings.innerHTML.includes('badge-floaino'),
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

  await t.test('10. MediaPipe Landmark Evaluation (onPoseResults) Must Not Overwrite Floaino State During Up Pose', () => {
    // Select Up pose and send correct Floaino packet
    app.selectPose('kae_kiat_upward');
    app.handleFloainoPacket({
      timestamp: '10:00:00',
      data: { Arm: '"165"' }
    });

    const stateBefore = app.getState();
    assert.equal(stateBefore.isHolding, true, 'Floaino hold must be active');
    const adviceBefore = env.getElement('advice').textContent;
    const statusClassBefore = env.getElement('status-card').className;
    assert.ok(statusClassBefore.includes('correct'));

    // Create synthetic landmarks (e.g. failing or neutral)
    const syntheticLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));

    // Simulate 10 frames of MediaPipe onPoseResults
    for (let frame = 0; frame < 10; frame++) {
      app.onPoseResults({ poseLandmarks: syntheticLandmarks });
    }

    // Floaino hold state and advice must remain completely untouched
    assert.equal(app.getState().isHolding, true, 'MediaPipe landmark evaluation must not reset Floaino hold');
    assert.equal(env.getElement('advice').textContent, adviceBefore, 'Advice must not be overwritten by MediaPipe');
    assert.equal(env.getElement('status-card').className, statusClassBefore, 'Status card class must not be changed by MediaPipe');

    // Simulate camera lost / occluded frame (null landmarks) during Up pose
    app.onPoseResults({ poseLandmarks: null });
    assert.notEqual(env.getElement('advice').textContent, 'ไม่พบตัวบุคคล กรุณากลับมายืนในระยะกล้อง', 'MediaPipe must not show unmonitored advice during Floaino Up pose');
    assert.equal(app.getState().isHolding, true, 'Null landmarks must not reset Floaino hold timer during Up pose');

    // Conversely, on a non-up pose (e.g. t_pose), null landmarks DOES set unmonitored advice
    app.selectPose('t_pose');
    app.onPoseResults({ poseLandmarks: null });
    assert.equal(env.getElement('advice').textContent, 'ไม่พบตัวบุคคล กรุณากลับมายืนในระยะกล้อง', 'MediaPipe must handle null landmarks on standard non-up poses');
  });

  await t.test('11. ThingsBoard Multi-format Telemetry Parsing & Metadata Immunity', () => {
    app.selectPose('kae_kiat_upward');

    // Telemetry payload with ThingsBoard timestamp key 'ts'
    const resTs = app.handleFloainoPacket({
      data: { ts: 1700000000000, Arm: '"165"' }
    });
    assert.ok(resTs !== null);
    assert.equal(resTs.key, 'Arm');
    assert.equal(resTs.parsed.value, 165);
    assert.equal(resTs.allCorrect, true);

    // ThingsBoard envelope with 'values' sub-object
    const resValues = app.handleFloainoPacket({
      data: { ts: 1700000000000, values: { Arm: '160' } }
    });
    assert.ok(resValues !== null);
    assert.equal(resValues.key, 'Arm');
    assert.equal(resValues.parsed.value, 160);
    assert.equal(resValues.allCorrect, true);

    // Telemetry with alternative angle key 'Angle'
    const resAngle = app.handleFloainoPacket({
      data: { ts: 1700000000000, Angle: '175' }
    });
    assert.ok(resAngle !== null);
    assert.equal(resAngle.key, 'Angle');
    assert.equal(resAngle.parsed.value, 175);
    assert.equal(resAngle.allCorrect, true);

    // Lowercase 'arm' with low angle
    const resLow = app.handleFloainoPacket({
      data: { ts: 1700000000000, arm: '85' }
    });
    assert.ok(resLow !== null);
    assert.equal(resLow.allCorrect, false);
    assert.ok(resLow.feedback.includes('ชูแขน'));

    // Payload containing only timestamp without sensor telemetry
    const resOnlyTs = app.handleFloainoPacket({
      data: { ts: 1700000000000 }
    });
    assert.equal(resOnlyTs.parsed.type, 'unknown', 'Timestamp-only payload must not evaluate as numeric degree');
  });

  await t.test('12. Rapid Switching Stress Test between Up and Non-Up Poses with Live Packet Stream', () => {
    const sequence = ['kae_kiat_upward', 't_pose', 'arms_up', 'kae_kiat_forward', 'kae_kiat_upward', 'arms_down'];

    for (let i = 0; i < sequence.length; i++) {
      const poseKey = sequence[i];
      app.selectPose(poseKey);

      const isUp = app.isFloainoPose(poseKey);
      assert.equal(app.isFloainoPose(poseKey), isUp);

      // Packet streams in while user switches
      const res = app.handleFloainoPacket({
        timestamp: '10:00:00',
        data: { Arm: '"165"' }
      });

      if (isUp) {
        assert.ok(res !== null, `Floaino packet must be processed for Up pose ${poseKey}`);
        assert.equal(res.allCorrect, true);
        assert.equal(app.getState().isHolding, true);
      } else {
        assert.equal(res, null, `Floaino packet must be dropped for non-up pose ${poseKey}`);
        assert.equal(app.getState().isHolding, false);
      }
    }
  });

  await t.test('13. Direction B: Throttled MQTT Publishing of L.Arm and R.Arm on Up Pose', () => {
    app.selectPose('kae_kiat_upward');

    const emitted = [];
    const mockSocket = {
      connected: true,
      emit: (event, payload) => {
        emitted.push({ event, payload });
      }
    };

    app.setState({ socket: mockSocket, lastAnglesPublishTime: 0 });

    // Helper: generate synthetic landmarks for Up Pose
    // Hip (23, 24) -> Shoulder (11, 12) -> Elbow (13, 14) -> Wrist (15, 16)
    // Left: (0.4, 0.8) -> (0.4, 0.4) -> (0.4, 0.1) -> 180 deg
    // Right: (0.6, 0.8) -> (0.6, 0.4) -> (0.6, 0.1) -> 180 deg
    const syntheticUpLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
    syntheticUpLandmarks[23] = { x: 0.4, y: 0.8, visibility: 0.99 };
    syntheticUpLandmarks[11] = { x: 0.4, y: 0.4, visibility: 0.99 };
    syntheticUpLandmarks[13] = { x: 0.4, y: 0.1, visibility: 0.99 };
    syntheticUpLandmarks[15] = { x: 0.4, y: 0.05, visibility: 0.99 };

    syntheticUpLandmarks[24] = { x: 0.6, y: 0.8, visibility: 0.99 };
    syntheticUpLandmarks[12] = { x: 0.6, y: 0.4, visibility: 0.99 };
    syntheticUpLandmarks[14] = { x: 0.6, y: 0.1, visibility: 0.99 };
    syntheticUpLandmarks[16] = { x: 0.6, y: 0.05, visibility: 0.99 };

    // Test extractArmAngles directly
    const extracted = app.extractArmAngles(syntheticUpLandmarks);
    assert.ok(extracted !== null);
    assert.equal(extracted.leftAngle, 180);
    assert.equal(extracted.rightAngle, 180);
    assert.equal(extracted.avgAngle, 180);

    // Initial frame at t = 1000ms: must publish
    const res1 = app.publishAnglesThrottled(syntheticUpLandmarks, 1000);
    assert.ok(res1 !== null);
    assert.equal(res1['L.Arm'], '180');
    assert.equal(res1['R.Arm'], '180');
    assert.equal(res1['Arm'], '180');
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].event, 'publish_angles');
    assert.deepEqual(emitted[0].payload, { "L.Arm": "180", "R.Arm": "180", "Arm": "180" });

    // Rapid successive frames within 500ms (t = 1100, 1200, 1350, 1499): all must be throttled
    const throttledTimes = [1100, 1200, 1350, 1499];
    for (const tVal of throttledTimes) {
      const throttledRes = app.publishAnglesThrottled(syntheticUpLandmarks, tVal);
      assert.equal(throttledRes, null, `Frame at t=${tVal}ms must be throttled`);
      assert.equal(emitted.length, 1, 'No additional socket emit while throttled');
    }

    // Frame at t = 1500ms (>= 500ms elapsed): must publish
    const res2 = app.publishAnglesThrottled(syntheticUpLandmarks, 1500);
    assert.ok(res2 !== null, 'Frame at t=1500ms must publish');
    assert.equal(emitted.length, 2);

    // Also verify live onPoseResults integrates publishAnglesThrottled
    app.setState({ lastAnglesPublishTime: 0 });
    emitted.length = 0;
    app.onPoseResults({ poseLandmarks: syntheticUpLandmarks });
    assert.equal(emitted.length, 1, 'onPoseResults on Up pose must trigger publish_angles');
  });

  await t.test('14. Direction B: Suppression of Publishing During Non-Up Poses', () => {
    const nonUpPoses = ['t_pose', 'kae_kiat_forward', 'arms_down', 'kae_kiat_prep', 'kae_kiat_left', 'kae_kiat_right'];

    const emitted = [];
    const mockSocket = {
      connected: true,
      emit: (event, payload) => {
        emitted.push({ event, payload });
      }
    };
    app.setState({ socket: mockSocket, lastAnglesPublishTime: 0 });

    const syntheticLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));

    for (const poseKey of nonUpPoses) {
      app.selectPose(poseKey);
      emitted.length = 0;

      // Both publishAnglesThrottled and onPoseResults must suppress MQTT publishing
      const pubRes = app.publishAnglesThrottled(syntheticLandmarks, 2000);
      assert.equal(pubRes, null, `publishAnglesThrottled must return null for non-up pose ${poseKey}`);

      app.onPoseResults({ poseLandmarks: syntheticLandmarks });
      assert.equal(emitted.length, 0, `No socket emit must occur for non-up pose ${poseKey}`);
    }
  });

  await t.test('15. Audio State-Transition Gating and Concise Coaching Phrases', () => {
    app.selectPose('kae_kiat_upward');
    app.setState({ ttsEnabled: true, lastSpokenAt: 0, targetHoldDuration: 10 });

    const spokenUtterances = [];
    global.window.speechSynthesis = {
      speaking: false,
      cancel: () => {},
      speak: (u) => { spokenUtterances.push(u); }
    };
    global.SpeechSynthesisUtterance = function(text) { this.text = text; };

    // Step 1: User transitions from idle -> correct hold
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(app.getState().isHolding, true);
    assert.equal(spokenUtterances.length, 1, 'Entering correct hold must trigger speech exactly once');
    assert.equal(spokenUtterances[0].text, 'ท่าถูกต้อง ค้างไว้ครับ', 'Must speak concise hold entrance phrase');

    // Step 2: User maintains hold for 9 seconds (packets arrive every 500ms)
    // Audio State-Transition Gating: DO NOT speak on every packet! Keep silent so user can focus
    for (let frame = 1; frame <= 18; frame++) {
      app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    }
    assert.equal(spokenUtterances.length, 1, 'While holding (seconds 1 to 9), zero additional speech triggers must occur');

    // Step 3: Hold completion reached (10 seconds)
    app.setState({ holdStartTime: Date.now() - 10500 });
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(app.getState().isCompleted, true);
    assert.equal(spokenUtterances.length, 2, 'Completion must trigger speech announcement');
    assert.equal(spokenUtterances[1].text, 'สำเร็จแล้วครับ', 'Must speak concise completion phrase');

    // Step 4: Posture breaks / form incorrect
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"false"' } });
    assert.equal(app.getState().isHolding, false);
    assert.equal(spokenUtterances.length, 3, 'Form break must trigger correction speech');
    assert.equal(spokenUtterances[2].text, 'ชูแขนขึ้นอีกครับ', 'Must speak concise correction phrase');

    // Step 5: Consecutive incorrect packets arrive: must NOT spam audio
    for (let frame = 1; frame <= 10; frame++) {
      app.handleFloainoPacket({ data: { IOT_GATEWAY: '"false"' } });
    }
    assert.equal(spokenUtterances.length, 3, 'Consecutive incorrect packets must not spam audio');

    // Step 6: User corrects posture again
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(app.getState().isHolding, true);
    assert.equal(spokenUtterances.length, 4, 'Re-entering correct hold must speak again');
    assert.equal(spokenUtterances[3].text, 'ท่าถูกต้อง ค้างไว้ครับ');
  });

  await t.test('16. Non-Overlapping Audio Protection (speechSynthesis.speaking)', () => {
    app.setState({ ttsEnabled: true, lastSpokenAt: 0 });

    const spoken = [];
    global.window.speechSynthesis = {
      speaking: true, // Currently speaking an utterance
      cancel: () => {},
      speak: (u) => { spoken.push(u); }
    };
    global.SpeechSynthesisUtterance = function(text) { this.text = text; };

    // With speaking: true, non-forced speech must be suppressed to prevent cutoffs
    app.speak('คำแนะนำไม่ด่วน', false);
    assert.equal(spoken.length, 0, 'Speech must be suppressed when window.speechSynthesis.speaking is true');

    // When speaking becomes false, speech is allowed
    global.window.speechSynthesis.speaking = false;
    app.setState({ lastSpokenAt: 0 });
    app.speak('คำแนะนำปกติ', false);
    assert.equal(spoken.length, 1, 'Speech allowed when window.speechSynthesis.speaking is false');

    // Forced announcement (e.g. completion) cuts through
    global.window.speechSynthesis.speaking = true;
    app.speak('สำเร็จแล้วครับ', true, true);
    assert.equal(spoken.length, 2, 'Forced completion announcement cuts through');
  });

  await t.test('17. Floaino Receiving IOT_GATEWAY: "true" and "false" (Hold progression & reset)', () => {
    app.selectPose('kae_kiat_upward');
    app.setState({ targetHoldDuration: 5 });

    // Floaino sends IOT_GATEWAY: "true"
    const resTrue = app.handleFloainoPacket({
      timestamp: '11:00:00',
      data: { IOT_GATEWAY: '"true"' }
    });
    assert.equal(resTrue.allCorrect, true);
    assert.equal(app.getState().isHolding, true);
    assert.equal(env.getElement('status-card').className, 'status-card correct');

    // Simulate hold completion
    app.setState({ holdStartTime: Date.now() - 5500 });
    const resComplete = app.handleFloainoPacket({
      timestamp: '11:00:05',
      data: { IOT_GATEWAY: '"true"' }
    });
    assert.equal(app.getState().isCompleted, true);
    assert.ok(app.getState().completedPoses.has('kae_kiat_upward'));
    assert.equal(env.getElement('status-card').className, 'status-card correct completed');

    // Floaino sends IOT_GATEWAY: "false" (breaks posture)
    const resFalse = app.handleFloainoPacket({
      timestamp: '11:00:06',
      data: { IOT_GATEWAY: '"false"' }
    });
    assert.equal(resFalse.allCorrect, false);
    assert.equal(app.getState().isHolding, false);
    assert.equal(env.getElement('timer-count').textContent, '0');
    assert.equal(env.getElement('status-card').className, 'status-card incorrect');
  });

  await t.test('18. Backend MQTT Publish Bridge in server.js', () => {
    delete require.cache[require.resolve('../server.js')];
    const serverModule = require('../server.js');

    assert.ok(serverModule.app, 'server.js must export app');
    assert.ok(serverModule.server, 'server.js must export server');
    assert.ok(serverModule.io, 'server.js must export io');
    assert.ok(serverModule.mqttClient, 'server.js must export mqttClient');

    // Simulate MQTT connected state
    serverModule.setIsMqttConnected(true);

    const published = [];
    const origPublish = serverModule.mqttClient.publish;
    serverModule.mqttClient.publish = (topic, payload) => {
      published.push({ topic, payload });
    };

    try {
      // Find publish_angles listener in socket.io connection event
      const socketListeners = serverModule.io.listeners('connection');
      assert.ok(socketListeners.length > 0, 'Socket connection listener must exist');

      const mockSocket = {
        emit: () => {},
        on: (event, handler) => {
          if (event === 'publish_angles') {
            mockSocket._publishAnglesHandler = handler;
          }
        }
      };

      // Invoke socket connection handler to attach listeners
      socketListeners[socketListeners.length - 1](mockSocket);
      assert.ok(typeof mockSocket._publishAnglesHandler === 'function', 'publish_angles handler must be registered');

      // Trigger publish_angles with payload
      const testPayload = { "L.Arm": "165", "R.Arm": "160", "Arm": "163" };
      mockSocket._publishAnglesHandler(testPayload);

      // Verify publishing to both attributes and telemetry
      assert.equal(published.length, 2);
      assert.equal(published[0].topic, 'v1/devices/me/attributes');
      assert.equal(published[0].payload, JSON.stringify(testPayload));
      assert.equal(published[1].topic, 'v1/devices/me/telemetry');
      assert.equal(published[1].payload, JSON.stringify(testPayload));
    } finally {
      // Restore publish and cleanly disconnect mqttClient
      serverModule.mqttClient.publish = origPublish;
      if (typeof serverModule.mqttClient.end === 'function') {
        serverModule.mqttClient.end(true);
      }
    }
  });

  await t.test('19. Direction B: extractArmAngles Low Visibility & NaN Landmark Immunity', () => {
    app.selectPose('kae_kiat_upward');

    // Case A: Null or empty landmarks
    assert.equal(app.extractArmAngles(null), null);
    assert.equal(app.extractArmAngles([]), null);
    assert.equal(app.extractArmAngles(Array(10)), null);

    // Case B: Landmarks with NaN / infinite coordinates
    const nanLandmarks = Array.from({ length: 33 }, () => ({ x: NaN, y: 0.5, visibility: 0.99 }));
    assert.equal(app.extractArmAngles(nanLandmarks), null);

    // Case C: Low visibility (< 0.5) landmarks must return null
    const lowVisLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }));
    assert.equal(app.extractArmAngles(lowVisLandmarks), null);

    // Case D: Occluded hips (seated user) safely falls back to elbow angles when elbows are visible
    const seatedLandmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
    seatedLandmarks[23] = { x: 0.5, y: 0.9, visibility: 0.1 }; // Hip occluded
    seatedLandmarks[24] = { x: 0.5, y: 0.9, visibility: 0.1 }; // Hip occluded
    // Elbows straight (180 deg)
    seatedLandmarks[11] = { x: 0.4, y: 0.5, visibility: 0.99 };
    seatedLandmarks[13] = { x: 0.4, y: 0.3, visibility: 0.99 };
    seatedLandmarks[15] = { x: 0.4, y: 0.1, visibility: 0.99 };
    seatedLandmarks[12] = { x: 0.6, y: 0.5, visibility: 0.99 };
    seatedLandmarks[14] = { x: 0.6, y: 0.3, visibility: 0.99 };
    seatedLandmarks[16] = { x: 0.6, y: 0.1, visibility: 0.99 };

    const seatedAngles = app.extractArmAngles(seatedLandmarks);
    assert.ok(seatedAngles !== null, 'Seated user with occluded hips must fall back to elbow angles');
    assert.equal(seatedAngles.leftAngle, 180);
    assert.equal(seatedAngles.rightAngle, 180);

    // Case E: publishAnglesThrottled must not emit when landmarks return null
    const emitted = [];
    app.setState({
      socket: { emit: (ev, p) => emitted.push({ ev, p }) },
      lastAnglesPublishTime: 0
    });
    const pubRes = app.publishAnglesThrottled(lowVisLandmarks, 10000);
    assert.equal(pubRes, null);
    assert.equal(emitted.length, 0, 'No MQTT publish must occur for low visibility / unconfident landmarks');
  });

  await t.test('20. Audio State Transitions Cut Through Active Speech (No Silent Audio Drops)', () => {
    app.selectPose('kae_kiat_upward');
    app.setState({ ttsEnabled: true, lastSpokenAt: 0, targetHoldDuration: 10 });

    const spoken = [];
    let isSpeaking = false;
    global.window.speechSynthesis = {
      get speaking() { return isSpeaking; },
      cancel: () => { isSpeaking = false; },
      speak: (u) => {
        isSpeaking = true;
        spoken.push(u.text);
      }
    };
    global.SpeechSynthesisUtterance = function(text) { this.text = text; };

    // 1. User enters correct posture -> speaks "ท่าถูกต้อง ค้างไว้ครับ"
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0], 'ท่าถูกต้อง ค้างไว้ครับ');
    assert.equal(isSpeaking, true, 'SpeechSynthesis should be active');

    // 2. While speech is still active (speaking: true), user breaks posture
    // Must NOT drop speech silently! State transition must force through and cancel stale speech
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"false"' } });
    assert.equal(spoken.length, 2, 'Form break must cut through active speech');
    assert.equal(spoken[1], 'ชูแขนขึ้นอีกครับ');
    assert.equal(app.getState().floainoAudioState, 'incorrect');

    // 3. User corrects posture again while correction speech is active
    app.handleFloainoPacket({ data: { IOT_GATEWAY: '"true"' } });
    assert.equal(spoken.length, 3, 'Posture re-correction must cut through active speech');
    assert.equal(spoken[2], 'ท่าถูกต้อง ค้างไว้ครับ');
    assert.equal(app.getState().floainoAudioState, 'holding');
  });

  await t.test('21. Self-Echo Suppression (MediaPipe Angle Stream Echoes Ignored)', () => {
    app.selectPose('kae_kiat_upward');
    app.setState({ isHolding: false, isCompleted: false });

    // Packet that contains MediaPipe angle stream (L.Arm and R.Arm) without Floaino evaluation (IOT_GATEWAY)
    const echoPacket = {
      data: {
        "L.Arm": "165",
        "R.Arm": "160",
        "Arm": "163"
      }
    };
    const echoResult = app.handleFloainoPacket(echoPacket);
    assert.equal(echoResult, null, 'Outgoing MediaPipe angle echo must be ignored by handleFloainoPacket');
    assert.equal(app.getState().isHolding, false, 'Self-echo must not start hold timer');

    // Valid Floaino packet with IOT_GATEWAY is processed
    const validPacket = {
      data: {
        IOT_GATEWAY: '"true"',
        "L.Arm": "165"
      }
    };
    const validResult = app.handleFloainoPacket(validPacket);
    assert.ok(validResult !== null, 'Packet with IOT_GATEWAY must be evaluated');
    assert.equal(validResult.allCorrect, true);
    assert.equal(app.getState().isHolding, true);
  });

  await t.test('22. Server Publish Bridge Defensive Handling of Null / Empty Payloads', () => {
    delete require.cache[require.resolve('../server.js')];
    const serverModule = require('../server.js');
    serverModule.setIsMqttConnected(true);

    const published = [];
    const origPublish = serverModule.mqttClient.publish;
    serverModule.mqttClient.publish = (topic, payload) => {
      published.push({ topic, payload });
    };

    try {
      const socketListeners = serverModule.io.listeners('connection');
      const mockSocket = {
        emit: () => {},
        on: (event, handler) => {
          if (event === 'publish_angles') {
            mockSocket._publishAnglesHandler = handler;
          }
        }
      };
      socketListeners[socketListeners.length - 1](mockSocket);

      // Publishing null or undefined payload must not throw or publish invalid content
      mockSocket._publishAnglesHandler(null);
      mockSocket._publishAnglesHandler(undefined);
      assert.equal(published.length, 0, 'Null/undefined payloads must be ignored');

      // Publishing valid payload
      mockSocket._publishAnglesHandler({ "L.Arm": "170", "R.Arm": "170", "Arm": "170" });
      assert.equal(published.length, 2, 'Valid payload must be published to both attributes and telemetry');
    } finally {
      serverModule.mqttClient.publish = origPublish;
      if (typeof serverModule.mqttClient.end === 'function') {
        serverModule.mqttClient.end(true);
      }
    }
  });
});
