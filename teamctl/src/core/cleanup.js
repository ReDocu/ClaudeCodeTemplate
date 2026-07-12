// cleanup — 대시보드(root/ 선언)에 연결되지 않은 wmux 워크스페이스와 그 안의 세션을 종료.
// reconcile의 "자동 종료 금지"는 선언된 팀에 대한 계약이고, 이 모듈은 선언 밖(undeclared)만
// 다루는 별도 옵트인 경로다(teamctl cleanup / boot --clean / config.cleanOnBoot).
//
// 안전 원칙 — 파괴 작업이므로 keep 판정은 reconcile 매칭보다 일부러 넓다(애매하면 남긴다):
//   ① team.json 되쓰기된 workspaceId  ② 팀 프로젝트 경로(projectPath '.'=팀 폴더 포함,
//   드리프트 보정 stableCwd 경유)  ③ 워크스페이스 제목 == 팀 이름(createWorkspace가 title=t.name)
//   ④ closed 팀도 선언으로 취급(보호)  ⑤ 이 프로세스가 탄 pane의 워크스페이스(WMUX_SURFACE_ID).
// 선언된 워크스페이스 안의 drift 세션은 건드리지 않는다(표시만 — 기존 계약 유지).
import { scanTeams } from './registry.js';
import { getWmuxFresh, killAgent, closeWorkspace, invalidateWmux } from './wmux.js';
import { stableCwd } from './state.js';

const norm = (p) => (p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
const isDead = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());
const agentIdOf = (a) => a.agentId || a.id;
const labelOf = (a) => a.label || a.role || a.name || '';
const wsOf = (a) => a.workspaceId || a.workspace;
// projectPath "." = 팀 폴더 자체(co-located) — reconcile.projectAbs와 동일 규칙.
const projectAbs = (t) => { const p = t.projectPath || '.'; return (!p || p === '.') ? t._dir : p; };

// 이 워크스페이스를 지켜야 하는 이유(문자열) — 없으면 null(= 정리 대상).
function keepReason(w, teams, selfWsId) {
  for (const t of teams) {
    if (t.workspaceId && t.workspaceId === w.id) return `팀 '${t.id}' workspaceId 바인딩`;
    const pa = norm(projectAbs(t));
    if (pa && (norm(stableCwd(w.id, w.cwd)) === pa || norm(w.cwd) === pa)) return `팀 '${t.id}' 프로젝트 경로`;
    if (w.title && t.name && w.title === t.name) return `팀 '${t.id}' 이름 일치`;
  }
  if (selfWsId && w.id === selfWsId) return '현재 프로세스의 pane이 속한 워크스페이스';
  return null;
}

// dryRun: 변경 없이 대상만 보고. 반환: { dryRun, kept, closed, errors }
//   kept:   [{ id, title, reason }]
//   closed: [{ id, title, cwd, agents:[{agentId,label}], action: closed|would-close|close-failed }]
export async function cleanup({ dryRun = false } = {}) {
  const teams = scanTeams(); // closed 포함 — 선언돼 있으면 전부 보호
  // 변이 결정은 신선한 상태로(불변 규칙) — stale 캐시는 방금 열린 세션을 못 본다.
  const { workspaces = [], agents = [], live } = await getWmuxFresh();
  if (!live) throw new Error('wmux 오프라인 — cleanup을 수행할 수 없습니다');

  // 자기 pane 보호 — wmux pane 안에서 실행되면(WMUX_SURFACE_ID) 그 pane의 ws는 절대 닫지 않는다.
  const self = process.env.WMUX_SURFACE_ID?.trim();
  const selfAgent = self ? agents.find((a) => a.surfaceId === self) : null;
  const selfWsId = selfAgent ? wsOf(selfAgent) : null;

  const result = { dryRun, kept: [], closed: [], errors: [] };
  let changed = false;
  for (const w of workspaces) {
    const reason = keepReason(w, teams, selfWsId);
    if (reason) { result.kept.push({ id: w.id, title: w.title || '', reason }); continue; }

    const wsAgents = agents.filter((a) => !isDead(a) && wsOf(a) === w.id);
    const entry = {
      id: w.id, title: w.title || '', cwd: w.cwd || '',
      agents: wsAgents.map((a) => ({ agentId: agentIdOf(a), label: labelOf(a) })),
    };
    if (dryRun) { entry.action = 'would-close'; result.closed.push(entry); continue; }

    // 세션 먼저 kill(잔존 셸 프로세스 최소화) → 워크스페이스 close.
    for (const a of wsAgents) {
      try { await killAgent(agentIdOf(a)); changed = true; }
      catch (e) { result.errors.push({ ws: w.id, agentId: agentIdOf(a), error: e.message }); }
    }
    try { await closeWorkspace(w.id); changed = true; entry.action = 'closed'; }
    catch (e) { entry.action = 'close-failed'; entry.error = e.message; result.errors.push({ ws: w.id, error: e.message }); }
    result.closed.push(entry);
  }
  if (changed) invalidateWmux();
  return result;
}
