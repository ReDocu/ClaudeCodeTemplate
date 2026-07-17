// 활성 포트맵 (FS-14) — 리스닝 포트 실측 + 프로젝트 귀속. 구 connectors/ports 참고 재작성.
// 귀속: ① 리스너 프로세스의 부모 트리에 프로젝트 세션 pid가 있으면 그 프로젝트
//      ② 커맨드라인에 root/<프로젝트>/ 경로가 보이면 그 프로젝트 — 그 외 null(기타).
// 스냅샷: win32=PowerShell(Get-NetTCPConnection+CIM) · darwin=lsof+ps — 동일 {listeners, procs} 형태로
// 귀속 로직 공유. 논블로킹 캐시(TTL·single-flight, §9-⑥) — /api/state 응답을 절대 막지 않는다.
import { execFile } from 'node:child_process';

const TTL = 15_000;
// dev/db 후보 필터 — 시스템 리스너 소음 제거(구현 시 실측 조정 대상, user_context D3).
const NOISE = new Set(['system', 'idle', 'svchost.exe', 'lsass.exe', 'services.exe', 'wininit.exe',
  'winlogon.exe', 'spoolsv.exe', 'searchhost.exe', 'memcompression']);
const inBand = (port) => port >= 80 && port < 49152;

const PS = `
$l = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0','127.0.0.1','::','::1' } | Select-Object LocalPort,OwningProcess
$p = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId,Name,CommandLine
@{ listen = @($l); procs = @($p) } | ConvertTo-Json -Depth 4 -Compress`;

let _snap = null, _at = 0, _inflight = null; // { listeners:[{port,pid}], procs: pid→{ppid,name,cmd} }

// darwin 리스너 파서 — lsof -nP -iTCP -sTCP:LISTEN -Fpn: p<pid> 행 뒤에 n<addr> 행들이 따라온다.
// 로컬 바인드(127.0.0.1/::1/*/0.0.0.0/[::])만 채택, 포트 중복(v4/v6) 제거, 포트 오름차순.
export function parseLsof(text) {
  const seen = new Set(); const out = [];
  let pid = null;
  for (const line of String(text).split('\n')) {
    if (line[0] === 'p') { pid = Number(line.slice(1)); continue; }
    if (line[0] !== 'n' || pid === null) continue;
    const m = /^(\*|0\.0\.0\.0|127\.0\.0\.1|\[::\]|\[::1\]):(\d+)$/.exec(line.slice(1));
    if (!m) continue;
    const port = Number(m[2]);
    if (seen.has(port)) continue;
    seen.add(port);
    out.push({ port, pid });
  }
  return out.sort((a, b) => a.port - b.port);
}

// darwin ps → pid→{ppid,name,cmd} (귀속의 부모 트리·커맨드라인 입력 — win32 procs와 동일 형태).
// 이름은 args 첫 토큰 basename(comm 16자 절단 회피 — proc.js parsePs와 동일 근거).
function psToPortProcs(text) {
  const procs = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const cmd = m[3] || '';
    procs.set(Number(m[1]), { ppid: Number(m[2]), name: (cmd.split(/\s+/)[0] || '').replace(/^-/, '').split('/').pop(), cmd });
  }
  return procs;
}

function refresh() {
  if (_inflight) return _inflight;
  _inflight = new Promise((resolveP) => {
    const done = (snap) => { if (snap) _snap = snap; _at = Date.now(); resolveP(_snap); };
    if (process.platform === 'darwin') {
      // lsof는 일부 소켓 접근 실패 시에도 부분 출력 + 비0 종료가 흔함 — 출력이 있으면 사용.
      execFile('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn'], { maxBuffer: 16 * 1024 * 1024 }, (e1, lsofOut) => {
        if (!lsofOut) return done(null);
        execFile('/bin/ps', ['-axo', 'pid=,ppid=,args='], { maxBuffer: 16 * 1024 * 1024 }, (e2, psOut) => {
          if (e2) return done(null);
          done({ listeners: parseLsof(lsofOut), procs: psToPortProcs(psOut) });
        });
      });
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (errIgn, stdout) => {
        try {
          const raw = JSON.parse(stdout);
          const procs = new Map();
          for (const p of raw.procs || []) {
            if (p && typeof p.ProcessId === 'number') procs.set(p.ProcessId, { ppid: p.ParentProcessId, name: p.Name || '', cmd: p.CommandLine || '' });
          }
          const seen = new Set(); const listeners = [];
          for (const l of (raw.listen || []).sort((a, b) => a.LocalPort - b.LocalPort)) {
            if (!l || typeof l.LocalPort !== 'number' || seen.has(l.LocalPort)) continue;
            seen.add(l.LocalPort);
            listeners.push({ port: l.LocalPort, pid: l.OwningProcess });
          }
          done({ listeners, procs });
        } catch { done(null); /* 파싱 실패 — 이전 스냅샷 유지 */ }
      });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

// 논블로킹 조회 — attribution 입력: [{name, dir, pids:Set}] (active 프로젝트만).
// 콜드 스냅샷은 [] 반환(다음 폴링에 채워짐).
export function getPorts(projInfo = []) {
  if (!['win32', 'darwin'].includes(process.platform)) return [];
  if (Date.now() - _at >= TTL) refresh();
  if (!_snap) return [];
  const { listeners, procs } = _snap;
  const out = [];
  for (const { port, pid } of listeners) {
    if (!inBand(port)) continue;
    const proc = procs.get(pid);
    const pname = (proc?.name || '').toLowerCase();
    if (!proc || NOISE.has(pname)) continue;

    let project = null;
    // ① 부모 트리에 프로젝트 세션 pid
    let cur = pid;
    for (let hop = 0; hop < 24 && cur; hop++) {
      const hit = projInfo.find((pi) => pi.pids.has(cur));
      if (hit) { project = hit.name; break; }
      cur = procs.get(cur)?.ppid;
      if (cur !== undefined && cur !== null && !procs.has(cur)) break;
    }
    // ② 커맨드라인에 프로젝트 경로
    if (!project && proc.cmd) {
      const cmdLc = proc.cmd.toLowerCase();
      const hit = projInfo.find((pi) => pi.dir && cmdLc.includes(pi.dir));
      if (hit) project = hit.name;
    }
    out.push({ p: ':' + port, port, pid, proc: proc.name.replace(/\.exe$/i, ''), project });
  }
  return out;
}

export function invalidatePorts() { _at = 0; refresh(); }

// ── 리스너 중지(FS-14 확장) — 대시보드 [✕]의 실측 재검증·종료 ──
// freshListener: TTL 무시 강제 재스캔 후 (port,pid) 정확 일치 리스너 반환(없으면 null).
// 낙관적 재검증(⑤) — 그 pid가 이미 내려갔거나 pid가 재사용됐으면 kill을 거부하게 한다.
export async function freshListener(port, pid) {
  if (!['win32', 'darwin'].includes(process.platform)) return null;
  _at = 0;
  await refresh();
  if (!_snap) return null;
  const hit = _snap.listeners.find((l) => l.port === port && l.pid === pid);
  if (!hit) return null;
  const proc = _snap.procs.get(pid);
  return { port, pid, proc: (proc?.name || '?').replace(/\.exe$/i, '') };
}

// 프로세스 트리째 종료(dev 서버가 스폰한 워커 포함 — pane 셸은 리스너의 부모라 무사). 실패는 reject.
// darwin엔 /T 대응이 없다 — 자식(-P)을 먼저 TERM하고 리스너 pid를 TERM한다. 리스너는 pid 자신이라
// 포트는 이 시점에 풀린다. 손자 프로세스는 고아로 남을 수 있다(win32와의 알려진 차이).
export function killPid(pid) {
  if (process.platform === 'darwin') {
    return new Promise((resolveP, rejectP) => {
      execFile('/usr/bin/pkill', ['-TERM', '-P', String(pid)], { timeout: 10_000 }, () => {
        // 자식이 없으면 pkill은 1로 끝난다 — 리스너 종료가 본체라 무시한다.
        execFile('/bin/kill', ['-TERM', String(pid)], { timeout: 10_000 },
          (e, _stdout, stderr) => (e ? rejectP(new Error((stderr || e.message).trim())) : resolveP()));
      });
    });
  }
  return new Promise((resolveP, rejectP) => {
    execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 },
      (e, _stdout, stderr) => (e ? rejectP(new Error((stderr || e.message).trim())) : resolveP()));
  });
}
