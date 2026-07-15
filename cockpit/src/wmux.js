// wmux 파이프 단일 창구 (FS-1) — 구 teamctl/src/core/wmux.js 참고 재작성.
// 프로토콜(실측 계승): V2 {method,params,id,token}\n → {result|error}\n · V1 'ping\n'→'pong\n'.
// 서버는 응답 후 연결을 닫지 않는다 → 첫 개행 수신 즉시 정리(end 대기 금지). 요청당 1연결(~1ms).
//
// 캐시 계약(계승 규칙 ①): 폴링·읽기 = getState(stale 허용, 논블로킹) · 변이 결정 = getFresh(실왕복
// 보장) · 변이 후 invalidate(). stale 캐시로 스폰을 결정하면 방금 열린 세션을 못 보고 중복 생성한다.
// dead 필터(계승 규칙 ②): agent kill은 리스트에서 안 지워진다 — 어댑터가 걸러 상위는 산 것만 본다.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { spawnSync, execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readConfig, patchConfig } from './registry.js';
import { logConsole } from './log.js';
import * as cmux from './cmux.js';

// darwin은 cmux 드라이버로 위임(동일 인터페이스) — win32는 기존 파이프 직결 그대로.
const D = process.platform === 'darwin' ? cmux : null;

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

// V1 ping — 토큰 불필요. 파이프 없음(ENOENT) = 앱 미실행. (darwin: cmux CLI ping → PONG)
export const ping = () => D ? D.ping() : exchange('ping', 5000);
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
let _epoch = 0; // 연결 세대(신뢰성 개편 ④) — offline→online 전환마다 증가. wmux 재시작 감지 신호.

function _refetch() {
  if (_inflight) return _inflight; // single-flight
  _inflight = (async () => {
    try {
      let ws, ag;
      if (D) {
        const r = await D.fetchState();
        ws = { workspaces: r.workspaces }; ag = { agents: r.agents };
      } else {
        [ws, ag] = await Promise.all([
          request('workspace.list'),
          request('agent.list').catch(() => ({ agents: [] })),
        ]);
      }
      if (!_cache || !_cache.live) _epoch++; // 첫 연결·재연결 — id 공간이 갈렸을 수 있음(reconcile이 재검증)
      _cache = {
        workspaces: (ws.workspaces || []).map(normWs),
        agents: (ag.agents || []).filter((a) => !isDead(a)).map(normAgent),
        live: true, epoch: _epoch, at: Date.now(), // at = 스냅샷 시각(reconcile의 스냅샷당 1회 판정용)
      };
    } catch {
      _cache = { workspaces: [], agents: [], live: false, epoch: _epoch, at: Date.now() }; // 오프라인
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
// 변이 직후 read-your-writes(신뢰성 개편 ①) — 변이 **이후에 시작된** 실왕복이 끝날 때까지 기다린다.
// 진행 중이던 refetch는 변이 전에 시작됐을 수 있어 결과를 신뢰하지 않고, 끝나길 기다렸다가 새로 왕복.
// 변이 핸들러가 이걸 await하고 응답하면 직후 폴링이 이전 화면을 보는 창이 사라진다.
export async function refreshState() {
  _at = 0;
  if (_inflight) { try { await _inflight; } catch { /* 실패해도 새 왕복은 진행 */ } _at = 0; }
  return _refetch();
}

// ── 제어 ──
export const selectWorkspace = (id) => D ? D.selectWorkspace(id) : request('workspace.select', { id });
export const focusPane = (id) => D ? D.focusPane(id) : request('pane.focus', { id });
export const killAgent = (id) => D ? D.killAgent(id) : request('agent.kill', { agentId: id });
// 점프 보조 — 멀티플렉서 앱을 앞으로(darwin: open <번들>). win32는 wmux가 select로 스스로 앞에 옴 — no-op.
export const activateApp = () => D ? D.activateApp() : Promise.resolve();

// wmux 앱 종료 — 전체 종료(⏻)가 서버와 함께 wmux도 내릴 때 사용. 파이프에 quit 메서드가 없어
// 프로세스 종료로 내린다(이미지 이름은 config.wmuxBin 기준 · Electron 자식들도 같은 이름이라 함께 종료).
// 실패해도 던지지 않는다 — 전체 종료 흐름을 막지 않는 게 우선(호출자는 로그만 남긴다).
export function killApp() {
  if (D) return D.killApp();
  const cfg = readConfig();
  const image = cfg.wmuxBin ? basename(cfg.wmuxBin) : 'wmux.exe';
  return new Promise((resolveP) => {
    execFile('taskkill', ['/F', '/IM', image], { windowsHide: true, timeout: 10_000 },
      (e, _stdout, stderr) => resolveP(e ? { ok: false, error: (stderr || e.message).trim() } : { ok: true, image }));
  });
}

export function createWorkspace({ title, cwd } = {}) {
  if (D) return D.createWorkspace({ title, cwd });
  const params = {};
  if (title) params.title = title;
  if (cwd) params.cwd = cwd;
  return request('workspace.create', params);
}
// 파라미터 명 두 갈래 실측(id/workspaceId) — id 우선, 실패 시 재시도(계승).
export async function closeWorkspace(id) {
  if (D) return D.closeWorkspace(id);
  try { return await request('workspace.close', { id }); }
  catch { return request('workspace.close', { workspaceId: id }); }
}

// 스폰 — cwd 항상 명시(계승 규칙 ③ — cwd 드리프트 원천 차단).
// env(신뢰성 개편 ⑥): 세션 신원(COCKPIT_PROJECT/ROLE)을 pane 환경에 주입 — wmux 미지원 시
// 호출자(lifecycle)가 env 없이 재시도한다. 지원 여부와 무관하게 스폰 자체는 동일.
export function spawnAgent({ workspaceId, label, cwd, cmd, env } = {}) {
  if (D) return D.spawnAgent({ workspaceId, label, cwd, cmd, env });
  if (!cmd) throw new Error('cmd 필요');
  if (!cwd) throw new Error('cwd 필요(드리프트 방지 — 항상 명시)');
  const params = { cmd, label: label || cmd.split(/\s+/)[0], cwd };
  if (workspaceId) params.workspaceId = workspaceId;
  if (env) params.env = env;
  return request('agent.spawn', params);
}

// 텍스트+Enter를 특정 세션 pane에 — surfaceId 명시 필수(계승 규칙 ② — 오발송 방지).
export async function sendLine(text, surfaceId) {
  if (D) return D.sendLine(text, surfaceId);
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
