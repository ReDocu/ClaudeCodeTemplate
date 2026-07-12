// 컨트롤 브리지 — teamctl serve (Tech.md §7, D14)
// Node 내장 http. 127.0.0.1 전용. 정적 대시보드 + JSON API를 같은 오리진에서 서빙(CORS 불필요).
// 보안(R8): 외부 인터페이스 바인드 금지 · X-Cockpit-Token 없으면 401 · wmux 명령 실행 주체이므로 로컬 전용.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, normalize, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildState, stableCwd } from '../core/state.js';
import { selectWorkspace, focusPane, killAgent, send, sendLine, spawnAgent, invalidateWmux, getWmuxState, getWmuxFresh, terminalCmd, spawnDied } from '../core/wmux.js';
import { changedFiles } from '../live/gitdiff.js';
import { buildPlan } from '../core/plan.js';
import { ensureScaffold, scanTeams, declareRole, undeclareRole, setTeamStatus, scaffoldRoleDir } from '../core/registry.js';
import { reconcile } from '../core/reconcile.js';
import { ensureWmux } from '../core/boot.js';
// claude 레이어 모듈(transcript·proc·usage·handover)은 정적 import 금지(FS-12 경계 규율) —
// serve()가 config.claudeLayer를 보고 동적 로드한다. off면 로드 자체가 없다.

const DASHBOARD = fileURLToPath(new URL('../../../dashboard-triage.html', import.meta.url));
const CONFIG = fileURLToPath(new URL('../../workspace/config.json', import.meta.url));

function loadConfig(port) {
  let cfg = {};
  if (existsSync(CONFIG)) { try { cfg = JSON.parse(readFileSync(CONFIG, 'utf8')); } catch {} }
  if (!cfg.token) cfg.token = randomBytes(24).toString('hex');
  if (port) cfg.port = port;
  if (!cfg.port) cfg.port = 7420;
  if (cfg.claudeLayer === undefined) cfg.claudeLayer = true; // FS-12 — claude 레이어 스위치(릴리스판은 false)
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

  // FS-12(PRD §2) — claude 레이어: off면 모듈 로드 자체를 생략(코어 = 순수 wmux 관제로 완결).
  // 게이트: /claude·/handover·/api/usage → 404, /api/session → git 파트만, 대시보드 → 레이어 UI 미렌더.
  let layer = null;
  if (cfg.claudeLayer !== false) {
    try {
      layer = {
        ...(await import('../live/transcript.js')),
        ...(await import('../live/proc.js')),
        ...(await import('../core/handover.js')),
        ...(await import('../live/usage.js')),
      };
    } catch (e) { console.warn('[teamctl] claude 레이어 로드 실패 — 코어만 서빙:', String(e.message || e)); }
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://127.0.0.1');

    // 정적 대시보드 — 토큰을 <head>에 주입 (페이지가 이후 API 호출에 사용). 인증 불필요.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      try {
        let html = await readFile(DASHBOARD, 'utf8');
        html = html.replace('<head>', `<head>\n<meta name="cockpit-token" content="${TOKEN}">\n<meta name="cockpit-claude-layer" content="${layer ? 'on' : 'off'}">`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } catch (e) {
        res.writeHead(500); res.end('dashboard 로드 실패: ' + e.message);
      }
      return;
    }

    // API — 토큰 필수
    const isApi = pathname.startsWith('/api/') || ['/attach', '/kill', '/send', '/spawn', '/claude', '/handover', '/refresh', '/up', '/boot', '/open', '/declare', '/team-close', '/team-reopen'].includes(pathname);
    if (isApi) {
      if (req.headers['x-cockpit-token'] !== TOKEN) return sendJson(res, 401, { error: 'unauthorized' });
      try {
        if (req.method === 'GET' && pathname === '/api/state') {
          const st = await buildState();
          if (layer) { const h = layer.handoverSnapshot(); if (h) st.handover = h; } // 단체 핸드오버 진행상황 — 대시보드 배너
          return sendJson(res, 200, st);
        }
        if (req.method === 'GET' && pathname === '/api/plan') return sendJson(res, 200, await buildPlan()); // 폴더 선언 ⊕ wmux → 동기화 상태
        if (req.method === 'GET' && pathname === '/api/session') {
          // 온디맨드(드로어 열 때) — 트랜스크립트 tail + git diff. 폴링과 분리.
          // claude 레이어 off면 트랜스크립트 파트 제외, git 파트만(FS-12 — source:'git-only').
          const cwd = new URL(req.url, 'http://127.0.0.1').searchParams.get('cwd') || '';
          const tx = layer ? layer.readTranscript(cwd) : null;
          const files = await changedFiles(cwd);
          return sendJson(res, 200, { now: tx?.now || null, feed: tx?.feed || [], files, source: layer ? (tx?.source || null) : 'git-only' });
        }
        if (req.method === 'POST' && pathname === '/refresh') {
          return sendJson(res, 200, await buildState({ forceConnectors: true })); // 커넥터 백그라운드 강제 갱신
        }
        if (req.method === 'GET' && pathname === '/api/usage') {
          // Claude 사용량(트랜스크립트 실측, 60s 캐시) — 대시보드 topbar 배지가 소비. 레이어 off면 404.
          if (!layer) return sendJson(res, 404, { error: 'claude-layer-disabled' });
          return sendJson(res, 200, await layer.getUsage());
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
        // 팀 생성 엔드포인트(POST /api/team)는 제거 — 팀 추가는 root/<팀>/ 폴더 선언이 유일한 경로.
        // 대시보드는 "저장된 팀 연결"(POST /up)로 선언↔wmux 수렴만 트리거한다.
        if (req.method === 'POST' && pathname === '/up') {
          const b = await readBody(req); // {team?, dry?} — 폴더→wmux reconcile ("저장된 팀 연결")
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
          const roleId = b.role || b.label;
          // 팀 선언 1회 조회 — closed 게이트(FS-7)·바인딩 판정(FS-3)·선언 등재(FS-4)·역할 폴더(FS-9)가 공유.
          const team = ws ? scanTeams().find((t) => t.workspaceId === ws) : null;
          if (team && (team.status || 'active') === 'closed') {
            return sendJson(res, 409, { error: 'team-closed', detail: '종료된 프로젝트 — 재개(reopen) 후 스폰하세요' });
          }
          // 중복 연결 방지(FS-3) — 판정 2순위: ① label=역할명 ② team.json의 r.agentId 바인딩
          // (채택된 세션은 label≠역할명이라 라벨 매칭에 안 잡히던 B1 엣지를 바인딩이 커버).
          // 스폰으로 진행한 경우 checked에 후보별 배제 사유를 실어 재발 시 원인을 즉시 특정.
          const checked = [];
          if (ws && roleId) {
            const st = await getWmuxFresh(); // 중복 판정은 신선한 상태로(방금 열린 세션 포함)
            const boundId = team?.roles?.find((r) => r && r.id === roleId)?.agentId || null;
            let dup = null, via = null;
            for (const a of (st.agents || []).filter((x) => (x.workspaceId || x.workspace) === ws)) {
              const aid = a.agentId || a.id;
              if (isDeadAgent(a)) { checked.push({ agentId: aid, reason: 'dead' }); continue; }
              if ((a.label || a.role || a.name) === roleId) { dup = a; via = 'label'; break; }
              if (boundId && aid === boundId) { dup = a; via = 'binding'; break; }
              checked.push({ agentId: aid, reason: 'label-mismatch' });
            }
            if (dup) {
              // 채택도 등재 대상(FS-4) — 바인딩 되쓰기로 다음 판정·plan 매칭이 안정화.
              const decl = b.declare === false ? { declared: false, reason: 'declare-off' }
                : declareRole(team, roleId, dup.agentId || dup.id);
              return sendJson(res, 200, { ok: true, adopted: true, via, agent: dup, ...decl });
            }
          }
          // 작업 폴더 직접 지정(b.cwd) — 없으면 생성, 있으면 그대로 연결(멱등). 상대경로는 팀 폴더 기준.
          // FS-9 규약 공유: 팀 내부 상대경로는 스캐폴드(README·.gitignore), 절대경로는 생성만(외부 프로젝트에 파일 미주입).
          let cwd = null, declCwd = null, cwdCreated = false;
          if (b.cwd) {
            const raw = String(b.cwd).trim();
            const target = team ? resolve(team._dir, raw) : resolve(raw);
            cwdCreated = !existsSync(target);
            try { cwd = (team && roleId) ? scaffoldRoleDir(team._dir, roleId, raw) : (mkdirSync(target, { recursive: true }), target); }
            catch (e) { return sendJson(res, 400, { error: '작업 폴더 준비 실패 — ' + String(e.message || e) }); }
            declCwd = raw; // 선언에 되쓰기(FS-4) — 재시작 후 reconcile이 같은 폴더로 복원
          }
          // FS-9(U5) — 역할 폴더 옵션: root/<팀>/<역할id>/ 스캐폴드 후 그 폴더를 cwd로.
          if (!cwd && b.roleDir && team && roleId) {
            try { cwd = scaffoldRoleDir(team._dir, roleId); declCwd = roleId; }
            catch { /* 폴더 생성 실패 — 기본 cwd 보정으로 폴백 */ }
          }
          // cwd 미지정 시 대상 워크스페이스의 고정 프로젝트 cwd로 보정 — 안 하면 wmux가
          // 홈에 스폰돼 세션이 팀 경로와 분리되고 드로어(GET /api/session?cwd=)가 홈을 읽음.
          // stableCwd는 폴링으로 채워진 pin에서 드리프트 이전의 프로젝트 경로를 돌려줌.
          if (!cwd && ws) {
            const st = await getWmuxState();
            const w = (st.workspaces || []).find((x) => x.id === ws);
            cwd = stableCwd(ws, w?.cwd) || undefined;
          }
          const agent = await spawnAgent({
            cmd: b.cmd || terminalCmd(),            // 기본: 터미널로 시작 — claude는 ▶ 버튼(POST /claude)으로
            label: roleId,
            cwd,
            pane: b.pane,
            workspaceId: ws,
          });
          invalidateWmux(); // 스폰된 세션이 다음 상태 조회에 즉시 뜨도록
          const aid = agent.agentId || agent.id;
          // FS-4(B4) — 선언 등재(기본 on): 재시작 후 reconcile이 이 역할을 복원한다(영구 drift 해소).
          const decl = b.declare === false ? { declared: false, reason: 'declare-off' }
            : declareRole(team, roleId, aid, declCwd ? { cwd: declCwd } : {});
          // FS-1(B2) — 즉사 감지: 조용한 유령 pane 대신 에러를 표면화(셸 오설정 진단).
          const dd = await spawnDied(aid);
          if (dd.died) invalidateWmux();
          return sendJson(res, 200, {
            ok: true, agent, checked, ...decl,
            ...(b.cwd ? { cwd, cwdCreated } : {}),
            ...(dd.died ? { died: true, exitCode: dd.exitCode } : {}),
          });
        }
        if (req.method === 'POST' && pathname === '/declare') {
          // FS-4 — 세션 ↔ 팀 선언: add(등재·바인딩) / remove(선언 해제 — 세션은 건드리지 않음, drift로 전환).
          const b = await readBody(req);
          try {
            const key = b.team || b.ws;
            if (b.action === 'remove') return sendJson(res, 200, { ok: true, ...undeclareRole(key, b.role) });
            const t = scanTeams().find((x) => x.id === key || x._folder === key || x.workspaceId === key);
            return sendJson(res, 200, { ok: true, ...declareRole(t, b.role, b.agentId) });
          } catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
        }
        if (req.method === 'POST' && pathname === '/team-close') {
          // FS-6(U1) — 종료 처리: 상태·closedAt만 기록. 세션 자동 종료 금지(일괄 kill은 대시보드
          // 확인 다이얼로그가 명시 체크 시 /kill을 개별 호출). 되돌리기 = /team-reopen.
          const b = await readBody(req);
          try { return sendJson(res, 200, { ok: true, ...setTeamStatus(b.team || b.ws, 'closed') }); }
          catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
        }
        if (req.method === 'POST' && pathname === '/team-reopen') {
          const b = await readBody(req);
          try { return sendJson(res, 200, { ok: true, ...setTeamStatus(b.team || b.ws, 'active') }); }
          catch (e) { return sendJson(res, 400, { error: String(e.message || e) }); }
        }
        if (req.method === 'POST' && pathname === '/claude') {
          // 터미널 세션에서 claude 시작 — pane·세션을 유지한 채 셸 → claude 전환(▶ 버튼).
          // 전송은 surfaceId 명시 타깃(포커스 조작 없음 — 점프 없는 판단 원칙 유지). claude 레이어 전용(FS-12).
          if (!layer) return sendJson(res, 404, { error: 'claude-layer-disabled' });
          const b = await readBody(req);
          const st = await getWmuxFresh(); // 방금 스폰된 세션에 바로 ▶를 눌러도 조회되도록
          const a = (st.agents || []).find((x) => b.surface
            ? x.surfaceId === b.surface
            : (x.agentId || x.id) === b.agentId);
          // FS-7 — 종료 팀 게이트(행동만 차단, 관찰은 허용)
          const aws = a && (a.workspaceId || a.workspace);
          if (aws) {
            const t = scanTeams().find((x) => x.workspaceId === aws);
            if (t && (t.status || 'active') === 'closed') return sendJson(res, 409, { error: 'team-closed' });
          }
          const surface = b.surface || a?.surfaceId; // 구 클라이언트 보정: agentId로 surface 역조회
          if (!surface) return sendJson(res, 400, { error: 'surface(또는 agentId) 필요' });
          // 중복 방지 — pane에 claude가 이미 떠 있으면(프로세스 실측) 'claude' 텍스트가 실행 중인
          // 프롬프트에 사용자 메시지로 들어간다 → 전송 생략, 열려있는 세션에 그대로 연결(already:true).
          if (!b.cmd && a && layer.claudeAlive(a.pid || a.processId) === true) {
            return sendJson(res, 200, { ok: true, already: true, surface });
          }
          await sendLine(b.cmd || 'claude', surface);
          layer.invalidateProc(); invalidateWmux(); // 다음 폴링에 실측 상태(ready) 반영
          return sendJson(res, 200, { ok: true, surface });
        }
        if (req.method === 'POST' && pathname === '/handover') {
          // 단체 핸드오버: 모든 claude-on 세션 → handover.md 갱신 → /exit → 터미널 복귀(백그라운드).
          if (!layer) return sendJson(res, 404, { error: 'claude-layer-disabled' });
          const b = await readBody(req);
          try { return sendJson(res, 200, { ok: true, job: await layer.startHandover({ text: b.text }) }); }
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
