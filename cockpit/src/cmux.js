// cmux 드라이버 (darwin) — wmux.js가 위임하는 macOS 대응물. 스펙: doc/specs/2026-07-14-cmux-port-design.md
// 원칙: ① 주소는 UUID만(short ref는 변이 사이 재번호 — 실측) ② 모든 호출은 cmux CLI(execFile) 경유
//       (raw 소켓 파라미터는 미문서 — CLI가 문서화된 계약) ③ 세션 신원은 매핑 파일이 정본
//       (cmux surface엔 label이 없고 탭 제목은 claude 훅이 덮어씀 — 실측).
import { execFile, spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { readConfig, patchConfig } from './registry.js';
import { logConsole } from './log.js';

const TIMEOUT = 10_000;

// ── CLI 발견 — config cmuxBin → PATH → /Applications/cmux*.app 글롭 (1회 캐시, config 되씀) ──
let _bin = null;
export function cmuxBin() {
  if (_bin) return _bin;
  const cfg = readConfig();
  if (cfg.cmuxBin && existsSync(cfg.cmuxBin)) return (_bin = cfg.cmuxBin);
  try {
    const r = spawnSync('/usr/bin/which', ['cmux'], { encoding: 'utf8', timeout: 3000 });
    const p = r.status === 0 ? r.stdout.trim() : '';
    if (p) { patchConfig({ cmuxBin: p }); return (_bin = p); }
  } catch { /* PATH에 없음 — 글롭으로 */ }
  let names = [];
  try { names = readdirSync('/Applications'); } catch { /* 접근 불가 — 아래 null */ }
  for (const n of names.filter((x) => /^cmux.*\.app$/i.test(x)).sort().reverse()) {
    const p = join('/Applications', n, 'Contents', 'Resources', 'bin', 'cmux');
    if (existsSync(p)) { patchConfig({ cmuxBin: p }); return (_bin = p); }
  }
  return null;
}
// 앱 번들 경로 역산 — CLI가 번들 안이면 그 번들, 아니면 null(open -a cmux 폴백).
export function cmuxApp() {
  const bin = cmuxBin();
  const m = bin && /^(.*?\.app)\//.exec(bin);
  return m ? m[1] : null;
}

// ── CLI 실행 — 요청당 1프로세스(~30ms). CMUX_* 상속 제거(코크핏이 cmux 터미널 안에서 돌 때
// 기본 --workspace 오염 방지). 고빈도 폴링 커맨드는 성공 로그 제외(wmux.js와 동일 규칙). ──
const QUIET = new Set(['rpc', 'top', 'ping', 'read-screen']);
const _hms = () => { try { return new Date().toLocaleTimeString(); } catch { return ''; } };
function cli(args, timeoutMs = TIMEOUT) {
  const bin = cmuxBin();
  if (!bin) return Promise.reject(new Error('cmux CLI를 찾을 수 없습니다 — /Applications에 cmux 설치 또는 config.json에 "cmuxBin" 지정'));
  const env = { ...process.env, CMUX_QUIET: '1' };
  delete env.CMUX_WORKSPACE_ID; delete env.CMUX_SURFACE_ID; delete env.CMUX_TAB_ID;
  const loud = !QUIET.has(args[0]);
  if (loud) logConsole(`${_hms()} [cmux→] ${args.join(' ')}`);
  return new Promise((resolveP, rejectP) => {
    execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) => {
      if (e) {
        const msg = (stderr || e.message || '').trim().slice(0, 300);
        logConsole(`${_hms()} [cmux✗] ${args[0]} — ${msg}`);
        return rejectP(new Error(msg || `cmux ${args[0]} 실패`));
      }
      if (loud) logConsole(`${_hms()} [cmux✓] ${args[0]}`);
      resolveP(stdout);
    });
  });
}
const rpc = async (method, params) => JSON.parse(await cli(['rpc', method, ...(params ? [JSON.stringify(params)] : [])]));

// ── 순수 파서 (단위 테스트 대상 — cockpit/test/cmux-parse.test.mjs) ──
const UUID = '[0-9A-Fa-f]{8}-[0-9A-Fa-f-]{27,}';
export function parseNewPane(text) {
  const m = new RegExp(`surface:\\d+ \\((${UUID})\\) pane:\\d+ \\((${UUID})\\)`).exec(String(text));
  return m ? { surfaceId: m[1], paneId: m[2] } : null;
}
// top tsv → Map('surface:N' → 대표 pid). 행: cpu\tmem\tcount\tkind\tkey\tparent\tname.
// surface 직속 process 행은 여럿(pty 프로세스들이 형제로 나열 — caffeinate·claude·zsh 등, 실측)이고
// 수명 짧은 것·tty 없는 데몬도 섞인다 → 대표 pid는 ① claude 계열 ② 셸 ③ 첫 행 순으로 픽.
// 켜짐 판정의 정본은 proc.js(tty 세션 그룹) — 여기 픽은 안정된 진입점 pid를 주는 역할.
export function parseTop(tsv) {
  const rank = (name) => /^claude/i.test(name) ? 0 : /^(zsh|bash|sh|fish)$/i.test(name) ? 1 : 2;
  const best = new Map(); // ref → {pid, r, seq}
  let seq = 0;
  for (const line of String(tsv).split('\n')) {
    const f = line.split('\t');
    if (f[3] !== 'process' || !/^surface:\d+$/.test(f[5] || '')) continue;
    const cur = { pid: Number(f[4]), r: rank(f[6] || ''), seq: seq++ };
    const prev = best.get(f[5]);
    if (!prev || cur.r < prev.r) best.set(f[5], cur);
  }
  return new Map([...best].map(([ref, b]) => [ref, b.pid]));
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const BARE_SHELL = /^(sh|bash|zsh|fish|pwsh)$/i;
export function buildInitLine({ cwd, cmd, env } = {}) {
  let line = `cd ${q(cwd)}`;
  if (env && Object.keys(env).length) line += ' && export ' + Object.entries(env).map(([k, v]) => `${k}=${q(v)}`).join(' ');
  if (cmd && !BARE_SHELL.test(cmd.trim())) line += ` && ${cmd}`; // 새 surface가 이미 셸 — bare 셸 cmd는 중첩 방지 생략
  return line;
}

// ── 세션 신원 매핑 (wmux label의 정본 대응물) — workspace/cmux-agents.json: {surfaceUUID: label} ──
// 스폰 시 기록·kill 시 삭제만(자동 청소 없음 — UUID는 재사용되지 않아 잔존 무해).
// cmux 재시작으로 UUID가 갈리면 세션은 '미연결'로 보이고 기존 채택(adopt) 경로로 복구.
const MAP_PATH = fileURLToPath(new URL('../workspace/cmux-agents.json', import.meta.url));
function readMap() { try { return JSON.parse(readFileSync(MAP_PATH, 'utf8')); } catch { return {}; } }
function writeMap(m) {
  try { mkdirSync(dirname(MAP_PATH), { recursive: true }); writeFileSync(MAP_PATH, JSON.stringify(m, null, 2)); }
  catch (e) { logConsole(`[cmux✗] 신원 매핑 저장 실패 — ${e.message}`); }
}

// ── 상태 실측 — wmux.js _refetch가 그대로 소비하는 형태로 반환 ──
// workspace.list는 window 단위(실측) — window.list로 전 창 순회해 다른 창의 프로젝트도 놓치지 않는다.
// 폴링당 CLI 1+W+N+1회(window.list · 창별 workspace.list · ws별 surface.list · top) — TTL 1.5s 캐시가 흡수.
async function listAllWorkspaces() {
  const win = await rpc('window.list');
  const wsLists = await Promise.all(
    (win.windows || []).map((w) => rpc('workspace.list', { window_id: w.id }).catch(() => ({ workspaces: [] }))),
  );
  return wsLists.flatMap((l) => l.workspaces || []);
}

export async function fetchState() {
  const workspaces = (await listAllWorkspaces()).map((w) => ({ id: w.id, title: w.title || '' }));
  const map = readMap();
  const [top, ...lists] = await Promise.all([
    cli(['top', '--all', '--processes', '--format', 'tsv']).catch(() => ''),
    ...workspaces.map((w) => rpc('surface.list', { workspace_id: w.id }).catch(() => ({ surfaces: [] }))),
  ]);
  const pidByRef = parseTop(top);
  const agents = [];
  workspaces.forEach((w, i) => {
    for (const s of lists[i].surfaces || []) {
      if (s.type !== 'terminal') continue; // browser 등 비터미널 surface는 세션 아님
      agents.push({
        agentId: s.id, label: map[s.id] || '', cmd: s.initial_command || '', status: 'running',
        paneId: s.pane_id || null, surfaceId: s.id, pid: pidByRef.get(s.ref) ?? null, workspaceId: w.id,
      });
    }
  });
  return { workspaces, agents };
}

export async function ping() { return cli(['ping'], 5000); }

// ── 제어 — 전부 UUID 주소 지정 ──
export const selectWorkspace = (id) => cli(['select-workspace', '--workspace', id]);
export const focusPane = (id) => cli(['focus-pane', '--pane', id]);
export async function killAgent(id) {
  await cli(['close-surface', '--surface', id]);
  const m = readMap();
  if (id in m) { delete m[id]; writeMap(m); }
}
export async function createWorkspace({ title, cwd } = {}) {
  const args = ['new-workspace', '--focus', 'false'];
  if (title) args.push('--name', title);
  if (cwd) args.push('--cwd', cwd);
  await cli(args); // 출력에 UUID 없음(실측) — 직후 전 창 목록에서 title로 역산(ensureWorkspace가 무매칭일 때만 생성하므로 유일)
  const hit = (await listAllWorkspaces()).filter((w) => w.title === title).pop();
  if (!hit) throw new Error(`workspace 생성 후 재발견 실패 — ${title}`);
  return { id: hit.id };
}
export const closeWorkspace = (id) => cli(['close-workspace', '--workspace', id]);

export async function spawnAgent({ workspaceId, label, cwd, cmd, env } = {}) {
  if (!cmd) throw new Error('cmd 필요');
  if (!cwd) throw new Error('cwd 필요(드리프트 방지 — 항상 명시)');
  if (!workspaceId) throw new Error('workspaceId 필요(UUID)');
  const out = await cli(['new-pane', '--type', 'terminal', '--workspace', workspaceId, '--focus', 'false', '--id-format', 'both']);
  const ids = parseNewPane(out);
  if (!ids) throw new Error(`new-pane 출력 해석 실패 — ${String(out).slice(0, 120)}`);
  if (label) { const m = readMap(); m[ids.surfaceId] = label; writeMap(m); }
  await sendLine(buildInitLine({ cwd, cmd, env }), ids.surfaceId);
  return { agentId: ids.surfaceId };
}

// 텍스트+Enter — 비포커스 surface는 pty 지연 초기화라 입력이 queue됨(실측: wake 시 정상 재생).
// read-screen 1줄로 강제 wake — 포커스 변경 없이 pty를 띄워 즉시 실행 + pid 실측 가능하게.
export async function sendLine(text, surfaceId) {
  if (!surfaceId) throw new Error('sendLine: 대상 surfaceId 필요(오발송 방지)');
  await rpc('surface.send_text', { surface_id: surfaceId, text });
  await rpc('surface.send_key', { surface_id: surfaceId, key: 'Enter' });
  await cli(['read-screen', '--surface', surfaceId, '--lines', '1']).catch(() => { /* wake 실패 — 표시 시점에 재생 */ });
}

// 점프(/attach) 보조 — cmux 앱을 앞으로. 번들 역산 실패 시 이름으로.
export function activateApp() {
  return new Promise((resolveP) => {
    const app = cmuxApp();
    const child = spawn('open', app ? [app] : ['-a', 'cmux'], { detached: true, stdio: 'ignore' });
    child.on('error', () => resolveP()); // 활성화 실패 — 점프의 보조 동작이라 무해
    child.on('spawn', () => { child.unref(); resolveP(); });
  });
}
