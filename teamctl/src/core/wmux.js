// wmux CLI 래퍼 — 모든 wmux 호출의 단일 창구 (Tech.md §5)
// WMUX_CLI 있으면 `node <cli>`, 없으면 PATH의 `wmux`. execFile(셸 미경유)로 인젝션 차단.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);
const BASE = process.env.WMUX_CLI ? ['node', process.env.WMUX_CLI] : ['wmux'];

export async function wmux(args, { json = true } = {}) {
  const argv = [...BASE.slice(1), ...args];
  const { stdout } = await pExecFile(BASE[0], argv, {
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  const out = (stdout || '').trim();
  if (!json) return out;
  try { return JSON.parse(out); } catch { return { raw: out }; }
}

// wmux 파이프에 실제로 붙는지 (없으면 오프라인 판정 → 대시보드 폴백)
export async function isAvailable() {
  try {
    const r = await wmux(['ping'], { json: false });
    return /pong/i.test(r);
  } catch { return false; }
}

// --- read (상태 조회) ---
export const listWorkspaces = () => wmux(['list-workspaces']);
export const listAgents = () => wmux(['agent', 'list']);
export const agentStatus = (id) => wmux(['agent', 'status', id]);

// wmux 상태 캐시 — CLI 왕복이 호출당 수초까지 감(파이프 연결 고정 지연). 폴링마다 재조회하면 요청이 밀림.
// 논블로킹: 폴링은 캐시를 즉시 받고, 갱신은 백그라운드 single-flight로. 콜드 첫 호출만 대기.
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
export function invalidateWmux() { _cacheAt = 0; _refetch().catch(() => {}); }

// --- write (제어) — Tech.md §5.1 매핑 ---
export const selectWorkspace = (id) => wmux(['select-workspace', id], { json: false });
export const focusPane = (id) => wmux(['focus-pane', id], { json: false });
export const killAgent = (id) => wmux(['agent', 'kill', id], { json: false });
export const send = (text) => wmux(['send', text], { json: false });

// agent spawn — cmd 필수(예: 'claude'). label 없으면 wmux가 cmd 첫 토큰으로 대체.
// workspaceId 주면 해당 워크스페이스에, 없으면 활성 워크스페이스에 스폰.
// 반환: 스폰된 agent 정보(JSON) → 대시보드가 즉시 loadState로 카드 채움.
export function spawnAgent({ cmd, label, cwd, pane, workspaceId } = {}) {
  if (!cmd) throw new Error('cmd 필요');
  const args = ['agent', 'spawn', '--cmd', cmd];
  if (label) args.push('--label', label);
  if (cwd) args.push('--cwd', cwd);
  if (pane) args.push('--pane', pane);
  if (workspaceId) args.push('--workspace', workspaceId);
  return wmux(args);
}
