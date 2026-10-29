/**
 * Deterministic math (design guide §4.3).
 *
 * ECMAScript lets Math.sin/cos/tan/pow/exp/log/atan2/cbrt return
 * implementation-approximated results, so they can differ in the last bit
 * between engines. Anything whose result feeds a comparison, a rounding or an
 * index must use these functions instead. They use only +, -, *, / and
 * Math.sqrt/floor/round/abs, which IEEE-754 and ECMAScript define exactly.
 *
 * Accuracy targets are "good enough for design" (about 1e-9 relative for
 * sin/cos, 1e-12 for cbrt); reproducibility is the requirement.
 *
 * PINNED: changing coefficients or iteration counts is a generator version
 * bump.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Reduce to [-π/2, π/2] for sine, tracking the reflection exactly. */
function reduceSin(x: number): number {
  // to [-π, π)
  let t = x - TWO_PI * Math.floor((x + PI) / TWO_PI);
  // fold to [-π/2, π/2] using sin(π - t) = sin(t)
  if (t > HALF_PI) t = PI - t;
  else if (t < -HALF_PI) t = -PI - t;
  return t;
}

/** Taylor series to t^17; |error| < 1e-11 on [-π/2, π/2]. */
function sinPoly(t: number): number {
  const t2 = t * t;
  return (
    t *
    (1 -
      (t2 / 6) *
        (1 -
          (t2 / 20) *
            (1 -
              (t2 / 42) *
                (1 - (t2 / 72) * (1 - (t2 / 110) * (1 - (t2 / 156) * (1 - (t2 / 210) * (1 - t2 / 272))))))))
  );
}

export function detSin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  return sinPoly(reduceSin(x));
}

export function detCos(x: number): number {
  return detSin(x + HALF_PI);
}

export function degToRad(deg: number): number {
  return (deg * PI) / 180;
}

/** x^n for integer n by repeated squaring — exact operations only. */
export function detPowInt(x: number, n: number): number {
  if (!Number.isInteger(n)) throw new RangeError("detPowInt(): integer exponent required");
  if (n < 0) return 1 / detPowInt(x, -n);
  let result = 1;
  let base = x;
  let e = n;
  while (e > 0) {
    if (e & 1) result *= base;
    base *= base;
    e >>= 1;
  }
  return result;
}

/** Cube root by Newton's method from a fixed start; 40 iterations, bit-stable. */
export function detCbrt(x: number): number {
  if (x === 0 || !Number.isFinite(x)) return x;
  const neg = x < 0;
  const a = neg ? -x : x;
  // Start from a value guaranteed to be >= the root, then Newton converges
  // monotonically from above.
  let y = a > 1 ? a : 1;
  for (let i = 0; i < 200; i++) {
    const next = (2 * y + a / (y * y)) / 3;
    if (next >= y) break;
    y = next;
  }
  return neg ? -y : y;
}

/** atan for |x| <= 1 by a fixed-degree series after two halvings. */
function atanUnit(x: number): number {
  // atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))), applied twice to shrink |x|
  let y = x / (1 + Math.sqrt(1 + x * x));
  y = y / (1 + Math.sqrt(1 + y * y));
  // now |y| <= tan(π/16) ≈ 0.199; series to y^25
  const y2 = y * y;
  let sum = 0;
  for (let k = 12; k >= 0; k--) {
    sum = 1 / (2 * k + 1) - y2 * sum;
  }
  return 4 * y * sum;
}

/** Deterministic atan2 in radians, range (-π, π]. */
export function detAtan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  if (Math.abs(y) <= Math.abs(x)) {
    const a = atanUnit(y / x);
    if (x > 0) return a;
    return y >= 0 ? a + PI : a - PI;
  }
  const a = atanUnit(x / y);
  return y > 0 ? HALF_PI - a : -HALF_PI - a;
}

/** Clamp v into [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
