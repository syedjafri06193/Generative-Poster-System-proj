/**
 * PCG32 (O'Neill, "PCG: A Family of Simple Fast Space-Efficient Statistically
 * Good Algorithms for Random Number Generation", 2014), plus SplitMix64 for
 * hierarchical sub-stream derivation (design guide §4.2, §4.4, §15.1).
 *
 * Every operation here is exact integer arithmetic on BigInt or uint32, so
 * the output is bit-identical on every JavaScript engine.
 *
 * PINNED: changing anything in this file changes every poster ever generated.
 * A fix here is a generator version bump (see core/version.ts).
 */

const MASK64 = 0xffff_ffff_ffff_ffffn;

/** SplitMix64 finaliser (Steele, Lea & Flood, 2014). */
export function splitmix64(x: bigint): bigint {
  let z = (x + 0x9e37_79b9_7f4a_7c15n) & MASK64;
  z = ((z ^ (z >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK64;
  return (z ^ (z >> 31n)) & MASK64;
}

export class Rng {
  private state: bigint;
  private readonly inc: bigint;

  constructor(seed: bigint, seq: bigint = 0xda3e_39cb_94b9_5bdbn) {
    this.state = 0n;
    this.inc = ((seq << 1n) | 1n) & MASK64;
    this.next();
    this.state = (this.state + (seed & MASK64)) & MASK64;
    this.next();
  }

  /** Next uint32. */
  next(): number {
    const old = this.state;
    this.state = (old * 6364136223846793005n + this.inc) & MASK64;
    const xorshifted = Number((((old >> 18n) ^ old) >> 27n) & 0xffff_ffffn);
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << (-rot & 31))) >>> 0;
  }

  /** Uniform in [0, 1). 32 bits of resolution; exact division by 2^32. */
  float(): number {
    return this.next() / 4294967296;
  }

  /**
   * Uniform integer in [min, max], inclusive, without modulo bias
   * (Lemire-style rejection on the 32-bit range).
   */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RangeError(`int(${min}, ${max}): need integers with min <= max`);
    }
    const span = max - min + 1;
    if (span > 4294967296) throw new RangeError("int(): range wider than 2^32");
    const limit = 4294967296 - (4294967296 % span);
    let x = this.next();
    while (x >= limit) x = this.next();
    return min + (x % span);
  }

  /** Uniform real in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.float();
  }

  pick<T>(xs: readonly T[]): T {
    if (xs.length === 0) throw new RangeError("pick() from an empty array");
    return xs[this.int(0, xs.length - 1)]!;
  }

  /** Weighted pick; weights must be non-negative and not all zero. */
  weighted<T>(xs: readonly T[], weights: readonly number[]): T {
    if (xs.length !== weights.length || xs.length === 0) throw new RangeError("weighted(): bad input");
    let total = 0;
    for (const w of weights) total += w;
    if (!(total > 0)) throw new RangeError("weighted(): weights sum to zero");
    let r = this.float() * total;
    for (let i = 0; i < xs.length; i++) {
      r -= weights[i]!;
      if (r < 0) return xs[i]!;
    }
    return xs[xs.length - 1]!;
  }

  bool(p = 0.5): boolean {
    return this.float() < p;
  }

  /** 64 fresh bits, for deriving child seeds. */
  nextBigInt(): bigint {
    return (BigInt(this.next()) << 32n) | BigInt(this.next());
  }

  /** Fisher-Yates shuffle into a new array. */
  shuffled<T>(xs: readonly T[]): T[] {
    const out = xs.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}

/**
 * Derive an independent stream for a named subsystem (§4.2). Adding a
 * random() call inside one subsystem cannot shift any other subsystem's
 * stream, because each stream depends only on (master seed, path).
 */
export function subStream(master: bigint, path: string): Rng {
  return new Rng(subSeed(master, path));
}

export function subSeed(master: bigint, path: string): bigint {
  let h = splitmix64(master & MASK64);
  for (const ch of path) {
    h = splitmix64(h ^ BigInt(ch.codePointAt(0)!));
  }
  return h;
}

/**
 * Poster seeds are 48-bit, so the printed form ("7f3a-9c21-0e48", 12 hex
 * digits) is the whole seed and always reproduces the poster.
 */
export const SEED_MASK = 0xffff_ffff_ffffn;

/** Parse a seed written as hex groups ("7f3a-9c21-0e48") or plain hex. */
export function parseSeed(text: string): bigint {
  const hex = text.trim().toLowerCase().replace(/^0x/, "").replace(/[-_\s]/g, "");
  if (!/^[0-9a-f]{1,12}$/.test(hex)) throw new Error(`invalid seed "${text}": expected up to 12 hex digits`);
  return BigInt("0x" + hex);
}

/** Format a seed as 4-digit hex groups, the form printed on the poster. */
export function formatSeed(seed: bigint): string {
  if (seed < 0n || seed > SEED_MASK) throw new RangeError("formatSeed(): seeds are 48-bit");
  const hex = seed.toString(16).padStart(12, "0");
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
