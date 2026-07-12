// 콜드 부트(F12) — wmux 보장(발견→기동→ready 대기) → 서버 보장 → reconcile → 대시보드 오픈.
// 원칙: wmux는 띄우기만 하고 죽이지 않는다(수명 소유 안 함, detached). 모든 단계 멱등 — 재클릭 안전.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAvailable, invalidateWmux, openBrowser } from './wmux.js';
import { discoverRoots, promptForRoot, binFromRoot } from './locate.js';

// serve.js와 같은 파일 — 서버가 token/port를 여기 저장하므로 boot도 같은 곳을 읽는다.
const CONFIG = fileURLToPath(new URL('../../workspace/config.json', import.meta.url));
const readConfig = () => { try { return JSON.parse(readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const writeConfig = (patch) => {
  const cfg = { ...readConfig(), ...patch };
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  return cfg;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// F12b: wmux 위치 확보 — config가 유효하면 그대로, 아니면 자동 발견(§13-G① — WMUX_CLI 역산 →
// wmuxBin 형제 폴더 → LOCALAPPDATA·Program Files 글롭) → TTY에서만 최후 수단 프롬프트.
// force(boot --setup): 자동 발견/기존 설정을 건너뛰고 항상 프롬프트 — 후보는 번호 선택지로 제시.
// 채택 시 config.wmuxBin 저장(재질문 없음) + wmux.js CLI 즉시 전환.
async function ensureLocated(cfg, { force = false } = {}) {
  if (!force && cfg.wmuxBin && existsSync(cfg.wmuxBin)) return cfg;
  const roots = discoverRoots(cfg);
  let root = roots[0];
  const tty = process.stdin.isTTY && process.stdout.isTTY;
  if (force && tty) {
    console.log('[boot]    wmux 경로 설정(--setup) — 자동 발견 후보를 번호로 고르거나 직접 입력하세요.');
    root = await promptForRoot({ candidates: roots, current: cfg.wmuxBin });
    if (!root && cfg.wmuxBin && existsSync(cfg.wmuxBin)) {
      console.log(`[boot]    건너뜀 — 기존 설정 유지: ${cfg.wmuxBin}`);
      return cfg;
    }
  } else if (root) {
    console.log(`[boot]    wmux 자동 발견: ${root}${roots.length > 1 ? ` (후보 ${roots.length}개 중 최우선)` : ''}`);
  } else if (tty) {
    console.log('[boot]    wmux를 자동으로 찾지 못했습니다 — 설치 위치를 알려주세요 (최초 1회, config에 저장됩니다).');
    root = await promptForRoot();
  }
  if (!root) throw new Error(
    'wmux를 찾을 수 없습니다. wmux 설치 후 다시 실행하거나, teamctl/workspace/config.json에 '
    + '"wmuxBin": "<wmux.exe 절대경로>" (선택: "wmuxArgs": [...]) 를 지정하세요. '
    + '(자동 탐색 순서: WMUX_CLI env → PATH → config wmuxBin → %LOCALAPPDATA%\\Programs·각 드라이브 Program Files의 wmux*)');
  const next = writeConfig({ wmuxBin: binFromRoot(root) });
  console.log(`[boot]    wmuxBin 저장: ${next.wmuxBin} (teamctl/workspace/config.json)`);
  return next;
}

// wmux 보장 — 없으면 config의 wmuxBin을 detached 스폰 후 ready까지 폴링(앱 기동에 수 초).
// 진단은 파이프 직결 ping 두 상태: ready(pong) · 그 외(파이프 없음/무응답 = 앱 미실행).
// forceLocate(boot --setup): ping 상태와 무관하게 경로 설정 프롬프트부터 — 저장 후 정상 흐름 계속.
export async function ensureWmux({ timeoutMs = 15000, intervalMs = 500, forceLocate = false } = {}) {
  if (forceLocate) await ensureLocated(readConfig(), { force: true });
  if (await isAvailable()) return { action: 'reused' };

  // 앱 미실행 — 스폰할 wmuxBin 위치부터 확보(직결에선 CLI 유무가 요청 경로와 무관).
  const cfg = await ensureLocated(readConfig());

  let spawnErr = null;
  const child = spawn(cfg.wmuxBin, cfg.wmuxArgs || [], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => { spawnErr = e; });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    if (spawnErr) throw new Error(`wmux 기동 실패: ${spawnErr.message} (wmuxBin: ${cfg.wmuxBin})`);
    if (await isAvailable()) { invalidateWmux(); return { action: 'started', pid: child.pid }; }
  }
  throw new Error(`wmux를 기동했지만 ${Math.round(timeoutMs / 1000)}초 내 응답이 없습니다 (wmuxBin: ${cfg.wmuxBin}).`);
}

// 기존 서버 감지 — 재클릭 멱등성의 핵심. 401도 alive로 본다(우리 계열 서버가 응답 중이면
// GET /가 자기 토큰을 HTML에 주입하므로 대시보드는 정상 동작 — 새로 띄우면 EADDRINUSE만 남).
async function serverAlive(port, token) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, {
      headers: { 'X-Cockpit-Token': token || '' }, signal: ctl.signal,
    });
    clearTimeout(t);
    return res.ok || res.status === 401;
  } catch { return false; }
}

// claude 미설치는 부트를 막지 않는다(역할 스폰 시점의 문제) — 경고만.
function warnIfNoClaude() {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, ['claude'], { stdio: 'ignore' });
  if (r.status !== 0) console.warn('[boot] 경고: PATH에서 claude CLI를 찾지 못했습니다 — 역할 스폰(기본 cmd "claude")이 실패할 수 있습니다.');
}

// 콜드 부트 전체 — F12 사용자 시나리오 2번. 서버가 없으면 이 프로세스가 서버가 된다(창=서버 콘솔).
// panel: true면 구 동작(wmux 브라우저 패널). 기본은 시스템 기본 브라우저(크롬 등) — 사용자 요구.
// clean: 선언 밖 정리(cleanup.js) — 플래그 또는 config.cleanOnBoot로 옵트인. 기본 off:
//        "boot는 죽이지 않는다" 원칙의 예외이므로 사용자가 명시했을 때만.
export async function boot({ port, setup = false, panel = false, clean = false } = {}) {
  console.log('[boot] ① wmux 확인/기동');
  const w = await ensureWmux({ forceLocate: setup });
  console.log(`[boot]    wmux ${w.action === 'reused' ? '이미 실행 중 — 재사용' : `기동 완료 (pid ${w.pid})`}`);
  warnIfNoClaude();

  const cfg = readConfig();

  if (clean || cfg.cleanOnBoot === true) {
    console.log(`[boot] ①+ 선언 밖 정리 (${clean ? '--clean' : 'config.cleanOnBoot'}) — root/ 선언에 없는 워크스페이스·세션 종료`);
    try {
      const { cleanup } = await import('./cleanup.js');
      const c = await cleanup({});
      for (const x of c.closed) console.log(`[boot]      ✕ ${x.title || x.id}  [${x.action}]  세션 ${x.agents.length}개`);
      console.log(`[boot]    닫음 ${c.closed.length}개 · 유지 ${c.kept.length}개${c.errors.length ? ` · 오류 ${c.errors.length}건` : ''}`);
    } catch (e) { console.warn(`[boot]    정리 실패(${e.message}) — 부트는 계속 진행`); }
  }
  const PORT = port || cfg.port || 7420;
  const url = `http://127.0.0.1:${PORT}/`;

  console.log('[boot] ② 서버 확인');
  let served = false;
  if (await serverAlive(PORT, cfg.token)) {
    console.log(`[boot]    기존 서버 재사용 — ${url}`);
  } else {
    const { serve } = await import('../server/serve.js'); // 지연 import — serve.js가 boot.js를 정적 import(순환 방지)
    await serve({ port: PORT });
    served = true;
  }

  console.log('[boot] ③ 폴더 선언 수렴 (reconcile — 멱등)');
  const { reconcile } = await import('./reconcile.js');
  const r = await reconcile({});
  for (const t of r.teams) {
    console.log(`[boot]    ▸ ${t.name}  [ws ${t.ws.action}${t.ws.id ? ' ' + t.ws.id : ''}]`);
    for (const role of t.roles) console.log(`[boot]        ${role.id}: ${role.action}${role.agentId ? ' ' + role.agentId : ''}`);
  }
  console.log(`[boot]    변경 ${r.changed}건${r.changed === 0 ? ' — 이미 동기화됨 (멱등 ✓)' : ''}`);

  // 토큰은 서버가 GET /에서 HTML <head>에 주입 — URL에 실을 필요 없음.
  // 기본: 시스템 기본 브라우저(explorer.exe가 http URL을 기본 브라우저로 위임 — /open과 동일 기전).
  // --panel: 구 동작(wmux 브라우저 패널). 비 Windows는 패널로 폴백.
  const useExplorer = !panel && process.platform === 'win32';
  console.log(`[boot] ④ 대시보드 오픈 (${useExplorer ? '기본 브라우저' : 'wmux 브라우저 패널'})`);
  try {
    if (useExplorer) spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
    else await openBrowser(url);
  } catch (e) { console.warn(`[boot]    대시보드 오픈 실패(${e.message}) — 수동으로 여세요: ${url}`); }

  console.log(served
    ? '[boot] 완료 — 이 창이 서버 콘솔입니다. 창을 닫아도 wmux 세션은 유지되고, 다시 클릭하면 같은 상태로 복귀합니다.'
    : '[boot] 완료 — 기존 서버를 재사용했으므로 이 창은 닫아도 됩니다.');
  return { url, served, reconcile: r };
}
