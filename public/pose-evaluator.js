/**
 * PoseEvaluator
 * Shared evaluation logic for MediaPipe Pose rules and angle calculations.
 * Compatible with Node.js (CommonJS) and browser (window.PoseEvaluator).
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = mod;
  }
  if (root) {
    root.PoseEvaluator = mod;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {

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
    if (!rule || !landmarks || !Array.isArray(rule.landmarks) || rule.landmarks.length < 3) {
      return { rule: rule || null, ok: false, lowVis: true, angle: null, feedback: 'ไม่เห็นจุดสำคัญ' };
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

    const lowVis = (A.visibility !== undefined && (A.visibility < 0.5 || Number.isNaN(A.visibility))) ||
                   (B.visibility !== undefined && (B.visibility < 0.5 || Number.isNaN(B.visibility))) ||
                   (C.visibility !== undefined && (C.visibility < 0.5 || Number.isNaN(C.visibility))) ||
                   !Number.isFinite(A.x) || !Number.isFinite(A.y) ||
                   !Number.isFinite(B.x) || !Number.isFinite(B.y) ||
                   !Number.isFinite(C.x) || !Number.isFinite(C.y);

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

  /**
   * Canonical edge key for unordered landmark pair (e.g., "11-13").
   *
   * @param {number} a - First landmark index
   * @param {number} b - Second landmark index
   * @returns {string} Canonical edge key min(a,b)-max(a,b)
   */
  function edgeKey(a, b) {
    const na = Number(a);
    const nb = Number(b);
    return na < nb ? `${na}-${nb}` : `${nb}-${na}`;
  }

  /**
   * Returns the skeletal limb connectors associated with a rule.
   * Supports explicit rule.connectors, anatomical mappings, and a 3-landmark fallback.
   *
   * @param {Object} rule - Pose rule
   * @param {Object} [pose] - Active pose object
   * @returns {Array<[number, number]>} List of connector pairs
   */
  function getRuleConnectors(rule, pose) {
    if (!rule) return [];
    if (Array.isArray(rule.connectors) && rule.connectors.length > 0) {
      return rule.connectors;
    }

    const id = rule.id || '';
    const hasElbowRule = Boolean(
      pose &&
      Array.isArray(pose.rules) &&
      pose.rules.some(r => r.id && r.id.includes('elbow'))
    );

    // Anatomical mappings
    if (id === 'left_arm') {
      return hasElbowRule ? [[11, 13]] : [[11, 13], [13, 15]];
    }
    if (id === 'right_arm') {
      return hasElbowRule ? [[12, 14]] : [[12, 14], [14, 16]];
    }
    if (id === 'left_elbow') {
      return [[11, 13], [13, 15]];
    }
    if (id === 'right_elbow') {
      return [[12, 14], [14, 16]];
    }
    if (id === 'left_knee') {
      return [[23, 25], [25, 27]];
    }
    if (id === 'right_knee') {
      return [[24, 26], [26, 28]];
    }
    if (id === 'left_hip') {
      return [[11, 23], [23, 25]];
    }
    if (id === 'right_hip') {
      return [[12, 24], [24, 26]];
    }

    // Generic fallback: if rule.landmarks has length >= 3
    if (Array.isArray(rule.landmarks) && rule.landmarks.length >= 3) {
      const [a, b, c] = rule.landmarks;
      return [[a, b], [b, c]];
    }

    return [];
  }

  /**
   * Computes the status map of skeleton connectors for the current evaluation frame.
   * Implements failure-precedence: a connector is only conforming if it passed and
   * did not fail any other rule.
   *
   * @param {Object} pose - Active pose object
   * @param {Array<Object>} ruleResults - Array of evaluated rule results
   * @returns {{ failedEdges: Set<string>, conformingEdges: Set<string>, allMonitoredEdges: Set<string> }}
   */
  function getConnectorStatusMap(pose, ruleResults) {
    const failedEdges = new Set();
    const passingCandidateEdges = new Set();
    const allMonitoredEdges = new Set();

    if (!ruleResults || !Array.isArray(ruleResults)) {
      return { failedEdges, conformingEdges: new Set(), allMonitoredEdges };
    }

    for (const res of ruleResults) {
      if (!res || !res.rule) continue;
      const connectors = getRuleConnectors(res.rule, pose);

      for (const [p1, p2] of connectors) {
        const key = edgeKey(p1, p2);
        allMonitoredEdges.add(key);

        if (res.ok) {
          passingCandidateEdges.add(key);
        } else if (!res.lowVis) {
          failedEdges.add(key);
        }
      }
    }

    // Failure precedence: conforming only if passed and not in failedEdges
    const conformingEdges = new Set();
    for (const key of passingCandidateEdges) {
      if (!failedEdges.has(key)) {
        conformingEdges.add(key);
      }
    }

    return { failedEdges, conformingEdges, allMonitoredEdges };
  }

  return {
    calcAngle,
    evaluateRule,
    evaluateRuleWithAngle,
    evaluatePose,
    edgeKey,
    getRuleConnectors,
    getConnectorStatusMap
  };
});
