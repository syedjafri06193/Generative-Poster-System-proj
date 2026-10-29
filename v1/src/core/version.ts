/**
 * Generator version (design guide §4.1). Bump the major version whenever
 * the same (seed, grammar) would produce a different document: a PRNG change,
 * a new random() call in a decision path, a layout rule change.
 *
 * Old versions must stay resolvable: generators are registered by version in
 * src/generate.ts and never mutated once released.
 */
export const GENERATOR_VERSION = "1.0.0";
