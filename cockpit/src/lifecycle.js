// 프로젝트 생명주기 (FS-5·6·7) — 상태 전이 §8.3: idle ↔ active(활성화/비활성화), idle ↔ archived.
// 스폰 수렴(사용자 개편): workspace 보장 → 초점 이동 → 그 자리에서 역할 스폰 → 연결 검증. label 멱등(KR3).
// 스폰 결정은 전부 getFresh()(계승 규칙 ①). kill은 비활성화 일괄뿐(R2 ops 보호 겸용).
import { mkdirSync } from 'node:fs';
import {
  getFresh, invalidate, refreshState, spawnAgent, killAgent, createWorkspace, closeWorkspace, resolveShell, selectWorkspace,
} from './mux.js';
import { findProject, writeProject, ensureRoleDir, scanProjects } from './registry.js';
import { logEvent } from './log.js';

const err = (status, code) => Object.assign(new Error(code), { status });

function requireProject(name) {
  const p = findProject(name);
  if (!p) throw err(404, 'unknown-project');
  return p;
}

// ── label 네임스페이스 (신뢰성 개편 ③) — 스폰 label = cockpit:<프로젝트폴더>:<역할> ──
// 사용자 pane label과의 우연한 충돌을 구조적으로 차단하고, wmux 재시작으로 wsId·agentId가
// 갈려도 label만 살아있으면 프로젝트·역할을 복원한다. 구 형식(plain role label)은 폴백 인식(호환).
// 폴더·역할명은 Windows 폴더명이라 ':'을 포함할 수 없음 — 파싱 모호성 없음.
export const roleLabel = (proj, role) => `cockpit:${proj._folder}:${role}`;
export function parseLabel(label) {
  const m = /^cockpit:([^:]+):(.+)$/.exec(String(label || ''));
  return m ? { project: m[1], role: m[2] } : null;
}
// 세션의 역할 해석 — 채택 > 네임스페이스 label(같은 프로젝트만) > plain label(구 형식).
// 남의 프로젝트 네임스페이스 label이면 null(이 프로젝트 역할 아님 — orphan 취급).
export function roleOf(proj, a) {
  const adopted = (proj.adopted || {})[a.agentId];
  if (adopted) return adopted;
  const ns = parseLabel(a.label);
  if (ns) return ns.project === proj._folder ? ns.role : null;
  return a.label || null;
}

// 프로젝트의 wmux workspace 실측 매칭 + 근거(신뢰성 개편 ⑦) — wsId > title > label 역산(FS-3-3 확장).
// label 역산: 이 프로젝트 네임스페이스 label을 단 세션이 속한 workspace — 재시작 후 wsId·제목이
// 모두 소실돼도 cockpit이 스폰한 세션만 살아있으면 복원된다.
export function matchWorkspaceInfo(state, proj) {
  let w = state.workspaces.find((x) => proj.wsId && x.id === proj.wsId);
  if (w) return { ws: w, via: 'wsId' };
  w = state.workspaces.find((x) => x.title === proj.name);
  if (w) return { ws: w, via: 'title' };
  const a = state.agents.find((x) => parseLabel(x.label)?.project === proj._folder);
  w = a ? state.workspaces.find((x) => x.id === a.workspaceId) : null;
  return w ? { ws: w, via: 'label' } : { ws: null, via: null };
}
export const matchWorkspace = (state, proj) => matchWorkspaceInfo(state, proj).ws;
export const agentsOfWs = (state, wsId) => state.agents.filter((a) => a.workspaceId === wsId);

// ── 화해 루프 (신뢰성 개편 ②④) — 선언(project.json)과 wmux 실측의 어긋남 자기치유 ──
// 긍정 신호(제목/label 재발견)는 즉시 되쓰기, 부정 신호(실측 부재)는 연속 GRACE 스냅샷 관찰 후에만
// 정리 — 일시 단절·타이밍으로 매핑을 날리지 않기 위함. wmux 오프라인 스냅샷에선 아무것도 판정하지
// 않고, 재연결(epoch 변화) 시 부재 카운트를 리셋해 새 실측 기준으로 다시 관찰한다.
const GRACE = 3;
const _missWs = new Map();    // _folder → wsId 실측 부재 연속 횟수
const _missAdopt = new Map(); // `${_folder}/${agentId}` → 채택 세션 실측 부재 연속 횟수
let _seenEpoch = null, _seenAt = 0;

export function reconcile(state, projects) {
  if (!state.live) return;                    // 오프라인 — 실측이 없을 때 매핑을 건드리지 않는다
  if (state.at === _seenAt) return;           // 같은 스냅샷은 1회만 판정(다중 폴러가 그레이스를 깎지 않게)
  _seenAt = state.at;
  if (state.epoch !== _seenEpoch) {
    if (_seenEpoch !== null) logEvent('info', null, 'reconcile', `wmux 재연결 감지(epoch ${state.epoch}) — 매핑 재검증 시작`);
    _seenEpoch = state.epoch;
    _missWs.clear(); _missAdopt.clear();
  }
  const wsIds = new Set(state.workspaces.map((w) => w.id));
  const agentIds = new Set(state.agents.map((a) => a.agentId));
  for (const p of projects) {
    let dirty = false;
    // wsId — 실측 재발견(제목/label 매칭)은 즉시 되쓰기, 부재는 GRACE 후 해제
    const { ws, via } = matchWorkspaceInfo(state, p);
    if (ws && p.wsId !== ws.id) {
      logEvent('info', p.name, 'reconcile', `workspace 재바인딩(${via} 매칭) — wsId ${p.wsId || '없음'} → ${ws.id}`);
      p.wsId = ws.id; dirty = true; _missWs.delete(p._folder);
    } else if (p.wsId && !wsIds.has(p.wsId)) {
      const n = (_missWs.get(p._folder) || 0) + 1;
      if (n >= GRACE) {
        logEvent('info', p.name, 'reconcile', `stale wsId 해제 — ${p.wsId} (실측 ${GRACE}회 연속 부재)`);
        p.wsId = null; dirty = true; _missWs.delete(p._folder);
      } else _missWs.set(p._folder, n);
    } else _missWs.delete(p._folder);
    // adopted — 실측에 없는 agentId는 GRACE 후 제거(재시작 등으로 무효화된 채택의 영구 잔류 방지)
    for (const aid of Object.keys(p.adopted || {})) {
      const key = `${p._folder}/${aid}`;
      if (agentIds.has(aid)) { _missAdopt.delete(key); continue; }
      const n = (_missAdopt.get(key) || 0) + 1;
      if (n >= GRACE) {
        logEvent('info', p.name, 'reconcile', `stale 채택 해제 — ${aid} → ${p.adopted[aid]} (실측 ${GRACE}회 연속 부재)`);
        delete p.adopted[aid]; dirty = true; _missAdopt.delete(key);
      } else _missAdopt.set(key, n);
    }
    if (dirty) {
      try { writeProject(p); }
      catch (e) { logEvent('error', p.name, 'reconcile', `되쓰기 실패 — ${e.message}`); }
    }
  }
}

// ── 클린 슬레이트 (boot 초기화) — wmux가 자동 저장분을 복원한 세션·워크스페이스 전부 정리 ──
// wmux는 30초마다 상태를 자동 저장했다가 재기동 시 복원한다. 복원분은 wsId가 전부 새로 갈리고
// 같은 제목의 워크스페이스가 여럿 쌓일 수 있어, title 매칭이 순서에 따라 엉뚱한(빈) 워크스페이스에
// 바인딩된다 — 그래서 갓 기동한 wmux에선 복원분을 전부 걷어내고 선언(project.json)만 진실로 남긴다.
// **갓 기동한 wmux에만 호출할 것**(boot이 직접 스폰한 경우) — 실행 중이던 wmux엔 파괴적이라 금지.
// 복원은 기동 직후 비동기로 이어질 수 있어, 실측(ws·세션 수)이 연속 3회 같아질 때까지 관찰 후 정리.
export async function cleanSlate() {
  let state = await refreshState(), sig = null, stable = 0;
  for (let i = 0; i < 12 && stable < 3; i++) {
    await new Promise((r) => setTimeout(r, 700));
    state = await refreshState();
    const cur = state.live ? `${state.workspaces.length}/${state.agents.length}` : 'offline';
    stable = cur === sig ? stable + 1 : 1;
    sig = cur;
  }
  if (!state.live) throw err(503, 'wmux-offline');
  let killed = 0, closed = 0;
  for (const a of state.agents) {
    try { await killAgent(a.agentId); killed++; }
    catch (e) { logEvent('error', null, 'clean-slate', `복원 세션 ${a.label || a.agentId} 종료 실패 — ${e.message}`); }
  }
  for (const w of state.workspaces) {
    try { await closeWorkspace(w.id); closed++; }
    catch { /* 마지막 워크스페이스 등 닫기 거부 — 빈 껍데기는 무해, 대시보드엔 '미연결'로 표시 */ }
  }
  // 방금 전부 닫았으므로 남은 wsId는 전부 무효 — 그레이스 없이 즉시 해제(재수렴이 새로 바인딩).
  for (const p of scanProjects().projects) {
    if (!p.wsId) continue;
    p.wsId = null;
    try { writeProject(p); } catch { /* 되쓰기 실패 — reconcile 그레이스가 정리 */ }
  }
  await refreshState(); // read-your-writes(①) — 이후 재수렴·폴링이 정리된 실측을 보게
  logEvent('info', null, 'clean-slate', `wmux 초기화 — 복원 세션 ${killed}개 종료 · 워크스페이스 ${closed}개 닫음 (선언 기준 재구성)`);
  return { killed, closed };
}

// 워크스페이스 보장 — 없으면 생성(스폰은 안 함). 반환 {ws, wsCreated}.
async function ensureWorkspace(p, state) {
  let ws = matchWorkspace(state, p);
  if (ws) return { ws, wsCreated: false };
  const r = await createWorkspace({ title: p.name, cwd: p._dir });
  const raw = r && (r.workspace || r);
  ws = { id: raw.id || raw.workspaceId, title: p.name };
  if (!ws.id) throw err(502, 'workspace-create-failed');
  await refreshState(); // read-your-writes(①) — 응답 시점에 새 workspace가 실측에 반영돼 있게
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

// 신원 실린 스폰(③⑥) — label은 네임스페이스 형식, env로 COCKPIT_PROJECT/ROLE 주입 시도.
// env 미지원 wmux(즉시 거부)면 env 없이 1회 재시도 후 세션 내 기억(_envSpawnOk=false).
// 타임아웃 실패는 pane이 생겼을 수 있어 재시도하지 않는다(중복 pane 방지) — 기존 실패 경로로 보고.
let _envSpawnOk = null; // null=미확인 · true=지원 · false=미지원(env 없이 스폰)
async function spawnWithIdentity(p, role, { workspaceId, cwd, cmd }) {
  const base = { workspaceId, label: roleLabel(p, role), cwd, cmd };
  if (_envSpawnOk === false) return spawnAgent(base);
  try {
    const r = await spawnAgent({ ...base, env: { COCKPIT_PROJECT: p._folder, COCKPIT_ROLE: role } });
    _envSpawnOk = true;
    return r;
  } catch (e) {
    if (/응답 없음/.test(e.message || '')) throw e; // 타임아웃 — 재시도 금지
    _envSpawnOk = false;
    logEvent('info', p.name, 'spawn', `env 주입 미지원 wmux — env 없이 재시도 (${role})`);
    return spawnAgent(base);
  }
}

// 연결 검증(스폰 ③단계) — 스폰된 세션이 **대상 워크스페이스에** 실측으로 나타날 때까지 확인(최대 ~3초).
// agentId를 알면: 대상 ws에 있으면 성공 — label이 안 붙는 wmux라도 우리가 방금 스폰한 세션이므로
// 채택(adopted[agentId]=role)으로 즉시 바인딩해 대시보드 '연결됨'을 보장한다. 다른 ws에 붙었으면
// (초점 경합·오배치) 그 pane을 걷어내고 실패 — orphan 누적과 재시도 시 중복 스폰을 막는다.
// agentId를 모르면(wmux 응답 형태 상이): 역할 해석 일치로만 판정.
async function verifyPlacement(p, role, wsId, agentId, { tries = 6, gapMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((res) => setTimeout(res, gapMs));
    const state = await refreshState();
    if (!state.live) continue;
    if (agentId) {
      const a = state.agents.find((x) => x.agentId === agentId);
      if (a && a.workspaceId === wsId) {
        if (roleOf(p, a) !== role) { p.adopted = { ...(p.adopted || {}), [agentId]: role }; writeProject(p); }
        return true;
      }
      if (a && a.workspaceId && a.workspaceId !== wsId) {
        try { await killAgent(agentId); } catch { /* 정리 실패 — orphan으로 남음([⎇ 역할로 동기화] 가능) */ }
        logEvent('error', p.name, 'spawn', `${role} 오배치 감지 — ${a.workspaceId}에 스폰됨 · 정리 후 실패 처리`);
        return false;
      }
    } else if (agentsOfWs(state, wsId).some((a) => roleOf(p, a) === role)) return true;
  }
  return false;
}

// POST /spawn — 세션(pane) 스폰, 3단계(사용자 개편): ① 대상 워크스페이스로 초점 이동 → ② 그 자리에서
// 역할 스폰 → ③ 연결 검증(verifyPlacement — 실패면 spawned로 세지 않아, 상태 기반 렌더인 대시보드가
// [＋ 세션 활성화] 버튼을 그대로 유지한다). role 지정=그 역할 하나, 생략=빠진 선언 역할 전부(멱등 수렴).
// 스폰 결정은 매 회 getFresh()(계승 규칙 ① — stale로 중복 스폰 금지). 중복(역할 해석 일치)은 재사용.
export async function spawnRole(name, role) {
  const p = requireProject(name);
  if (p.status === 'archived') throw err(409, 'project-archived');
  let state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');
  const declared = ['ops', ...(p.roles || []).map((r) => r.id)];
  if (role && !declared.includes(role)) throw err(400, 'unknown-role');
  const targets = role ? [role] : declared;
  const { ws } = await ensureWorkspace(p, state);
  // ① 초점 먼저 — 스폰 전에 대상 워크스페이스로 이동. 초점 밖 워크스페이스로의 스폰이 순서(초점)에
  //    따라 엉뚱한 곳에 붙는 실측 문제 대응. 실패해도 workspaceId 명시 스폰이라 계속(focused로 보고만,
  //    wmux 계층이 [wmux✗] workspace.select 로 콘솔 로깅).
  let focused = false;
  try { await selectWorkspace(ws.id); focused = true; } catch { /* 초점 실패 — 스폰은 계속 */ }
  let spawned = 0, reused = 0; const spawnedIds = [], failed = [];
  for (const r of targets) {
    state = await getFresh();
    // 중복 판정 — 역할 해석(채택 > 네임스페이스 label > 구형식 label) 일치 시 재사용(③ 호환 포함)
    const dup = agentsOfWs(state, ws.id).find((a) => roleOf(p, a) === r);
    if (dup) { reused++; continue; }
    const cwd = ensureRoleDir(p._dir, r);
    let agentId = null;
    try {
      const res = await spawnWithIdentity(p, r, { workspaceId: ws.id, cwd, cmd: resolveShell() });
      agentId = (res && (res.agent?.agentId || res.agentId || res.agent?.id || res.id)) || null;
    } catch (e) {
      failed.push(r);
      logEvent('error', p.name, 'spawn', `${r} 스폰 실패 — ${e.message}`);
      invalidate();
      continue;
    }
    // ③ 연결 검증 — 실패는 spawned로 세지 않는다 → 대시보드 [＋ 세션 활성화] 버튼 유지(재시도 가능).
    if (await verifyPlacement(p, r, ws.id, agentId)) { spawned++; spawnedIds.push(r); }
    else {
      failed.push(r);
      logEvent('error', p.name, 'spawn', `${r} 연결 확인 실패 — 대상 워크스페이스에서 실측되지 않음(활성화 버튼 유지)`);
    }
    invalidate();
  }
  await refreshState(); // read-your-writes(①) — 응답 시점에 스폰 결과가 실측에 반영돼 있게
  if (p.status !== 'active') p.status = 'active';
  p.wsId = ws.id;
  writeProject(p);
  logEvent('info', p.name, 'spawn',
    `세션 스폰 ${spawned}${spawnedIds.length ? ` (${spawnedIds.join('·')})` : ''}`
    + (reused ? ` · 재사용 ${reused}` : '') + (failed.length ? ` · 연결 실패 ${failed.join('·')}` : ''));
  return { ok: true, wsId: ws.id, spawned, reused, failed, focused };
}

// POST /kill-session — 세션 하나 종료(개별 비활성화). 카드 [비활성화](전체 kill)와 별개의 세밀 경로.
// expectedRole(⑤ 낙관적 재검증): 대시보드가 화면에서 본 역할 — 실측 해석과 다르면 화면이 낡은 것,
// 엉뚱한 세션 kill을 막기 위해 409(대시보드가 갱신 후 재시도 유도).
export async function killSession(name, agentId, expectedRole) {
  const p = requireProject(name);
  const state = await getFresh();
  if (!state.live) throw err(503, 'wmux-offline');
  const ws = matchWorkspace(state, p);
  if (!ws) throw err(409, 'project-inactive');
  const a = agentsOfWs(state, ws.id).find((x) => x.agentId === agentId);
  if (!a) throw err(404, 'session-not-found');
  const role = roleOf(p, a) || a.label || agentId;
  if (expectedRole && role !== expectedRole) throw err(409, 'session-changed');
  await killAgent(agentId);
  await refreshState(); // read-your-writes(①)
  logEvent('info', p.name, 'kill', `세션 종료 — ${role} (개별 비활성화)`);
  return { ok: true, killed: agentId, role };
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
    await refreshState(); // read-your-writes(①)
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
