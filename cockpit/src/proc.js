// claude 켜짐/꺼짐 실측 (FS-10) — 구 live/proc.js 참고 재작성.
// wmux는 pane 안의 현재 프로세스를 모른다(status는 사실상 running 하나) → agent pid(셸)에서
// 프로세스 트리를 내려가 claude CLI가 자손으로 살아있는지 직접 확인.
// 스냅샷: PowerShell CIM 전체 1회 조회 → TTL 캐시 + single-flight + 논블로킹(계승 규칙 ⑥).
import { execFile } from 'node:child_process';

const TTL = 4000;
const IS_WIN = process.platform === 'win32';

// claude CLI 판별(실측 계승): 네이티브 claude.exe(셸 자식) O · 데스크톱 앱(AnthropicClaude) X ·
// npm(node + @anthropic-ai/claude-code/cli.js) O.
function isClaudeProc(name, cmd) {
  const n = (name || '').toLowerCase();
  if (/anthropicclaude/i.test(cmd || '')) return false;
  if (n === 'claude.exe' || n === 'claude') return true;
  if (n === 'node.exe' || n === 'node') return /@anthropic-ai[\\/]claude|claude-code[\\/]cli\.m?js/i.test(cmd || '');
  return false;
}

let _snap = null, _at = 0, _inflight = null; // { procs: pid→{name,cmd}, kids: ppid→pid[] }

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
  _inflight = new Promise((resolveP) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (!err) { try { _snap = index(JSON.parse(stdout)); } catch { /* 파싱 실패 — 이전 스냅샷 유지 */ } }
      _at = Date.now(); // 실패여도 갱신 시각 기록 — powershell 연속 스폰 폭주 방지
      resolveP(_snap);
    });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

function aliveInSnap(pid) {
  const id = Number(pid);
  if (!_snap || !id) return null;
  const { procs, kids } = _snap;
  const q = [id], seen = new Set();
  while (q.length) {
    const cur = q.shift();
    if (seen.has(cur)) continue; // PID 재사용 사이클 방어
    seen.add(cur);
    const p = procs.get(cur);
    if (p && isClaudeProc(p.name, p.cmd)) return true;
    for (const k of kids.get(cur) || []) q.push(k);
  }
  return false;
}

// true/false = 실측, null = 미상(비Windows·pid 없음·콜드 스냅샷) → 대시보드 'unknown'(버튼 미노출).
export function claudeAlive(pid) {
  if (!IS_WIN) return null;
  if (Date.now() - _at >= TTL) refresh(); // 논블로킹 — 백그라운드 갱신
  return aliveInSnap(pid);
}

// 변이 결정용(POST /claude — already 판정) — 콜드/스테일이면 실조회를 기다린다(§9-①).
export async function claudeAliveFresh(pid) {
  if (!IS_WIN) return null;
  if (!_snap || Date.now() - _at >= TTL) await refresh();
  return aliveInSnap(pid);
}

export function invalidateProc() { _at = 0; refresh(); }
