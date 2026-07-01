-- AGENTHESIS DESK MIRROR — runs in the foil Supabase project.
-- The EC2 worker (service_role, bypasses RLS) is the ONLY writer of the mirror
-- tables. The browser uses the anon key to READ the mirror and to QUEUE a
-- pause/stop intent into desk_controls. Paste this into the foil SQL editor.

-- ---- tables ------------------------------------------------------------
create table if not exists public.desk_meta (
  id             text primary key,          -- = session
  mode           text,
  status         text,
  total_ingested int,
  trade_count    int,
  provenance     jsonb,
  proof          jsonb,
  source         text,
  stalls         int,
  updated_at     timestamptz default now()
);

create table if not exists public.desk_agents (
  id             text primary key,
  session        text not null default 'live',
  name           text,
  title          text,
  edge_kinds     text[],
  status         text,
  bankroll       numeric,
  start_bankroll numeric,
  day_pnl        numeric,
  bets           int,
  wins           int,
  losses         int,
  open_positions int,
  unrealized     numeric,
  updated_at     timestamptz default now()
);

create table if not exists public.desk_trades (
  id         text primary key,              -- agentId:proofHash:ts
  session    text not null default 'live',
  ts         bigint,
  agent_id   text,
  agent      text,
  kind       text,
  match      text,
  side       text,
  direction  text,
  odds       numeric,
  stake      numeric,
  proof_hash text,
  status     text,
  clv_return numeric,
  pnl        numeric,
  -- CLOSING leg: the market's last real quote before it stopped trading, and its
  -- frame fingerprint — present once settled, so the close reconciles against
  -- TxLINE exactly like the entry. Null while the call is still open.
  exit_odds       numeric,
  exit_prob       numeric,
  exit_ts         bigint,
  exit_proof_hash text
);
create index if not exists desk_trades_ts_idx on public.desk_trades (ts desc);

-- Back-fill the closing-leg columns onto an already-created mirror (idempotent).
alter table public.desk_trades add column if not exists exit_odds       numeric;
alter table public.desk_trades add column if not exists exit_prob       numeric;
alter table public.desk_trades add column if not exists exit_ts         bigint;
alter table public.desk_trades add column if not exists exit_proof_hash text;

create table if not exists public.desk_controls (
  id           bigint generated always as identity primary key,
  session      text not null default 'live',
  agent_id     text not null,
  op           text not null check (op in ('pause','resume','stop')),
  requested_at timestamptz default now()
);

-- ---- RLS ---------------------------------------------------------------
alter table public.desk_meta     enable row level security;
alter table public.desk_agents   enable row level security;
alter table public.desk_trades   enable row level security;
alter table public.desk_controls enable row level security;

-- Start from zero, then grant only what each role needs (lockdown rule).
revoke all on public.desk_meta, public.desk_agents, public.desk_trades, public.desk_controls
  from anon, authenticated;

grant select on public.desk_meta, public.desk_agents, public.desk_trades to anon, authenticated;
grant insert on public.desk_controls to anon, authenticated;

-- anon/authenticated may READ the mirror…
drop policy if exists desk_meta_read   on public.desk_meta;
drop policy if exists desk_agents_read on public.desk_agents;
drop policy if exists desk_trades_read on public.desk_trades;
create policy desk_meta_read   on public.desk_meta   for select to anon, authenticated using (true);
create policy desk_agents_read on public.desk_agents for select to anon, authenticated using (true);
create policy desk_trades_read on public.desk_trades for select to anon, authenticated using (true);

-- …and may QUEUE a pause/stop intent, but cannot read/modify the queue.
-- (Demo trade-off: anyone viewing the public desk can pause/stop the demo
-- agents. The worker validates op via the CHECK constraint and clears the row.)
drop policy if exists desk_controls_insert on public.desk_controls;
create policy desk_controls_insert on public.desk_controls for insert to anon, authenticated with check (true);

-- service_role bypasses RLS entirely → the EC2 worker writes mirrors and
-- drains desk_controls with no policy needed.
