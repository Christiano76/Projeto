-- ════════════════════════════════════════════════════════════════════
-- AI Agency OS — esquema inicial
--
-- Multi-tenant: toda tabela de negócio possui company_id e RLS.
-- Escritas operacionais (eventos, tarefas, execuções de agentes) são feitas
-- pelo backend com a service role (que ignora RLS) após validação e
-- autorização no servidor. O cliente só LÊ esses dados.
-- ════════════════════════════════════════════════════════════════════

-- gen_random_uuid() é nativo desde o PostgreSQL 13 (sem extensões).

-- ─── Tipos ───────────────────────────────────────────────────────────
create type public.user_role as enum ('director', 'member');
create type public.employee_status as enum ('offline', 'idle', 'working', 'meeting', 'resting', 'blocked', 'error');
create type public.task_status as enum ('pending', 'queued', 'in_progress', 'blocked', 'review', 'completed', 'failed', 'cancelled');
create type public.task_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.event_source as enum ('system', 'orchestrator', 'agent', 'manual');
create type public.ai_provider as enum ('anthropic', 'openai');

-- ─── Função utilitária: updated_at ───────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ─── Empresa e usuários ──────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  company_id uuid references public.companies (id) on delete set null,
  role public.user_role not null default 'director',
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_company_idx on public.users (company_id);

create table public.company_settings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  -- Limites de autonomia (usados pelo orquestrador na Fase 3)
  autonomy_enabled boolean not null default false,
  monthly_ai_budget_usd numeric(12, 2) not null default 50 check (monthly_ai_budget_usd >= 0),
  max_concurrent_tasks int not null default 3 check (max_concurrent_tasks between 1 and 50),
  max_ai_calls_per_hour int not null default 60 check (max_ai_calls_per_hour between 1 and 10000),
  max_task_attempts int not null default 3 check (max_task_attempts between 1 and 10),
  cycle_pause_seconds int not null default 60 check (cycle_pause_seconds >= 5),
  -- Ações externas exigem permissão explícita do diretor
  external_permissions jsonb not null default
    '{"send_messages": false, "send_proposals": false, "publish_projects": false, "spend_money": false}'::jsonb,
  agency_branding jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  key text not null,
  name text not null,
  color text not null default '#64748b',
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

-- ─── Escritório ──────────────────────────────────────────────────────
create table public.office_rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  key text not null,
  name text not null,
  kind text not null check (kind in ('reception', 'director', 'manager', 'department', 'meeting', 'lounge', 'corridor')),
  x numeric(8, 2) not null,
  z numeric(8, 2) not null,
  width numeric(8, 2) not null check (width > 0),
  depth numeric(8, 2) not null check (depth > 0),
  doors jsonb not null default '[]'::jsonb,
  floor_color text not null default '#e5e7eb',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);
create index office_rooms_company_idx on public.office_rooms (company_id);

create table public.office_objects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  room_id uuid not null references public.office_rooms (id) on delete cascade,
  key text not null,
  type text not null,
  x numeric(8, 3) not null,
  z numeric(8, 3) not null,
  rotation numeric(10, 6) not null default 0,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, key)
);
create index office_objects_company_idx on public.office_objects (company_id);
create index office_objects_room_idx on public.office_objects (room_id);

-- ─── Funcionários e agentes ──────────────────────────────────────────
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  key text not null,
  name text not null,
  role_title text not null,
  personality text not null default '',
  objectives text[] not null default '{}',
  avatar jsonb not null default '{}'::jsonb,
  is_manager boolean not null default false,
  -- Estado operacional (fonte da verdade do escritório 3D)
  status public.employee_status not null default 'idle',
  runtime_state jsonb not null,
  state_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, key)
);
create index employees_company_idx on public.employees (company_id);
create index employees_status_idx on public.employees (company_id, status);
create trigger employees_touch before update on public.employees
  for each row execute function public.touch_updated_at();

create table public.employee_positions (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  desk_object_id uuid references public.office_objects (id) on delete set null,
  current_room_id uuid references public.office_rooms (id) on delete set null,
  x numeric(8, 3),
  z numeric(8, 3),
  updated_at timestamptz not null default now()
);
create index employee_positions_company_idx on public.employee_positions (company_id);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null unique references public.employees (id) on delete cascade,
  provider public.ai_provider not null default 'anthropic',
  model text not null,
  temperature numeric(3, 2) not null default 0.3 check (temperature between 0 and 2),
  max_output_tokens int not null default 4096 check (max_output_tokens > 0),
  max_runs_per_hour int not null default 20 check (max_runs_per_hour > 0),
  monthly_token_budget bigint not null default 2000000 check (monthly_token_budget >= 0),
  allowed_tools text[] not null default '{}',
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_company_idx on public.agents (company_id);
create trigger agents_touch before update on public.agents
  for each row execute function public.touch_updated_at();

create table public.agent_instructions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  version int not null,
  system_prompt text not null,
  is_active boolean not null default true,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_id, version)
);
create unique index agent_instructions_one_active on public.agent_instructions (agent_id) where is_active;

-- ─── Comercial ───────────────────────────────────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  company_name text,
  segment text,
  public_contact text,
  source_url text,
  status text not null default 'lead' check (status in ('lead', 'qualified', 'negotiating', 'active', 'inactive', 'lost')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_company_idx on public.customers (company_id, status);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  title text not null,
  company_name text,
  segment text,
  public_contact text,
  -- Origem verificável é obrigatória: nada de oportunidades inventadas.
  source text not null,
  source_url text not null check (source_url ~ '^https?://'),
  evidence text not null check (char_length(evidence) >= 10),
  identified_need text,
  potential_score int check (potential_score between 0 and 100),
  status text not null default 'new' check (status in ('new', 'qualified', 'discarded', 'proposal', 'won', 'lost')),
  dedupe_key text not null,
  discovered_by_employee_id uuid references public.employees (id) on delete set null,
  discovered_at timestamptz not null default now(),
  interaction_history jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (company_id, dedupe_key)
);
create index opportunities_company_idx on public.opportunities (company_id, status, discovered_at desc);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  opportunity_id uuid references public.opportunities (id) on delete set null,
  service text not null,
  description text not null,
  price_cents bigint not null check (price_cents >= 0),
  currency char(3) not null default 'BRL',
  delivery_days int not null check (delivery_days > 0),
  conditions text,
  valid_until date,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired')),
  pdf_path text,
  created_by_employee_id uuid references public.employees (id) on delete set null,
  approved_by uuid references public.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index proposals_company_idx on public.proposals (company_id, status);

-- ─── Produção ────────────────────────────────────────────────────────
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  proposal_id uuid references public.proposals (id) on delete set null,
  name text not null,
  status text not null default 'planning'
    check (status in ('planning', 'in_progress', 'testing', 'awaiting_approval', 'delivered', 'cancelled')),
  repository_url text,
  staging_url text,
  production_url text,
  -- Publicação em produção só com aprovação explícita do diretor.
  publish_approved_by uuid references public.users (id) on delete set null,
  publish_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (production_url is null or publish_approved_by is not null)
);
create index projects_company_idx on public.projects (company_id, status);

-- ─── Tarefas e execução de agentes ───────────────────────────────────
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '',
  assigned_employee_id uuid references public.employees (id) on delete set null,
  created_by_employee_id uuid references public.employees (id) on delete set null,
  parent_task_id uuid references public.tasks (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'pending',
  due_at timestamptz,
  result jsonb,
  attempts int not null default 0,
  max_attempts int not null default 3,
  available_at timestamptz not null default now(),
  locked_by text,
  locked_until timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_company_status_idx on public.tasks (company_id, status);
create index tasks_assignee_idx on public.tasks (assigned_employee_id, status);
-- Índice da fila: tarefas prontas para execução, por prioridade.
create index tasks_queue_idx on public.tasks (company_id, priority desc, available_at)
  where status in ('queued');
create trigger tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

create table public.task_logs (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  employee_id uuid references public.employees (id) on delete set null,
  level text not null default 'info' check (level in ('debug', 'info', 'warn', 'error')),
  message text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index task_logs_task_idx on public.task_logs (task_id, created_at);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  agent_id uuid not null references public.agents (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  provider public.ai_provider not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_runs_company_idx on public.agent_runs (company_id, started_at desc);
create index agent_runs_agent_idx on public.agent_runs (agent_id, started_at desc);

create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  from_employee_id uuid not null references public.employees (id) on delete cascade,
  to_employee_id uuid references public.employees (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  kind text not null default 'message'
    check (kind in ('message', 'request_info', 'share_result', 'handoff', 'review_request', 'meeting_note')),
  subject text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index agent_messages_company_idx on public.agent_messages (company_id, created_at desc);
create index agent_messages_to_idx on public.agent_messages (to_employee_id, read_at);

create table public.agent_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  source public.event_source not null,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index agent_events_company_idx on public.agent_events (company_id, created_at desc);
create index agent_events_employee_idx on public.agent_events (employee_id, created_at desc);

-- ─── Financeiro ──────────────────────────────────────────────────────
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null default 'BRL',
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'overdue', 'cancelled')),
  issued_at date,
  due_at date,
  paid_at date,
  created_at timestamptz not null default now()
);
create index invoices_company_idx on public.invoices (company_id, status);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  category text not null check (category in ('ai', 'infrastructure', 'tools', 'marketing', 'other')),
  description text not null,
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null default 'BRL',
  agent_run_id uuid references public.agent_runs (id) on delete set null,
  incurred_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index expenses_company_idx on public.expenses (company_id, incurred_at desc);

-- ════════════════════════════════════════════════════════════════════
-- Segurança: funções auxiliares e RLS
-- ════════════════════════════════════════════════════════════════════

create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.users where id = auth.uid()
$$;

create or replace function public.is_director() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users where id = auth.uid() and role = 'director' and company_id is not null)
$$;

-- Cria o perfil público ao registrar um usuário no Supabase Auth.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

/**
 * Persiste atomicamente um evento e o novo estado do funcionário, com
 * concorrência otimista. O novo estado é calculado no servidor pela máquina
 * de estados (@agency/core). Retorna false em caso de conflito de versão.
 * Uso exclusivo do backend (service role).
 */
create or replace function public.commit_agent_event(
  p_company_id uuid,
  p_employee_id uuid,
  p_expected_version int,
  p_runtime_state jsonb,
  p_event_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_source public.event_source,
  p_created_by uuid,
  p_created_at timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update public.employees
     set runtime_state = p_runtime_state,
         status = (p_runtime_state ->> 'status')::public.employee_status,
         state_version = p_expected_version + 1
   where id = p_employee_id
     and company_id = p_company_id
     and state_version = p_expected_version;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  insert into public.agent_events (id, company_id, employee_id, type, payload, source, created_by, created_at)
  values (p_event_id, p_company_id, p_employee_id, p_event_type, p_payload, p_source, p_created_by, p_created_at);
  return true;
end $$;

revoke all on function public.commit_agent_event(uuid, uuid, int, jsonb, uuid, text, jsonb, public.event_source, uuid, timestamptz) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.commit_agent_event(uuid, uuid, int, jsonb, uuid, text, jsonb, public.event_source, uuid, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.commit_agent_event(uuid, uuid, int, jsonb, uuid, text, jsonb, public.event_source, uuid, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.commit_agent_event(uuid, uuid, int, jsonb, uuid, text, jsonb, public.event_source, uuid, timestamptz) to service_role;
  end if;
end $$;

-- ─── RLS ─────────────────────────────────────────────────────────────
alter table public.companies enable row level security;
alter table public.users enable row level security;

create policy companies_select on public.companies for select to authenticated
  using (id = public.current_company_id());
create policy companies_update on public.companies for update to authenticated
  using (id = public.current_company_id() and public.is_director())
  with check (id = public.current_company_id());

create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or company_id = public.current_company_id());
-- O usuário pode alterar apenas o próprio nome (papel/empresa são definidos pelo servidor).
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select u.role from public.users u where u.id = auth.uid())
    and company_id is not distinct from (select u.company_id from public.users u where u.id = auth.uid())
  );

-- Tabelas de configuração: leitura para membros, escrita para o diretor.
do $$
declare t text;
begin
  foreach t in array array[
    'company_settings', 'departments', 'office_rooms', 'office_objects',
    'employees', 'employee_positions', 'agents', 'agent_instructions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (company_id = public.current_company_id() and public.is_director()) with check (company_id = public.current_company_id() and public.is_director())',
      t || '_director_write', t);
  end loop;
end $$;

-- Tabelas operacionais: somente leitura para membros; escrita via backend.
do $$
declare t text;
begin
  foreach t in array array[
    'tasks', 'task_logs', 'agent_runs', 'agent_messages', 'agent_events',
    'customers', 'opportunities', 'projects', 'invoices', 'expenses', 'proposals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (company_id = public.current_company_id())',
      t || '_select', t);
  end loop;
end $$;

-- O diretor aprova/rejeita propostas e autoriza publicação de projetos.
create policy proposals_director_update on public.proposals for update to authenticated
  using (company_id = public.current_company_id() and public.is_director())
  with check (company_id = public.current_company_id());
create policy projects_director_update on public.projects for update to authenticated
  using (company_id = public.current_company_id() and public.is_director())
  with check (company_id = public.current_company_id());

-- ─── Realtime ────────────────────────────────────────────────────────
-- O escritório 3D assina eventos e mudanças de estado (respeitando RLS).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.agent_events, public.employees;
  end if;
end $$;
