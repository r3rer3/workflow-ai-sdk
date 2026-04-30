-- workflow-ai-sdk Supabase example schema.
--
-- Three RLS-enabled tables that the example WorkflowStore writes to:
--   workflow_runs         — one row per workflow execution
--   workflow_checkpoints  — one row per run; overwritten on each saveCheckpoint
--   workflow_events       — append-only event log
--
-- Every row is stamped with user_id (references auth.users). All reads and
-- writes go through Row Level Security with `auth.uid() = user_id`, so a
-- route that uses an authenticated Supabase client cannot accidentally touch
-- another user's data. There is no service-role bypass.
--
-- Apply this file against your Supabase project (SQL editor or `supabase db
-- push`) before running `apps/examples`.

create table if not exists public.workflow_runs (
  user_id uuid not null references auth.users(id) on delete cascade,

  run_id text primary key,
  workflow_name text not null,
  thread_id text not null,
  resource_id text not null,
  mode text not null,
  state jsonb not null,
  status text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  result jsonb
);

create table if not exists public.workflow_checkpoints (
  user_id uuid not null references auth.users(id) on delete cascade,

  run_id text primary key references public.workflow_runs(run_id) on delete cascade,
  workflow_name text not null,
  mode text not null,
  thread_id text not null,
  resource_id text not null,
  state jsonb not null,
  pause jsonb,
  metadata jsonb,
  runtime jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.workflow_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,

  run_id text not null references public.workflow_runs(run_id) on delete cascade,
  event jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists workflow_runs_user_id_idx
  on public.workflow_runs (user_id);
create index if not exists workflow_checkpoints_user_id_idx
  on public.workflow_checkpoints (user_id);
create index if not exists workflow_events_user_id_run_id_idx
  on public.workflow_events (user_id, run_id);

alter table public.workflow_runs enable row level security;
alter table public.workflow_checkpoints enable row level security;
alter table public.workflow_events enable row level security;

-- workflow_runs policies.
create policy "workflow_runs select own"
  on public.workflow_runs
  for select
  using (auth.uid() = user_id);

create policy "workflow_runs insert own"
  on public.workflow_runs
  for insert
  with check (auth.uid() = user_id);

create policy "workflow_runs update own"
  on public.workflow_runs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workflow_runs delete own"
  on public.workflow_runs
  for delete
  using (auth.uid() = user_id);

-- workflow_checkpoints policies.
create policy "workflow_checkpoints select own"
  on public.workflow_checkpoints
  for select
  using (auth.uid() = user_id);

create policy "workflow_checkpoints insert own"
  on public.workflow_checkpoints
  for insert
  with check (auth.uid() = user_id);

create policy "workflow_checkpoints update own"
  on public.workflow_checkpoints
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workflow_checkpoints delete own"
  on public.workflow_checkpoints
  for delete
  using (auth.uid() = user_id);

-- workflow_events policies.
create policy "workflow_events select own"
  on public.workflow_events
  for select
  using (auth.uid() = user_id);

create policy "workflow_events insert own"
  on public.workflow_events
  for insert
  with check (auth.uid() = user_id);

create policy "workflow_events update own"
  on public.workflow_events
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "workflow_events delete own"
  on public.workflow_events
  for delete
  using (auth.uid() = user_id);
