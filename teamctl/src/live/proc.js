// Claude 켜짐/꺼짐 실측 프로브 — 상태 3분류(터미널/명령 대기/작업중)의 근거 업그레이드.
// wmux는 스폰 시점 cmd만 기억하고 pane 안의 현재 프로세스를 알려주지 않는다(status는 사실상
// running 하나). → agent의 pid(셸)에서 프로세스 트리를 내려가 claude CLI가 자손으로
// 살아있는지 직접 확인한다. 셸에서 수동 실행/수동 종료해도 다음 스냅샷에 그대로 반영.
// 스냅샷: PowerShell CIM(Win32_Process) 전체 1회 조회 → TTL 캐시 + single-flight + 논블로킹
// (wmux 캐시와 같은 계약 — 대시보드 폴링을 절대 막지 않는다).
import { execFile } from 'node:child_process';

const TTL = 4000;
const IS_WIN = process.platform === 'win32';

// claude CLI 판별 — 실측(2026-07): 네이티브 설치는 <home>\.local\bin\claude.exe가 셸의
// 자식으로 뜬다. 데스크톱 앱(AnthropicClaude\...\claude.exe)도 같은 이름이므로 경로로 제외.
// npm 설치(node + @anthropic-ai/claude-code/cli.js)도 커버.
function isClaudeProc(name, cmd) {
  const n = (name || '').toLowerCase();
  if (/anthropicclaude/i.test(cmd || '')) return false; // 데스크톱 앱
  if (n === 'claude.exe' || n === 'claude') return true;
  if (n === 'node.exe' || n === 'node') return /@anthropic-ai[\\/]claude|claude-code[\\/]cli\.m?js/i.test(cmd || '');
  return false;
}

let _snap = null, _at = 0, _inflight = null; // _snap: { procs: pid→{name,cmd}, kids: ppid→pid[] }

function index(raw) {
  const arr = Array.isArray(raw) ? raw : [raw];
  const procs = new Map(), kids = new Map();
  for (const p of arr) {
    if (!p || typeof p.ProcessId !== 'number') continue;
    procs.set(p.ProcessId, { name: p.Name || '', cmd: p.CommandLine || '' });
    const pp = p.ParentProcessId;
    if (typeof pp === 'number') {
      if (!kids.has(pp)) kids.set(pp, []);
      kids.get(pp).push(p.ProcessId);
    }
  }
  return { procs, kids };
}

function refresh() {
  if (_inflight) return _inflight;
  _inflight = new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (!err) { try { _snap = index(JSON.parse(stdout)); } catch { /* 파싱 실패 — 이전 스냅샷 유지 */ } }
      _at = Date.now(); // 실패여도 갱신 시각은 기록 — powershell 연속 스폰 폭주 방지
      resolve(_snap);
    });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

// true/false = 실측 판정, null = 미상(비Windows·pid 없음·스냅샷 콜드) — 호출자는 null일 때만
// 스폰 cmd 추정으로 폴백한다. pid 자신이 claude일 수도 있으므로(직접 스폰) 자신 포함 BFS.
export function claudeAlive(pid) {
  if (!IS_WIN) return null;
  if (Date.now() - _at >= TTL) refresh(); // 논블로킹 — 백그라운드 갱신 트리거
  const id = Number(pid);
  if (!_snap || !id) return null;
  const { procs, kids } = _snap;
  const q = [id], seen = new Set();
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue; // PID 재사용으로 생길 수 있는 트리 사이클 방어
    seen.add(cur);
    const p = procs.get(cur);
    if (p && isClaudeProc(p.name, p.cmd)) return true;
    for (const k of kids.get(cur) || []) q.push(k);
  }
  return false;
}

// 변이 직후(claude 기동/종료 지시) 다음 폴링에 빨리 반영되도록 강제 재조회.
export function invalidateProc() { _at = 0; refresh(); }

// 콜드 스냅샷을 기다려야 하는 곳(핸드오버 종료 확인 등)용 — 첫 조회 완료를 보장.
export async function procReady() {
  if (!IS_WIN) return null;
  if (!_snap) await refresh();
  return _snap;
}
