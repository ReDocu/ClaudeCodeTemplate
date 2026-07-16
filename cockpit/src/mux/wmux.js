// wmux 드라이버 (win32) — 파이프 단일 창구(FS-1). 구 teamctl/src/core/wmux.js 참고 재작성.
// 프로토콜(실측 계승): V2 {method,params,id,token}\n → {result|error}\n · V1 'ping\n'→'pong\n'.
// 서버는 응답 후 연결을 닫지 않는다 → 첫 개행 수신 즉시 정리(end 대기 금지). 요청당 1연결(~1ms).
//
// 역할 분담(계약 전문은 mux.js 헤더): 상태 캐시·정규화·dead 필터·셸 결정은 파사드(mux.js)가 갖고,
// 이 파일은 wmux 고유 규약만 안다 — 파이프·권한 토큰·파라미터 명 두 갈래·앱 발견/기동.
import net from 'node:net';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { readConfig, patchConfig } from '../registry.js';
import { logConsole } from '../log.js';

export const NAME = 'wmux';
// cockpit이 앱을 독점 소유한다(mux.js 계약) — wmux는 cockpit 전용 전제라 boot이 자동 복원분을
// 걷어내도(cleanSlate) 전체 종료가 앱을 내려도(killApp) 남의 작업을 파괴하지 않는다.
export const OWNS_APP = true;

const PIPE = process.env.WMUX_PIPE || '\\\\.\\pipe\\wmux';
const TIMEOUT = 10_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// V2 권한 토큰 — wmux가 스폰한 셸엔 env, 밖(런처)에선 APPDATA 토큰 파일. 1회 캐시.
let _token = null;
function token() {
  if (_token !== null) return _token;
  const env = process.env.WMUX_PIPE_TOKEN?.trim();
  if (env) return (_token = env);
  try {
    const suffix = process.env.WMUX_INSTANCE?.trim() ? `-${process.env.WMUX_INSTANCE.trim()}` : '';
    const base = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming');
    return (_token = readFileSync(join(base, `wmux${suffix}`, 'pipe-token'), 'utf8').trim());
  } catch { return ''; } // 실패는 캐시하지 않음 — 갓 기동한 wmux가 토큰 파일을 아직 안 썼을 수 있어 다음 요청에서 재시도
}

// 한 연결 = 한 요청 — 첫 개행(또는 서버 종료)까지 읽고 즉시 소켓·타이머 정리.
function exchange(line, timeoutMs = TIMEOUT) {
  return new Promise((resolveP, rejectP) => {
    let data = '', done = false, timer;
    const client = net.connect({ path: PIPE }, () => client.write(line + '\n'));
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); client.destroy(); fn(v); };
    timer = setTimeout(() => finish(rejectP, new Error(`wmux 응답 없음 (${timeoutMs / 1000}s)`)), timeoutMs);
    client.on('data', (chunk) => {
      data += chunk;
      const nl = data.indexOf('\n');
      if (nl !== -1) finish(resolveP, data.slice(0, nl).trim());
    });
    client.on('end', () => finish(resolveP, data.trim()));
    client.on('error', (err) => finish(rejectP, err));
  });
}

// ── 서버 콘솔 디버그 로깅 — wmux로 나가는 명령·설명·결과/실패를 서버 콘솔에 출력 ──
// 사용자 요청대로 logConsole 경유로 '[오류]내용 : …' 통일 형식(wmux 상세는 내용에 그대로 보존).
// 고빈도 폴링 read(workspace.list·agent.list)는 소음이라 성공 로그 제외(실패는 오프라인 진단상 항상 출력).
// COCKPIT_WMUX_LOG=0 으로 끄기. 콘솔이 보이는 곳에서 실행해야 보임(`node cockpit/bin/cockpit.js serve`).
const QUIET = new Set(['workspace.list', 'agent.list']);
const LOG_WMUX = process.env.COCKPIT_WMUX_LOG !== '0';
const CMD_DESC = {
  'workspace.create': (p) => `워크스페이스 생성 — title=${p.title || '?'} · cwd=${p.cwd || '?'}`,
  'workspace.close': (p) => `워크스페이스 닫기 — ${p.id || p.workspaceId || '?'}`,
  'workspace.select': (p) => `워크스페이스 포커스 이동 — ${p.id || '?'}`,
  'agent.spawn': (p) => `세션(pane) 스폰 — label=${p.label || '?'} · cmd=${p.cmd || '?'} · cwd=${p.cwd || '?'} · ws=${p.workspaceId || '?'}`,
  'agent.kill': (p) => `세션 종료(kill) — ${p.agentId || '?'}`,
  'pane.focus': (p) => `pane 포커스 — ${p.id || '?'}`,
  'surface.send_text': (p) => `텍스트 전송 — surface=${p.surfaceId || '?'} · text=${JSON.stringify(p.text ?? '')}`,
  'surface.send_key': (p) => `키 전송 — surface=${p.surfaceId || '?'} · key=${p.key || '?'}`,
};
const _hms = () => { try { return new Date().toLocaleTimeString(); } catch { return ''; } };
const _resId = (r) => r && (r.workspace?.id || r.workspaceId || r.agent?.agentId || r.agentId || r.id) || null;

let _seq = 0;
export async function request(method, params = {}, timeoutMs = TIMEOUT) {
  const loud = LOG_WMUX && !QUIET.has(method);
  if (loud) logConsole(`${_hms()} [wmux→] ${method}  ${CMD_DESC[method] ? CMD_DESC[method](params) : JSON.stringify(params)}`);
  let raw;
  try { raw = await exchange(JSON.stringify({ method, params, id: ++_seq, token: token() }), timeoutMs); }
  catch (e) { if (LOG_WMUX) logConsole(`${_hms()} [wmux✗] ${method} 전송 실패 — ${e.message}`); throw e; }
  let res;
  try { res = JSON.parse(raw); } catch { return { raw }; }
  if (res.error) {
    if (LOG_WMUX) logConsole(`${_hms()} [wmux✗] ${method} — ${res.error.message || JSON.stringify(res.error)}`);
    throw new Error(res.error.message || String(res.error));
  }
  if (loud) { const id = _resId(res.result); logConsole(`${_hms()} [wmux✓] ${method}${id ? ` → ${id}` : ' ok'}`); }
  return res.result;
}

// V1 ping — 토큰 불필요. 파이프 없음(ENOENT) = 앱 미실행.
export const ping = () => exchange('ping', 5000);
export async function isAvailable() {
  try { return /pong/i.test(await ping()); } catch { return false; }
}

// ── 상태 실측 — mux.js _refetch가 정규화·dead 필터를 걸어 소비한다 ──
// agent 실측 필드(계승 규칙 ②): agentId·label·cmd·status·paneId·surfaceId·pid·workspaceId.
export async function fetchState() {
  const [ws, ag] = await Promise.all([
    request('workspace.list'),
    request('agent.list').catch(() => ({ agents: [] })),
  ]);
  return { workspaces: ws.workspaces || [], agents: ag.agents || [] };
}

// ── 제어 ──
export const selectWorkspace = (id) => request('workspace.select', { id });
export const focusPane = (id) => request('pane.focus', { id });
export const killAgent = (id) => request('agent.kill', { agentId: id });
// 점프 보조 — win32는 wmux가 select로 스스로 앞에 옴(no-op). darwin(cmux)만 실제 활성화가 필요.
export const activateApp = () => Promise.resolve();

export function createWorkspace({ title, cwd } = {}) {
  const params = {};
  if (title) params.title = title;
  if (cwd) params.cwd = cwd;
  return request('workspace.create', params);
}
// 파라미터 명 두 갈래 실측(id/workspaceId) — id 우선, 실패 시 재시도(계승).
export async function closeWorkspace(id) {
  try { return await request('workspace.close', { id }); }
  catch { return request('workspace.close', { workspaceId: id }); }
}

// 스폰 — cwd 항상 명시(계승 규칙 ③ — cwd 드리프트 원천 차단, 검사는 파사드).
// env(신뢰성 개편 ⑥): 세션 신원(COCKPIT_PROJECT/ROLE)을 pane 환경에 주입 — wmux 미지원 시
// 호출자(lifecycle)가 env 없이 재시도한다. 지원 여부와 무관하게 스폰 자체는 동일.
export function spawnAgent({ workspaceId, label, cwd, cmd, env } = {}) {
  const params = { cmd, label: label || cmd.split(/\s+/)[0], cwd };
  if (workspaceId) params.workspaceId = workspaceId;
  if (env) params.env = env;
  return request('agent.spawn', params);
}

// 텍스트+Enter를 특정 세션 pane에 — surfaceId 명시 필수(계승 규칙 ② — 오발송 방지, 검사는 파사드).
export async function sendLine(text, surfaceId) {
  await request('surface.send_text', { surfaceId, text });
  try { await request('surface.send_key', { surfaceId, key: 'Enter' }); }
  catch { await request('surface.send_text', { surfaceId, text: '\r' }); }
}

// 내장 브라우저 패널(오른쪽)로 URL 이동 — 파사드의 선택 계약 openWeb 구현.
// 실측(2026-07-16): `browser.navigate {url}` → `{ok:true}`. browser.* 중 파이프가 아는 건 navigate 하나뿐
// (open·goto·toggle·list·new·create·show는 전부 `Unknown: browser.*`). 패널이 닫혀 있어도 wmux가 열고 이동한다.
// url 형식 검사는 파사드 — 여기선 그대로 넘긴다.
export const openWeb = (url) => request('browser.navigate', { url });

// wmux 앱 종료 — 전체 종료(⏻)가 서버와 함께 wmux도 내릴 때 사용(OWNS_APP). 파이프에 quit 메서드가
// 없어 프로세스 종료로 내린다(이미지 이름은 config.wmuxBin 기준 · Electron 자식들도 같은 이름이라 함께 종료).
// 실패해도 던지지 않는다 — 전체 종료 흐름을 막지 않는 게 우선(호출자는 로그만 남긴다).
export function killApp() {
  const cfg = readConfig();
  const image = cfg.wmuxBin ? basename(cfg.wmuxBin) : 'wmux.exe';
  return new Promise((resolveP) => {
    const args = process.platform === 'win32' ? ['/F', '/IM', image] : ['-f', image];
    execFile(process.platform === 'win32' ? 'taskkill' : 'pkill', args,
      { windowsHide: true, timeout: 10_000 },
      (e, _stdout, stderr) => resolveP(e ? { ok: false, error: (stderr || e.message).trim() } : { ok: true, app: image }));
  });
}

// ── 앱 발견 (구 bin/cockpit.js locate) — env WMUX_CLI 역산 → PATH → config → 글롭 ──
const EXE = 'wmux.exe';
const isRoot = (root) => existsSync(join(root, EXE));
const binFromRoot = (root) => join(root, EXE);
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
function discoverBin(cfg) { const roots = discoverRoots(cfg); return roots.length ? binFromRoot(roots[0]) : null; }

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

// wmux 보장(boot ①) — 있으면 재사용, 없으면 발견/프롬프트→detached 스폰→ready 폴링.
// wmux 수명은 소유하지 않는다(FS-13 — 평시엔 끄지 않고, 끄는 건 전체 종료뿐).
// setup(--setup): ping 상태와 무관하게 경로 설정 프롬프트부터(후보 번호 제시) — 저장 후 정상 흐름 계속.
export async function ensureApp({ setup = false } = {}) {
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
  let bin = cfg.wmuxBin && existsSync(cfg.wmuxBin) ? cfg.wmuxBin : discoverBin(cfg);
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
    if (await isAvailable()) return { action: 'started', pid: child.pid };
  }
  throw new Error(`wmux를 기동했지만 15초 내 응답이 없습니다 (wmuxBin: ${bin}).`);
}
