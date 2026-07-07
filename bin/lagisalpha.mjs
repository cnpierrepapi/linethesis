#!/usr/bin/env node
// lagisalpha — the paper-trading terminal as a CLI. Same commands and same engine as the web terminal,
// runnable in PowerShell, cmd, bash, or zsh:  npx lagisalpha
// Signals come from the deployed API (override with LAGISALPHA_BASE). Paper only, no real trades.

import readline from "node:readline";
import { BANNER, newState, handle } from "../lib/paper/runner.mjs";

const BASE = process.env.LAGISALPHA_BASE || "https://lagisalpha.vercel.app";
const NO_COLOR = !!process.env.NO_COLOR;

// ANSI colour map (Windows Terminal / modern PowerShell render these; NO_COLOR disables).
const COLORS = { sys: "33", sig: "37", fill: "90", win: "32", loss: "31", muted: "90", echo: "90", prompt: "33" };
const paint = (text, cls) => (NO_COLOR || !COLORS[cls] ? text : `\x1b[${COLORS[cls]}m${text}\x1b[0m`);

const host = {
  base: BASE,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async fetchJson(path, key) {
    const res = await fetch(BASE + path, key ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
    let body = {};
    try { body = await res.json(); } catch { /* ignore */ }
    return res.ok ? body : { __err: res.status, ...body };
  },
};

const state = newState(BASE);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: paint("lagisalpha> ", "prompt") });

function emit(text, cls = "sig") {
  if (text === "__clear__") { console.clear(); return; }
  console.log(paint(text, cls));
}

BANNER.forEach((l) => emit(l, "muted"));
emit(`connected to ${BASE}`, "muted");
rl.prompt();

rl.on("line", async (line) => {
  try {
    await handle(state, line, emit, host);
  } catch {
    emit("terminal error — try again", "loss");
  }
  rl.prompt();
});
rl.on("close", () => { emit("bye.", "muted"); process.exit(0); });
