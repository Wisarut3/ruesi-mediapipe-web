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
      this.textContent = '';
      this.innerHTML = '';
      this.className = '';
      this.classList = new MockClassList();
      this.style = {};
      this.attributes = new Map();
      this.children = [];
      this.firstChild = null;
      this.lastChild = null;
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
  getOrCreateElement('engine-mediapipe-btn', 'button');
  getOrCreateElement('engine-floaino-btn', 'button');
  getOrCreateElement('camera-status', 'div');
  getOrCreateElement('mqtt-status', 'div');
  getOrCreateElement('floaino-card', 'div');
  getOrCreateElement('floaino-conn-badge', 'span');
  getOrCreateElement('floaino-timestamp', 'span');
  getOrCreateElement('floaino-raw-json', 'pre');
  getOrCreateElement('floaino-log-list', 'ul');
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

  await t.test('3. Engine Switcher Mechanics (setEngine)', () => {
    // Initial state is mediapipe
    assert.equal(app.getEngine(), 'mediapipe');

    // Switch to Floaino
    app.setEngine('floaino');
    assert.equal(app.getEngine(), 'floaino');

    const camEl = env.getElement('camera-status');
    const mqttEl = env.getElement('mqtt-status');
    const cardEl = env.getElement('floaino-card');

    assert.equal(camEl.style.display, 'none');
    assert.equal(mqttEl.style.display, '');
    assert.equal(cardEl.style.display, 'block');

    // Switch back to MediaPipe
    app.setEngine('mediapipe');
    assert.equal(app.getEngine(), 'mediapipe');
    assert.equal(camEl.style.display, '');
    assert.equal(mqttEl.style.display, 'none');
    assert.equal(cardEl.style.display, 'none');
  });

  await t.test('4. MQTT Status UI Updates (updateMqttStatusUI)', () => {
    app.updateMqttStatusUI({ connected: true });
    const mqttEl = env.getElement('mqtt-status');
    const badgeEl = env.getElement('floaino-conn-badge');

    assert.ok(mqttEl.textContent.includes('เชื่อมต่อแล้ว'));
    assert.equal(mqttEl.className, 'badge connected');
    assert.equal(badgeEl.className, 'badge connected');

    app.updateMqttStatusUI({ connected: false });
    assert.ok(mqttEl.textContent.includes('รอเชื่อมต่อ'));
    assert.equal(mqttEl.className, 'badge disconnected');
  });

  await t.test('5. Floaino Packet Handling for Single Target Pose (kae_kiat_forward)', () => {
    app.setEngine('floaino');
    app.selectPose('kae_kiat_forward');

    // Test Boolean "true" packet
    const resTrue = app.handleFloainoPacket({
      timestamp: '10:00:00',
      topic: 'v1/devices/me/attributes',
      data: { IOT_GATEWAY: '"true"' }
    });
    assert.equal(resTrue.allCorrect, true);
    assert.equal(resTrue.key, 'IOT_GATEWAY');

    // Test Boolean "false" packet
    const resFalse = app.handleFloainoPacket({
      timestamp: '10:00:01',
      topic: 'v1/devices/me/attributes',
      data: { IOT_GATEWAY: '"false"' }
    });
    assert.equal(resFalse.allCorrect, false);

    // Test Numeric angle in target range (125°–180° for kae_kiat_forward arm)
    const resArmOk = app.handleFloainoPacket({
      timestamp: '10:00:02',
      topic: 'v1/devices/me/attributes',
      data: { Arm: '"154"' }
    });
    assert.equal(resArmOk.allCorrect, true);
    assert.ok(resArmOk.feedback.includes('ถูกต้องตามเกณฑ์'));

    // Test Numeric angle out of range (85° < 125°)
    const resArmBad = app.handleFloainoPacket({
      timestamp: '10:00:03',
      topic: 'v1/devices/me/attributes',
      data: { Arm: '"85"' }
    });
    assert.equal(resArmBad.allCorrect, false);
    assert.ok(resArmBad.feedback.includes('ต่ำกว่าเกณฑ์') || resArmBad.feedback.includes('เหยียดแขน'));
  });

  await t.test('6. Simulation Helper (simulateFloaino)', () => {
    // Switch to mediapipe first
    app.setEngine('mediapipe');
    assert.equal(app.getEngine(), 'mediapipe');

    // Calling simulateFloaino automatically activates floaino engine
    app.simulateFloaino('true');
    assert.equal(app.getEngine(), 'floaino');

    const state = app.getState();
    assert.equal(state.currentEngine, 'floaino');
    assert.equal(state.isHolding, true);

    // Calling simulateFloaino('false') resets hold
    app.simulateFloaino('false');
    const badState = app.getState();
    assert.equal(badState.isHolding, false);
  });

  await t.test('7. Floaino Hold Timer Completion Progression', () => {
    app.setEngine('floaino');
    app.selectPose('kae_kiat_forward');
    app.setState({ targetHoldDuration: 2 });

    // Initial correct packet
    app.handleFloainoPacket({
      timestamp: '10:00:00',
      data: { IOT_GATEWAY: '"true"' }
    });

    const midState = app.getState();
    assert.equal(midState.isHolding, true);
    assert.equal(midState.isCompleted, false);

    // Artificially advance holdStartTime backwards by 2.5s to simulate holding
    app.setState({ holdStartTime: Date.now() - 2500 });

    // Next correct packet arrives
    app.handleFloainoPacket({
      timestamp: '10:00:02',
      data: { IOT_GATEWAY: '"true"' }
    });

    const finalState = app.getState();
    assert.equal(finalState.isCompleted, true);
    assert.ok(finalState.completedPoses.has('kae_kiat_forward'));
  });
});
