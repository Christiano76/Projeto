import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Aplica as migrações em um PostgreSQL embarcado (PGlite) com um "stub" mínimo
 * do ambiente Supabase (schema auth, papéis e publicação do Realtime), e
 * verifica RLS e a função de commit de eventos.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create publication supabase_realtime;
`;

const A_USER = '00000000-0000-0000-0000-00000000000a';
const B_USER = '00000000-0000-0000-0000-00000000000b';
let db: PGlite;
let companyA: string;
let companyB: string;
let employeeA: string;

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false);`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  // No Supabase, privilégios de tabela são concedidos por padrão; RLS faz o filtro.
  await db.exec(`
    grant usage on schema public to anon, authenticated, service_role;
    grant all on all tables in schema public to authenticated, service_role;
    grant all on all sequences in schema public to authenticated, service_role;
  `);

  await db.exec(`insert into auth.users (id, email) values ('${A_USER}', 'a@ex.com'), ('${B_USER}', 'b@ex.com');`);
  companyA = (await db.query<{ id: string }>(`insert into companies (name) values ('Agência A') returning id`)).rows[0]!.id;
  companyB = (await db.query<{ id: string }>(`insert into companies (name) values ('Agência B') returning id`)).rows[0]!.id;
  await db.exec(`
    update users set company_id = '${companyA}' where id = '${A_USER}';
    update users set company_id = '${companyB}', role = 'member' where id = '${B_USER}';
  `);
  for (const c of [companyA, companyB]) {
    const dep = (await db.query<{ id: string }>(`insert into departments (company_id, key, name) values ('${c}', 'dev', 'Dev') returning id`)).rows[0]!.id;
    const emp = (
      await db.query<{ id: string }>(
        `insert into employees (company_id, department_id, key, name, role_title, runtime_state)
         values ('${c}', '${dep}', 'dev', 'Dev ${c === companyA ? 'A' : 'B'}', 'Dev', '{"status":"idle"}') returning id`,
      )
    ).rows[0]!.id;
    if (c === companyA) employeeA = emp;
  }
});

afterAll(async () => {
  await db?.close();
});

describe('migrações Supabase', () => {
  it('cria todas as tabelas planejadas', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'users', 'employees', 'departments', 'agents', 'agent_instructions', 'tasks', 'task_logs',
      'agent_messages', 'agent_runs', 'customers', 'opportunities', 'proposals', 'projects', 'invoices',
      'expenses', 'company_settings', 'office_rooms', 'office_objects', 'employee_positions', 'agent_events', 'companies',
    ]) {
      expect(names, t).toContain(t);
    }
  });

  it('cria o perfil público ao registrar no Auth (papel padrão: diretor sem empresa)', async () => {
    const { rows } = await db.query<{ role: string; full_name: string }>(`select role, full_name from users where id = '${A_USER}'`);
    expect(rows[0]).toMatchObject({ role: 'director', full_name: 'a' });
  });

  it('RLS isola dados entre empresas', async () => {
    const seenByA = await asUser(A_USER, () => db.query<{ name: string }>(`select name from employees`));
    expect(seenByA.rows.map((r) => r.name)).toEqual(['Dev A']);
    const seenByB = await asUser(B_USER, () => db.query<{ name: string }>(`select name from employees`));
    expect(seenByB.rows.map((r) => r.name)).toEqual(['Dev B']);
    const companies = await asUser(A_USER, () => db.query(`select id from companies`));
    expect(companies.rows).toHaveLength(1);
  });

  it('membro (não diretor) não altera configuração; diretor altera', async () => {
    const asMember = await asUser(B_USER, () => db.query(`update employees set name = 'x' returning id`));
    expect(asMember.rows).toHaveLength(0);
    const asDirector = await asUser(A_USER, () => db.query(`update employees set name = 'Dev A2' returning id`));
    expect(asDirector.rows).toHaveLength(1);
  });

  it('cliente autenticado não escreve eventos nem chama commit_agent_event', async () => {
    await expect(
      asUser(A_USER, () =>
        db.query(`insert into agent_events (company_id, employee_id, type, source) values ('${companyA}', '${employeeA}', 'x', 'manual')`),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(A_USER, () =>
        db.query(
          `select commit_agent_event('${companyA}', '${employeeA}', 0, '{"status":"working"}', gen_random_uuid(), 'task.started', '{}', 'manual', null, now())`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('usuário não consegue se promover nem trocar de empresa', async () => {
    const r = await asUser(B_USER, () =>
      db.query(`update users set role = 'director' where id = '${B_USER}' returning id`).catch((e: Error) => e),
    );
    expect(r instanceof Error ? r.message : (r as { rows: unknown[] }).rows.length).toSatisfy(
      (v: unknown) => v === 0 || (typeof v === 'string' && /row-level security/.test(v)),
    );
    const { rows } = await db.query<{ role: string }>(`select role from users where id = '${B_USER}'`);
    expect(rows[0]!.role).toBe('member');
  });

  it('commit_agent_event aplica com concorrência otimista (service role)', async () => {
    const commit = (version: number) =>
      db.query<{ commit_agent_event: boolean }>(
        `select commit_agent_event($1, $2, $3, $4, gen_random_uuid(), 'task.started', '{}'::jsonb, 'manual', null, now())`,
        [companyA, employeeA, version, JSON.stringify({ status: 'working' })],
      );
    expect((await commit(0)).rows[0]!.commit_agent_event).toBe(true);
    expect((await commit(0)).rows[0]!.commit_agent_event).toBe(false); // versão antiga => conflito
    const { rows } = await db.query<{ status: string; state_version: number }>(
      `select status, state_version from employees where id = $1`,
      [employeeA],
    );
    expect(rows[0]).toEqual({ status: 'working', state_version: 1 });
    const events = await db.query(`select 1 from agent_events where employee_id = $1`, [employeeA]);
    expect(events.rows).toHaveLength(1);
  });

  it('oportunidades exigem origem verificável e projeto só vai a produção com aprovação', async () => {
    await expect(
      db.query(
        `insert into opportunities (company_id, title, source, source_url, evidence, dedupe_key) values ($1, 'x', 'forum', 'ftp://x', 'evidência suficiente', 'k1')`,
        [companyA],
      ),
    ).rejects.toThrow(/check constraint/);
    await expect(
      db.query(`insert into projects (company_id, name, production_url) values ($1, 'Site', 'https://site.com')`, [companyA]),
    ).rejects.toThrow(/check constraint/);
  });

  it('tabelas de estado estão na publicação do Realtime', async () => {
    const { rows } = await db.query<{ tablename: string }>(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(['agent_events', 'employees']);
  });
});
