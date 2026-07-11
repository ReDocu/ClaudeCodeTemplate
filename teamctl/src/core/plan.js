// 계획(plan) 빌더 — 폴더 선언(desired) ⊕ wmux 실측(actual)을 매칭해 동기화 상태를 계산.
// GET /api/plan 이 소비. 구성(Sync) 뷰 + 라이브의 "미동기화/drift" 트리아지가 이걸 읽음.
import { ROOT, scanTeams } from './registry.js';
import { getWmuxState } from './wmux.js';
import { stableCwd } from './state.js';

const isDead = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());
const norm = (p) => (p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
const agentIdOf = (a) => a.agentId || a.id;
const labelOf = (a) => a.label || a.role || a.name || '';

// 팀 선언 ↔ 워크스페이스 매칭: ① workspaceId 명시 우선 ② projectPath == cwd(드리프트 보정 stableCwd 경유) 폴백.
function matchWorkspace(t, workspaces) {
  if (t.workspaceId && workspaces.some((w) => w.id === t.workspaceId)) return t.workspaceId;
  const pp = norm(t.projectPath);
  if (!pp || pp === '.') return null;
  const m = workspaces.find((w) => norm(stableCwd(w.id, w.cwd)) === pp || norm(w.cwd) === pp);
  return m ? m.id : null;
}

export async function buildPlan() {
  const desired = scanTeams();
  const { workspaces = [], agents = [], live } = await getWmuxState();
  const liveAgents = agents.filter((a) => !isDead(a));
  const claimed = new Set();

  const teams = desired.map((t) => {
    const ws = matchWorkspace(t, workspaces);
    const wsAgents = ws ? liveAgents.filter((a) => (a.workspaceId || a.workspace) === ws) : [];
    const roles = (t.roles || []).map((r) => {
      // ① label ② 되쓰기된 r.agentId(reconcile이 채택한 열려있는 세션은 label이 역할명과 다름) 순.
      const a = wsAgents.find((x) => labelOf(x) === r.id)
        || (r.agentId ? wsAgents.find((x) => agentIdOf(x) === r.agentId) : null);
      if (a) claimed.add(agentIdOf(a));
      return { id: r.id, autostart: !!r.autostart, agentId: a ? agentIdOf(a) : null, status: a ? (a.status || 'running') : 'pending' };
    });
    // 대기(pending) = 워크스페이스 미생성(1) + 스폰 안 된 autostart 역할 수
    const pending = (ws ? 0 : 1) + roles.filter((r) => r.autostart && !r.agentId).length;
    return {
      id: t.id, name: t.name, folder: t._folder,
      projectPath: t.projectPath || '', workspaceId: ws,
      connectors: t.connectors || [], expectedPorts: t.expectedPorts || [],
      roles, pending, syncState: pending ? 'pending' : 'synced',
    };
  });

  // drift = 어떤 폴더 역할에도 매칭 안 된 살아있는 세션(폴더에 선언 없음). 표시만, 자동 종료 금지.
  const drift = liveAgents
    .filter((a) => !claimed.has(agentIdOf(a)))
    .map((a) => ({ role: labelOf(a) || a.cmd || '?', agentId: agentIdOf(a), ws: a.workspaceId || a.workspace, status: a.status || 'running' }));

  return { root: ROOT, live: !!live, teams, drift, generatedAt: Date.now() };
}
