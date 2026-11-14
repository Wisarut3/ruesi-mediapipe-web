const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { calcAngle, evaluateRule, evaluateRuleWithAngle, evaluatePose } = require('../public/pose-evaluator.js');

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
