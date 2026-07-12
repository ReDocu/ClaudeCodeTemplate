#!/usr/bin/env node
// cockpit CLI — serve · boot (FS-3·13). 리라이트: 구 teamctl boot/locate 참고 재작성.
//   node cockpit/bin/cockpit.js serve [--port 7421]
//   node cockpit/bin/cockpit.js boot  [--port 7421]
// boot 시퀀스(FS-13): ① wmux 보장(탐색 체인) ② 서버 보장(멱등 재사용)
//                    ③ active 프로젝트 자동 재수렴(C3 — wmux 재시작 복원) ④ 기본 브라우저 오픈.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { readConfig, patchConfig, scanProjects } from '../src/registry.js';
import { isAvailable, invalidate } from '../src/wmux.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

// ── wmux 자동 발견 (구 locate.js 참고) — env WMUX_CLI 역산 → PATH → config → 글롭 ──
const EXE = 'wmux.exe';
const isRoot = (root) => existsSync(join(root, EXE));
function globRoots(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => /^wmux/i.test(n)).sort().reverse().map((n) => join(dir, n)).filter(isRoot);
}
function discoverWmuxBin(cfg) {
  const out = [];
  const push = (root) => { if (root && isRoot(root) && !out.includes(root)) out.push(root); };
  if (process.env.WMUX_CLI) push(dirname(dirname(dirname(resolve(process.env.WMUX_CLI))))); // <root>/resources/cli/wmux.js 역산
  try {
    const r = spawnSync('where.exe', [EXE], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0) for (const line of r.stdout.split('\n')) { const p = line.trim(); if (p) push(dirname(p)); }
  } catch { /* PATH에 없음 — 다음 후보 */ }
  if (cfg.wmuxBin) { const bin = resolve(cfg.wmuxBin); push(dirname(bin)); for (const r of globRoots(dirname(dirname(bin)))) push(r); }
  if (process.env.LOCALAPPDATA) for (const r of globRoots(join(process.env.LOCALAPPDATA, 'Programs'))) push(r);
  for (let c = 67; c <= 90; c++) { // C:~Z: Program Files 글롭
    const drive = `${String.fromCharCode(c)}:\\`;
    if (!existsSync(drive)) continue;
    for (const pf of ['Program Files', 'Program Files (x86)']) for (const r of globRoots(join(drive, pf))) push(r);
  }
  return out.length ? join(out[0], EXE) : null;
}

// wmux 보장 — 있으면 재사용, 없으면 발견→detached 스폰→ready 폴링. wmux 수명은 소유하지 않는다.
async function ensureWmux() {
  if (await isAvailable()) return { action: 'reused' };
  const cfg = readConfig();
  let bin = cfg.wmuxBin && existsSync(cfg.wmuxBin) ? cfg.wmuxBin : discoverWmuxBin(cfg);
  if (!bin) throw new Error('wmux를 찾을 수 없습니다 — cockpit/workspace/config.json에 "wmuxBin": "<wmux.exe 절대경로>"를 지정하세요. (탐색 순서: WMUX_CLI → PATH → config → Programs/Program Files 글롭)');
  if (bin !== cfg.wmuxBin) { patchConfig({ wmuxBin: bin }); console.log(`[boot]    wmux 자동 발견 · 저장: ${bin}`); }
  let spawnErr = null;
  const child = spawn(bin, [], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => { spawnErr = e; });
  child.unref();
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (spawnErr) throw new Error(`wmux 기동 실패: ${spawnErr.message} (wmuxBin: ${bin})`);
    if (await isAvailable()) { invalidate(); return { action: 'started', pid: child.pid }; }
  }
  throw new Error(`wmux를 기동했지만 15초 내 응답이 없습니다 (wmuxBin: ${bin}).`);
}

// 기존 서버 감지 — 재클릭 멱등성. 401도 alive(우리 계열 서버가 응답 중 — 새로 띄우면 EADDRINUSE만 남).
async function serverAlive(port, token) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Cockpit-Token': token || '' }, signal: ctl.signal });
    clearTimeout(t);
    return res.ok || res.status === 401;
  } catch { return false; }
}

async function boot() {
  console.log('[boot] ① wmux 확인/기동');
  const w = await ensureWmux();
  console.log(`[boot]    wmux ${w.action === 'reused' ? '이미 실행 중 — 재사용' : `기동 완료 (pid ${w.pid})`}`);

  const cfg = readConfig();
  const PORT = Number(flag('--port')) || cfg.port || 7421;
  const url = `http://127.0.0.1:${PORT}/`;

  console.log('[boot] ② 서버 확인');
  let served = false;
  if (await serverAlive(PORT, cfg.token)) {
    console.log(`[boot]    기존 서버 재사용 — ${url}`);
  } else {
    const { serve } = await import('../src/server.js');
    await serve({ port: PORT });
    served = true;
  }

  // ③ active 프로젝트 자동 재수렴(FS-13-1 ③, C3) — 멱등: 정상 상태에선 no-op(agent 수 불변).
  console.log('[boot] ③ active 프로젝트 재수렴 (멱등)');
  const { activate } = await import('../src/lifecycle.js');
  const actives = scanProjects().projects.filter((p) => p.status === 'active');
  for (const p of actives) {
    try {
      const r = await activate(p.name);
      console.log(`[boot]    ▸ ${p.name}: 스폰 ${r.spawned} · 재사용 ${r.reused}${r.failed?.length ? ` · 실패 ${r.failed.join('·')}` : ''}`);
    } catch (e) { console.warn(`[boot]    ▸ ${p.name}: 재수렴 실패 — ${e.message}`); }
  }
  if (!actives.length) console.log('[boot]    active 프로젝트 없음 — 건너뜀');

  console.log('[boot] ④ 대시보드 오픈 (기본 브라우저)');
  try { spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { console.warn(`[boot]    오픈 실패(${e.message}) — 수동으로 여세요: ${url}`); }

  console.log(served
    ? '[boot] 완료 — 이 창이 서버 콘솔입니다(127.0.0.1 전용 — 방화벽 허용 불필요). 다시 클릭하면 같은 상태로 복귀합니다.'
    : '[boot] 완료 — 기존 서버를 재사용했으므로 이 창은 닫아도 됩니다.');
}

if (cmd === 'serve') {
  const { serve } = await import('../src/server.js');
  await serve({ port: Number(flag('--port')) || undefined });
} else if (cmd === 'boot') {
  await boot().catch((e) => { console.error(`[boot] 실패 — ${e.message}`); process.exitCode = 1; });
} else {
  console.log('사용법: cockpit.js serve [--port 7421] | boot [--port 7421]');
  process.exitCode = cmd ? 1 : 0;
}
