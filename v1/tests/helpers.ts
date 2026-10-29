import type { ComposeContext } from "../src/layout/compose.js";
import { loadContext } from "../src/node.js";

let ctx: Promise<ComposeContext> | undefined;
/** One shared context per test worker: fonts and lcms load once. */
export function context(): Promise<ComposeContext> {
  return (ctx ??= loadContext());
}
