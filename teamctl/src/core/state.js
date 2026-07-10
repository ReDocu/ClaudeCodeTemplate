// /api/state 페이로드 빌더 — wmux 실측(list-workspaces + agent list)을
// 트리아지 대시보드가 소비하는 { teams, sessions } 모델로 매핑.
import { basename } from 'node:path';
import { homedir } from 'node:os';
import { getWmuxState } from './wmux.js';
import { snapshot, maybeRefresh, refreshAll } from '../connectors/index.js';

// 워크스페이스 cwd는 활성 pane을 따라 홈으로 드리프트함(§8 — 스폰 시 새 pane이 홈에서 뜸).
// 팀=프로젝트 경로는 고정돼야 하므로 워크스페이스별 마지막 non-home cwd를 기억해 반환.
// 팀 path·세션 cwd(드로어)·커넥터 프로브·spawn --cwd가 모두 이 안정 경로를 공유.
const HOME = homedir().toLowerCase();
const _projectCwd = new Map(); // wsId -> 마지막 관측된 non-home cwd
export function stableCwd(wsId, liveCwd) {
  const c = liveCwd || '';
  if (c && c.toLowerCase() !== HOME) { _projectCwd.set(wsId, c); return c; }
  return _projectCwd.get(wsId) || c;
}

// wmux 읽기는 getWmuxState 캐시 경유(TTL+single-flight) — 폴링당 5초 왕복을 압축.
export async function buildState({ forceConnectors = false } = {}) {
  const st = await getWmuxState();
  const { agents, live } = st;
  if (!live) {
    return { source: 'offline', live: false, teams: [], sessions: {}, ports: [], generatedAt: Date.now() };
  }
  // 드리프트 보정: 홈으로 튄 cwd를 고정된 프로젝트 경로로 치환 후 하류 전체가 이를 사용.
  const workspaces = (st.workspaces || []).map((w) => ({ ...w, cwd: stableCwd(w.id, w.cwd) }));

  // 커넥터 갱신은 절대 응답을 막지 않음: force여도 fire-and-forget(다음 폴링에 반영).
  if (forceConnectors) refreshAll(workspaces).catch(() => {});
  else maybeRefresh(workspaces);
  const conn = snapshot();

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
      conns: conn.byTeam[w.id]?.conns || [],   // git/env/node 프로브 (connectors 캐시)
      ports: conn.byTeam[w.id]?.ports || [],   // 이 팀에 귀속된 리스너
    };
  });

  return { source: 'live', live: true, teams, sessions, ports: conn.globalPorts || [], generatedAt: Date.now() };
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
    cwd: w.cwd || '',
    pane: a.paneId || a.pane || '',
    agentId: aid,
    screen: `<span class="mut">agent ${aid}\ncmd: ${a.cmd || '—'}\nstatus: ${a.status || a.state || 'unknown'}\ncwd: ${w.cwd || ''}</span>`,
    feed: [],
    files: [],
  };
}
