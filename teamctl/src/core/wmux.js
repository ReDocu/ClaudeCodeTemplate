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

// --- write (제어) — Tech.md §5.1 매핑 ---
export const selectWorkspace = (id) => wmux(['select-workspace', id], { json: false });
export const focusPane = (id) => wmux(['focus-pane', id], { json: false });
export const killAgent = (id) => wmux(['agent', 'kill', id], { json: false });
export const send = (text) => wmux(['send', text], { json: false });
