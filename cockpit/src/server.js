// HTTP 레이어(유일) — FS-3 + 전 엔드포인트(§8.4, 이 목록이 전부):
//   GET  / · /api/state · /api/log · /api/caps · /api/usage
//   POST /activate · /spawn · /kill-session · /deactivate · /archive · /reopen · /create · /import · /create-git · /roles
//        /claude · /attach · /open · /links · /git-remote · /adopt · /pick-folder · /console · /hook-install · /shutdown
// 127.0.0.1 바인드 + X-Cockpit-Token(GET / 제외 전부, A-5). 어떤 프로브도 응답을 막지 않는다(§9-⑥).
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';
import { ROOT, readConfig, patchConfig, scanProjects, findProject, createProject, importProject, removeRole, writeProject } from './registry.js';
import { getState, getFresh, invalidate, selectWorkspace, focusPane, sendLine, killApp } from './wmux.js';
import {
  activate, deactivate, archive, reopen, spawnRole, killSession,
  matchWorkspace, matchWorkspaceInfo, agentsOfWs, reconcile, parseLabel, roleOf,
} from './lifecycle.js';
import { claudeAlive, claudeAliveFresh, invalidateProc } from './proc.js';
import { getPorts } from './ports.js';
import { getGit, connectRemote, repoNameFromUrl } from './git.js';
import { getActivity, hookInstalled, invalidateHook } from './activity.js';
import { globalCaps, sessionCaps } from './caps.js';
import { getUsage } from './usage.js';
import { logEvent, readLog, logConsole } from './log.js';

const DASHBOARD = fileURLToPath(new URL('../dashboard.html', import.meta.url));
const HOOK_SCRIPT = fileURLToPath(new URL('../bin/activity-hook.mjs', import.meta.url));
const err = (status, code) => Object.assign(new Error(code), { status });

// 프로젝트 선언 ⊕ wmux 실측 병합 — GET /api/state 페이로드(FS-3-2).
// claude 실측은 proc 캐시 값만(true→on·false→off·null→unknown) — 응답 비차단.
function buildState(state) {
  const { projects, errors } = scanProjects();
  reportScanErrors(errors);
  reconcile(state, projects); // 자기치유(②④) — stale wsId 되쓰기/해제·stale 채택 청소(그레이스 경유)
  const dirLc = (p) => (p._dir || '').toLowerCase();
  const payloadProjects = [];
  const portInfo = [];
  const linkedWs = new Set(); // 프로젝트에 매칭된 workspace id — 나머지는 '미연결'로 분류
  for (const p of projects) {
    const { ws, via: wsVia } = state.live ? matchWorkspaceInfo(state, p) : { ws: null, via: null };
    if (ws) linkedWs.add(ws.id);
    const agents = ws ? agentsOfWs(state, ws.id) : [];
    // 세션→역할 해석(③): 채택 > 네임스페이스 label(같은 프로젝트) > plain label(구 형식). 선언 역할이면 connected.
    const declaredRoles = new Set(['ops', ...(p.roles || []).map((r) => r.id)]);
    const adopted = p.adopted || {};
    const resolveRole = (a) => roleOf(p, a);
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
      wsLive: !!ws, wsVia, git: getGit(existsSync(join(p._dir, 'ops', '.git')) ? join(p._dir, 'ops') : p._dir),
      sessions: agents.map((a) => {
        const alive = claudeAlive(a.pid);
        const adoptedRole = adopted[a.agentId];
        const ns = parseLabel(a.label);
        const resolved = resolveRole(a);
        const connected = !!adoptedRole || (resolved !== null && declaredRoles.has(resolved));
        const role = resolved || (ns ? `${ns.project}/${ns.role}` : a.label) || a.agentId;
        return { role, agentId: a.agentId, alive: true,
          connected, adopted: !!adoptedRole,
          via: adoptedRole ? 'adopted' : ns ? 'label-ns' : 'label', // 매칭 근거(⑦) — 드로어 표시·진단용
          claude: alive === true ? 'on' : alive === false ? 'off' : 'unknown',
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
          const ns = parseLabel(a.label); // 네임스페이스 label은 사람이 읽게 프로젝트/역할로 풀어 표시
          return { role: ns ? `${ns.project}/${ns.role}` : (a.label || a.agentId), agentId: a.agentId, claude: alive === true ? 'on' : alive === false ? 'off' : 'unknown' };
        }),
      });
    }
  }
  // hookInstalled=false면 대시보드가 활동 배지(FS-7) 훅 설치 안내 배너를 띄운다 — 설치 방법·원클릭 버튼 포함.
  return { projects: payloadProjects, unlinked, ports: getPorts(portInfo), hookInstalled: hookInstalled() };
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

// 네이티브 폴더 선택창(Windows) — 대시보드 "찾아보기"가 절대경로 타이핑 대신 클릭으로 폴더를 고르게(FS-9 보조).
// 서버(127.0.0.1)와 브라우저가 같은 머신이라 서버가 사용자 데스크톱에 모달 대화상자를 띄운다 — /open의 explorer 스폰과 동형.
//
// 포그라운드 문제: 브라우저 클릭으로 서버가 백그라운드에서 PowerShell을 띄우면 Windows 포그라운드 잠금 때문에
// 대화상자가 다른 창 뒤로 간다. 그래서 보이지 않는(opacity 0) TopMost 소유자 폼을 정상 표시한 뒤,
// Win32(AttachThreadInput+SetForegroundWindow+SetWindowPos TOPMOST)로 잠금을 우회해 맨 앞으로 끌어올린다.
// -File로 임시 .ps1 실행(C# 인라인·한글 설명 인용 안전). 취소=path:null · 비Windows=unsupported(수동 입력 폴백).
function pickFolder({ title } = {}) {
  if (process.platform !== 'win32') return Promise.resolve({ path: null, unsupported: true });
  const desc = String(title || '연동할 기존 프로젝트 폴더를 선택하세요').replace(/[\r\n]/g, ' ').replace(/'/g, "''").slice(0, 120);
  const script = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CockpitFg {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  static IntPtr HWND_TOPMOST = new IntPtr(-1);
  static IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  const uint SWP_NOMOVE = 0x0002;
  const uint SWP_NOSIZE = 0x0001;
  const uint SWP_SHOWWINDOW = 0x0040;
  public static void Bring(IntPtr hWnd) {
    IntPtr fg = GetForegroundWindow();
    uint pid;
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint our = GetCurrentThreadId();
    AttachThreadInput(our, fgThread, true);
    ShowWindow(hWnd, 5);
    SetWindowPos(hWnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    SetWindowPos(hWnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW);
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    AttachThreadInput(our, fgThread, false);
  }
}
'@
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Cockpit 폴더 선택'
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Show()
[System.Windows.Forms.Application]::DoEvents()
[CockpitFg]::Bring($owner.Handle)
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${desc}'
$d.ShowNewFolderButton = $false
$res = $d.ShowDialog($owner)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }
$owner.Close()
`;
  const file = join(tmpdir(), `cockpit-pick-${randomBytes(6).toString('hex')}.ps1`);
  return new Promise((resolveP) => {
    let done = false;
    const finish = (path) => { if (done) return; done = true; try { rmSync(file, { force: true }); } catch { /* temp 정리 실패 무시 */ } resolveP({ path }); };
    try { writeFileSync(file, '﻿' + script, 'utf8'); } // UTF-8 BOM — PowerShell 5.1이 한글 설명을 UTF-8로 읽게
    catch { return resolveP({ path: null }); }
    execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', file],
      { windowsHide: true, timeout: 5 * 60 * 1000 }, // 5분 방치 시 kill → path:null
      (_e, stdout) => finish((stdout || '').trim() || null));
  });
}

// POST /shutdown 전용 — 응답이 플러시된 뒤 wmux 앱을 내리고 서버를 닫는다. _server는 serve()가 등록.
// 평시 wmux 수명은 소유하지 않지만(FS-13), 전체 종료(⏻)만은 예외 — 사용자 의도가 '다 끄기'이므로
// wmux도 함께 내린다(세션은 이미 비활성화로 정리됨). wmux 종료는 응답 플러시 뒤에 — 서버가 wmux
// pane 안에서 돌 때 응답 전에 wmux를 죽이면 응답이 유실된다.
let _server = null;
function scheduleExit() {
  setTimeout(async () => {
    const r = await killApp();
    console.log(r.ok
      ? `[cockpit] 전체 종료 — 프로젝트 비활성화 완료 · wmux(${r.image}) 종료 · 서버를 내립니다.`
      : `[cockpit] 전체 종료 — 프로젝트 비활성화 완료 · wmux 종료 실패(${r.error} — 이미 꺼져 있으면 정상) · 서버를 내립니다.`);
    try { if (_server) _server.close(); } catch { /* 이미 닫힘 — 종료는 계속 */ }
    setTimeout(() => process.exit(0), 200);
  }, 400);
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
  'POST /kill-session': async (b) => killSession(b.name, b.agentId, b.role), // 개별 비활성화 — role은 낙관적 재검증(⑤, 불일치=409)
  'POST /deactivate': async (b) => {
    if (b.confirm !== true) throw err(400, 'confirm-required'); // §9-3 — kill은 항상 확인 경유
    return deactivate(b.name);
  },
  'POST /archive': async (b) => archive(b.name),
  'POST /reopen': async (b) => reopen(b.name),
  // 전체 종료 — active 프로젝트 전부 비활성화(세션 kill → 대기중)한 뒤 wmux 앱과 서버를 내린다.
  // kill 경유이므로 confirm 필수(§9-3 — /deactivate와 동형). 실패 프로젝트는 응답·로그로 보고하고 종료는 계속.
  // 비활성화(파이프 사용)가 먼저, wmux 종료는 scheduleExit(응답 플러시 후) — 순서 뒤집으면 세션 정리 불가.
  'POST /shutdown': async (b) => {
    if (b.confirm !== true) throw err(400, 'confirm-required');
    const actives = scanProjects().projects.filter((p) => p.status === 'active');
    const deactivated = [], failed = [];
    for (const p of actives) {
      try { await deactivate(p.name); deactivated.push(p.name); }
      catch (e) { failed.push(p.name); logEvent('error', p.name, 'shutdown', `비활성화 실패 — ${e.message}`); }
    }
    logEvent('info', null, 'shutdown',
      `전체 종료 — 프로젝트 ${deactivated.length}개 비활성화(대기중)${failed.length ? ` · 실패 ${failed.join('·')}` : ''} · wmux 종료 · 서버 종료`);
    scheduleExit();
    return { ok: true, deactivated, failed };
  },

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
    // 살아있는 세션 가드(FS-8-3) — 그 역할의 세션이 떠 있으면 409(비활성화/정리 후). 역할 해석은 roleOf(③).
    const state = await getFresh();
    const ws = state.live ? matchWorkspace(state, p) : null;
    if (ws && agentsOfWs(state, ws.id).some((a) => roleOf(p, a) === b.role)) throw err(409, 'role-alive');
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
    const nsL = parseLabel(a.label);
    logEvent('info', proj?.name || null, 'claude', `${nsL ? nsL.role : (a.label || a.agentId)} 세션에 claude 기동 전송`);
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
  // 네이티브 폴더 선택창을 띄우고 선택된 절대경로를 돌려줌 — "기존 프로젝트 연동"이 경로를 클릭으로 고르게(FS-9 보조).
  // 순수 읽기(FS 변이 없음) — 실제 연동(이동)은 사용자가 확인 후 POST /import이 수행.
  'POST /pick-folder': async (b) => pickFolder({ title: b && b.title }),
  // 대시보드 토스트 미러 — 화면에 뜬 토스트 내용을 서버 콘솔에 '[오류]내용 : …'로 출력(관측용). msg는 500자 컷.
  'POST /console': async (b) => { logConsole(String((b && b.msg) || '').slice(0, 500)); return { ok: true }; },
  // 활동 배지 훅 설치(FS-7) — 대시보드 안내 배너의 [훅 설치]가 호출. bin/activity-hook.mjs install을
  // 자식 프로세스로 실행(스크립트는 top-level 실행형 — import하면 process.exit(0)이 서버를 내린다).
  // 병합·백업·멱등(기존 wmux 훅 보존)은 스크립트 소관. 반영은 새로 시작하는 Claude 세션부터.
  'POST /hook-install': () => new Promise((resolveP, rejectP) => {
    execFile(process.execPath, [HOOK_SCRIPT, 'install'], { timeout: 15_000, windowsHide: true }, (e, _stdout, stderr) => {
      invalidateHook(); // 성공/실패 무관 즉시 재실측 — 다음 /api/state 폴링에 배너 상태 반영
      if (e) { logEvent('error', null, 'hook', `활동 배지 훅 설치 실패 — ${(stderr || e.message).trim()}`); return rejectP(err(500, 'hook-install-failed')); }
      logEvent('info', null, 'hook', '활동 배지 훅 설치 — ~/.claude/settings.json 병합(백업 settings.json.cockpit-bak)');
      resolveP({ ok: true });
    });
  }),
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
    // 역할이 이미 살아있는 다른 세션(역할 해석 일치 — 채택/네임스페이스/구형식)으로 차 있으면 거부(이중 바인딩 방지).
    if (wsAgents.some((a) => a.agentId !== agentId && roleOf(p, a) === role)) throw err(409, 'role-filled');
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
  _server = server; // POST /shutdown의 scheduleExit()가 닫을 수 있게 등록

  const n = scanProjects().projects.length;
  console.log(`[cockpit] 서버 가동 — http://127.0.0.1:${PORT}/  (127.0.0.1 전용 — 방화벽 허용 불필요)`);
  console.log(`[cockpit] root: ${ROOT}  · 프로젝트 ${n}개 · 토큰: workspace/config.json`);
  console.log('[cockpit] 이 창이 서버 콘솔입니다 — 오류가 여기 표시됩니다. 창을 닫으면 대시보드가 offline이 됩니다.');
  return { server, port: PORT, token };
}
