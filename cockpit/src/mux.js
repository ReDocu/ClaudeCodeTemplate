// 멀티플렉서 파사드 (FS-1) — 플랫폼별 드라이버를 고르고 그 위에 공통 계약을 얹는다.
//   darwin → mux/cmux.js · 그 외 → mux/wmux.js
// **상위(server·lifecycle·bin)는 이 파일만 import한다** — 플랫폼 분기는 여기서 끝난다.
//
// 파사드가 아는 것: 상태 캐시(TTL·single-flight·epoch) · 정규화 · dead 필터 · 스폰 인자 계약 · 셸 결정.
// 드라이버가 아는 것: 앱 발견/기동 · 프로토콜 왕복 · 제어 동사 · 앱 종료 · 그 멀티플렉서 고유 규약.
//
// ── 드라이버 계약 ──
//   NAME                         'wmux' | 'cmux' (표시용)
//   OWNS_APP                     cockpit이 앱을 독점 소유하는가. true면 boot이 자동 복원분을 일괄
//                                정리(cleanSlate)하고 전체 종료가 앱도 내린다. false(cmux)면 둘 다
//                                안 한다 — 사용자의 일상 터미널이라 cockpit 밖 작업을 파괴하므로.
//   ping()                       → 문자열(살아있으면 pong 포함)
//   isAvailable()                → boolean (예외 없음 — 실패는 false)
//   fetchState()                 → {workspaces:[{id,title}], agents:[{agentId,label,…}]} (정규화 전 원본 허용)
//   selectWorkspace(id) · focusPane(id) · killAgent(id)
//   createWorkspace({title,cwd}) → {id} 또는 {workspace:{id}} · closeWorkspace(id)
//   spawnAgent({workspaceId,label,cwd,cmd,env}) · sendLine(text, surfaceId)
//   activateApp()                점프 보조(앱을 앞으로) — 불필요하면 no-op
//   killApp()                    → {ok, app?, error?, skipped?} — 던지지 않는다(종료 흐름 비차단)
//   ensureApp({setup})           → {action:'reused'|'started', pid?} — 발견·기동·ready 폴링까지
//   openWeb(url)                 **선택** — 내장 브라우저 패널로 이동. 안 내보내면 미지원으로 보고
//                                `canOpenWeb=false` → 호출자가 기본 브라우저로 폴백한다.
//
// 캐시 계약(계승 규칙 ①): 폴링·읽기 = getState(stale 허용, 논블로킹) · 변이 결정 = getFresh(실왕복
// 보장) · 변이 후 invalidate(). stale 캐시로 스폰을 결정하면 방금 열린 세션을 못 보고 중복 생성한다.
// dead 필터(계승 규칙 ②): agent kill은 리스트에서 안 지워진다 — 파사드가 걸러 상위는 산 것만 본다.
import { spawnSync } from 'node:child_process';
import { readConfig, patchConfig } from './registry.js';
import * as wmux from './mux/wmux.js';
import * as cmux from './mux/cmux.js';

const D = process.platform === 'darwin' ? cmux : wmux;

export const name = D.NAME;       // 로그·대시보드 표시용 멀티플렉서 이름
export const ownsApp = D.OWNS_APP; // boot의 cleanSlate·전체 종료의 앱 종료 허용 여부
export const canOpenWeb = typeof D.openWeb === 'function'; // 내장 브라우저 패널 지원(선택 계약)

export const ping = () => D.ping();
export const isAvailable = () => D.isAvailable();

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
// isActive·cwd — workspace git 추적(follow.js)이 소비한다. 활성 workspace 판정과 저장소 유도의
// 유일한 근거이고, wmux가 실제로 내보내는 필드다(실측: id·title·isActive·cwd·shell — git 필드는 없음).
// cmux 드라이버는 아직 안 채운다 → undefined/null(그쪽은 canOpenWeb=false라 추적이 돌지 않는다).
const normWs = (w) => ({
  id: w.id || w.workspaceId || null,
  title: w.title || w.name || '',
  isActive: !!w.isActive,
  cwd: w.cwd || null,
});

const TTL = 1500;
let _cache = null, _at = 0, _inflight = null;
let _epoch = 0; // 연결 세대(신뢰성 개편 ④) — offline→online 전환마다 증가. 멀티플렉서 재시작 감지 신호.

function _refetch() {
  if (_inflight) return _inflight; // single-flight
  _inflight = (async () => {
    try {
      const r = await D.fetchState();
      if (!_cache || !_cache.live) _epoch++; // 첫 연결·재연결 — id 공간이 갈렸을 수 있음(reconcile이 재검증)
      _cache = {
        workspaces: (r.workspaces || []).map(normWs),
        agents: (r.agents || []).filter((a) => !isDead(a)).map(normAgent),
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
export const selectWorkspace = (id) => D.selectWorkspace(id);
export const focusPane = (id) => D.focusPane(id);
export const killAgent = (id) => D.killAgent(id);
export const createWorkspace = ({ title, cwd } = {}) => D.createWorkspace({ title, cwd });
export const closeWorkspace = (id) => D.closeWorkspace(id);
export const activateApp = () => D.activateApp();
export const killApp = () => D.killApp();

// 스폰 — cwd 항상 명시(계승 규칙 ③ — cwd 드리프트 원천 차단). 두 드라이버 공통 요구라 여기서 한 번만 검사.
// env(신뢰성 개편 ⑥): 세션 신원(COCKPIT_PROJECT/ROLE) 주입 — 미지원 멀티플렉서면 호출자(lifecycle)가
// env 없이 재시도한다.
export function spawnAgent({ workspaceId, label, cwd, cmd, env } = {}) {
  if (!cmd) throw new Error('cmd 필요');
  if (!cwd) throw new Error('cwd 필요(드리프트 방지 — 항상 명시)');
  return D.spawnAgent({ workspaceId, label, cwd, cmd, env });
}

// 텍스트+Enter를 특정 세션 pane에 — surfaceId 명시 필수(계승 규칙 ② — 오발송 방지).
export function sendLine(text, surfaceId) {
  if (!surfaceId) throw new Error('sendLine: 대상 surfaceId 필요(오발송 방지)');
  return D.sendLine(text, surfaceId);
}

// 내장 브라우저 패널로 URL 이동 — 대시보드 git 칩이 기본 브라우저 새 탭 대신 여기로 연다.
// http(s)만(FS-11 링크와 동일 규칙) — file://·custom scheme이 멀티플렉서 패널에 실리는 걸 차단한다.
// 미지원 드라이버(cmux)면 던진다 — 호출자는 canOpenWeb으로 미리 판정해 기본 브라우저로 폴백할 것.
export function openWeb(url) {
  if (!canOpenWeb) throw new Error(`${name}는 내장 브라우저 열기를 지원하지 않습니다`);
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) throw new Error('http(s) URL만 허용');
  return D.openWeb(u);
}

// 앱 보장(boot ①) — 발견·기동·ready 폴링은 드라이버 소관. 갓 기동했으면 캐시를 버린다:
// 기동 전 폴링이 남긴 오프라인 스냅샷이 그대로 굳으면 직후 재수렴이 '미연결'을 보고 오판한다.
export async function ensureApp(opts = {}) {
  const r = await D.ensureApp(opts);
  if (r.action === 'started') invalidate();
  return r;
}

// ── 셸 결정 (FS-1-3) — config.shell → TEAMCTL_SHELL → 자동 탐지(1회, config 되씀) → 폴백 ──
// 멀티플렉서가 아니라 OS의 관심사라 드라이버가 아닌 파사드에 둔다(win32/그 외 체인만 다름).
const SHELL_CHAIN = process.platform === 'win32' ? ['pwsh', 'powershell', 'cmd'] : ['pwsh', 'bash', 'sh'];
const WHICH = process.platform === 'win32' ? 'where.exe' : 'which';
function shellExists(nm) {
  try { return spawnSync(WHICH, [nm], { stdio: 'ignore', timeout: 3000 }).status === 0; }
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
