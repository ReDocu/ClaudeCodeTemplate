// HTTP 레이어(유일) — FS-3 + 전 엔드포인트(§8.4, 이 목록이 전부):
//   GET  / · /api/state · /api/log · /api/caps · /api/usage
//   POST /activate · /spawn · /kill-session · /deactivate · /archive · /reopen · /create · /import · /create-git · /roles
//        /claude · /attach · /open · /links · /git-remote · /adopt
// 127.0.0.1 바인드 + X-Cockpit-Token(GET / 제외 전부, A-5). 어떤 프로브도 응답을 막지 않는다(§9-⑥).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { ROOT, readConfig, patchConfig, scanProjects, findProject, createProject, importProject, removeRole, writeProject } from './registry.js';
import { getState, getFresh, invalidate, selectWorkspace, focusPane, sendLine } from './wmux.js';
import { activate, deactivate, archive, reopen, spawnRole, killSession, matchWorkspace, agentsOfWs } from './lifecycle.js';
import { claudeAlive, claudeAliveFresh, invalidateProc } from './proc.js';
import { getPorts } from './ports.js';
import { getGit, connectRemote, repoNameFromUrl } from './git.js';
import { getActivity } from './activity.js';
import { globalCaps, sessionCaps } from './caps.js';
import { getUsage } from './usage.js';
import { logEvent, readLog } from './log.js';

const DASHBOARD = fileURLToPath(new URL('../dashboard.html', import.meta.url));
const err = (status, code) => Object.assign(new Error(code), { status });

// 프로젝트 선언 ⊕ wmux 실측 병합 — GET /api/state 페이로드(FS-3-2).
// claude 실측은 proc 캐시 값만(true→on·false→off·null→unknown) — 응답 비차단.
function buildState(state) {
  const { projects, errors } = scanProjects();
  reportScanErrors(errors);
  const dirLc = (p) => (p._dir || '').toLowerCase();
  const payloadProjects = [];
  const portInfo = [];
  const linkedWs = new Set(); // 프로젝트에 매칭된 workspace id — 나머지는 '미연결'로 분류
  for (const p of projects) {
    const ws = state.live ? matchWorkspace(state, p) : null;
    if (ws) linkedWs.add(ws.id);
    const agents = ws ? agentsOfWs(state, ws.id) : [];
    // 세션→역할 해석: 채택 매핑(adopted[agentId]) 우선, 없으면 label. 선언 역할이면 connected.
    const declaredRoles = new Set(['ops', ...(p.roles || []).map((r) => r.id)]);
    const adopted = p.adopted || {};
    const resolveRole = (a) => adopted[a.agentId] || a.label;
    // 세션 정렬 — ops 먼저, 이후 선언 역할 순서, 미연결(orphan)은 뒤(FS-5의 스폰 순서와 동형).
    const orderOf = (a) => { const role = resolveRole(a); return role === 'ops' ? 0 : (() => {
      const i = (p.roles || []).findIndex((r) => r && r.id === role);
      return i === -1 ? 999 : i + 1;
    })(); };
    agents.sort((a, b) => orderOf(a) - orderOf(b));
    payloadProjects.push({
      name: p.name, status: p.status,
      createdAt: p.createdAt || null, archivedAt: p.archivedAt || null,
      links: p.links || [], roles: (p.roles || []).map((r) => ({ id: r.id })),
      // git 칩은 ops(코드베이스) 기준 — ops가 저장소면 ops, 아니면 프로젝트 루트로 폴백(레거시 호환).
      wsLive: !!ws, git: getGit(existsSync(join(p._dir, 'ops', '.git')) ? join(p._dir, 'ops') : p._dir),
      sessions: agents.map((a) => {
        const alive = claudeAlive(a.pid);
        const adoptedRole = adopted[a.agentId];
        const connected = !!adoptedRole || declaredRoles.has(a.label); // 선언 역할 label 일치 또는 채택됨
        const role = adoptedRole || a.label || a.agentId;
        return { role, agentId: a.agentId, alive: true,
          connected, adopted: !!adoptedRole, claude: alive === true ? 'on' : alive === false ? 'off' : 'unknown',
          // 활동 상태(FS-훅): claude 실행 중일 때만 의미 — 훅이 쓴 상태 파일 실측(없으면 null).
          activity: alive === true ? getActivity(p._folder, role) : null };
      }),
    });
    if (p.status === 'active') {
      portInfo.push({ name: p.name, dir: dirLc(p), pids: new Set(agents.map((a) => a.pid).filter(Boolean)) });
    }
  }
  // 프로젝트에 연결되지 않은 wmux workspace(직접 연 외부 세션) — 연결 여부 구분용(FS-3-2 보강).
  const unlinked = [];
  if (state.live) {
    for (const w of state.workspaces) {
      if (linkedWs.has(w.id)) continue;
      const agents = agentsOfWs(state, w.id);
      unlinked.push({
        wsId: w.id, title: w.title || '(제목 없음)',
        sessions: agents.map((a) => {
          const alive = claudeAlive(a.pid);
          return { role: a.label || a.agentId, agentId: a.agentId, claude: alive === true ? 'on' : alive === false ? 'off' : 'unknown' };
        }),
      });
    }
  }
  return { projects: payloadProjects, unlinked, ports: getPorts(portInfo) };
}

// 스캔 에러(깨진 project.json)는 변화가 있을 때만 1회 기록 — 폴링 스팸 방지.
let _lastScanErr = '';
function reportScanErrors(errors) {
  const key = errors.map((e) => e.name).sort().join(',');
  if (key === _lastScanErr) return;
  _lastScanErr = key;
  for (const e of errors) logEvent('error', e.name, 'scan', `project.json 파싱 실패 — ${e.message}`);
}

function requireProject(name) {
  const p = findProject(name);
  if (!p) throw err(404, 'unknown-project');
  return p;
}

async function findAgent(agentId, fresh = false) {
  const state = fresh ? await getFresh() : await getState();
  const a = state.agents.find((x) => x.agentId === agentId);
  if (!a) throw err(404, 'unknown-agent');
  return a;
}

// ── 라우트 ──
const routes = {
  'GET /api/state': async () => buildState(await getState()),
  'GET /api/log': async (_b, q) => ({ events: readLog({ project: q.get('project') || undefined, limit: Math.min(100, Number(q.get('limit')) || 20) }) }),
  'GET /api/usage': async () => getUsage(),
  'GET /api/caps': async (_b, q) => {
    const project = q.get('project'), role = q.get('role');
    if (!project) return { global: globalCaps() };
    const p = requireProject(project);
    return sessionCaps(p._dir, role ? join(p._dir, role) : null);
  },

  'POST /activate': async (b) => activate(b.name),
  'POST /spawn': async (b) => spawnRole(b.name, b.role), // role 지정=개별([＋ 세션 활성화]) · 생략=전체 수렴
  'POST /kill-session': async (b) => killSession(b.name, b.agentId), // 개별 비활성화(세밀 kill — 대시보드가 claude 실행 중이면 확인)
  'POST /deactivate': async (b) => {
    if (b.confirm !== true) throw err(400, 'confirm-required'); // §9-3 — kill은 항상 확인 경유
    return deactivate(b.name);
  },
  'POST /archive': async (b) => archive(b.name),
  'POST /reopen': async (b) => reopen(b.name),

  'POST /create': async (b) => {
    const r = createProject({ name: b.name, roles: b.roles || [] });
    logEvent('info', r.project.name, 'create',
      r.created ? `격리 스캐폴드 생성 · 역할 ${r.added.length}개 · 대기중 등록`
        : `역할 병합 — 추가 ${r.added.length ? r.added.join('·') : '없음(멱등)'}`);
    return { ok: true, created: r.created, added: r.added };
  },
  'POST /import': async (b) => {
    const r = importProject({ path: b.path, name: b.name });
    logEvent('info', r.project.name, 'import',
      r.already ? '이미 등록됨(멱등)' : r.inPlace ? '제자리 등록 — 이동 없이 스캐폴드·선언 적용'
        : `${b.path} → root/${r.project.name}/ops/ 이동${r.backup ? ` · 기존 ops 백업 ${basename(r.backup)}` : ''} · 대기중 등록`);
    return { ok: true, name: r.project.name, inPlace: r.inPlace, already: r.already, backup: r.backup ? basename(r.backup) : null };
  },
  'POST /create-git': async (b) => {
    // git URL 하나로 프로젝트 생성 — 스캐폴드(createProject) ⊕ ops에 clone(connectRemote) 합성.
    const url = String(b.url || '').trim().replace(/^["']|["']$/g, '');
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(url)) throw err(400, 'git-url-invalid'); // git URL 형태만
    const name = String(b.name || '').trim() || repoNameFromUrl(url);
    if (!name) throw err(400, 'name-underivable'); // URL에서 이름을 못 뽑음 — 이름 직접 입력 필요
    const r = createProject({ name });             // 격리 스캐폴드 생성(멱등 — project.json 있으면 재사용)
    const opsDir = join(r.project._dir, 'ops');
    mkdirSync(opsDir, { recursive: true });
    const g = await connectRemote(opsDir, url);    // ops에 clone(스켈레톤은 교체, 실내용은 백업 후) — clone 실패는 여기서 throw
    logEvent('info', r.project.name, 'create-git',
      `git ${g.action === 'cloned' ? 'clone' : '원격 갱신'} → root/${r.project.name}/ops/`
      + (g.backup ? ` · 기존 ops 백업 ${basename(g.backup)}` : '') + (r.created ? ' · 대기중 등록' : ' · 기존 프로젝트 재사용') + ` — ${url}`);
    return { ok: true, name: r.project.name, created: r.created, action: g.action, backup: g.backup ? basename(g.backup) : null, git: g.git };
  },
  'POST /roles': async (b) => {
    if (b.action !== 'remove') throw err(400, 'unknown-action'); // 추가는 POST /create 병합 경로
    const p = requireProject(b.name);
    // 살아있는 세션 가드(FS-8-3) — 그 역할의 세션이 떠 있으면 409(비활성화/정리 후).
    const state = await getFresh();
    const ws = state.live ? matchWorkspace(state, p) : null;
    if (ws && agentsOfWs(state, ws.id).some((a) => a.label === b.role)) throw err(409, 'role-alive');
    const r = removeRole(b.name, b.role);
    if (r.removed) logEvent('info', p.name, 'roles', `역할 제거 — ${b.role} (선언만, 폴더 보존)`);
    return { ok: true, removed: r.removed };
  },

  'POST /claude': async (b) => {
    const a = await findAgent(b.agentId, true);
    const alive = await claudeAliveFresh(a.pid); // fresh 실측 — 이미 on이면 재전송 생략(§9-①)
    if (alive === true) return { ok: true, already: true };
    if (!a.surfaceId) throw err(502, 'no-surface');
    await sendLine('claude', a.surfaceId);
    invalidateProc();
    const proj = scanProjects().projects.find((p) => p.wsId === a.workspaceId);
    logEvent('info', proj?.name || null, 'claude', `${a.label || a.agentId} 세션에 claude 기동 전송`);
    return { ok: true };
  },
  'POST /attach': async (b) => {
    const a = await findAgent(b.agentId);
    if (a.workspaceId) await selectWorkspace(a.workspaceId);
    if (a.paneId) { try { await focusPane(a.paneId); } catch { /* pane 포커스 실패 — ws 전환까지는 성공 */ } }
    return { ok: true };
  },
  'POST /open': async (b) => {
    const p = requireProject(b.name);
    const dir = b.role ? join(p._dir, String(b.role)) : p._dir;
    if (!dir.toLowerCase().startsWith(ROOT.toLowerCase()) || !existsSync(dir)) throw err(400, 'bad-path');
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  },
  'POST /adopt': async (b) => {
    // 미연결 세션(wmux 자동 첫 pane 등)을 빈 선언 역할에 바인딩 — adopted[agentId]=role 저장.
    const p = requireProject(b.name);
    const role = String(b.role || '').trim();
    const agentId = String(b.agentId || '').trim();
    if (!agentId) throw err(400, 'agentId-required');
    if (!new Set(['ops', ...(p.roles || []).map((r) => r.id)]).has(role)) throw err(400, 'unknown-role');
    const state = await getFresh();
    if (!state.live) throw err(503, 'wmux-offline');
    const ws = matchWorkspace(state, p);
    if (!ws) throw err(409, 'project-inactive');
    const wsAgents = agentsOfWs(state, ws.id);
    if (!wsAgents.some((a) => a.agentId === agentId)) throw err(404, 'agent-not-in-workspace'); // 이 프로젝트 workspace의 세션만
    const adopted = p.adopted || {};
    // 역할이 이미 살아있는 다른 세션(label 일치 또는 다른 채택)으로 차 있으면 거부(이중 바인딩 방지).
    if (wsAgents.some((a) => a.agentId !== agentId && (a.label === role || adopted[a.agentId] === role))) throw err(409, 'role-filled');
    p.adopted = { ...adopted, [agentId]: role };
    writeProject(p);
    logEvent('info', p.name, 'adopt', `세션 ${agentId} → 역할 ${role} 채택 (동기화)`);
    return { ok: true, agentId, role };
  },
  'POST /git-remote': async (b) => {
    const p = requireProject(b.name);
    const url = String(b.url || '').trim().replace(/^["']|["']$/g, '');
    if (!/^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(url)) throw err(400, 'git-url-invalid'); // git URL 형태만
    const opsDir = join(p._dir, 'ops');
    mkdirSync(opsDir, { recursive: true });
    const r = await connectRemote(opsDir, url); // ops에 clone(또는 기존 저장소면 원격 갱신) — 백업 후 진행
    logEvent('info', p.name, 'git', `ops 원격 ${r.action === 'cloned' ? 'clone' : '갱신'}${r.backup ? ` · 기존 ops 백업 ${basename(r.backup)}` : ''} — ${url}`);
    return { ok: true, action: r.action, backup: r.backup ? basename(r.backup) : null, git: r.git };
  },
  'POST /links': async (b) => {
    const p = requireProject(b.name);
    p.links = p.links || [];
    if (b.action === 'add') {
      if (!/^https?:\/\//.test(String(b.url || ''))) throw err(400, 'http-only'); // FS-11 — http(s)만
      p.links.push({ label: String(b.label || b.url).slice(0, 60), url: String(b.url) });
    } else if (b.action === 'remove') {
      p.links = p.links.filter((l) => !(l.label === b.label && (!b.url || l.url === b.url)));
    } else throw err(400, 'unknown-action');
    writeProject(p);
    return { ok: true, links: p.links };
  },
};

function readBody(req) {
  return new Promise((resolveP, rejectP) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { rejectP(err(413, 'body-too-large')); req.destroy(); } });
    req.on('end', () => {
      if (!data) return resolveP({});
      try { resolveP(JSON.parse(data)); } catch { rejectP(err(400, 'bad-json')); }
    });
    req.on('error', rejectP);
  });
}

export async function serve({ port } = {}) {
  const cfg = readConfig();
  const PORT = port || cfg.port || 7420; // 기본 7420 (W4 교체 완료 — teamctl 폐기, cockpit이 7420 정본)
  const token = cfg.token || randomBytes(24).toString('hex');
  patchConfig({ port: PORT, token });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        // 대시보드 서빙 — 토큰을 <head>에 주입(same-origin fetch 인증, 계승 기전)
        const html = readFileSync(DASHBOARD, 'utf8')
          .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta name="cockpit-token" content="${token}">`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (url.pathname === '/favicon.ico') { res.writeHead(404); return res.end(); }
      if ((req.headers['x-cockpit-token'] || '') !== token) return send(401, { error: 'unauthorized' });

      const handler = routes[`${req.method} ${url.pathname}`];
      if (!handler) return send(404, { error: 'not-found' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handler(body, url.searchParams);
      return send(200, result || { ok: true });
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) logEvent('error', null, 'server', `${req.method} ${url.pathname} — ${e.message}`);
      return send(status, { error: e.message || 'internal-error' });
    }
  });

  await new Promise((resolveP, rejectP) => {
    server.on('error', rejectP);
    server.listen(PORT, '127.0.0.1', resolveP);
  });

  const n = scanProjects().projects.length;
  console.log(`[cockpit] 서버 가동 — http://127.0.0.1:${PORT}/  (127.0.0.1 전용 — 방화벽 허용 불필요)`);
  console.log(`[cockpit] root: ${ROOT}  · 프로젝트 ${n}개 · 토큰: workspace/config.json`);
  console.log('[cockpit] 이 창이 서버 콘솔입니다 — 오류가 여기 표시됩니다. 창을 닫으면 대시보드가 offline이 됩니다.');
  return { server, port: PORT, token };
}
