// HTTP 레이어(유일) — FS-3 + 전 엔드포인트(§8.4, 이 목록이 전부):
//   GET  / · /api/state · /api/log · /api/caps · /api/usage
//   POST /activate · /deactivate · /archive · /reopen · /create · /import · /roles
//        /claude · /attach · /open · /links
// 127.0.0.1 바인드 + X-Cockpit-Token(GET / 제외 전부, A-5). 어떤 프로브도 응답을 막지 않는다(§9-⑥).
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ROOT, readConfig, patchConfig, scanProjects, findProject, createProject, importProject, removeRole, writeProject } from './registry.js';
import { getState, getFresh, invalidate, selectWorkspace, focusPane, sendLine } from './wmux.js';
import { activate, deactivate, archive, reopen, matchWorkspace, agentsOfWs } from './lifecycle.js';
import { claudeAlive, claudeAliveFresh, invalidateProc } from './proc.js';
import { getPorts } from './ports.js';
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
  for (const p of projects) {
    const ws = state.live ? matchWorkspace(state, p) : null;
    const agents = ws ? agentsOfWs(state, ws.id) : [];
    // 세션 정렬 — ops 먼저, 이후 선언 역할 순서, 나머지는 실측 순(FS-5의 스폰 순서와 동형).
    const orderOf = (label) => label === 'ops' ? 0 : (() => {
      const i = (p.roles || []).findIndex((r) => r && r.id === label);
      return i === -1 ? 999 : i + 1;
    })();
    agents.sort((a, b) => orderOf(a.label) - orderOf(b.label));
    payloadProjects.push({
      name: p.name, status: p.status,
      createdAt: p.createdAt || null, archivedAt: p.archivedAt || null,
      links: p.links || [], roles: (p.roles || []).map((r) => ({ id: r.id })),
      wsLive: !!ws,
      sessions: agents.map((a) => {
        const alive = claudeAlive(a.pid);
        return { role: a.label || a.agentId, agentId: a.agentId, alive: true, claude: alive === true ? 'on' : alive === false ? 'off' : 'unknown' };
      }),
    });
    if (p.status === 'active') {
      portInfo.push({ name: p.name, dir: dirLc(p), pids: new Set(agents.map((a) => a.pid).filter(Boolean)) });
    }
  }
  return { projects: payloadProjects, ports: getPorts(portInfo) };
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
      r.already ? '이미 등록됨(멱등)' : r.inPlace ? '제자리 등록 — 이동 없이 스캐폴드·선언 적용' : `${b.path} → root/${r.project.name}/ 이동 · 대기중 등록`);
    return { ok: true, name: r.project.name, inPlace: r.inPlace, already: r.already };
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
  const PORT = port || cfg.port || 7421; // 개발 기본 7421(A-1) — 교체(W4) 시 7420 전환
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
