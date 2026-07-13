// 프로젝트 생명주기 (FS-5·6·7) — 상태 전이 §8.3: idle ↔ active(활성화/비활성화), idle ↔ archived.
// 활성화 수렴: workspace 보장 → ops 1번 스폰 → 선언 역할 순서 스폰. label 멱등(KR3).
// 스폰 결정은 전부 getFresh()(계승 규칙 ①). kill은 비활성화 일괄뿐(R2 ops 보호 겸용).
import { mkdirSync } from 'node:fs';
import {
  getFresh, invalidate, spawnAgent, killAgent, createWorkspace, closeWorkspace, resolveShell,
} from './wmux.js';
import { findProject, writeProject, ensureRoleDir } from './registry.js';
import { logEvent } from './log.js';

const err = (status, code) => Object.assign(new Error(code), { status });

function requireProject(name) {
  const p = findProject(name);
  if (!p) throw err(404, 'unknown-project');
  return p;
}

// 프로젝트의 wmux workspace 실측 매칭 — wsId 되쓰기 우선, 폴백 title=프로젝트명(FS-3-3).
export function matchWorkspace(state, proj) {
  return state.workspaces.find((w) => proj.wsId && w.id === proj.wsId)
    || state.workspaces.find((w) => w.title === proj.name)
    || null;
}
export const agentsOfWs = (state, wsId) => state.agents.filter((a) => a.workspaceId === wsId);

// 워크스페이스 보장 — 없으면 생성(스폰은 안 함). 반환 {ws, wsCreated}.
async function ensureWorkspace(p, state) {
  let ws = matchWorkspace(state, p);
  if (ws) return { ws, wsCreated: false };
  const r = await createWorkspace({ title: p.name, cwd: p._dir });
  const raw = r && (r.workspace || r);
  ws = { id: raw.id || raw.workspaceId, title: p.name };
  if (!ws.id) throw err(502, 'workspace-create-failed');
  invalidate();
  return { ws, wsCreated: true };
}

// POST /activate — 워크스페이스만 보장하고 status=active. **세션(pane)은 스폰하지 않는다**(초기 미연결).
// 세션은 대시보드 [＋ 세션 활성화] → POST /spawn 으로 역할별 개별 스폰(사용자 개편 결정). 반환 {wsId, spawned:0}.
export async function activate(name) {
  const p = requireProject(name);
  if (p.status === 'archived') throw err(409, 'project-archived'); // 재개 후 활성화(FS-7 경유 강제)
  const state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');
  const { ws, wsCreated } = await ensureWorkspace(p, state);
  p.status = 'active'; p.wsId = ws.id;
  writeProject(p);
  logEvent('info', p.name, 'activate', `workspace ${wsCreated ? '생성' : '재사용'} · 세션 스폰 없음(개별 활성화 대기)`);
  return { ok: true, wsId: ws.id, spawned: 0, reused: 0 };
}

// POST /spawn — 세션(pane) 스폰. role 지정=그 역할 하나([＋ 세션 활성화]), 생략=빠진 선언 역할 전부(멱등 수렴).
// 스폰 결정은 매 회 getFresh()(계승 규칙 ① — stale로 중복 스폰 금지). 중복(label/채택 일치)은 재사용.
export async function spawnRole(name, role) {
  const p = requireProject(name);
  if (p.status === 'archived') throw err(409, 'project-archived');
  let state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');
  const declared = ['ops', ...(p.roles || []).map((r) => r.id)];
  if (role && !declared.includes(role)) throw err(400, 'unknown-role');
  const targets = role ? [role] : declared;
  const { ws } = await ensureWorkspace(p, state);
  const adopted = p.adopted || {};
  let spawned = 0, reused = 0; const spawnedIds = [], failed = [];
  for (const r of targets) {
    state = await getFresh();
    const dup = agentsOfWs(state, ws.id).find((a) => a.label === r || adopted[a.agentId] === r);
    if (dup) { reused++; continue; }
    const cwd = ensureRoleDir(p._dir, r);
    try {
      await spawnAgent({ workspaceId: ws.id, label: r, cwd, cmd: resolveShell() });
      spawned++; spawnedIds.push(r);
    } catch (e) {
      failed.push(r);
      logEvent('error', p.name, 'spawn', `${r} 스폰 실패 — ${e.message}`);
    }
    invalidate();
  }
  if (p.status !== 'active') p.status = 'active';
  p.wsId = ws.id;
  writeProject(p);
  logEvent('info', p.name, 'spawn',
    `세션 스폰 ${spawned}${spawnedIds.length ? ` (${spawnedIds.join('·')})` : ''}`
    + (reused ? ` · 재사용 ${reused}` : '') + (failed.length ? ` · 실패 ${failed.join('·')}` : ''));
  return { ok: true, wsId: ws.id, spawned, reused, failed };
}

// POST /kill-session — 세션 하나 종료(개별 비활성화). 카드 [비활성화](전체 kill)와 별개의 세밀 경로.
export async function killSession(name, agentId) {
  const p = requireProject(name);
  const state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');
  const ws = matchWorkspace(state, p);
  if (!ws) throw err(409, 'project-inactive');
  const a = agentsOfWs(state, ws.id).find((x) => x.agentId === agentId);
  if (!a) throw err(404, 'session-not-found');
  await killAgent(agentId);
  invalidate();
  logEvent('info', p.name, 'kill', `세션 종료 — ${a.label || agentId} (개별 비활성화)`);
  return { ok: true, killed: agentId, role: a.label || null };
}

// POST /deactivate — 확인 필수(서버가 confirm 검사, §9-3). ws의 살아있는 세션 전부 kill(ops 포함)
// → workspace close → idle. "자동 종료 금지" 원칙의 유일한 명시적 예외(R3).
export async function deactivate(name) {
  const p = requireProject(name);
  const state = await getFresh();
  const ws = state.live ? matchWorkspace(state, p) : null;
  let killed = 0;
  if (ws) {
    for (const a of agentsOfWs(state, ws.id)) {
      try { await killAgent(a.agentId); killed++; }
      catch (e) { logEvent('error', p.name, 'kill', `${a.label || a.agentId} 종료 실패 — ${e.message}`); }
    }
    try { await closeWorkspace(ws.id); } catch { /* 이미 닫힘/실패 — 상태 전이는 계속 */ }
    invalidate();
  }
  p.status = 'idle'; p.wsId = null;
  writeProject(p);
  logEvent('info', p.name, 'deactivate', `세션 ${killed}개 종료 · 대기중 전환`);
  return { ok: true, killed };
}

// POST /archive — active면 409(비활성화 먼저 — kill을 아카이브에 숨기지 않음, §8.3).
export function archive(name) {
  const p = requireProject(name);
  if (p.status === 'active') throw err(409, 'project-active');
  if (p.status === 'archived') return { ok: true, already: true };
  p.status = 'archived'; p.archivedAt = new Date().toISOString();
  writeProject(p);
  logEvent('info', p.name, 'archive', '아카이브 처리');
  return { ok: true };
}

// POST /reopen — 항상 idle 복귀(즉시 활성화 없음, R3).
export function reopen(name) {
  const p = requireProject(name);
  if (p.status !== 'archived') return { ok: true, already: true };
  p.status = 'idle'; p.archivedAt = null;
  writeProject(p);
  logEvent('info', p.name, 'reopen', '재개 — 대기중 복귀');
  return { ok: true };
}
