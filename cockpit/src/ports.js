// 활성 포트맵 (FS-14) — 리스닝 포트 실측 + 프로젝트 귀속. 구 connectors/ports 참고 재작성.
// 귀속: ① 리스너 프로세스의 부모 트리에 프로젝트 세션 pid가 있으면 그 프로젝트
//      ② 커맨드라인에 root/<프로젝트>/ 경로가 보이면 그 프로젝트 — 그 외 null(기타).
// 논블로킹 캐시(TTL·single-flight, §9-⑥) — /api/state 응답을 절대 막지 않는다(캐시 값만 병합).
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

function refresh() {
  if (_inflight) return _inflight;
  _inflight = new Promise((resolveP) => {
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
          _snap = { listeners, procs };
        } catch { /* 파싱 실패 — 이전 스냅샷 유지 */ }
        _at = Date.now();
        resolveP(_snap);
      });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

// 논블로킹 조회 — attribution 입력: [{name, dir, pids:Set}] (active 프로젝트만).
// 콜드 스냅샷은 [] 반환(다음 폴링에 채워짐).
export function getPorts(projInfo = []) {
  if (process.platform !== 'win32') return [];
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
    out.push({ p: ':' + port, proc: proc.name.replace(/\.exe$/i, ''), project });
  }
  return out;
}

export function invalidatePorts() { _at = 0; refresh(); }
