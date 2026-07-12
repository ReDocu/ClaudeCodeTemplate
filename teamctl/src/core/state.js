// /api/state 페이로드 빌더 — wmux 실측(list-workspaces + agent list)을
// 트리아지 대시보드가 소비하는 { teams, sessions } 모델로 매핑.
import { basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getWmuxState } from './wmux.js';
import { scanTeams, claudeLayerEnabled } from './registry.js';
import { snapshot, maybeRefresh, refreshAll } from '../connectors/index.js';

// claude 레이어(FS-12·PRD §2) — off면 transcript/proc를 로드조차 하지 않고 wmux 실측 상태만 산출.
// 코어(이 파일)는 레이어에 정적 의존 금지 — import는 레이어→코어 단방향(경계 규율).
let _layer = null, _layerChecked = false;
async function ensureLayer() {
  if (_layerChecked) return; _layerChecked = true;
  if (!claudeLayerEnabled()) return;
  try {
    _layer = { ...(await import('../live/transcript.js')), ...(await import('../live/proc.js')) };
  } catch { _layer = null; /* 레이어 로드 실패 — 코어만으로 동작 */ }
}

// 워크스페이스 cwd는 활성 pane을 따라 홈으로 드리프트함(§8 — 스폰 시 새 pane이 홈에서 뜸).
// 팀=프로젝트 경로는 고정돼야 하므로 워크스페이스별 마지막 non-home cwd를 기억해 반환.
// 팀 path·세션 cwd(드로어)·커넥터 프로브·spawn --cwd가 모두 이 안정 경로를 공유.
// 역할 전용 cwd(F13 ops 등)도 pin 오염원 — 홈과 마찬가지로 승격 금지(_roleCwds).
const HOME = homedir().toLowerCase();
const normP = (p) => (p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
const _projectCwd = new Map(); // wsId -> 마지막 관측된 non-home cwd
export function stableCwd(wsId, liveCwd) {
  const c = liveCwd || '';
  if (c && c.toLowerCase() !== HOME && !_roleCwds.paths.has(normP(c))) { _projectCwd.set(wsId, c); return c; }
  return _projectCwd.get(wsId) || c;
}

// root/ 선언에서 역할 전용 cwd 수집(F13) — ① 드로어가 세션 실제 폴더(트랜스크립트·diff)를 읽고
// ② 그 폴더가 워크스페이스 cwd pin으로 승격되지 않도록. buildState마다 갱신(폴더=진실, 캐시 불필요).
// 부수로 역할 바인딩(r.agentId → 역할 id)도 수집 — reconcile이 채택(adopt)한 열려있는 세션은
// label이 역할명과 다르므로, 카드가 선언된 역할명으로 표시되려면 이 바인딩이 필요.
const _roleCwds = { paths: new Set(), byWs: new Map() }; // paths: norm cwd 전체, byWs: wsId -> (roleId -> 절대 cwd)
let _roleBind = new Map(); // agentId -> 역할 id (reconcile 스폰/채택이 team.json에 되쓴 것)
let _roleIdsByWs = new Map(); // wsId -> Set(선언된 역할 id) — FS-4 declared 배지(라벨 매칭분)
let _teamsMeta = [];          // 팀 선언 메타(FS-5·FS-8) — status·createdAt·closedAt·folder
let _teamMetaByWs = new Map();
function refreshRoleCwds() {
  const paths = new Set(); const byWs = new Map(); const bind = new Map();
  const idsByWs = new Map(); const metas = []; const metaByWs = new Map();
  try {
    for (const t of scanTeams()) {
      const meta = {
        id: t.id, folder: t._folder, name: t.name, workspaceId: t.workspaceId || null,
        status: t.status || 'active', createdAt: t.createdAt || null, closedAt: t.closedAt || null,
        createdAtEstimated: !!t.createdAtEstimated,
        path: (!t.projectPath || t.projectPath === '.') ? t._dir : t.projectPath,
      };
      metas.push(meta);
      if (t.workspaceId) metaByWs.set(t.workspaceId, meta);
      for (const r of (t.roles || [])) {
        if (!r) continue;
        if (t.workspaceId) {
          if (!idsByWs.has(t.workspaceId)) idsByWs.set(t.workspaceId, new Set());
          idsByWs.get(t.workspaceId).add(r.id);
        }
        if (r.agentId) bind.set(r.agentId, r.id);
        if (!r.cwd) continue;
        const abs = resolve(t._dir, r.cwd);
        paths.add(normP(abs));
        if (t.workspaceId) {
          if (!byWs.has(t.workspaceId)) byWs.set(t.workspaceId, new Map());
          byWs.get(t.workspaceId).set(r.id, abs);
        }
      }
    }
  } catch { /* root/ 없음 — 보정 생략 */ }
  _roleCwds.paths = paths; _roleCwds.byWs = byWs; _roleBind = bind;
  _roleIdsByWs = idsByWs; _teamsMeta = metas; _teamMetaByWs = metaByWs;
}
refreshRoleCwds();

// wmux 읽기는 getWmuxState 캐시 경유(TTL+single-flight) — 폴링당 5초 왕복을 압축.
export async function buildState({ forceConnectors = false } = {}) {
  await ensureLayer(); // FS-12 — claude 레이어 1회 로드(off면 no-op)
  const st = await getWmuxState();
  const { agents, live } = st;
  if (!live) {
    return { source: 'offline', live: false, teams: [], sessions: {}, ports: [], generatedAt: Date.now() };
  }
  // 드리프트 보정: 홈·역할 전용 cwd로 튄 cwd를 고정된 프로젝트 경로로 치환 후 하류 전체가 이를 사용.
  // cwdRaw(원시값)는 FS-2 진단용 — 세션 cwdSource(live/workspace-pin/role-cwd) 판정에 쓴다.
  refreshRoleCwds();
  const workspaces = (st.workspaces || []).map((w) => ({ ...w, cwdRaw: w.cwd, cwd: stableCwd(w.id, w.cwd) }));

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
      // 역할 전용 cwd(F13): 선언된 role.cwd로 스폰된 세션은 드로어도 그 폴더를 읽어야 함.
      const roleCwd = _roleCwds.byWs.get(w.id)?.get(a.label || a.role || a.name) || null;
      sessions[key] = mapAgent(a, w, roleCwd);
      return key;
    });
    const meta = _teamMetaByWs.get(w.id); // 팀 선언 메타(FS-5) — 선언 없는 워크스페이스는 필드 생략
    return {
      id: w.id,
      name: w.title || basename(w.cwd || '') || w.id,
      tag: basename(w.cwd || '') || '—',
      path: w.cwd || '',
      active: !!w.isActive,
      roles: roleKeys,
      conns: conn.byTeam[w.id]?.conns || [],   // git/env/node 프로브 (connectors 캐시)
      ports: conn.byTeam[w.id]?.ports || [],   // 이 팀에 귀속된 리스너
      ...(meta ? {
        folder: meta.folder, status: meta.status, createdAt: meta.createdAt,
        closedAt: meta.closedAt, createdAtEstimated: meta.createdAtEstimated,
      } : {}),
    };
  });

  // FS-8(U4) — 종료 팀은 워크스페이스가 없어도(그게 정상 상태) 목록에 실어 '종료됨' 섹션이 렌더되게.
  const wsIds = new Set(workspaces.map((w) => w.id));
  for (const m of _teamsMeta) {
    if (m.status !== 'closed' || (m.workspaceId && wsIds.has(m.workspaceId))) continue;
    teams.push({
      id: 'decl:' + m.folder, name: m.name, tag: m.folder, path: m.path, active: false,
      roles: [], conns: [], ports: [], folder: m.folder, status: 'closed',
      createdAt: m.createdAt, closedAt: m.closedAt, createdAtEstimated: m.createdAtEstimated,
    });
  }

  return { source: 'live', live: true, teams, sessions, ports: conn.globalPorts || [], generatedAt: Date.now() };
}

// wmux agent 실측 필드: agentId·label·cmd·status·paneId·workspaceId·spawnTime·pid·exitCode.
const agentIdOf = (a) => a.agentId || a.id;
const isDead = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());

// 상태 3분류(사용자 요구) — wmux status는 사실상 'running' 하나뿐이라 구분 불가 →
//   terminal: pane에 claude가 안 떠 있음(순수 터미널) — 프로세스 트리 실측(proc.js)이 진실.
//             스폰 cmd 추정은 실측 미상(콜드 스냅샷·비Windows)일 때의 폴백일 뿐.
//   ready:    Claude 실행중 · 명령 대기(턴 종료 후 조용 / 트랜스크립트 아직 없음)
//   working:  Claude 작업중(최근 기록 or 턴 미종료 — 툴 실행 대기 포함)
// ready/working은 트랜스크립트 활동으로 판별. waiting(승인/입력 요구)은 wmux가 명시할 때만.
const isClaudeCmd = (cmd) => /(^|[\\/\s"'])claude(\.\w+)?(["'\s]|$)/i.test(String(cmd || ''));
const ACTIVE_MS = 30_000;          // 최근 30s 내 트랜스크립트 갱신 = 작업중
const TURN_STALL_MS = 10 * 60_000; // 턴 미종료(마지막 이벤트≠text)면 10분까진 작업중(장시간 툴 허용)
function classifySt(a, act) {
  const state = (a.status || a.state || '').toLowerCase();
  if (/wait|approval|pending|input/.test(state)) return 'waiting';
  if (!_layer) return 'terminal'; // FS-12 — claude 레이어 off: wmux 실측만(terminal/waiting/exited)
  const alive = _layer.claudeAlive(pidOf(a));
  const on = alive === null ? isClaudeCmd(a.cmd) : alive; // 실측 우선 — 수동 실행/종료도 반영
  if (!on) return 'terminal';
  if (!act) return 'ready'; // 방금 뜬 claude — 첫 명령 대기
  const age = Date.now() - act.mtimeMs;
  if (age < ACTIVE_MS) return 'working';
  if (act.lastEvent && act.lastEvent !== 'text' && age < TURN_STALL_MS) return 'working';
  return 'ready';
}

// agent 객체 → 대시보드 세션 상세. roleCwd(F13) 지정 시 세션 cwd가 워크스페이스 cwd 대신 그 폴더.
const pidOf = (a) => a.pid || a.processId || null;
function mapAgent(a, w, roleCwd = null) {
  const aid = agentIdOf(a);
  const cwd = roleCwd || w.cwd || '';
  const act = _layer ? _layer.sessionActivity(cwd) : null;
  const st = classifySt(a, act);
  // "지금" 문구 — 터미널이면 셸 정보(▶ Claude 버튼 유도), claude면 최근 발화(트랜스크립트 실측).
  const now = st === 'terminal'
    ? `터미널 — ${a.cmd || 'shell'}${_layer ? ' (Claude 꺼짐)' : ''}`
    : (a.lastMessage || a.summary || act?.lastText || 'Claude 대기 — 첫 명령을 기다리는 중');
  const label = a.label || a.role || a.name;
  return {
    team: w.title || w.id,
    // 채택(adopt)된 세션은 label이 다르므로 선언 바인딩(_roleBind)이 우선 — 카드가 역할명으로 뜬다.
    role: _roleBind.get(aid) || a.role || a.label || a.name || a.title || aid,
    st,
    // FS-4 — 선언 여부(배지·선언 제거/추가 버튼): 바인딩 또는 라벨이 선언된 역할과 일치하면 선언됨.
    declared: _roleBind.has(aid) || !!_roleIdsByWs.get(w.id)?.has(label),
    // FS-2 진단 — 드로어가 읽는 cwd의 출처: 역할 전용(role-cwd) / pin 보정(workspace-pin) / 실측(live).
    cwdSource: roleCwd ? 'role-cwd' : (normP(w.cwd) === normP(w.cwdRaw ?? w.cwd) ? 'live' : 'workspace-pin'),
    now,
    model: a.model || '—',
    elapsed: a.elapsed || '—',
    cost: a.cost || '—',
    tokens: a.tokens || '0',
    tools: a.tools || 0,
    ws: w.id,
    cwd,
    pane: a.paneId || a.pane || '',
    surface: a.surfaceId || '', // send_text/send_key 타깃 — pane과 별개 네임스페이스(surf-*)
    agentId: aid,
    pid: pidOf(a),
    screen: `<span class="mut">agent ${aid}\ncmd: ${a.cmd || '—'}\nstatus: ${a.status || a.state || 'unknown'}\ncwd: ${cwd}</span>`,
    feed: [],
    files: [],
  };
}
