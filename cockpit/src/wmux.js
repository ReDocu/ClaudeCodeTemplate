// wmux 파이프 단일 창구 (FS-1) — 구 teamctl/src/core/wmux.js 참고 재작성.
// 프로토콜(실측 계승): V2 {method,params,id,token}\n → {result|error}\n · V1 'ping\n'→'pong\n'.
// 서버는 응답 후 연결을 닫지 않는다 → 첫 개행 수신 즉시 정리(end 대기 금지). 요청당 1연결(~1ms).
//
// 캐시 계약(계승 규칙 ①): 폴링·읽기 = getState(stale 허용, 논블로킹) · 변이 결정 = getFresh(실왕복
// 보장) · 변이 후 invalidate(). stale 캐시로 스폰을 결정하면 방금 열린 세션을 못 보고 중복 생성한다.
// dead 필터(계승 규칙 ②): agent kill은 리스트에서 안 지워진다 — 어댑터가 걸러 상위는 산 것만 본다.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig, patchConfig } from './registry.js';

const PIPE = process.env.WMUX_PIPE || '\\\\.\\pipe\\wmux';
const TIMEOUT = 10_000;

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
  } catch { return (_token = ''); }
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

// ── 서버 콘솔 디버그 로깅 — wmux로 나가는 명령·설명·결과/실패를 stdout/stderr에 출력 ──
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
  if (loud) console.log(`${_hms()} [wmux→] ${method}  ${CMD_DESC[method] ? CMD_DESC[method](params) : JSON.stringify(params)}`);
  let raw;
  try { raw = await exchange(JSON.stringify({ method, params, id: ++_seq, token: token() }), timeoutMs); }
  catch (e) { if (LOG_WMUX) console.error(`${_hms()} [wmux✗] ${method} 전송 실패 — ${e.message}`); throw e; }
  let res;
  try { res = JSON.parse(raw); } catch { return { raw }; }
  if (res.error) {
    if (LOG_WMUX) console.error(`${_hms()} [wmux✗] ${method} — ${res.error.message || JSON.stringify(res.error)}`);
    throw new Error(res.error.message || String(res.error));
  }
  if (loud) { const id = _resId(res.result); console.log(`${_hms()} [wmux✓] ${method}${id ? ` → ${id}` : ' ok'}`); }
  return res.result;
}

// V1 ping — 토큰 불필요. 파이프 없음(ENOENT) = 앱 미실행.
export const ping = () => exchange('ping', 5000);
export async function isAvailable() {
  try { return /pong/i.test(await ping()); } catch { return false; }
}

// ── 상태 캐시 (getState/getFresh/invalidate) ──
// agent 실측 필드(계승 규칙 ②): agentId·label·cmd·status·paneId·surfaceId·pid·workspaceId.
const isDead = (a) => /exit|dead|kill|stop|terminat/i.test(String(a.status || ''));
const normAgent = (a) => ({
  agentId: a.agentId || a.id || null,
  label: a.label || '',
  cmd: a.cmd || '',
  status: a.status || '',
  paneId: a.paneId || null,
  surfaceId: a.surfaceId || null,
  pid: a.pid ?? null,
  workspaceId: a.workspaceId || a.workspace || null,
});
const normWs = (w) => ({ id: w.id || w.workspaceId || null, title: w.title || w.name || '' });

const TTL = 1500;
let _cache = null, _at = 0, _inflight = null;

function _refetch() {
  if (_inflight) return _inflight; // single-flight
  _inflight = (async () => {
    try {
      const [ws, ag] = await Promise.all([
        request('workspace.list'),
        request('agent.list').catch(() => ({ agents: [] })),
      ]);
      _cache = {
        workspaces: (ws.workspaces || []).map(normWs),
        agents: (ag.agents || []).filter((a) => !isDead(a)).map(normAgent),
        live: true,
      };
    } catch {
      _cache = { workspaces: [], agents: [], live: false }; // 오프라인
    }
    _at = Date.now();
    return _cache;
  })().finally(() => { _inflight = null; });
  return _inflight;
}

// 폴링용 — stale이어도 즉시 반환(백그라운드 갱신), 콜드일 때만 첫 왕복 대기.
export async function getState() {
  if (_cache) {
    if (Date.now() - _at >= TTL && !_inflight) _refetch().catch(() => {});
    return _cache;
  }
  return _refetch();
}
// 변이 결정용 — 신선하지 않으면 실왕복 대기(§9-①).
export async function getFresh() {
  if (_cache && Date.now() - _at < TTL) return _cache;
  return _refetch();
}
export function invalidate() { _at = 0; _refetch().catch(() => {}); }

// ── 제어 ──
export const selectWorkspace = (id) => request('workspace.select', { id });
export const focusPane = (id) => request('pane.focus', { id });
export const killAgent = (id) => request('agent.kill', { agentId: id });

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

// 스폰 — cwd 항상 명시(계승 규칙 ③ — cwd 드리프트 원천 차단).
export function spawnAgent({ workspaceId, label, cwd, cmd } = {}) {
  if (!cmd) throw new Error('cmd 필요');
  if (!cwd) throw new Error('cwd 필요(드리프트 방지 — 항상 명시)');
  const params = { cmd, label: label || cmd.split(/\s+/)[0], cwd };
  if (workspaceId) params.workspaceId = workspaceId;
  return request('agent.spawn', params);
}

// 텍스트+Enter를 특정 세션 pane에 — surfaceId 명시 필수(계승 규칙 ② — 오발송 방지).
export async function sendLine(text, surfaceId) {
  if (!surfaceId) throw new Error('sendLine: 대상 surfaceId 필요(오발송 방지)');
  await request('surface.send_text', { surfaceId, text });
  try { await request('surface.send_key', { surfaceId, key: 'Enter' }); }
  catch { await request('surface.send_text', { surfaceId, text: '\r' }); }
}

// ── 셸 결정 (FS-1-3) — config.shell → TEAMCTL_SHELL → 자동 탐지(1회, config 되씀) → 폴백 ──
const SHELL_CHAIN = process.platform === 'win32' ? ['pwsh', 'powershell', 'cmd'] : ['pwsh', 'bash', 'sh'];
const WHICH = process.platform === 'win32' ? 'where.exe' : 'which';
function shellExists(name) {
  try { return spawnSync(WHICH, [name], { stdio: 'ignore', timeout: 3000 }).status === 0; }
  catch { return false; }
}
let _shell = null;
export function resolveShell() {
  if (_shell) return _shell;
  const cfg = readConfig();
  if (cfg.shell) return (_shell = String(cfg.shell));
  const env = process.env.TEAMCTL_SHELL?.trim();
  if (env) return (_shell = env);
  _shell = SHELL_CHAIN.find(shellExists) || (process.platform === 'win32' ? 'cmd' : 'sh');
  try { patchConfig({ shell: _shell }); } catch { /* 캐시 실패 — 다음 부팅에 재탐지 */ }
  return _shell;
}
