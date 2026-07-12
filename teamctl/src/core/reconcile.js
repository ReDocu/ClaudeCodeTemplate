// reconcile — 폴더 선언(desired)에 맞춰 wmux를 수렴시킨다 (teamctl up / POST /up).
// 원칙(§P2): ① 멱등(없는 것만 생성, 있으면 재사용) ② 부여된 id를 team.json에 되쓰기
//           ③ eager 워크스페이스·lazy 역할(autostart만 스폰) ④ drift는 표시만, 자동 종료 금지.
import { resolve } from 'node:path';
import { scanTeams, writeTeam, scaffoldRoleDir, claudeLayerEnabled } from './registry.js';
import { getWmuxFresh, createWorkspace, spawnAgent, invalidateWmux, terminalCmd, spawnDied } from './wmux.js';
import { buildPlan } from './plan.js';
import { stableCwd } from './state.js';

// claude 실측(claudeAlive)은 claude 레이어(FS-12) — off면 로드하지 않고 실측 미상(null) 취급.
// 미상은 compatibleCmd에서 보수적(불일치) 판정이라 off여도 안전(채택 대신 스폰).
let _claudeAlive = () => null, _layerTried = false;
async function ensureLayer() {
  if (_layerTried) return; _layerTried = true;
  if (!claudeLayerEnabled()) return;
  try { _claudeAlive = (await import('../live/proc.js')).claudeAlive; } catch { /* 미상 취급 */ }
}

const norm = (p) => (p || '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
const isDead = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());
const labelOf = (a) => a.label || a.role || a.name || '';
const agentIdOf = (a) => a.agentId || a.id;

// 중복 판정 — 열려있는 세션이 이 역할이 새로 스폰하려던 것과 "같은 일"인가 (스폰 cmd 계열 비교).
// 셸 역할: 아무 셸이든, 또는 claude가 켜진 pane(셸+claude = ▶ 버튼을 이미 누른 상태)이면 중복.
// claude 역할: cmd가 claude거나 프로세스 실측(claudeAlive)이 켜짐일 때만. 실측 미상(null)은 불일치 취급.
const SHELLS = new Set(['pwsh', 'powershell', 'cmd', 'bash', 'zsh', 'sh', 'fish', 'nu']);
const cmdKey = (cmd) => (String(cmd || '').trim().replace(/^["']/, '').split(/\s+/)[0] || '')
  .split(/[\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/i, '');
function compatibleCmd(a, wantCmd) {
  const want = cmdKey(wantCmd), have = cmdKey(a.cmd);
  if (want && want === have) return true;
  const claudeOn = have === 'claude' || _claudeAlive(a.pid || a.processId) === true;
  if (SHELLS.has(want)) return SHELLS.has(have) || claudeOn;
  if (want === 'claude') return claudeOn;
  return false;
}
const wsIdOf = (created) => created?.id || created?.workspaceId || created?.workspace?.id || created?.raw || null;
// projectPath "." = 팀 폴더 자체(co-located), 그 외 = 외부 절대경로.
const projectAbs = (t) => { const p = t.projectPath || '.'; return (!p || p === '.') ? t._dir : p; };

function matchWs(t, workspaces) {
  if (t.workspaceId && workspaces.some((w) => w.id === t.workspaceId)) return t.workspaceId;
  const pp = norm(t.projectPath);
  if (!pp || pp === '.') return null;
  const m = workspaces.find((w) => norm(stableCwd(w.id, w.cwd)) === pp || norm(w.cwd) === pp);
  return m ? m.id : null;
}

// scope: {team} 지정 시 그 팀만, 없으면 전체. dryRun: 변경 없이 계획만.
export async function reconcile({ team, dryRun = false } = {}) {
  await ensureLayer();
  const desired = scanTeams().filter((t) => !team || t.id === team || t._folder === team);
  const summary = { teams: [], drift: [], changed: 0, dryRun };

  for (const t of desired) {
    // FS-7(U2) — 종료 팀: 워크스페이스 생성·스폰·채택 전부 스킵. 조용히 생략하지 않고
    // closed-skip으로 표기(plan·대시보드가 "왜 안 만들었나"를 볼 수 있게).
    if ((t.status || 'active') === 'closed') {
      summary.teams.push({
        id: t.id, name: t.name, ws: null, status: 'closed',
        roles: (t.roles || []).map((r) => ({ id: r.id, action: 'closed-skip' })),
      });
      continue;
    }
    // 변이 결정은 신선한 상태로 — stale 캐시는 방금 열린 세션/워크스페이스를 못 보고 중복 생성한다.
    let { workspaces = [] } = await getWmuxFresh();
    let ws = matchWs(t, workspaces);
    const tRes = { id: t.id, name: t.name, ws: null, roles: [] };

    // ① 워크스페이스 보장 (eager)
    if (!ws) {
      if (dryRun) { tRes.ws = { action: 'would-create' }; }
      else {
        const created = await createWorkspace({ title: t.name, cwd: projectAbs(t) });
        ws = wsIdOf(created);
        tRes.ws = { action: 'created', id: ws }; summary.changed++;
        invalidateWmux();
      }
    } else {
      tRes.ws = { action: 'reused', id: ws };
    }
    // 되쓰기: 부여된 workspaceId
    if (!dryRun && ws && t.workspaceId !== ws) { t.workspaceId = ws; writeTeam(t._dir, t); }

    // ② autostart 역할 보장 (lazy — autostart만)
    let { agents = [] } = await getWmuxFresh();
    const wsAgents = ws ? agents.filter((a) => !isDead(a) && (a.workspaceId || a.workspace) === ws) : [];
    // 역할 매칭: ① label ② 되쓰기된 r.agentId(채택 세션은 label이 역할명과 다름) 순.
    // 어느 역할에도 안 잡힌 열려있는 세션이 스폰하려던 것과 중복이면 새로 스폰하지 않고 채택(adopt).
    const roleIds = new Set((t.roles || []).map((x) => x.id));
    const boundIds = new Set((t.roles || []).map((x) => x.agentId).filter(Boolean));
    const claimed = new Set(); // 이번 패스에서 역할이 점유한 agentId — 이중 채택 방지
    for (const r of (t.roles || [])) {
      const ex = wsAgents.find((a) => labelOf(a) === r.id)
        || (r.agentId && wsAgents.find((a) => agentIdOf(a) === r.agentId))
        || null;
      if (ex) claimed.add(agentIdOf(ex));
      if (!r.autostart) { tRes.roles.push({ id: r.id, action: 'manual-skip' }); continue; }
      if (ex) {
        tRes.roles.push({ id: r.id, action: 'reused', agentId: agentIdOf(ex) });
        if (!dryRun && r.agentId !== agentIdOf(ex)) { r.agentId = agentIdOf(ex); writeTeam(t._dir, t); }
        continue;
      }
      // 채택(adopt) — 역할 전용 cwd(F13 ops 등)는 열린 세션의 실제 폴더를 확인할 수 없어 제외.
      const open = !r.cwd && wsAgents.find((a) => {
        const aid = agentIdOf(a);
        return !claimed.has(aid) && !boundIds.has(aid) && !roleIds.has(labelOf(a))
          && compatibleCmd(a, r.cmd || terminalCmd());
      });
      if (open) {
        claimed.add(agentIdOf(open));
        if (dryRun) { tRes.roles.push({ id: r.id, action: 'would-adopt', agentId: agentIdOf(open) }); continue; }
        r.agentId = agentIdOf(open); writeTeam(t._dir, t); // 바인딩 되쓰기 — plan/state가 이 세션을 역할로 인식
        tRes.roles.push({ id: r.id, action: 'adopted', agentId: agentIdOf(open) });
        continue;
      }
      if (dryRun || !ws) { tRes.roles.push({ id: r.id, action: 'would-spawn' }); continue; }
      // role.cwd(F13) = 팀 폴더 기준 상대경로(예: ops의 'ops') — FS-9: 폴더 생성을 스캐폴드
      // (README·시크릿 .gitignore·역할 지침, 멱등)로 승격. 절대경로 선언은 생성만(파일 미주입).
      const cwd = r.cwd ? resolve(t._dir, r.cwd) : projectAbs(t);
      if (r.cwd) scaffoldRoleDir(t._dir, r.id, r.cwd);
      // 기본은 터미널 스폰 — claude는 대시보드 ▶ 버튼(POST /claude)으로 명시 시작. role.cmd 선언은 존중.
      const agent = await spawnAgent({ cmd: r.cmd || terminalCmd(), label: r.id, cwd, workspaceId: ws });
      const aid = agentIdOf(agent);
      invalidateWmux();
      // FS-1 — 즉사 감지: exited pane에 바인딩을 남기면 유령 역할이 된다 → 바인딩 생략, 다음 reconcile이 재시도.
      const dd = await spawnDied(aid);
      if (dd.died) {
        tRes.roles.push({ id: r.id, action: 'spawn-died', agentId: aid, cwd, exitCode: dd.exitCode });
        summary.changed++;
        continue;
      }
      r.agentId = aid; writeTeam(t._dir, t); // 바인딩 되쓰기
      // cwd를 결과에 실음(FS-2 진단) — 스폰 시 넘긴 경로 vs 실측 드리프트 대조용.
      tRes.roles.push({ id: r.id, action: 'spawned', agentId: aid, cwd }); summary.changed++;
    }
    summary.teams.push(tRes);
  }

  // drift(폴더에 없는 세션)는 plan에서 계산 — 표시만.
  try { summary.drift = (await buildPlan()).drift; } catch { /* noop */ }
  return summary;
}
