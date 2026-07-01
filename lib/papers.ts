// PAPER CATALOG — the strategy menu.
//
// A "paper" is a published market-inefficiency result rendered as a runnable
// agent strategy. Each paper maps to one edge kind in the engine plus a
// calibrated set of default levers (the "parameter variant" — the edge
// conditioned on a specific match context). Every paper is a real, usable edge
// and is available to every forecaster — there is no gate and nothing to buy.
// Standing is earned purely on closing-line value.

import type { EdgeKind } from "./edge/types";

export interface AgentLevers {
  edgeKinds: EdgeKind[]; // which signals this lever set trades (base default: ["quote"])
  minConviction: number; // edgeMeasure threshold (fair-prob move, 0.01–0.20)
  stakeMode: "flat" | "kelly";
  stakePct: number; // flat: fraction of bankroll per bet (0.01–0.25)
  kellyFraction: number; // kelly: fraction of full Kelly (0.1–1.0)
  phase: "pre" | "inplay" | "both";
  minMinute: number; // in-play minute gate
  maxMinute: number;
  marketFilter: string[]; // allowed SuperOddsType values; [] = any
  oddsMin: number; // decimal-odds band
  oddsMax: number;
  maxConcurrent: number; // open positions cap
  direction: "follow" | "fade"; // follow the engine's call, or invert it
}

// A resolved unit the agent actually trades: a lever set gated to certain edge
// kinds. An agent runs its base-tuning strategy plus one per attached paper.
export interface Strategy {
  label: string; // e.g. "base tuning" or the paper title
  source: "base" | "paper";
  paperId?: string;
  edgeKinds: EdgeKind[];
  levers: AgentLevers;
}

export interface Paper {
  id: string;
  title: string;
  authors: string;
  year: number;
  edgeKind: EdgeKind;
  doi: string; // stylised reference id (display)
  free: boolean;
  abstract: string;
  tags: string[];
  levers: AgentLevers;
}

const BASE: AgentLevers = {
  edgeKinds: ["quote"], // baseline data-trading; papers add steam/overreaction
  minConviction: 0.003, // low floor: the engine already gates each signal's size
  stakeMode: "flat",
  stakePct: 0.05,
  kellyFraction: 0.5,
  phase: "both",
  minMinute: 0,
  maxMinute: 90,
  marketFilter: [],
  oddsMin: 1.3,
  oddsMax: 6.0,
  maxConcurrent: 3,
  direction: "follow",
};

// The default tuning for a freshly-built agent with no papers attached: it
// trades the baseline "quote" signal on the live book (proves autonomous play
// on real data). Attaching papers layers steam / overreaction edges on top.
export const DEFAULT_BASE_LEVERS: AgentLevers = { ...BASE };

export const PAPERS: Paper[] = [
  // --- foundational base papers ----------------------------------------
  {
    id: "steam-base",
    title: "Sharp Money and the Information Content of Line Moves",
    authors: "Gandar, Zuber & Lamb",
    year: 2001,
    edgeKind: "steam",
    doi: "AGTH-0001",
    free: true,
    abstract:
      "Late, sharp adjustments to the no-vig fair price carry information: the side a steam move favours wins more often than its closing odds imply. Back the move within the window.",
    tags: ["steam", "line-move", "clv"],
    levers: { ...BASE, direction: "follow" },
  },
  {
    id: "overreaction-base",
    title: "Market Overreaction to Salient In-Play Events",
    authors: "Croxson & Reade",
    year: 2014,
    edgeKind: "overreaction",
    doi: "AGTH-0002",
    free: true,
    abstract:
      "Immediately after a goal or red card the fair line overshoots the true probability shift. The overshoot mean-reverts within minutes. Fade the swing.",
    tags: ["overreaction", "in-play", "mean-reversion"],
    levers: { ...BASE, direction: "follow", phase: "inplay" },
  },

  // --- calibrated parameter variants -----------------------------------
  {
    id: "steam-favourite",
    title: "Steam on Short-Priced Favourites",
    authors: "Levitt",
    year: 2004,
    edgeKind: "steam",
    doi: "AGTH-0103",
    free: false,
    abstract:
      "Steam moves on already-short prices are the most information-rich and least noise-prone. Restrict to the favourite band and raise the conviction floor.",
    tags: ["steam", "favourite", "high-conviction"],
    levers: { ...BASE, minConviction: 0.06, oddsMin: 1.3, oddsMax: 2.5 },
  },
  {
    id: "steam-longshot-fade",
    title: "The Favourite–Longshot Bias in Drifting Markets",
    authors: "Snowberg & Wolfers",
    year: 2010,
    edgeKind: "steam",
    doi: "AGTH-0104",
    free: false,
    abstract:
      "Longshots are systematically overbet; steam drifting a longshot out is the market correcting. Fade steam in the high-odds band to harvest the bias.",
    tags: ["longshot-bias", "fade", "value"],
    levers: { ...BASE, direction: "fade", oddsMin: 3.0, oddsMax: 6.0 },
  },
  {
    id: "overreaction-redcard",
    title: "Red Cards and the Mispricing of Numerical Disadvantage",
    authors: "Vecer, Kopriva & Ichiba",
    year: 2009,
    edgeKind: "overreaction",
    doi: "AGTH-0105",
    free: false,
    abstract:
      "Markets over-penalise the team reduced to ten, especially early. The implied swing exceeds the true expected-goals impact. Fade the post-red-card overshoot.",
    tags: ["red-card", "overreaction", "in-play"],
    levers: { ...BASE, direction: "follow", phase: "inplay", minConviction: 0.08 },
  },
  {
    id: "overreaction-lategoal",
    title: "Late-Goal Overshoots and Closing-Line Reversion",
    authors: "Reade & Singleton",
    year: 2021,
    edgeKind: "overreaction",
    doi: "AGTH-0106",
    free: false,
    abstract:
      "Goals after the 60th minute trigger the largest line overshoots as books chase momentum. Fade late-game swings with a higher conviction floor.",
    tags: ["late-goal", "overreaction", "momentum"],
    levers: { ...BASE, direction: "follow", phase: "inplay", minMinute: 60, minConviction: 0.1 },
  },
  {
    id: "steam-prematch",
    title: "Pre-Match Steam and Closing-Line Value",
    authors: "Hubáček, Šourek & Železný",
    year: 2019,
    edgeKind: "steam",
    doi: "AGTH-0107",
    free: false,
    abstract:
      "Pre-kickoff steam predicts the closing line. Trade only before kickoff and measure success purely by beating the close.",
    tags: ["pre-match", "steam", "clv"],
    levers: { ...BASE, phase: "pre", maxMinute: 0 },
  },
  {
    id: "overreaction-kelly",
    title: "Optimal Sizing of Mean-Reversion Edges",
    authors: "Kelly (after)",
    year: 1956,
    edgeKind: "overreaction",
    doi: "AGTH-0108",
    free: false,
    abstract:
      "The overreaction edge with fractional-Kelly sizing: stake proportional to the measured mispricing rather than a flat fraction, capped to control variance.",
    tags: ["kelly", "sizing", "overreaction"],
    levers: { ...BASE, direction: "follow", phase: "inplay", stakeMode: "kelly", kellyFraction: 0.5 },
  },
];

export function getPaper(id: string): Paper | undefined {
  return PAPERS.find((p) => p.id === id);
}

// Every paper is usable by every forecaster — the whole catalog, always.
export const ALL_PAPER_IDS = PAPERS.map((p) => p.id);

// Compose an agent's runnable strategies: one per attached paper (priority) plus
// the always-on base tuning (lowest priority). decide() tries them in order.
export function buildStrategies(baseLevers: AgentLevers, paperIds: string[]): Strategy[] {
  const strategies: Strategy[] = [];
  for (const pid of paperIds || []) {
    const p = getPaper(pid);
    if (!p) continue;
    strategies.push({
      label: p.title,
      source: "paper",
      paperId: p.id,
      edgeKinds: [p.edgeKind],
      levers: { ...p.levers, edgeKinds: [p.edgeKind] },
    });
  }
  if (baseLevers?.edgeKinds?.length) {
    strategies.push({
      label: "base tuning",
      source: "base",
      edgeKinds: baseLevers.edgeKinds,
      levers: baseLevers,
    });
  }
  return strategies;
}
