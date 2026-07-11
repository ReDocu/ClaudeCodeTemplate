// wmux 파이프 직결 — 모든 wmux 호출의 단일 창구 (Tech.md §5)
// 구 구현(CLI 스폰)을 버린 이유: CLI(node wmux.js)는 응답을 ~1ms에 받고도 5s 안전 타이머를
// 해제하지 않아 프로세스가 타이머 만료까지 생존 — 호출당 ~5.07s 고정(실측, ping 포함 전 명령).
// 직결은 같은 요청이 ~1ms. handover §8의 "파이프 연결 지연" 추정은 오진이었다.
//
// 프로토콜(CLI 소스 + 파이프 실측):
//   V2: {method, params, id, token}\n → {result|error}\n     V1: 'ping\n' → 'pong\n'
// 서버는 응답 후 연결을 닫지 않는다 → 개행 수신 즉시 정리(end 대기 금지 — CLI 5s의 원인).
// 서버가 한 연결에 다중 요청을 받는 것도 실측 확인했지만, connect가 ~0ms라 상주 연결의
// 재접속·응답 다중화 복잡도가 이득이 없어 요청당 1연결로 둔다.
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PIPE = process.env.WMUX_PIPE || '\\\\.\\pipe\\wmux';
const TIMEOUT = 10_000;

// V2 권한 토큰 — wmux가 스폰한 셸엔 env로 주입, 밖(더블클릭 런처 등)에선 APPDATA의
// 토큰 파일(이 사용자만 읽기 가능)에서. 1회 캐시.
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

// 한 연결 = 한 요청. 첫 개행(또는 서버 측 종료)까지 읽고 즉시 소켓·타이머 정리.
function exchange(line, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    let data = '', done = false, timer;
    const client = net.connect({ path: PIPE }, () => client.write(line + '\n'));
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); client.destroy(); fn(v); };
    timer = setTimeout(() => finish(reject, new Error(`wmux 응답 없음 (${timeoutMs / 1000}s)`)), timeoutMs);
    client.on('data', (chunk) => {
      data += chunk;
      const nl = data.indexOf('\n');
      if (nl !== -1) finish(resolve, data.slice(0, nl).trim());
    });
    client.on('end', () => finish(resolve, data.trim()));
    client.on('error', (err) => finish(reject, err));
  });
}

// V2 요청 — 성공 시 result 그대로 반환(구 CLI가 stdout에 찍던 것과 동일 형상), error면 throw.
let _seq = 0;
export async function request(method, params = {}, timeoutMs = TIMEOUT) {
  const raw = await exchange(JSON.stringify({ method, params, id: ++_seq, token: token() }), timeoutMs);
  let res;
  try { res = JSON.parse(raw); } catch { return { raw }; } // 비JSON 응답 방어
  if (res.error) throw new Error(res.error.message || String(res.error));
  return res.result;
}

// V1 텍스트 ping — 토큰 불필요, 가장 가벼운 생존 확인. 파이프 없음(ENOENT) = 앱 미실행.
export const ping = () => exchange('ping', 5000);
export async function isAvailable() {
  try { return /pong/i.test(await ping()); } catch { return false; }
}

// --- read (상태 조회) ---
export const listWorkspaces = () => request('workspace.list');
export const listAgents = () => request('agent.list');
export const agentStatus = (id) => request('agent.status', { agentId: id });

// wmux 상태 캐시 — 왕복이 ~1ms가 되어 지연 회피 목적은 소멸했지만, 논블로킹 폴링 계약
// (대시보드 2.5s 폴링이 wmux 상태에 절대 안 막힘)과 live 판정·single-flight는 그대로 유효.
// spawn/kill 등 변이 후 invalidateWmux()로 즉시 백그라운드 재조회.
const WMUX_TTL = 1500;
let _cache = null, _cacheAt = 0, _inflight = null;

function _refetch() {
  if (_inflight) return _inflight; // single-flight
  _inflight = (async () => {
    try {
      const [ws, ag] = await Promise.all([listWorkspaces(), listAgents().catch(() => ({ agents: [] }))]);
      _cache = { workspaces: ws.workspaces || [], agents: ag.agents || [], live: true };
    } catch {
      _cache = { workspaces: [], agents: [], live: false }; // list-workspaces 실패 = 오프라인
    }
    _cacheAt = Date.now();
    return _cache;
  })().finally(() => { _inflight = null; });
  return _inflight;
}

// 논블로킹 — 캐시 즉시 반환(오래됐으면 백그라운드 갱신 트리거). 콜드면 null.
export function getWmuxCached() {
  if (Date.now() - _cacheAt >= WMUX_TTL && !_inflight) _refetch().catch(() => {});
  return _cache;
}
// 콜드 캐시일 때만 첫 왕복을 대기(부팅/첫 폴링). 이후엔 getWmuxCached로 즉시.
export async function getWmuxState() {
  const c = getWmuxCached();
  return c || _refetch();
}
// 변이 결정용(중복 세션 판정·reconcile 스폰 여부) — stale 캐시로 판단하면 방금 열린 세션을
// 못 보고 중복 스폰한다. 신선하지 않으면 실왕복(~1ms)을 기다려 최신 상태를 보장.
export async function getWmuxFresh() {
  if (_cache && Date.now() - _cacheAt < WMUX_TTL) return _cache;
  return _refetch();
}
export function invalidateWmux() { _cacheAt = 0; _refetch().catch(() => {}); }

// --- write (제어) — Tech.md §5.1 매핑 ---
export const selectWorkspace = (id) => request('workspace.select', { id });
export const focusPane = (id) => request('pane.focus', { id });
export const killAgent = (id) => request('agent.kill', { agentId: id });

// CLI와 동일: 패널 안에서 실행 중이면 자기 surface를 대상으로 (WMUX_SURFACE_ID 상속).
export function send(text) {
  const params = { text };
  if (process.env.WMUX_SURFACE_ID) params.surfaceId = process.env.WMUX_SURFACE_ID;
  return request('surface.send_text', params);
}

// 텍스트 + Enter를 특정 세션 pane에 — 셸 명령 실행·claude 프롬프트 제출용.
// surfaceId 명시 필수(agent.spawn/agent.list의 surfaceId — pane-*가 아닌 surf-*).
// 실측 교훈: 포커스 기반·WMUX_SURFACE_ID 상속 전송은 대시보드 서버/사용자가 보던 pane으로
// 오발송된다(paneId를 send_text에 주면 "no PTY" 에러). 절대 암묵 타깃으로 보내지 말 것.
export async function sendLine(text, surfaceId) {
  if (!surfaceId) throw new Error('sendLine: 대상 surfaceId 필요(오발송 방지)');
  await request('surface.send_text', { surfaceId, text });
  try { await request('surface.send_key', { surfaceId, key: 'Enter' }); }
  catch { await request('surface.send_text', { surfaceId, text: '\r' }); } // send_key 미지원 폴백
}

// 스폰 기본 셸 — "처음 실행은 터미널로 시작"(claude 자동 실행 안 함, ▶ 버튼/POST /claude로 전환).
export const TERMINAL_CMD = process.env.TEAMCTL_SHELL || 'pwsh';

// 대시보드를 wmux 브라우저 패널에 (boot ④). caller = CLI의 issue #62 라우팅과 동일.
export function openBrowser(url) {
  const params = { url };
  if (process.env.WMUX_SURFACE_ID) params.caller = process.env.WMUX_SURFACE_ID;
  return request('browser.navigate', params);
}

// 워크스페이스 생성 — reconcile(teamctl up)에서 폴더 팀에 워크스페이스가 없을 때. 반환: 생성된 workspace(JSON).
export function createWorkspace({ title, cwd } = {}) {
  const params = {};
  if (title) params.title = title;
  if (cwd) params.cwd = cwd;
  return request('workspace.create', params);
}

// agent spawn — cmd 필수(예: 'claude'). label 기본값은 cmd 첫 토큰(CLI와 동일).
// workspaceId 주면 해당 워크스페이스에, 없으면 활성 워크스페이스에 스폰.
// 반환: 스폰된 agent 정보(JSON) → 대시보드가 즉시 loadState로 카드 채움.
export function spawnAgent({ cmd, label, cwd, pane, workspaceId } = {}) {
  if (!cmd) throw new Error('cmd 필요');
  const params = { cmd, label: label || cmd.split(/\s+/)[0] };
  if (cwd) params.cwd = cwd;
  if (pane) params.paneId = pane;
  if (workspaceId) params.workspaceId = workspaceId;
  return request('agent.spawn', params);
}
