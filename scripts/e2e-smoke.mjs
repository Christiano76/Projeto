#!/usr/bin/env node
/**
 * Teste de fumaça end-to-end (modo local, sem Supabase):
 *  1. sobe o servidor Next (build de produção já gerado);
 *  2. abre o escritório 3D num Chromium real e verifica o WebGL;
 *  3. registra eventos pela API e confirma que o estado chega ao navegador
 *     em tempo real (SSE) e que transições inválidas são recusadas;
 *  4. salva capturas de tela em artifacts/.
 *
 * Uso: npm run build && npm run test:e2e
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(root, 'artifacts');
mkdirSync(OUT, { recursive: true });

await assertPortFree();

const env = { ...process.env, AGENCY_FORCE_MEMORY_MODE: 'true', NEXT_TELEMETRY_DISABLED: '1', PORT: String(PORT) };
const nextBin = require.resolve('next/dist/bin/next', { paths: [path.join(root, 'apps/web')] });
const server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
  cwd: path.join(root, 'apps/web'),
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // permite encerrar o grupo de processos inteiro no final
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};

async function assertPortFree() {
  try {
    await fetch(`${BASE}/api/health`);
  } catch {
    return;
  }
  throw new Error(`porta ${PORT} já está em uso — encerre o processo anterior ou defina E2E_PORT`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(500);
  }
  throw new Error('servidor não respondeu\n' + serverLog);
}

async function main() {
  const health = await waitForServer();
  check(health.mode === 'memory', `servidor no ar (modo ${health.mode})`);

  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await sleep(2500);
  const webgl = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return !!c && c.width > 0 && c.height > 0;
  });
  check(webgl, 'canvas WebGL renderizado');
  const roomLabels = await page.locator('.room-label').allTextContents();
  check(roomLabels.length === 9, `9 ambientes rotulados (${roomLabels.length}: ${roomLabels.join(', ')})`);
  check((await page.locator('.avatar-label').count()) === 8, '8 funcionários no escritório');
  await page.screenshot({ path: path.join(OUT, '01-escritorio.png') });

  const snap = await (await fetch(`${BASE}/api/office`)).json();
  const byKey = Object.fromEntries(snap.employees.map((e) => [e.key, e]));
  check(snap.employees.every((e) => e.runtime.status === 'idle'), 'todos começam disponíveis (sem trabalho fictício)');

  const post = (employeeId, type, payload = {}) =>
    fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, type, payload }) });

  // Transições válidas
  const r1 = await post(byKey.dev_frontend.id, 'task.started', { taskId: 'site-1', title: 'Landing page — Padaria Pão Bom' });
  check(r1.status === 201, 'dev frontend inicia tarefa (201)');
  const r2 = await post(byKey.gerente.id, 'meeting.joined', { meetingId: 'm1', topic: 'Planejamento semanal' });
  const r3 = await post(byKey.analista_comercial.id, 'meeting.joined', { meetingId: 'm1', topic: 'Planejamento semanal' });
  check(r2.status === 201 && r3.status === 201, 'gerente e analista entram em reunião');
  const r4 = await post(byKey.analista_financeiro.id, 'break.started');
  check(r4.status === 201, 'analista financeiro inicia pausa');
  const r5 = await post(byKey.qa.id, 'employee.offline');
  check(r5.status === 201, 'QA sai do expediente');

  // Transição inválida
  const bad = await post(byKey.dev_frontend.id, 'task.started', { taskId: 'site-2', title: 'Outra' });
  check(bad.status === 409, 'segunda tarefa simultânea é recusada (409)');
  const invalid = await post(byKey.dev_frontend.id, 'task.started', { taskId: 'x' });
  check(invalid.status === 400, 'payload inválido é recusado (400)');

  // Estado chega ao navegador por SSE
  await page.waitForFunction(
    () => [...document.querySelectorAll('aside li')].some((li) => li.textContent?.includes('Marina Souza') && li.textContent?.includes('Trabalhando')),
    null,
    { timeout: 10_000 },
  ).then(() => check(true, 'navegador recebeu o novo estado em tempo real (SSE)'))
   .catch(() => check(false, 'navegador recebeu o novo estado em tempo real (SSE)'));

  await sleep(9000); // tempo para os avatares caminharem até os destinos
  await page.screenshot({ path: path.join(OUT, '02-eventos-aplicados.png') });

  // Seleção + foco de sala
  await page.getByRole('button', { name: /Marina Souza/ }).first().click();
  await page.getByRole('button', { name: 'Desenvolvimento' }).click();
  await sleep(1500);
  check(await page.getByText('Landing page — Padaria Pão Bom').first().isVisible(), 'ficha mostra a tarefa real em execução');
  await page.screenshot({ path: path.join(OUT, '03-desenvolvimento.png') });

  await page.getByRole('button', { name: 'Sala de Reuniões' }).click();
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, '04-reuniao.png') });

  const done = await post(byKey.dev_frontend.id, 'task.completed', { taskId: 'site-1' });
  check(done.status === 201, 'dev frontend conclui a tarefa');
  const after = await (await fetch(`${BASE}/api/office`)).json();
  const dev = after.employees.find((e) => e.key === 'dev_frontend');
  check(dev.runtime.status === 'idle' && dev.runtime.tasksCompleted === 1, 'produtividade contabilizada');

  // Mobile
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('canvas');
  await sleep(2500);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'mobile sem rolagem horizontal');
  await mobile.screenshot({ path: path.join(OUT, '05-mobile.png') });

  // Painel admin
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  check(await page.getByText('Tarefas concluídas', { exact: true }).isVisible(), 'painel administrativo carrega');
  await page.screenshot({ path: path.join(OUT, '06-admin.png'), fullPage: true });

  const relevantErrors = errors.filter((e) => !/GPU stall|WebGL|swiftshader|ReadPixels/i.test(e));
  check(relevantErrors.length === 0, `sem erros no console${relevantErrors.length ? ': ' + relevantErrors.join(' | ') : ''}`);

  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(() => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
    console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTodas as verificações passaram');
    process.exit(failures ? 1 : 0);
  });
