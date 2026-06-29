// Client-side wallet/ownership store (localStorage).
//
// AGI is a buyable, non-redeemable in-app token. It buys research papers only —
// never bankroll, never prize odds. Every agent still starts from the same
// fake-USD float. Owned papers default to the two free ones.

import { FREE_PAPERS, AGI_PER_PAPER } from "./papers";

const AGI_KEY = "agenthesis_agi";
const PAPERS_KEY = "agenthesis_papers";
const STARTER_AGI = 1000; // enough to unlock one paper, so the loop is visible

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}
function write(key: string, val: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, val);
}

export function getAgi(): number {
  const raw = read(AGI_KEY);
  if (raw == null) {
    write(AGI_KEY, String(STARTER_AGI));
    return STARTER_AGI;
  }
  return Number(raw) || 0;
}

export function setAgi(v: number) {
  write(AGI_KEY, String(Math.max(0, Math.round(v))));
}

export function spendAgi(amount: number): boolean {
  const bal = getAgi();
  if (bal < amount) return false;
  setAgi(bal - amount);
  return true;
}

export function getOwnedPapers(): string[] {
  const raw = read(PAPERS_KEY);
  if (raw == null) {
    write(PAPERS_KEY, JSON.stringify(FREE_PAPERS));
    return [...FREE_PAPERS];
  }
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [...FREE_PAPERS];
  }
}

export function ownsPaper(id: string): boolean {
  return getOwnedPapers().includes(id);
}

// Unlock a paper with AGI. Returns true on success (or if already owned/free).
export function unlockPaper(id: string): boolean {
  if (ownsPaper(id)) return true;
  if (!spendAgi(AGI_PER_PAPER)) return false;
  const owned = getOwnedPapers();
  owned.push(id);
  write(PAPERS_KEY, JSON.stringify(owned));
  return true;
}
