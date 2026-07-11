// 컨트롤 브리지 — teamctl serve (Tech.md §7, D14)
// Node 내장 http. 127.0.0.1 전용. 정적 대시보드 + JSON API를 같은 오리진에서 서빙(CORS 불필요).
// 보안(R8): 외부 인터페이스 바인드 금지 · X-Cockpit-Token 없으면 401 · wmux 명령 실행 주체이므로 로컬 전용.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildState, stableCwd } from '../core/state.js';
import { selectWorkspace, focusPane, killAgent, send, sendLine, spawnAgent, invalidateWmux, getWmuxState, getWmuxFresh, TERMINAL_CMD } from '../core/wmux.js';
import { readTranscript } from '../live/transcript.js';
import { invalidateProc, claudeAlive } from '../live/proc.js';
import { startHandover, handoverSnapshot } from '../core/handover.js';
import { changedFiles } from '../live/gitdiff.js';
import { getUsage } from '../live/usage.js';
import { buildPlan } from '../core/plan.js';
import { ensureScaffold, createTeam } from '../core/registry.js';
import { reconcile } from '../core/reconcile.js';
import { ensureWmux } from '../core/boot.js';

const DASHBOARD = fileURLToPath(new URL('../../../dashboard-triage.html', import.meta.url));
const CONFIG = fileURLToPath(new URL('../../workspace/config.json', import.meta.url));

function loadConfig(port) {
  let cfg = {};
  if (existsSync(CONFIG)) { try { cfg = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch {} }
  if (!cfg.token) cfg.token = randomBytes(24).toString('hex');
  if (port) cfg.port = port;
  if (!cfg.port) cfg.port = 7420;
  mkdirSync(dirname(CONFIG), { recursive: true });
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));
  return cfg;
}

const isDeadAgent = (a) => /exit|dead|stopped|killed|terminated/.test((a.status || a.state || '').toLowerCase());
const sendJson = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(b) });
  res.end(b);
};
const readBody = (req) => new Promise((resolve) => {
  let d = '';
  req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
});

export async function serve({ port } = {}) {
  const cfg = loadConfig(port);
  const TOKEN = cfg.token;
  ensureScaffold(); // root/.manager·.templates 뼈대 보장(없으면 생성)

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');

    // 정적 대시보드 — 토큰을 <head>에 주입 (페이지가 이후 API 호출에 사용). 인증 불필요.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      try {
        let html = await readFile(DASHBOARD, 'utf8');
        html = html.replace('<head>', `<head>\n<meta name="cockpit-token" content="${TOKEN}">`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (e) {
        res.writeHead(500); res.end('dashboard 로드 실패: ' + e.message);
      }
      return;
    }

    // API — 토큰 필수
    const isApi = pathname.startsWith('/api/') || ['/attach', '/kill', '/send', '/spawn', '/claude', '/handover', '/refresh', '/up', '/boot', '/open'].includes(pathname);
    if (isApi) {
      if (req.headers['x-cockpit-token'] !== TOKEN) return sendJson(res, 401, { error: 'unauthorized' });
      try {
        if (req.method === 'GET' && pathname === '/api/state') {
          const st = await buildState();
          const h = handoverSnapshot();
          if (h) st.handover = h; // 단체 핸드오버 진행상황 — 대시보드 배너
          return sendJson(res, 200, st);
        }
        if (req.method === 'GET' && pathname === '/api/plan') return sendJson(res, 200, await buildPlan()); // 폴더 선언 ⊕ wmux → 동기화 상태
        if (req.method === 'GET' && pathname === '/api/session') {
          // 온디맨드(드로어 열 때) — 트랜스크립트 tail + git diff. 폴링과 분리.
          const cwd = new URL(req.url, 'http://127.0.0.1').searchParams.get('cwd') || '';
          const tx = readTranscript(cwd);
          const files = await changedFiles(cwd);
          return sendJson(res, 200, { now: tx?.now || null, feed: tx?.feed || [], files, source: tx?.source || null });
        }
        if (req.method === 'POST' && pathname === '/refresh') {
          return sendJson(res, 200, await buildState({ forceConnectors: true })); // 커넥터 백그라운드 강제 갱신
        }
        if (req.method === 'GET' && pathname === '/api/usage') {
          // Claude 사용량(트랜스크립트 실측, 60s 캐시) — 대시보드 topbar 배지가 소비.
          return sendJson(res, 200, await getUsage());
        }
        if (req.method === 'POST' && pathname === '/open') {
          // 로컬 UX 브리지 — {path}: 탐색기로 폴더 열기 · {url}: 기본 브라우저로 http(s) URL.
          // 로컬 전용 서버 + 토큰 전제(R8). explorer.exe 는 URL도 기본 브라우저로 위임.
          const b = await readBody(req);
          if (b.path) {
            const p = normalize(String(b.path));
            let ok = false; try { ok = statSync(p).isDirectory(); } catch { /* 없음/접근불가 → 400 */ }
            if (!ok) return sendJson(res, 400, { error: '폴더를 찾을 수 없습니다: ' + p });
            spawn('explorer.exe', [p], { detached: true, stdio: 'ignore' }).unref();
            return sendJson(res, 200, { ok: true, opened: p });
          }
          if (b.url) {
            const u = String(b.url).trim();
            if (!/^https?:\/\/[^\s"']+$/i.test(u)) return sendJson(res, 400, { error: 'http(s) URL만 열 수 있습니다' });
            spawn('explorer.exe', [u], { detached: true, stdio: 'ignore' }).unref();
            return sendJson(res, 200, { ok: true, opened: u });
          }
          return sendJson(res, 400, { error: 'path 또는 url 필요' });
        }
        if (req.method === 'POST' && pathname === '/api/team') {
          // "＋ 새 팀" — {name, projectPath?} 입력 → root/<이름>/team.json 스캐폴드 생성.
          // 생성 직후 해당 팀만 reconcile해 워크스페이스까지 준비(wmux 오프라인이면 폴더만).
          const b = await readBody(req);
          let team;
          try { team = createTeam({ name: b.name, projectPath: b.projectPath }); }
          catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
          let up = null;
          try { up = await reconcile({ team: team.id }); invalidateWmux(); }
          catch { /* wmux 오프라인 — 폴더 선언만 남기고 다음 /up·/boot 때 수렴 */ }
          return sendJson(res, 200, { ok: true, team: { id: team.id, name: team.name, folder: team._folder }, up });
        }
        if (req.method === 'POST' && pathname === '/up') {
          const b = await readBody(req); // {team?, dry?} — 폴더→wmux reconcile (구성 뷰 ▶ Sync)
          const summary = await reconcile({ team: b.team, dryRun: !!b.dry });
          invalidateWmux(); // 생성/스폰된 것이 다음 상태 조회에 즉시 반영
          return sendJson(res, 200, { ok: true, ...summary });
        }
        if (req.method === 'POST' && pathname === '/boot') {
          // F12: 대시보드 오프라인 폴백의 "wmux 시작" — wmux 기동(띄우기만, 수명 소유 안 함) + 즉시 수렴.
          const w = await ensureWmux();
          const summary = await reconcile({});
          invalidateWmux();
          return sendJson(res, 200, { ok: true, wmux: w.action, ...summary });
        }
        if (req.method === 'POST' && pathname === '/attach') {
          const b = await readBody(req);
          if (b.ws) await selectWorkspace(b.ws);
          if (b.pane) await focusPane(b.pane);
          return sendJson(res, 200, { ok: true, ws: b.ws, pane: b.pane });
        }
        if (req.method === 'POST' && pathname === '/kill') {
          const b = await readBody(req);
          if (!b.agentId) return sendJson(res, 400, { error: 'agentId 필요' });
          await killAgent(b.agentId);
          invalidateWmux(); // 다음 상태 조회에 즉시 반영
          return sendJson(res, 200, { ok: true, agentId: b.agentId });
        }
        if (req.method === 'POST' && pathname === '/send') {
          const b = await readBody(req);
          // surface 지정 시 명시 타깃(권장 — 오발송 없음), 미지정은 구 동작(포커스 기반) 유지.
          if (b.surface) { await sendLine(b.text || '', b.surface); return sendJson(res, 200, { ok: true }); }
          if (b.pane) await focusPane(b.pane);
          await send(b.text || '');
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && pathname === '/spawn') {
          const b = await readBody(req);
          const ws = b.ws || b.workspaceId;
          // 중복 연결 방지 — 같은 팀(워크스페이스)에 같은 역할 라벨의 살아있는 세션이 이미 열려
          // 있으면 새로 스폰하지 않고 그 세션을 반환(adopted:true) → 대시보드가 기존 카드에 연결.
          const wantLabel = b.role || b.label;
          if (ws && wantLabel) {
            const st = await getWmuxFresh(); // 중복 판정은 신선한 상태로(방금 열린 세션 포함)
            const dup = (st.agents || []).find((a) => !isDeadAgent(a)
              && (a.workspaceId || a.workspace) === ws
              && (a.label || a.role || a.name) === wantLabel);
            if (dup) return sendJson(res, 200, { ok: true, adopted: true, agent: dup });
          }
          // cwd 미지정 시 대상 워크스페이스의 고정 프로젝트 cwd로 보정 — 안 하면 wmux가
          // 홈에 스폰돼 세션이 팀 경로와 분리되고 드로어(GET /api/session?cwd=)가 홈을 읽음.
          // stableCwd는 폴링으로 채워진 pin에서 드리프트 이전의 프로젝트 경로를 돌려줌.
          let cwd = b.cwd;
          if (!cwd && ws) {
            const st = await getWmuxState();
            const w = (st.workspaces || []).find((x) => x.id === ws);
            cwd = stableCwd(ws, w?.cwd) || undefined;
          }
          const agent = await spawnAgent({
            cmd: b.cmd || TERMINAL_CMD,             // 기본: 터미널로 시작 — claude는 ▶ 버튼(POST /claude)으로
            label: b.role || b.label,
            cwd,
            pane: b.pane,
            workspaceId: ws,
          });
          invalidateWmux(); // 스폰된 세션이 다음 상태 조회에 즉시 뜨도록
          return sendJson(res, 200, { ok: true, agent });
        }
        if (req.method === 'POST' && pathname === '/claude') {
          // 터미널 세션에서 claude 시작 — pane·세션을 유지한 채 셸 → claude 전환(▶ 버튼).
          // 전송은 surfaceId 명시 타깃(포커스 조작 없음 — 점프 없는 판단 원칙 유지).
          const b = await readBody(req);
          const st = await getWmuxFresh(); // 방금 스폰된 세션에 바로 ▶를 눌러도 조회되도록
          const a = (st.agents || []).find((x) => b.surface
            ? x.surfaceId === b.surface
            : (x.agentId || x.id) === b.agentId);
          const surface = b.surface || a?.surfaceId; // 구 클라이언트 보정: agentId로 surface 역조회
          if (!surface) return sendJson(res, 400, { error: 'surface(또는 agentId) 필요' });
          // 중복 방지 — pane에 claude가 이미 떠 있으면(프로세스 실측) 'claude' 텍스트가 실행 중인
          // 프롬프트에 사용자 메시지로 들어간다 → 전송 생략, 열려있는 세션에 그대로 연결(already:true).
          if (!b.cmd && a && claudeAlive(a.pid || a.processId) === true) {
            return sendJson(res, 200, { ok: true, already: true, surface });
          }
          await sendLine(b.cmd || 'claude', surface);
          invalidateProc(); invalidateWmux(); // 다음 폴링에 실측 상태(ready) 반영
          return sendJson(res, 200, { ok: true, surface });
        }
        if (req.method === 'POST' && pathname === '/handover') {
          // 단체 핸드오버: 모든 claude-on 세션 → handover.md 갱신 → /exit → 터미널 복귀(백그라운드).
          const b = await readBody(req);
          try { return sendJson(res, 200, { ok: true, job: await startHandover({ text: b.text }) }); }
          catch (e) { return sendJson(res, 409, { error: String(e.message || e) }); }
        }
        return sendJson(res, 404, { error: 'not found' });
      } catch (e) {
        return sendJson(res, 502, { error: 'wmux 실행 실패', detail: String(e.message || e) });
      }
    }

    res.writeHead(404); res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(cfg.port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${cfg.port}/`;
      console.log(`[teamctl] 컨트롤 브리지(D14) 기동 — ${url}`);
      console.log(`[teamctl] token ${TOKEN.slice(0, 8)}… · 127.0.0.1 전용 · X-Cockpit-Token`);
      console.log(`[teamctl] 브라우저 패널: wmux browser open ${url}`);
      buildState({ forceConnectors: true }).catch(() => {}); // 부팅 시 커넥터 캐시 워밍(논블로킹)
      resolve({ server, url, token: TOKEN, port: cfg.port });
    });
  });
}
