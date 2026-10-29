/**
 * Tune scoring weights against human judgement (design guide §10.3).
 *
 * Input: pairwise preferences ("A preferred over B") with each candidate's
 * feature vector. Model: Bradley–Terry / logistic regression on feature
 * differences, P(A ≻ B) = σ(w · (f_A − f_B)), fitted by deterministic
 * full-batch gradient descent with L2 regularisation. The fitted weights are
 * a versioned artifact stored alongside the grammar.
 */
import { FEATURE_KEYS, type Features, type Weights } from "./score.js";

export interface Preference {
  preferred: Features;
  rejected: Features;
}

export interface TuneResult {
  weights: Weights;
  /** Fraction of training pairs the fitted weights order correctly. */
  agreement: number;
  logLoss: number;
  iterations: number;
}

// σ(z) without Math.exp: tuning runs offline, but keep it reproducible anyway
// via a fixed-iteration exp from the deterministic toolbox.
function exp(x: number): number {
  // exp(x) = (exp(x / 2^k))^(2^k) with a Taylor series on the reduced argument
  const k = 10;
  let r = x / 1024;
  let s = 1,
    t = 1;
  for (let i = 1; i < 12; i++) {
    t = (t * r) / i;
    s += t;
  }
  for (let i = 0; i < k; i++) s *= s;
  return s;
}
const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + exp(-z)) : exp(z) / (1 + exp(z)));

export function tuneWeights(prefs: Preference[], opts: { iterations?: number; learningRate?: number; l2?: number } = {}): TuneResult {
  if (prefs.length === 0) throw new Error("tuneWeights: no preferences");
  const iterations = opts.iterations ?? 2000;
  const lr = opts.learningRate ?? 0.5;
  const l2 = opts.l2 ?? 0.01;
  const d = prefs.map((p) => FEATURE_KEYS.map((k) => p.preferred[k] - p.rejected[k]));
  const w = new Array(FEATURE_KEYS.length).fill(0) as number[];
  for (let it = 0; it < iterations; it++) {
    const grad = new Array(w.length).fill(0) as number[];
    for (const x of d) {
      let z = 0;
      for (let j = 0; j < w.length; j++) z += w[j]! * x[j]!;
      const g = sigmoid(z) - 1; // d/dz of −log σ(z)
      for (let j = 0; j < w.length; j++) grad[j]! += (g * x[j]!) / d.length;
    }
    for (let j = 0; j < w.length; j++) w[j] = w[j]! - lr * (grad[j]! + l2 * w[j]!);
  }
  let correct = 0,
    loss = 0;
  for (const x of d) {
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j]! * x[j]!;
    if (z > 0) correct++;
    const p = sigmoid(z);
    loss -= p > 1e-12 ? naturalLog(p) : -27.6;
  }
  const weights = Object.fromEntries(FEATURE_KEYS.map((k, j) => [k, w[j]!])) as Weights;
  return { weights, agreement: correct / d.length, logLoss: loss / d.length, iterations };
}

/** ln(x) for x in (0, 1], by atanh series; only used for the reported loss. */
function naturalLog(x: number): number {
  let k = 0;
  while (x < 0.5) {
    x *= 2;
    k++;
  }
  const y = (x - 1) / (x + 1);
  let sum = 0,
    term = y;
  for (let n = 1; n < 60; n += 2) {
    sum += term / n;
    term *= y * y;
  }
  return 2 * sum - k * 0.6931471805599453;
}
