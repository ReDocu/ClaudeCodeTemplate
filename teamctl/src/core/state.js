// /api/state 페이로드 빌더 — wmux 실측(list-workspaces + agent list)을
// 트리아지 대시보드가 소비하는 { teams, sessions } 모델로 매핑.
import { basename } from 'node:path';
import { isAvailable, listWorkspaces, listAgents } from './wmux.js';

export async function buildState() {
  if (!(await isAvailable())) {
    return { source: 'offline', live: false, teams: [], sessions: {}, generatedAt: Date.now() };
  }

  let workspaces = [], agents = [];
  try { workspaces = (await listWorkspaces()).workspaces || []; } catch {}
  try { agents = (await listAgents()).agents || []; } catch {}

  const sessions = {};
  const teams = workspaces.map((w) => {
    // 종료된(exited/dead) 에이전트는 유령 카드로 쌓이므로 제외 — 살아있는 세션만 표시.
    const wsAgents = agents.filter((a) =>
      (a.workspaceId || a.workspace) === w.id && !isDead(a));
    const roleKeys = wsAgents.map((a) => {
      const aid = agentIdOf(a);
      const key = `${w.id}/${aid}`;
      sessions[key] = mapAgent(a, w);
      return key;
    });
    return {
      id: w.id,
      name: w.title || basename(w.cwd || '') || w.id,
      tag: basename(w.cwd || '') || '—',
      path: w.cwd || '',
      active: !!w.isActive,
      roles: roleKeys,
      conns: [],   // TODO: connectors 스캐너 (git/env/node) — 후속
      ports: [],   // TODO: ports 프로브 — 후속
    };
  });

  return { source: 'live', live: true, teams, sessions, generatedAt: Date.now() };
}

// wmux agent 실측 필드: agentId·label·cmd·status·paneId·workspaceId·spawnTime·pid·exitCode.
const agentIdOf = (a) => a.agentId || a.id;
const isDead = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());

// agent 객체 → 대시보드 세션 상세.
function mapAgent(a, w) {
  const aid = agentIdOf(a);
  const state = (a.status || a.state || '').toLowerCase();
  const waiting = /wait|approval|pending|input/.test(state);
  const running = state === 'running';
  return {
    team: w.title || w.id,
    role: a.role || a.label || a.name || a.title || aid,
    st: waiting ? 'waiting' : running ? 'working' : 'idle',
    now: a.lastMessage || a.summary || (a.cmd ? `실행: ${a.cmd}` : a.title) || '(상태 정보 없음)',
    model: a.model || '—',
    elapsed: a.elapsed || '—',
    cost: a.cost || '—',
    tokens: a.tokens || '0',
    tools: a.tools || 0,
    ws: w.id,
    pane: a.paneId || a.pane || '',
    agentId: aid,
    screen: `<span class="mut">agent ${aid}\ncmd: ${a.cmd || '—'}\nstatus: ${a.status || a.state || 'unknown'}\ncwd: ${w.cwd || ''}</span>`,
    feed: [],
    files: [],
  };
}
