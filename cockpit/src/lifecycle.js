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

// POST /activate — 멱등 수렴. 반환 {wsId, spawned, reused}. [세션 복구]도 같은 경로.
export async function activate(name) {
  const p = requireProject(name);
  if (p.status === 'archived') throw err(409, 'project-archived'); // 재개 후 활성화(FS-7 경유 강제)

  let state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');

  let ws = matchWorkspace(state, p);
  let wsCreated = false;
  if (!ws) {
    const r = await createWorkspace({ title: p.name, cwd: p._dir });
    const raw = r && (r.workspace || r);
    ws = { id: raw.id || raw.workspaceId, title: p.name };
    if (!ws.id) throw err(502, 'workspace-create-failed');
    wsCreated = true;
    invalidate();
  }

  // ops 항상 1번(먼저), 이후 선언 roles 순서(FS-5-1). 각 스폰 결정 직전 fresh 재확인.
  const order = [{ id: 'ops' }, ...(p.roles || []).filter((r) => r && r.id && r.id !== 'ops')];
  const adopted = p.adopted || {}; // 채택된 세션(agentId→role)은 그 역할을 이미 채운 것으로 간주(중복 스폰 방지)
  let spawned = 0, reused = 0;
  const spawnedIds = [], failed = [];
  for (const role of order) {
    state = await getFresh();
    const dup = agentsOfWs(state, ws.id).find((a) => a.label === role.id || adopted[a.agentId] === role.id);
    if (dup) { reused++; continue; }
    const cwd = ensureRoleDir(p._dir, role.id);
    try {
      await spawnAgent({ workspaceId: ws.id, label: role.id, cwd, cmd: resolveShell() });
      spawned++; spawnedIds.push(role.id);
    } catch (e) {
      failed.push(role.id);
      logEvent('error', p.name, 'spawn', `${role.id} 스폰 실패 — ${e.message}`);
    }
    invalidate();
  }

  p.status = 'active'; p.wsId = ws.id;
  writeProject(p);
  logEvent('info', p.name, 'activate',
    `workspace ${wsCreated ? '생성' : '재사용'} · 스폰 ${spawned} · 재사용 ${reused}`
    + (spawnedIds.length ? ` (${spawnedIds.join('·')})` : '')
    + (failed.length ? ` · 실패 ${failed.join('·')}` : ''));
  return { ok: true, wsId: ws.id, spawned, reused, failed };
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
