// Client-side paper ownership (localStorage).
//
// Every research paper is a real, runnable strategy and is available to every
// forecaster — there is no gate and nothing to purchase. Standing is earned
// purely on closing-line value. This module now just reports "you own them all"
// so the builder and library can render without special-casing.

import { ALL_PAPER_IDS } from "./papers";

// Every paper is usable by every agent. Kept as a function (not a constant) so
// callers that used the old localStorage-backed shape keep working unchanged.
export function getOwnedPapers(): string[] {
  return [...ALL_PAPER_IDS];
}

export function ownsPaper(_id: string): boolean {
  return true;
}
