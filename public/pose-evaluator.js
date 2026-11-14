/**
 * PoseEvaluator
 * Shared evaluation logic for MediaPipe Pose rules and angle calculations.
 * Compatible with Node.js (CommonJS) and browser (window.PoseEvaluator).
 */
(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    root.PoseEvaluator = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Calculates the interior angle (in degrees, 0 to 180) at vertex B
   * in the triangle formed by landmarks A, B, and C in 2D space.
   *
   * @param {Object} A - First point {x, y}
   * @param {Object} B - Vertex point {x, y}
   * @param {Object} C - Third point {x, y}
   * @returns {number} Angle in degrees [0, 180] rounded to nearest integer
   */
  function calcAngle(A, B, C) {
    if (!A || !B || !C) return 0;
    const radians =
      Math.atan2(C.y - B.y, C.x - B.x) -
      Math.atan2(A.y - B.y, A.x - B.x);
    let angle = Math.abs((radians * 180) / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return Math.round(angle);
  }

  /**
   * Evaluates an individual pose rule against detected landmarks.
   *
   * @param {Object} rule - Rule object { id, label, landmarks: [ai, bi, ci], min, max, feedback_low, feedback_high }
   * @param {Array<Object>} landmarks - MediaPipe pose landmarks (length >= 33)
   * @returns {Object} { rule, ok: boolean, lowVis: boolean, angle: number|null, feedback: string|null }
   */
  function evaluateRule(rule, landmarks) {
    if (!rule || !landmarks) {
      return { rule: rule || null, ok: false, lowVis: true, angle: null, feedback: null };
    }
    const [ai, bi, ci] = rule.landmarks;
    const A = landmarks[ai];
    const B = landmarks[bi];
    const C = landmarks[ci];

    if (!A || !B || !C) {
      return {
        rule,
        ok: false,
        lowVis: true,
        angle: null,
        feedback: 'ไม่เห็นจุดสำคัญ'
      };
    }

    const lowVis = (A.visibility !== undefined && A.visibility < 0.5) ||
                   (B.visibility !== undefined && B.visibility < 0.5) ||
                   (C.visibility !== undefined && C.visibility < 0.5);

    if (lowVis) {
      return {
        rule,
        ok: false,
        lowVis: true,
        angle: null,
        feedback: 'ไม่เห็นชัด'
      };
    }

    const angle = calcAngle(A, B, C);
    return evaluateRuleWithAngle(rule, angle);
  }

  /**
   * Evaluates an individual pose rule directly against a numeric angle.
   *
   * @param {Object} rule - Rule object
   * @param {number} angle - Angle in degrees
   * @returns {Object} { rule, ok: boolean, lowVis: false, angle: number, feedback: string|null }
   */
  function evaluateRuleWithAngle(rule, angle) {
    const ok = angle >= rule.min && angle <= rule.max;
    let feedback = null;
    if (!ok) {
      feedback = angle < rule.min ? rule.feedback_low : rule.feedback_high;
    }
    return {
      rule,
      ok,
      lowVis: false,
      angle,
      feedback
    };
  }

  /**
   * Evaluates all rules of a given pose against detected landmarks.
   *
   * @param {Object} pose - Pose object { name, description, rules: [...] }
   * @param {Array<Object>} landmarks - MediaPipe pose landmarks
   * @returns {Object} { allCorrect: boolean, feedbacks: Array<string>, results: Array<Object> }
   */
  function evaluatePose(pose, landmarks) {
    if (!pose || !Array.isArray(pose.rules)) {
      return { allCorrect: false, feedbacks: [], results: [] };
    }
    let allCorrect = true;
    const feedbacks = [];
    const results = [];

    for (const rule of pose.rules) {
      const res = evaluateRule(rule, landmarks);
      results.push(res);
      if (!res.ok) {
        allCorrect = false;
        if (res.feedback && !res.lowVis) {
          feedbacks.push(res.feedback);
        }
      }
    }

    return {
      allCorrect,
      feedbacks,
      results
    };
  }

  return {
    calcAngle,
    evaluateRule,
    evaluateRuleWithAngle,
    evaluatePose
  };
});
