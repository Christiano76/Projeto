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

  await themeChecks(browser, errors);

  const relevantErrors = errors.filter((e) => !/GPU stall|WebGL|swiftshader|ReadPixels/i.test(e));
  check(relevantErrors.length === 0, `sem erros no console${relevantErrors.length ? ': ' + relevantErrors.join(' | ') : ''}`);

  await browser.close();
}

/** Lê a cor média de uma região da tela (decodificando a captura no próprio navegador). */
async function sampleColor(page, clip) {
  const b64 = (await page.screenshot({ clip })).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    return { r: r / n, g: g / n, b: b / n, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / n };
  }, b64);
}

async function themeChecks(browser, errors) {
  const STORAGE = 'agency-os:theme';
  // 1) Sem flash: com preferência salva "dark", o <html> já nasce escuro.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await ctx.addInitScript(([k]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, 'dark'); sessionStorage.setItem('seeded', '1'); } }, [STORAGE]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const response = await page.goto(BASE, { waitUntil: 'commit' });
  check(!!response, 'página carregada para teste de tema');
  await page.waitForLoadState('domcontentloaded');
  const early = await page.evaluate(() => document.documentElement.dataset.theme);
  check(early === 'dark', `tema salvo aplicado antes da hidratação (data-theme=${early})`);
  const htmlSrc = await (await fetch(BASE)).text();
  check(htmlSrc.indexOf('agency-os:theme') < htmlSrc.indexOf('<body'), 'script de tema roda no <head> (antes do corpo)');

  await page.waitForSelector('canvas');
  await sleep(3500);
  const bodyBgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const sceneDark = await sampleColor(page, { x: 1300, y: 500, width: 40, height: 40 });
  await page.screenshot({ path: path.join(OUT, '10-escuro-escritorio.png') });

  // 2) Alternância animada + persistência
  await page.getByTestId('theme-toggle').first().click();
  const during = await page.evaluate(() => document.documentElement.classList.contains('theme-transition'));
  check(during, 'transição animada ativa durante a troca de tema');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'botão alterna para o modo claro');
  await sleep(2000); // transição gradual da iluminação 3D
  const sceneLight = await sampleColor(page, { x: 1300, y: 500, width: 40, height: 40 });
  const bodyBgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bodyBgDark !== bodyBgLight, `interface muda de cor (${bodyBgDark} → ${bodyBgLight})`);
  check(sceneLight.lum > sceneDark.lum + 60, `escritório 3D clareia (lum ${sceneDark.lum.toFixed(0)} → ${sceneLight.lum.toFixed(0)})`);
  check(sceneDark.b >= sceneDark.r, 'modo escuro com tom frio/azulado');
  await page.screenshot({ path: path.join(OUT, '11-claro-escritorio.png') });
  await page.reload({ waitUntil: 'domcontentloaded' });
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'preferência mantida após recarregar');

  // 3) Todas as telas nos dois temas
  for (const theme of ['light', 'dark']) {
    await page.evaluate(([k, t]) => localStorage.setItem(k, t), [STORAGE, theme]);
    for (const [route, name] of [['/admin', 'admin'], ['/admin/events', 'eventos']]) {
      await page.goto(BASE + route, { waitUntil: 'networkidle' });
      const t = await page.evaluate(() => document.documentElement.dataset.theme);
      const fg = await page.evaluate(() => getComputedStyle(document.body).color);
      check(t === theme, `${route} no tema ${theme} (texto ${fg})`);
      await page.screenshot({ path: path.join(OUT, `12-${theme}-${name}.png`), fullPage: true });
    }
    // Ficha do funcionário aberta (painéis, botões e console)
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForSelector('canvas');
    await sleep(2500);
    await page.getByRole('button', { name: /Thiago Almeida/ }).first().click();
    await sleep(600);
    await page.getByRole('button', { name: /Console de eventos/ }).click();
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `13-${theme}-ficha.png`) });
  }

  // 4) Mobile nos dois temas
  for (const theme of ['light', 'dark']) {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await m.addInitScript(([k, t]) => localStorage.setItem(k, t), [STORAGE, theme]);
    const mp = await m.newPage();
    await mp.goto(BASE, { waitUntil: 'networkidle' });
    await mp.waitForSelector('canvas');
    await sleep(2500);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, `mobile (${theme}) sem rolagem horizontal`);
    await mp.screenshot({ path: path.join(OUT, `14-${theme}-mobile.png`) });
    await m.close();
  }

  // 5) prefers-reduced-motion: troca instantânea, sem classe de transição
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  await rp.goto(BASE, { waitUntil: 'networkidle' });
  await rp.waitForSelector('canvas');
  const before = await rp.evaluate(() => document.documentElement.dataset.theme);
  await rp.getByTestId('theme-toggle').first().click();
  const state = await rp.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    transition: document.documentElement.classList.contains('theme-transition'),
    anim: getComputedStyle(document.querySelector('.anim-panel-in')).animationDuration,
  }));
  check(state.theme !== before && !state.transition, 'movimento reduzido: tema troca sem animação');
  check(parseFloat(state.anim) < 0.01, `movimento reduzido: animações desativadas (${state.anim})`);
  await rm.close();
  await ctx.close();
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
