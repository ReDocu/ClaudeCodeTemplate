// 컨트롤 브리지 — teamctl serve (Tech.md §7, D14)
// Node 내장 http. 127.0.0.1 전용. 정적 대시보드 + JSON API를 같은 오리진에서 서빙(CORS 불필요).
// 보안(R8): 외부 인터페이스 바인드 금지 · X-Cockpit-Token 없으면 401 · wmux 명령 실행 주체이므로 로컬 전용.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildState, stableCwd } from '../core/state.js';
import { selectWorkspace, focusPane, killAgent, send, spawnAgent, invalidateWmux, getWmuxState } from '../core/wmux.js';
import { readTranscript } from '../live/transcript.js';
import { changedFiles } from '../live/gitdiff.js';

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
    const isApi = pathname.startsWith('/api/') || ['/attach', '/kill', '/send', '/spawn', '/refresh'].includes(pathname);
    if (isApi) {
      if (req.headers['x-cockpit-token'] !== TOKEN) return sendJson(res, 401, { error: 'unauthorized' });
      try {
        if (req.method === 'GET' && pathname === '/api/state') return sendJson(res, 200, await buildState());
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
          if (b.pane) await focusPane(b.pane);
          await send(b.text || '');
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'POST' && pathname === '/spawn') {
          const b = await readBody(req);
          const ws = b.ws || b.workspaceId;
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
            cmd: b.cmd || 'claude',                 // 기본: claude 역할 세션
            label: b.role || b.label,
            cwd,
            pane: b.pane,
            workspaceId: ws,
          });
          invalidateWmux(); // 스폰된 세션이 다음 상태 조회에 즉시 뜨도록
          return sendJson(res, 200, { ok: true, agent });
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
