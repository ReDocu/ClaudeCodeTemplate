#!/usr/bin/env node
// cockpit CLI — serve · boot (FS-3·13). 리라이트: 구 teamctl boot/locate 참고 재작성.
//   node cockpit/bin/cockpit.js serve [--port 7420]
//   node cockpit/bin/cockpit.js boot  [--port 7420]
// boot 시퀀스(FS-13): ① wmux 보장(탐색 체인) — 갓 기동했으면 ①-b 클린 슬레이트(복원분 정리)
//                    ② 서버 보장(멱등 재사용) ③ active 프로젝트 자동 재수렴(C3 — wmux 재시작 복원)
//                    ④ 기본 브라우저 오픈.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { readConfig, patchConfig, scanProjects } from '../src/registry.js';
import { isAvailable, invalidate } from '../src/wmux.js';
import { cmuxApp } from '../src/cmux.js';

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
function discoverRoots(cfg) {
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
  return out;
}
const binFromRoot = (root) => join(root, EXE);
function discoverWmuxBin(cfg) { const roots = discoverRoots(cfg); return roots.length ? binFromRoot(roots[0]) : null; }

// 콘솔 프롬프트(구 teamctl locate.js 이식) — 자동 발견 0건(최후 수단) 또는 --setup(강제) + TTY일 때만.
// 후보는 번호로 선택, 직접 경로 입력도 허용. 따옴표 제거, 폴더 입력 시 wmux.exe 자동 결합,
// s=건너뛰기, 3회 재시도. 실패/건너뛰기 = null.
async function promptForRoot({ candidates = [], current } = {}) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (current) console.log(`  현재 설정: ${current}`);
    candidates.forEach((r, i) => console.log(`  [${i + 1}] ${binFromRoot(r)}`));
    const hint = candidates.length ? `번호(1-${candidates.length}), ` : '';
    for (let i = 3; i > 0; i--) {
      const raw = (await rl.question(`wmux 위치 — ${hint}설치 폴더 또는 ${EXE} 경로 (s=건너뛰기): `))
        .trim().replace(/^["']|["']$/g, '');
      if (raw.toLowerCase() === 's') return null;
      if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= candidates.length)
        return candidates[Number(raw) - 1];
      if (raw) {
        const p = resolve(raw);
        const root = p.toLowerCase().endsWith(EXE) ? dirname(p) : p;
        if (isRoot(root)) return root;
        console.error(`  ✗ ${binFromRoot(root)} 가 없습니다 (남은 시도 ${i - 1}회)`);
      }
    }
    return null;
  } finally { rl.close(); }
}

// wmux 보장 — 있으면 재사용, 없으면 발견/프롬프트→detached 스폰→ready 폴링. wmux 수명은 소유하지 않는다.
// setup(--setup): ping 상태와 무관하게 경로 설정 프롬프트부터(후보 번호 제시) — 저장 후 정상 흐름 계속.
async function ensureWmux({ setup = false } = {}) {
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (setup && tty) {
    const cfg = readConfig();
    console.log('[boot]    wmux 경로 설정(--setup) — 후보를 번호로 고르거나 직접 입력하세요.');
    const root = await promptForRoot({ candidates: discoverRoots(cfg), current: cfg.wmuxBin });
    if (root) { patchConfig({ wmuxBin: binFromRoot(root) }); console.log(`[boot]    wmuxBin 저장: ${binFromRoot(root)}`); }
    else if (cfg.wmuxBin && existsSync(cfg.wmuxBin)) console.log(`[boot]    건너뜀 — 기존 설정 유지: ${cfg.wmuxBin}`);
  }
  if (await isAvailable()) return { action: 'reused' };
  const cfg = readConfig();
  let bin = cfg.wmuxBin && existsSync(cfg.wmuxBin) ? cfg.wmuxBin : discoverWmuxBin(cfg);
  if (!bin && tty && !setup) { // --setup은 이미 위에서 프롬프트함 — 재질문 방지
    console.log('[boot]    wmux를 자동으로 찾지 못했습니다 — 설치 위치를 알려주세요 (최초 1회, config에 저장됩니다).');
    const root = await promptForRoot({ candidates: discoverRoots(cfg), current: cfg.wmuxBin });
    if (root) bin = binFromRoot(root);
  }
  if (!bin) throw new Error('wmux를 찾을 수 없습니다 — 콘솔(TTY)에서 boot를 실행해 경로를 입력하거나, cockpit/workspace/config.json에 "wmuxBin": "<wmux.exe 절대경로>"를 지정하세요. (탐색 순서: WMUX_CLI → PATH → config → Programs/Program Files 글롭)');
  if (bin !== cfg.wmuxBin) { patchConfig({ wmuxBin: bin }); console.log(`[boot]    wmuxBin 저장: ${bin}`); }
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

// cmux 보장(darwin) — 있으면 재사용, 없으면 앱 번들 open 후 ready 폴링. cmux 수명은 소유하지 않는다.
// 발견은 드라이버(cmux.js cmuxBin: config → PATH → /Applications 글롭)가 담당 — 번들만 역산.
async function ensureCmux() {
  if (await isAvailable()) return { action: 'reused' };
  const app = cmuxApp();
  if (!app) throw new Error('cmux를 찾을 수 없습니다 — /Applications에 cmux를 설치하거나 cockpit/workspace/config.json에 "cmuxBin": "<cmux CLI 절대경로>"를 지정하세요.');
  spawn('open', [app], { detached: true, stdio: 'ignore' }).unref();
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (await isAvailable()) { invalidate(); return { action: 'started' }; }
  }
  throw new Error(`cmux를 기동했지만 20초 내 응답이 없습니다 (${app}).`);
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
  const setup = args.includes('--setup');
  const IS_MAC = process.platform === 'darwin';
  const MUX = IS_MAC ? 'cmux' : 'wmux';
  console.log(`[boot] ① ${MUX} 확인/기동`);
  const w = IS_MAC ? await ensureCmux() : await ensureWmux({ setup });
  console.log(`[boot]    ${MUX} ${w.action === 'reused' ? '이미 실행 중 — 재사용' : `기동 완료${w.pid ? ` (pid ${w.pid})` : ''}`}`);

  // ①-b 클린 슬레이트 — boot이 wmux를 **직접 기동한 경우에만**. wmux가 자동 복원한 이전
  // 세션·워크스페이스(같은 제목 중복 → 순서 따라 오바인딩)를 전부 걷어내고 대시보드 선언 기준으로
  // 재구성한다. 이미 실행 중이던 wmux(reused)는 살아있는 작업일 수 있어 절대 건드리지 않는다.
  // darwin 제외 — cmux는 사용자의 일상 터미널 앱이라 복원분 일괄 정리가 비-cockpit 작업을 파괴한다
  // (wmux는 cockpit 전용 전제). 중복 제목 위험은 reconcile·title 매칭이 흡수.
  if (w.action === 'started' && !IS_MAC) {
    console.log('[boot] ①-b wmux 초기화 — 자동 복원된 이전 세션·워크스페이스 정리');
    try {
      const { cleanSlate } = await import('../src/lifecycle.js');
      const r = await cleanSlate();
      console.log(`[boot]    복원 세션 ${r.killed}개 종료 · 워크스페이스 ${r.closed}개 닫음 — 대시보드 상태로 재구성`);
    } catch (e) { console.warn(`[boot]    초기화 실패 — ${e.message} (그대로 진행)`); }
  }

  const cfg = readConfig();
  const PORT = Number(flag('--port')) || cfg.port || 7420;
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
  try { spawn(IS_MAC ? 'open' : 'explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref(); }
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
  console.log('사용법: cockpit.js serve [--port 7420] | boot [--port 7420] [--setup]');
  process.exitCode = cmd ? 1 : 0;
}
