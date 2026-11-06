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
const { chromium, devices } = require('playwright');

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

  await officeLifeChecks(browser, errors);
  await cameraChecks(browser, errors);
  await androidChecks(browser, errors);
  await themeChecks(browser, errors);

  const relevantErrors = errors.filter((e) => !/GPU stall|WebGL|swiftshader|ReadPixels/i.test(e));
  check(relevantErrors.length === 0, `sem erros no console${relevantErrors.length ? ': ' + relevantErrors.join(' | ') : ''}`);

  await browser.close();
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

async function openOffice(browser, errors, opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__agencyOS?.agents && window.__agencyOS?.camera && window.__agencyOS.camera());
  await sleep(1500);
  return page;
}

const agentsOf = (page) => page.evaluate(() => window.__agencyOS.agents());
const cameraOf = (page) => page.evaluate(() => window.__agencyOS.camera());
const post = (employeeId, type, payload = {}) =>
  fetch(`${BASE}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, type, payload }) });

/** Movimento autônomo, chegada às mesas, colisões, obstáculos e inspeções do gerente. */
async function officeLifeChecks(browser, errors) {
  console.log('\n— Escritório vivo —');
  const page = await openOffice(browser, errors);
  const snap = await (await fetch(`${BASE}/api/office`)).json();
  const byKey = Object.fromEntries(snap.employees.map((e) => [e.key, e]));
  // Estado deixado pelo roteiro anterior: encerra reunião, pausa e ausência.
  await post(byKey.gerente.id, 'meeting.left', { meetingId: 'm1' });
  await post(byKey.analista_comercial.id, 'meeting.left', { meetingId: 'm1' });
  await post(byKey.analista_financeiro.id, 'break.ended');
  await post(byKey.qa.id, 'employee.online');

  // 1) Amostragem do movimento por 24 s
  const samples = [];
  const times = [];
  for (let i = 0; i < 96; i++) {
    samples.push(await agentsOf(page));
    times.push(Date.now());
    await sleep(250);
  }
  let walkingSeen = 0;
  let minSep = Infinity;
  let maxJump = 0;
  let offGrid = [];
  for (let i = 0; i < samples.length; i++) {
    const vis = samples[i].filter((a) => a.phase !== 'hidden' && a.phase !== 'entering');
    walkingSeen += vis.filter((a) => a.phase === 'walking').length;
    for (let x = 0; x < vis.length; x++) for (let y = x + 1; y < vis.length; y++) minSep = Math.min(minSep, dist(vis[x].pos, vis[y].pos));
    for (const a of vis) {
      const nearSeat = (a.goalPos && dist(a.goalPos, a.pos) < 0.9) || (a.seatPos && dist(a.seatPos, a.pos) < 0.9);
      if (!a.walkable && a.phase === 'walking' && !nearSeat) offGrid.push(`${a.id.slice(0, 4)}@${a.pos.map((v) => v.toFixed(1))}`);
      const prev = i > 0 && samples[i - 1].find((p) => p.id === a.id);
      if (prev && prev.phase !== 'hidden' && prev.phase !== 'entering') {
        const dtSim = a.simTime - prev.simTime;
        if (dtSim > 0) maxJump = Math.max(maxJump, dist(prev.pos, a.pos) / dtSim);
      }
    }
  }
  const moved = samples.at(-1).filter((a) => a.distance > 1).length;
  check(walkingSeen > 0 && moved >= 1, `funcionários caminham pelo escritório (${moved} se deslocaram)`);
  check(minSep > 0.4, `ninguém atravessa ninguém (menor distância ${minSep.toFixed(2)} m)`);
  check(offGrid.length === 0, `ninguém atravessa móveis/paredes${offGrid.length ? ': ' + offGrid.slice(0, 5).join(' ') : ''}`);
  check(maxJump < 3.0, `sem teletransporte (maior velocidade observada: ${maxJump.toFixed(2)} m/s)`);

  // 1b) Mensagem interna real => remetente vai até o colega e conversa
  const sender = byKey.vendedor;
  const receiver = byKey.prospector;
  const msg = await post(sender.id, 'message.sent', { toEmployeeId: receiver.id, subject: 'Lead do site da padaria' });
  check(msg.status === 201, 'mensagem interna registrada');
  let visiting = null;
  for (let i = 0; i < 50 && !visiting; i++) {
    const list = await agentsOf(page);
    const a = list.find((x) => x.id === sender.id);
    if (a.goalKey?.startsWith(`visit:${receiver.id}`) && a.phase === 'standing') visiting = { a, r: list.find((x) => x.id === receiver.id) };
    else await sleep(300);
  }
  check(!!visiting, 'remetente caminha até o colega para conversar');
  if (visiting) {
    check(dist(visiting.a.pos, visiting.r.pos) < 2.2 && visiting.a.pose === 'stand_talk', `animação de conversa ao lado do colega (${dist(visiting.a.pos, visiting.r.pos).toFixed(2)} m)`);
  }

  // 2) Trabalho real => volta à própria mesa e senta digitando
  const dev = byKey.dev_backend;
  const r = await post(dev.id, 'task.started', { taskId: 'api-1', title: 'API de pedidos' });
  check(r.status === 201, 'dev backend recebe tarefa real');
  let seated = null;
  for (let i = 0; i < 90 && !seated; i++) {
    const a = (await agentsOf(page)).find((x) => x.id === dev.id);
    if (a.phase === 'seated' && a.goalKey === `seat:${dev.deskSeatKey}`) seated = a;
    else await sleep(500);
  }
  check(!!seated, 'funcionário caminha até a própria mesa e senta');
  await sleep(800);
  const typing = (await agentsOf(page)).find((x) => x.id === dev.id);
  check(typing.pose === 'sit_typing', `animação de trabalho só com tarefa real (pose: ${typing.pose})`);

  // 3) Falha real => gerente prioriza, caminha, inspeciona e registra o estado consultado
  const fin = byKey.analista_financeiro;
  const failedAt = Date.now() - 500;
  await post(fin.id, 'task.started', { taskId: 'fin-1', title: 'Conciliação bancária' });
  await post(fin.id, 'task.failed', { taskId: 'fin-1', error: 'extrato indisponível' });
  const manager = byKey.gerente;
  let inspected = null;
  let visit = null;
  let managerWalked = 0;
  for (let i = 0; i < 120 && !inspected; i++) {
    const evs = (await (await fetch(`${BASE}/api/events?employeeId=${manager.id}&limit=50`)).json()).events;
    const after = evs.filter((e) => Date.parse(e.createdAt) >= failedAt);
    visit = visit ?? after.find((e) => e.type === 'supervision.visit_started' && e.payload.targetEmployeeId === fin.id);
    inspected = after.find((e) => e.type === 'supervision.inspected' && e.payload.targetEmployeeId === fin.id);
    const m = (await agentsOf(page)).find((x) => x.id === manager.id);
    managerWalked = m.distance;
    if (!inspected) await sleep(500);
  }
  check(!!visit, 'gerente inicia visita ao funcionário com falha (prioridade)');
  check(!!inspected, 'gerente conclui a inspeção');
  if (inspected) {
    check(inspected.payload.observedStatus === 'error' && inspected.payload.findings.includes('error'), 'inspeção registra o estado REAL consultado (erro)');
    check(Date.parse(inspected.createdAt) - Date.parse(visit.createdAt) >= 4000, 'inspeção só após caminhar e observar (≥ 4 s)');
    check(managerWalked > 1, `gerente caminhou de fato (${managerWalked.toFixed(1)} m)`);
    check(inspected.source === 'system', 'inspeção registrada pelo servidor (origem system)');
  }
  const forged = await post(manager.id, 'supervision.inspected', { targetEmployeeId: fin.id, observedStatus: 'idle', findings: ['ok'], statusMinutes: 0 });
  check(forged.status === 403, 'inspeção falsa pelo console é recusada (403)');

  // 4) Ficha do gerente com supervisão
  await page.getByRole('button', { name: /Helena Prado/ }).first().click();
  await page.waitForSelector('[data-testid="supervision-section"]');
  await sleep(1200);
  const supText = await page.locator('[data-testid="supervision-section"]').innerText();
  check(/Analista Financeiro|Eduardo/.test(supText) && /Falha na última tarefa/.test(supText), 'ficha do gerente mostra inspecionados e problemas identificados');
  check(await page.locator('[data-testid="agent-activity"]').isVisible(), 'ficha mostra a atividade atual');
  await page.screenshot({ path: path.join(OUT, '20-gerente-supervisao.png') });

  // 5) Acompanhar com a câmera
  await page.getByTestId('follow-toggle').click();
  await sleep(2500);
  const m = (await agentsOf(page)).find((x) => x.id === manager.id);
  const cam = await cameraOf(page);
  check(dist([cam.target[0], cam.target[2]], m.pos) < 1.5, 'câmera acompanha o personagem selecionado');
  await page.getByTestId('follow-toggle').click();
  await page.close();
}

/** Câmera livre: aba retrátil, botões, mouse, roda, teclado, limites e redimensionamento. */
async function cameraChecks(browser, errors) {
  console.log('\n— Câmera —');
  const page = await openOffice(browser, errors);
  const c0 = await cameraOf(page);
  const panelHidden = () => page.locator('#camera-dock-panel').getAttribute('aria-hidden');
  check((await panelHidden()) === 'true', 'aba de câmera começa recolhida');
  await page.getByTestId('camera-dock-toggle').click();
  await sleep(600);
  check((await panelHidden()) === 'false', 'aba expande ao clicar');
  await page
    .waitForFunction(() => Number(getComputedStyle(document.querySelector('#camera-dock-panel')).opacity) > 0.95, null, { timeout: 5000 })
    .catch(() => {});
  const panelOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('#camera-dock-panel')).opacity);
  check(Number(panelOpacity) > 0.95, `controles aparecem (animação concluída, opacidade ${panelOpacity})`);
  await page.screenshot({ path: path.join(OUT, '21-aba-camera.png') });

  // Espera a câmera parar (o Chromium de teste renderiza por CPU, a poucos quadros/s).
  const settle = async () => {
    await sleep(1200);
    let last = await cameraOf(page);
    let still = 0;
    for (let i = 0; i < 25 && still < 2; i++) {
      await sleep(400);
      const c = await cameraOf(page);
      const moved = Math.abs(c.azimuth - last.azimuth) + Math.abs(c.polar - last.polar) + Math.abs(c.distance - last.distance) + dist([c.target[0], c.target[2]], [last.target[0], last.target[2]]);
      still = moved < 1e-3 ? still + 1 : 0;
      last = c;
    }
    return last;
  };
  const click = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).click();
    await sleep(200);
    return settle();
  };
  let c = await click('Girar à direita');
  check(Math.abs(c.azimuth - c0.azimuth) > 0.3, `botão girar altera o ângulo (${c0.azimuth.toFixed(2)} → ${c.azimuth.toFixed(2)})`);
  let prev = c;
  c = await click('Aproximar');
  check(c.distance < prev.distance - 1, `botão aproximar (${prev.distance.toFixed(1)} → ${c.distance.toFixed(1)})`);
  prev = c;
  c = await click('Afastar');
  check(c.distance > prev.distance + 1, 'botão afastar');
  prev = c;
  c = await click('Inclinar para cima (mais de cima)');
  check(c.polar < prev.polar - 0.05, 'botão inclinar');
  prev = c;
  c = await click('Mover para a direita');
  check(dist([c.target[0], c.target[2]], [prev.target[0], prev.target[2]]) > 1, 'botão mover desloca a câmera');

  // Pressionar e segurar = movimento contínuo
  const btn = page.getByRole('button', { name: 'Girar à esquerda', exact: true });
  const box = await btn.boundingBox();
  prev = await cameraOf(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await sleep(1500);
  await page.mouse.up();
  await sleep(400);
  c = await cameraOf(page);
  check(Math.abs(c.azimuth - prev.azimuth) > 0.6, `segurar o botão gira continuamente (${(c.azimuth - prev.azimuth).toFixed(2)} rad)`);

  c = await click('Redefinir câmera');
  await sleep(600);
  c = await cameraOf(page);
  const azErr = Math.abs(Math.atan2(Math.sin(c.azimuth - Math.PI / 4), Math.cos(c.azimuth - Math.PI / 4)));
  check(azErr < 0.05 && Math.abs(c.polar - Math.atan(Math.SQRT2)) < 0.03, `redefinir volta à vista isométrica inicial (az ${c.azimuth.toFixed(2)}, polar ${c.polar.toFixed(2)})`);

  // Mouse: arrastar = girar; botão direito = deslocar; roda = zoom
  const canvas = await page.locator('canvas').boundingBox();
  const cx = canvas.x + canvas.width * 0.6;
  const cy = canvas.y + canvas.height * 0.5;
  prev = await cameraOf(page);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(cx + i * 14, cy + i * 3);
  await page.mouse.up();
  await sleep(800);
  c = await cameraOf(page);
  check(Math.abs(c.azimuth - prev.azimuth) > 0.2, 'arrastar com o mouse gira a câmera (360°)');
  prev = c;
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 15; i++) await page.mouse.move(cx - i * 12, cy - i * 6);
  await page.mouse.up({ button: 'right' });
  await sleep(800);
  c = await cameraOf(page);
  check(dist([c.target[0], c.target[2]], [prev.target[0], prev.target[2]]) > 1, 'botão direito desloca lateralmente');
  prev = c;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -200);
    await sleep(60);
  }
  await sleep(800);
  c = await cameraOf(page);
  check(c.distance < prev.distance - 2, `roda do mouse aproxima (${prev.distance.toFixed(1)} → ${c.distance.toFixed(1)})`);

  // Teclado
  prev = c;
  await page.mouse.click(canvas.x + canvas.width * 0.75, canvas.y + 40); // foca a cena, fora dos painéis
  await page.keyboard.down('KeyW');
  await sleep(700);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyQ');
  await sleep(600);
  await page.keyboard.up('KeyQ');
  await sleep(500);
  c = await cameraOf(page);
  check(dist([c.target[0], c.target[2]], [prev.target[0], prev.target[2]]) > 1 && Math.abs(c.azimuth - prev.azimuth) > 0.3, `teclado (W/Q) move e gira a câmera (alvo ${dist([c.target[0], c.target[2]], [prev.target[0], prev.target[2]]).toFixed(2)} m, giro ${(c.azimuth - prev.azimuth).toFixed(2)})`);

  // Limites: inclinar ao máximo nunca atravessa o chão
  const tiltDown = page.getByRole('button', { name: 'Inclinar para baixo (mais lateral)', exact: true });
  const tb = await tiltDown.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await page.mouse.down();
  await sleep(3000);
  await page.mouse.up();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await sleep(900);
  c = await cameraOf(page);
  check(c.polar <= 1.37 && c.position[1] > 0.3, `limite de inclinação: câmera acima do chão (polar ${c.polar.toFixed(2)}, altura ${c.position[1].toFixed(1)} m)`);
  check(c.distance <= 95.1, 'limite de afastamento');
  await page.screenshot({ path: path.join(OUT, '22-angulo-baixo.png') });

  c = await click('Vista isométrica');
  await sleep(500);
  c = await cameraOf(page);
  check(Math.abs(c.polar - Math.atan(Math.SQRT2)) < 0.03, 'botão "Iso" retorna à inclinação isométrica');

  await page.getByTestId('camera-dock-toggle').click();
  await sleep(600);
  check((await panelHidden()) === 'true', 'aba recolhe ao clicar novamente');

  // Redimensionamento
  await page.setViewportSize({ width: 960, height: 640 });
  await sleep(1000);
  const size = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    return { w: cv.clientWidth, h: cv.clientHeight };
  });
  check(size.w === 960 && size.h === 640, `canvas acompanha o redimensionamento (${size.w}×${size.h})`);
  await page.screenshot({ path: path.join(OUT, '23-redimensionado.png') });
  await page.close();
}

/** Android (Pixel 7): toque para girar, pinça para zoom, aba retrátil. */
async function androidChecks(browser, errors) {
  console.log('\n— Android (toque) —');
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas');
  await page.waitForFunction(() => window.__agencyOS?.camera && window.__agencyOS.camera());
  await sleep(2500);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const vw = page.viewportSize();
  const midX = vw.width / 2;
  const midY = vw.height / 2;

  let prev = await cameraOf(page);
  await touch('touchStart', [[midX - 60, midY]]);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [[midX - 60 + i * 12, midY]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(900);
  let c = await cameraOf(page);
  check(Math.abs(c.azimuth - prev.azimuth) > 0.15, `toque com um dedo gira a câmera (${(c.azimuth - prev.azimuth).toFixed(2)} rad)`);

  prev = c;
  await touch('touchStart', [[midX - 30, midY], [midX + 30, midY]]);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', [[midX - 30 - i * 10, midY], [midX + 30 + i * 10, midY]]);
    await sleep(16);
  }
  await touch('touchEnd', []);
  await sleep(900);
  c = await cameraOf(page);
  check(c.distance < prev.distance - 1, `pinça com dois dedos aproxima (${prev.distance.toFixed(1)} → ${c.distance.toFixed(1)})`);

  await page.getByTestId('camera-dock-toggle').tap();
  await sleep(600);
  check((await page.locator('#camera-dock-panel').getAttribute('aria-hidden')) === 'false', 'aba de câmera abre com toque');
  prev = await cameraOf(page);
  await page.getByRole('button', { name: 'Afastar', exact: true }).tap();
  await sleep(900);
  c = await cameraOf(page);
  check(c.distance > prev.distance + 0.5, 'botão da aba funciona com toque');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'Android sem rolagem horizontal');
  await page.screenshot({ path: path.join(OUT, '24-android.png') });
  await ctx.close();
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
      process.kill(-server.pid, 'SIGTERM'); // grupo inteiro (inclui o processo next-server filho)
    } catch {
      server.kill('SIGTERM');
    }
    console.log(failures ? `\n${failures} verificação(ões) falharam` : '\nTodas as verificações passaram');
    process.exit(failures ? 1 : 0);
  });
