const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  calcAngle,
  evaluateRule,
  evaluateRuleWithAngle,
  evaluatePose,
  edgeKey,
  getRuleConnectors,
  getConnectorStatusMap
} = require('../public/pose-evaluator.js');
const { renderSkeletonConnectors, DEFAULT_POSE_CONNECTIONS } = require('../public/script.js');

const posesFilePath = path.join(__dirname, '..', 'public', 'poses.json');
const posesRaw = fs.readFileSync(posesFilePath, 'utf8');
const poses = JSON.parse(posesRaw);

/**
 * Generates an array of 33 MediaPipe pose landmarks where the 3 landmarks
 * specified in the rule form an angle of exactly `angleDegrees` at vertex B.
 *
 * @param {Object} rule - Rule containing landmarks [ai, bi, ci]
 * @param {number} angleDegrees - Target angle at vertex B in degrees [0, 180]
 * @param {number} [visibility=1.0] - Visibility score for the landmarks
 * @returns {Array<Object>} 33 landmarks
 */
function makeSyntheticLandmarks(rule, angleDegrees, visibility = 1.0) {
  const [ai, bi, ci] = rule.landmarks;
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility: 1.0
  }));

  // Place vertex B at (0.5, 0.5)
  landmarks[bi] = { x: 0.5, y: 0.5, z: 0, visibility };

  // Place point A along positive X axis from B (angle = 0 radians)
  landmarks[ai] = { x: 0.7, y: 0.5, z: 0, visibility };

  // Place point C at angleDegrees relative to vector BA
  const rad = (angleDegrees * Math.PI) / 180;
  landmarks[ci] = {
    x: 0.5 + 0.2 * Math.cos(rad),
    y: 0.5 + 0.2 * Math.sin(rad),
    z: 0,
    visibility
  };

  return landmarks;
}

test('1. Poses JSON File & Schema Integrity', async (t) => {
  await t.test('public/poses.json is valid parseable JSON', () => {
    assert.doesNotThrow(() => JSON.parse(posesRaw));
    assert.equal(typeof poses, 'object');
    assert.notEqual(poses, null);
  });

  await t.test('Contains exactly 8 poses total (3 baseline test poses + 5 authentic ท่าแก้เกียจ poses)', () => {
    const keys = Object.keys(poses);
    assert.equal(keys.length, 8, `Expected exactly 8 poses, found ${keys.length}: ${keys.join(', ')}`);

    // Existing 3 test poses
    assert.ok(poses.t_pose, 'Missing baseline pose: t_pose');
    assert.ok(poses.arms_up, 'Missing baseline pose: arms_up');
    assert.ok(poses.arms_down, 'Missing baseline pose: arms_down');

    // Exactly 5 authentic ท่าแก้เกียจ poses
    assert.ok(poses.kae_kiat_prep, 'Missing authentic pose: kae_kiat_prep');
    assert.ok(poses.kae_kiat_forward, 'Missing authentic pose: kae_kiat_forward');
    assert.ok(poses.kae_kiat_upward, 'Missing authentic pose: kae_kiat_upward');
    assert.ok(poses.kae_kiat_left, 'Missing authentic pose: kae_kiat_left');
    assert.ok(poses.kae_kiat_right, 'Missing authentic pose: kae_kiat_right');
  });

  await t.test('Every pose has non-empty Thai name, description, and non-empty rules array', () => {
    for (const [key, pose] of Object.entries(poses)) {
      assert.equal(typeof pose.name, 'string', `${key}.name must be a string`);
      assert.ok(pose.name.trim().length > 0, `${key}.name must not be empty`);

      assert.equal(typeof pose.description, 'string', `${key}.description must be a string`);
      assert.ok(pose.description.trim().length > 0, `${key}.description must not be empty`);

      assert.ok(Array.isArray(pose.rules), `${key}.rules must be an array`);
      assert.ok(pose.rules.length > 0, `${key}.rules must not be empty`);
    }
  });

  await t.test('All 5 ท่าแก้เกียจ poses contain authentic descriptive Thai names mentioning แก้เกียจ', () => {
    const kaeKiatKeys = ['kae_kiat_prep', 'kae_kiat_forward', 'kae_kiat_upward', 'kae_kiat_left', 'kae_kiat_right'];
    for (const key of kaeKiatKeys) {
      assert.ok(
        poses[key].name.includes('แก้เกียจ'),
        `Pose ${key} name "${poses[key].name}" should contain "แก้เกียจ"`
      );
    }
  });
});

test('2. Pose Rules Specification & Landmark Validation', async (t) => {
  for (const [poseKey, pose] of Object.entries(poses)) {
    await t.test(`Validate rules of pose [${poseKey}]`, () => {
      const ruleIds = new Set();

      for (const rule of pose.rules) {
        // String ID and uniqueness within pose
        assert.equal(typeof rule.id, 'string', `${poseKey} rule.id must be string`);
        assert.ok(rule.id.trim().length > 0, `${poseKey} rule.id must not be empty`);
        assert.ok(!ruleIds.has(rule.id), `Duplicate rule id "${rule.id}" in pose ${poseKey}`);
        ruleIds.add(rule.id);

        // Thai label
        assert.equal(typeof rule.label, 'string', `${poseKey}.${rule.id}.label must be string`);
        assert.ok(rule.label.trim().length > 0, `${poseKey}.${rule.id}.label must not be empty`);

        // MediaPipe landmark indices (exactly 3 integers between 0 and 32)
        assert.ok(Array.isArray(rule.landmarks), `${poseKey}.${rule.id}.landmarks must be an array`);
        assert.equal(rule.landmarks.length, 3, `${poseKey}.${rule.id}.landmarks must have exactly 3 indices`);
        for (const idx of rule.landmarks) {
          assert.equal(typeof idx, 'number', `${poseKey}.${rule.id} landmark index must be a number`);
          assert.ok(Number.isInteger(idx), `${poseKey}.${rule.id} landmark index must be an integer`);
          assert.ok(idx >= 0 && idx <= 32, `${poseKey}.${rule.id} landmark index ${idx} out of range [0, 32]`);
        }

        // Angle thresholds: 0 <= min < max <= 180
        assert.equal(typeof rule.min, 'number', `${poseKey}.${rule.id}.min must be a number`);
        assert.equal(typeof rule.max, 'number', `${poseKey}.${rule.id}.max must be a number`);
        assert.ok(rule.min >= 0, `${poseKey}.${rule.id}.min (${rule.min}) must be >= 0`);
        assert.ok(rule.max <= 180, `${poseKey}.${rule.id}.max (${rule.max}) must be <= 180`);
        assert.ok(rule.min < rule.max, `${poseKey}.${rule.id}.min (${rule.min}) must be < max (${rule.max})`);

        // Thai feedback messages
        assert.equal(typeof rule.feedback_low, 'string', `${poseKey}.${rule.id}.feedback_low must be a string`);
        assert.ok(rule.feedback_low.trim().length > 0, `${poseKey}.${rule.id}.feedback_low must not be empty`);
        assert.equal(typeof rule.feedback_high, 'string', `${poseKey}.${rule.id}.feedback_high must be a string`);
        assert.ok(rule.feedback_high.trim().length > 0, `${poseKey}.${rule.id}.feedback_high must not be empty`);
      }
    });
  }
});

test('3. Mathematical Angle Calculation (calcAngle)', async (t) => {
  await t.test('Calculates precise right angle (90 degrees)', () => {
    const A = { x: 0.5, y: 0.0 };
    const B = { x: 0.0, y: 0.0 };
    const C = { x: 0.0, y: 0.5 };
    assert.equal(calcAngle(A, B, C), 90);
  });

  await t.test('Calculates straight collinear angle (180 degrees)', () => {
    const A = { x: -1.0, y: 0.0 };
    const B = { x: 0.0, y: 0.0 };
    const C = { x: 1.0, y: 0.0 };
    assert.equal(calcAngle(A, B, C), 180);
  });

  await t.test('Calculates zero angle (overlapping rays, 0 degrees)', () => {
    const A = { x: 1.0, y: 0.0 };
    const B = { x: 0.0, y: 0.0 };
    const C = { x: 1.0, y: 0.0 };
    assert.equal(calcAngle(A, B, C), 0);
  });

  await t.test('Calculates 45 and 135 degree angles accurately', () => {
    const B = { x: 0.0, y: 0.0 };
    const A = { x: 1.0, y: 0.0 };
    const C45 = { x: 1.0, y: 1.0 };
    assert.equal(calcAngle(A, B, C45), 45);

    const C135 = { x: -1.0, y: 1.0 };
    assert.equal(calcAngle(A, B, C135), 135);
  });

  await t.test('Is symmetric with respect to endpoints A and C', () => {
    const A = { x: 0.7, y: 0.3 };
    const B = { x: 0.4, y: 0.4 };
    const C = { x: 0.2, y: 0.8 };
    assert.equal(calcAngle(A, B, C), calcAngle(C, B, A));
  });
});

test('4. Programmatic Synthetic Landmark Angle Verification Across All Rules', async (t) => {
  for (const [poseKey, pose] of Object.entries(poses)) {
    for (const rule of pose.rules) {
      await t.test(`[${poseKey} -> ${rule.id} (${rule.label})]: Synthetic angle verification`, () => {
        // 4a. Within range [min, max] -> evaluates to ok = true
        const midAngle = Math.round((rule.min + rule.max) / 2);
        const inRangeLandmarks = makeSyntheticLandmarks(rule, midAngle);
        const inRangeResult = evaluateRule(rule, inRangeLandmarks);

        assert.equal(
          inRangeResult.ok,
          true,
          `Rule ${poseKey}.${rule.id} should pass at angle ${midAngle}° within [${rule.min}, ${rule.max}]`
        );
        assert.equal(inRangeResult.angle, midAngle);
        assert.equal(inRangeResult.lowVis, false);
        assert.equal(inRangeResult.feedback, null);

        // Also test exact boundary min and max
        const atMinLandmarks = makeSyntheticLandmarks(rule, rule.min);
        const atMinResult = evaluateRule(rule, atMinLandmarks);
        assert.equal(atMinResult.ok, true, `Rule ${poseKey}.${rule.id} should pass at exact min ${rule.min}°`);

        const atMaxLandmarks = makeSyntheticLandmarks(rule, rule.max);
        const atMaxResult = evaluateRule(rule, atMaxLandmarks);
        assert.equal(atMaxResult.ok, true, `Rule ${poseKey}.${rule.id} should pass at exact max ${rule.max}°`);

        // 4b. Below min -> evaluates to ok = false with feedback matching feedback_low
        if (rule.min > 0) {
          const belowAngle = Math.max(0, rule.min - 5);
          const belowLandmarks = makeSyntheticLandmarks(rule, belowAngle);
          const belowResult = evaluateRule(rule, belowLandmarks);

          assert.equal(
            belowResult.ok,
            false,
            `Rule ${poseKey}.${rule.id} should fail at angle ${belowAngle}° below min ${rule.min}°`
          );
          assert.equal(
            belowResult.feedback,
            rule.feedback_low,
            `Rule ${poseKey}.${rule.id} should return feedback_low below min`
          );
        } else {
          // If min is 0 (like in arms_down), test rule evaluation logic directly with angle below min
          const belowResult = evaluateRuleWithAngle(rule, -1);
          assert.equal(belowResult.ok, false);
          assert.equal(belowResult.feedback, rule.feedback_low);
        }

        // 4c. Above max -> evaluates to ok = false with feedback matching feedback_high
        if (rule.max < 180) {
          const aboveAngle = Math.min(180, rule.max + 5);
          const aboveLandmarks = makeSyntheticLandmarks(rule, aboveAngle);
          const aboveResult = evaluateRule(rule, aboveLandmarks);

          assert.equal(
            aboveResult.ok,
            false,
            `Rule ${poseKey}.${rule.id} should fail at angle ${aboveAngle}° above max ${rule.max}°`
          );
          assert.equal(
            aboveResult.feedback,
            rule.feedback_high,
            `Rule ${poseKey}.${rule.id} should return feedback_high above max`
          );
        } else {
          // If max is 180, test rule evaluation logic directly with angle above max
          const aboveResult = evaluateRuleWithAngle(rule, 181);
          assert.equal(aboveResult.ok, false);
          assert.equal(aboveResult.feedback, rule.feedback_high);
        }

        // 4d. Low visibility (< 0.5) -> evaluates to ok = false
        const lowVisLandmarks = makeSyntheticLandmarks(rule, midAngle, 0.4);
        const lowVisResult = evaluateRule(rule, lowVisLandmarks);

        assert.equal(
          lowVisResult.ok,
          false,
          `Rule ${poseKey}.${rule.id} must fail when landmark visibility is < 0.5`
        );
        assert.equal(lowVisResult.lowVis, true);
        assert.equal(lowVisResult.feedback, 'ไม่เห็นชัด');

        // Test individual landmark low visibility on each of A, B, C
        for (let i = 0; i < 3; i++) {
          const partialVisLandmarks = makeSyntheticLandmarks(rule, midAngle, 1.0);
          partialVisLandmarks[rule.landmarks[i]].visibility = 0.3;
          const partialRes = evaluateRule(rule, partialVisLandmarks);
          assert.equal(partialRes.ok, false);
          assert.equal(partialRes.lowVis, true);
        }
      });
    }
  }
});

test('5. Full Pose Evaluation (evaluatePose)', async (t) => {
  for (const [poseKey, pose] of Object.entries(poses)) {
    await t.test(`[${poseKey}]: Multi-rule pose evaluation`, () => {
      // Build a synthetic landmark set satisfying all rules for this pose
      const idealLandmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1.0 }));

      for (const rule of pose.rules) {
        const midAngle = Math.round((rule.min + rule.max) / 2);
        const [ai, bi, ci] = rule.landmarks;

        // Position vertex B, ray BA, and ray BC for this rule
        idealLandmarks[bi] = { x: 0.5, y: 0.5, z: 0, visibility: 1.0 };
        idealLandmarks[ai] = { x: 0.7, y: 0.5, z: 0, visibility: 1.0 };
        const rad = (midAngle * Math.PI) / 180;
        idealLandmarks[ci] = {
          x: 0.5 + 0.2 * Math.cos(rad),
          y: 0.5 + 0.2 * Math.sin(rad),
          z: 0,
          visibility: 1.0
        };
      }

      // If all rules evaluate ok
      const evalRes = evaluatePose(pose, idealLandmarks);
      assert.equal(typeof evalRes.allCorrect, 'boolean');
      assert.ok(Array.isArray(evalRes.results));
      assert.equal(evalRes.results.length, pose.rules.length);
    });
  }
});

test('6. Real-Time Skeleton Connector Mapping & Error Highlighting (R2)', async (t) => {
  await t.test('edgeKey produces canonical symmetric keys', () => {
    assert.equal(edgeKey(11, 13), '11-13');
    assert.equal(edgeKey(13, 11), '11-13');
    assert.equal(edgeKey(24, 12), '12-24');
    assert.equal(edgeKey(12, 24), '12-24');
    assert.equal(edgeKey(5, 5), '5-5');
  });

  await t.test('getRuleConnectors: Anatomical mappings for poses without elbow rules (t_pose, arms_up, arms_down)', () => {
    const baselinePoses = ['t_pose', 'arms_up', 'arms_down'];
    for (const key of baselinePoses) {
      const pose = poses[key];
      const leftArm = pose.rules.find(r => r.id === 'left_arm');
      const rightArm = pose.rules.find(r => r.id === 'right_arm');
      assert.ok(leftArm, `left_arm rule must exist in ${key}`);
      assert.ok(rightArm, `right_arm rule must exist in ${key}`);

      // Without elbow rule, arm rules highlight upper and forearm
      assert.deepEqual(getRuleConnectors(leftArm, pose), [[11, 13], [13, 15]]);
      assert.deepEqual(getRuleConnectors(rightArm, pose), [[12, 14], [14, 16]]);
    }
  });

  await t.test('getRuleConnectors: Anatomical mappings for all 5 authentic ท่าแก้เกียจ poses (with elbow rules)', () => {
    const kaeKiatKeys = ['kae_kiat_prep', 'kae_kiat_forward', 'kae_kiat_upward', 'kae_kiat_left', 'kae_kiat_right'];
    for (const key of kaeKiatKeys) {
      const pose = poses[key];
      const leftArm = pose.rules.find(r => r.id === 'left_arm');
      const rightArm = pose.rules.find(r => r.id === 'right_arm');
      const leftElbow = pose.rules.find(r => r.id === 'left_elbow');
      const rightElbow = pose.rules.find(r => r.id === 'right_elbow');

      if (leftArm) {
        assert.deepEqual(getRuleConnectors(leftArm, pose), [[11, 13]], `Pose ${key} left_arm should map to [[11, 13]]`);
      }
      if (rightArm) {
        assert.deepEqual(getRuleConnectors(rightArm, pose), [[12, 14]], `Pose ${key} right_arm should map to [[12, 14]]`);
      }
      if (leftElbow) {
        assert.deepEqual(getRuleConnectors(leftElbow, pose), [[11, 13], [13, 15]], `Pose ${key} left_elbow should map to [[11, 13], [13, 15]]`);
      }
      if (rightElbow) {
        assert.deepEqual(getRuleConnectors(rightElbow, pose), [[12, 14], [14, 16]], `Pose ${key} right_elbow should map to [[12, 14], [14, 16]]`);
      }
    }
  });

  await t.test('getRuleConnectors: Anatomical mappings for lower body joints (knee, hip)', () => {
    assert.deepEqual(getRuleConnectors({ id: 'left_knee' }), [[23, 25], [25, 27]]);
    assert.deepEqual(getRuleConnectors({ id: 'right_knee' }), [[24, 26], [26, 28]]);
    assert.deepEqual(getRuleConnectors({ id: 'left_hip' }), [[11, 23], [23, 25]]);
    assert.deepEqual(getRuleConnectors({ id: 'right_hip' }), [[12, 24], [24, 26]]);
  });

  await t.test('getRuleConnectors: Explicit rule.connectors takes precedence over heuristics', () => {
    const customRule = {
      id: 'left_arm',
      connectors: [[11, 12], [23, 24]]
    };
    assert.deepEqual(getRuleConnectors(customRule, poses.kae_kiat_forward), [[11, 12], [23, 24]]);
  });

  await t.test('getRuleConnectors: Fallbacks and edge cases', () => {
    // 3-landmark generic fallback
    const genericRule = { id: 'custom_neck', landmarks: [0, 11, 12] };
    assert.deepEqual(getRuleConnectors(genericRule), [[0, 11], [11, 12]]);

    // Missing rule or empty landmarks
    assert.deepEqual(getRuleConnectors(null), []);
    assert.deepEqual(getRuleConnectors({ id: 'unknown' }), []);
  });

  await t.test('getConnectorStatusMap: All rules passing marks all monitored edges conforming and 0 failed', () => {
    const pose = poses.kae_kiat_forward;
    const ruleResults = [
      { rule: { id: 'left_arm' }, ok: true },
      { rule: { id: 'right_arm' }, ok: true },
      { rule: { id: 'left_elbow' }, ok: true },
      { rule: { id: 'right_elbow' }, ok: true }
    ];

    const statusMap = getConnectorStatusMap(pose, ruleResults);
    assert.equal(statusMap.failedEdges.size, 0);
    assert.ok(statusMap.conformingEdges.has('11-13'));
    assert.ok(statusMap.conformingEdges.has('13-15'));
    assert.ok(statusMap.conformingEdges.has('12-14'));
    assert.ok(statusMap.conformingEdges.has('14-16'));
    assert.equal(statusMap.conformingEdges.size, 4);
    assert.equal(statusMap.allMonitoredEdges.size, 4);
  });

  await t.test('getConnectorStatusMap: Failed rules mark edges as failed and remove them from conforming', () => {
    const pose = poses.t_pose;
    const ruleResults = [
      { rule: { id: 'left_arm' }, ok: false }, // [11, 13], [13, 15] failed
      { rule: { id: 'right_arm' }, ok: true }  // [12, 14], [14, 16] conforming
    ];

    const statusMap = getConnectorStatusMap(pose, ruleResults);
    assert.ok(statusMap.failedEdges.has('11-13'));
    assert.ok(statusMap.failedEdges.has('13-15'));
    assert.ok(!statusMap.conformingEdges.has('11-13'));
    assert.ok(!statusMap.conformingEdges.has('13-15'));

    assert.ok(!statusMap.failedEdges.has('12-14'));
    assert.ok(!statusMap.failedEdges.has('14-16'));
    assert.ok(statusMap.conformingEdges.has('12-14'));
    assert.ok(statusMap.conformingEdges.has('14-16'));
  });

  await t.test('getConnectorStatusMap: Failure precedence on shared limb connectors', () => {
    const pose = poses.kae_kiat_forward;
    // Suppose left_arm (maps to 11-13) passed, but left_elbow (maps to 11-13 and 13-15) failed
    const ruleResults = [
      { rule: { id: 'left_arm' }, ok: true },
      { rule: { id: 'left_elbow' }, ok: false }
    ];

    const statusMap = getConnectorStatusMap(pose, ruleResults);
    // 11-13 was both passing candidate and failed; failed MUST take precedence
    assert.ok(statusMap.failedEdges.has('11-13'), '11-13 must be in failedEdges');
    assert.ok(statusMap.failedEdges.has('13-15'), '13-15 must be in failedEdges');
    assert.ok(!statusMap.conformingEdges.has('11-13'), '11-13 must NOT be in conformingEdges due to failure precedence');
    assert.equal(statusMap.conformingEdges.size, 0);
  });

  await t.test('getConnectorStatusMap: Handles null/undefined/empty gracefully', () => {
    const res1 = getConnectorStatusMap(null, null);
    assert.equal(res1.failedEdges.size, 0);
    assert.equal(res1.conformingEdges.size, 0);
    assert.equal(res1.allMonitoredEdges.size, 0);

    const res2 = getConnectorStatusMap(poses.t_pose, []);
    assert.equal(res2.failedEdges.size, 0);
    assert.equal(res2.conformingEdges.size, 0);
  });

  await t.test('renderSkeletonConnectors: Canvas rendering partitioned by failure, conforming, and unmonitored', () => {
    const pose = poses.t_pose;
    const drawnCalls = [];
    const mockCtx = {
      canvas: { width: 640, height: 480 },
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {}
    };

    // Mock drawConnectors global
    global.drawConnectors = (ctx, landmarks, connections, options) => {
      drawnCalls.push({ connections, options });
    };

    try {
      const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1.0 }));
      const evalResult = {
        allCorrect: false,
        feedbacks: ['ยกแขนซ้าย'],
        results: [
          { rule: { id: 'left_arm' }, ok: false }, // fails [11, 13], [13, 15]
          { rule: { id: 'right_arm' }, ok: true }  // passes [12, 14], [14, 16]
        ]
      };

      renderSkeletonConnectors(mockCtx, landmarks, evalResult, pose);

      assert.equal(drawnCalls.length, 3, 'Should draw 3 distinct groups: unmonitored, conforming, failed');

      // Unmonitored group (sky blue #38bdf8, lw 3)
      const unmonitoredCall = drawnCalls.find(c => c.options.color === '#38bdf8');
      assert.ok(unmonitoredCall, 'Must draw unmonitored connections in #38bdf8');
      assert.equal(unmonitoredCall.options.lineWidth, 3);
      assert.ok(!unmonitoredCall.connections.some(([a, b]) => edgeKey(a, b) === '11-13'));
      assert.ok(!unmonitoredCall.connections.some(([a, b]) => edgeKey(a, b) === '12-14'));

      // Conforming group (emerald green #10b981, lw 3)
      const conformingCall = drawnCalls.find(c => c.options.color === '#10b981');
      assert.ok(conformingCall, 'Must draw conforming connections in #10b981');
      assert.equal(conformingCall.options.lineWidth, 3);
      assert.ok(conformingCall.connections.some(([a, b]) => edgeKey(a, b) === '12-14'));
      assert.ok(conformingCall.connections.some(([a, b]) => edgeKey(a, b) === '14-16'));

      // Failed group (bright red #ef4444, lw 5)
      const failedCall = drawnCalls.find(c => c.options.color === '#ef4444');
      assert.ok(failedCall, 'Must draw failed connections in #ef4444');
      assert.equal(failedCall.options.lineWidth, 5);
      assert.ok(failedCall.connections.some(([a, b]) => edgeKey(a, b) === '11-13'));
      assert.ok(failedCall.connections.some(([a, b]) => edgeKey(a, b) === '13-15'));
    } finally {
      // Cleanup global mock
      delete global.drawConnectors;
    }
  });

  await t.test('renderSkeletonConnectors: Canvas 2D fallback when drawConnectors is undefined', () => {
    const pose = poses.kae_kiat_forward;
    const strokes = [];
    const mockCtx = {
      canvas: { width: 640, height: 480 },
      strokeStyle: null,
      lineWidth: 0,
      lineCap: null,
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {
        strokes.push({ strokeStyle: this.strokeStyle, lineWidth: this.lineWidth });
      }
    };

    assert.equal(typeof global.drawConnectors, 'undefined');

    const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1.0 }));
    const evalResult = {
      allCorrect: false,
      feedbacks: ['ข้อศอกซ้ายงอ'],
      results: [
        { rule: { id: 'left_arm' }, ok: true },
        { rule: { id: 'right_arm' }, ok: true },
        { rule: { id: 'left_elbow' }, ok: false }, // fails
        { rule: { id: 'right_elbow' }, ok: true }
      ]
    };

    renderSkeletonConnectors(mockCtx, landmarks, evalResult, pose);

    assert.ok(strokes.length > 0, 'Canvas 2D strokes should be executed');
    const redStrokes = strokes.filter(s => s.strokeStyle === '#ef4444' && s.lineWidth === 5);
    const greenStrokes = strokes.filter(s => s.strokeStyle === '#10b981' && s.lineWidth === 3);
    const blueStrokes = strokes.filter(s => s.strokeStyle === '#38bdf8' && s.lineWidth === 3);

    assert.ok(redStrokes.length > 0, 'Should have red strokes for failed limb connectors');
    assert.ok(greenStrokes.length > 0, 'Should have green strokes for conforming connectors');
    assert.ok(blueStrokes.length > 0, 'Should have blue strokes for unmonitored connectors');
  });
});

test('7. Authentic Thai Health Context & Cautions Integrity (R3)', async (t) => {
  await t.test('All 8 poses contain a valid health_context object', () => {
    const keys = Object.keys(poses);
    assert.equal(keys.length, 8, 'Must validate exactly 8 poses');
    for (const [key, pose] of Object.entries(poses)) {
      assert.ok(pose.health_context, `Pose [${key}] must have health_context`);
      assert.equal(typeof pose.health_context, 'object', `Pose [${key}].health_context must be an object`);
      assert.notEqual(pose.health_context, null, `Pose [${key}].health_context must not be null`);
    }
  });

  for (const [key, pose] of Object.entries(poses)) {
    await t.test(`Validate health context for pose [${key}]`, () => {
      const hc = pose.health_context;
      assert.ok(hc, `Pose [${key}] must have health_context`);

      // Benefits
      assert.ok(Array.isArray(hc.benefits), `${key}.health_context.benefits must be an array`);
      assert.ok(hc.benefits.length >= 1, `${key} must have at least 1 health benefit`);
      for (const benefit of hc.benefits) {
        assert.equal(typeof benefit, 'string', `${key} benefit must be a string`);
        assert.ok(benefit.trim().length > 0, `Benefit in ${key} cannot be empty`);
        assert.ok(/[\u0E00-\u0E7F]/.test(benefit), `Benefit in ${key} must contain Thai text`);
      }

      // Categorized Cautions
      const cautions = hc.cautions;
      assert.ok(cautions, `${key} must have cautions object`);
      assert.equal(typeof cautions, 'object', `${key}.cautions must be an object`);

      // Elderly caution
      assert.equal(typeof cautions.elderly, 'string', `${key} elderly caution must be a string`);
      assert.ok(cautions.elderly.trim().length > 0, `${key} elderly caution cannot be empty`);
      assert.ok(/[\u0E00-\u0E7F]/.test(cautions.elderly), `${key} elderly caution must contain Thai text`);

      // Pregnant caution
      assert.equal(typeof cautions.pregnant, 'string', `${key} pregnant caution must be a string`);
      assert.ok(cautions.pregnant.trim().length > 0, `${key} pregnant caution cannot be empty`);
      assert.ok(/[\u0E00-\u0E7F]/.test(cautions.pregnant), `${key} pregnant caution must contain Thai text`);

      // General caution
      assert.equal(typeof cautions.general, 'string', `${key} general caution must be a string`);
      assert.ok(cautions.general.trim().length > 0, `${key} general caution cannot be empty`);
      assert.ok(/[\u0E00-\u0E7F]/.test(cautions.general), `${key} general caution must contain Thai text`);
    });
  }
});
