import { describe, expect, test } from "vitest";
import { degToRad, detAtan2, detCbrt, detCos, detPowInt, detSin } from "../../src/core/detmath.js";
import { formatSeed, parseSeed, Rng, subSeed, subStream } from "../../src/core/prng.js";

describe("PCG32", () => {
  test("matches the reference implementation (pcg32_srandom(42, 54))", () => {
    const r = new Rng(42n, 54n);
    const got = Array.from({ length: 6 }, () => r.next());
    expect(got).toEqual([0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);
  });

  test("int() stays in range and covers it", () => {
    const r = new Rng(7n);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(3, 9);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(9);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });

  test("float() is in [0, 1)", () => {
    const r = new Rng(1n);
    for (let i = 0; i < 1000; i++) {
      const f = r.float();
      expect(f >= 0 && f < 1).toBe(true);
    }
  });
});

describe("hierarchical seeding (§4.2)", () => {
  test("a sub-stream depends only on (master, path)", () => {
    const a = subStream(123n, "palette");
    a.next();
    a.next(); // extra draws in one stream...
    const grid1 = subStream(123n, "grid").next();
    const grid2 = subStream(123n, "grid").next();
    expect(grid1).toBe(grid2); // ...cannot shift another
    expect(subSeed(123n, "grid")).not.toBe(subSeed(123n, "grie"));
    expect(subSeed(123n, "a/b")).not.toBe(subSeed(124n, "a/b"));
  });

  test("seed text round-trips", () => {
    expect(formatSeed(parseSeed("7f3a-9c21-0e48"))).toBe("7f3a-9c21-0e48");
    expect(() => parseSeed("not hex")).toThrow();
    expect(() => parseSeed("1234567890abcdef")).toThrow(); // > 48 bits
  });
});

describe("deterministic math (§4.3)", () => {
  test("sin/cos are accurate to 1e-9 over a wide range", () => {
    for (let x = -50; x <= 50; x += 0.0137) {
      expect(Math.abs(detSin(x) - Math.sin(x))).toBeLessThan(1e-9);
      expect(Math.abs(detCos(x) - Math.cos(x))).toBeLessThan(1e-9);
    }
  });

  test("cbrt and atan2 are accurate", () => {
    for (const v of [1e-9, 0.001, 0.5, 1, 2, 27, 1e6, -8]) expect(detCbrt(v)).toBeCloseTo(Math.cbrt(v), 12);
    for (let a = -3; a <= 3; a += 0.25) expect(detAtan2(Math.sin(a), Math.cos(a))).toBeCloseTo(Math.atan2(Math.sin(a), Math.cos(a)), 10);
    expect(detPowInt(1.25, 5)).toBe(1.25 * 1.25 * 1.25 * 1.25 * 1.25);
  });

  test("pinned values: changing these is a generator version bump", () => {
    // Exact bit patterns, so an edit to a coefficient fails here first.
    expect(detSin(1)).toBe(0.8414709848078965);
    expect(detCos(degToRad(60))).toBe(0.5000000000000002);
    expect(detCbrt(10)).toBe(2.154434690031884);
  });
});
