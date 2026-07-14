// claude 켜짐/꺼짐 실측 (FS-10) — 구 live/proc.js 참고 재작성.
// 멀티플렉서는 pane 안의 현재 프로세스를 모른다(status는 사실상 running 하나) → agent pid(셸)에서
// 프로세스 트리를 내려가 claude CLI가 자손으로 살아있는지 직접 확인.
// 스냅샷: win32=PowerShell CIM · darwin=ps -axo, 전체 1회 조회 → TTL 캐시 + single-flight + 논블로킹(계승 규칙 ⑥).
import { execFile } from 'node:child_process';

const TTL = 4000;
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// darwin 스냅샷 파서 — ps -axo pid=,ppid=,tty=,args=. 이름은 args 첫 토큰의 basename
// (comm 컬럼은 16자 절단 — '/usr/local/bin/c' 실측 — 이라 못 쓴다. 로그인 셸의 '-' 접두어 제거).
// tty 그룹(ttys Map)이 핵심: cmux pty의 프로세스들은 셸의 자손이 아니라 형제로 나열된다(실측 —
// caffeinate·claude·zsh가 모두 surface 직속). 부모 트리 워크로는 claude가 안 보여 tty로 세션을 묶는다.
export function parsePs(text) {
  const procs = new Map(), kids = new Map(), ttys = new Map();
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]), ppid = Number(m[2]);
    const tty = m[3] === '??' ? null : m[3];
    const cmd = m[4] || '';
    const name = (cmd.split(/\s+/)[0] || '').replace(/^-/, '').split('/').pop();
    procs.set(pid, { name, cmd, tty });
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
    if (tty) {
      if (!ttys.has(tty)) ttys.set(tty, []);
      ttys.get(tty).push(pid);
    }
  }
  return { procs, kids, ttys };
}

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
    const done = () => { _at = Date.now(); resolveP(_snap); }; // 실패여도 갱신 시각 기록 — 스폰 폭주 방지
    if (IS_MAC) {
      execFile('/bin/ps', ['-axo', 'pid=,ppid=,tty=,args='], { maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
        if (!err) _snap = parsePs(stdout);
        done();
      });
      return;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      if (!err) { try { _snap = index(JSON.parse(stdout)); } catch { /* 파싱 실패 — 이전 스냅샷 유지 */ } }
      done();
    });
  }).finally(() => { _inflight = null; });
  return _inflight;
}

function aliveInSnap(pid) {
  const id = Number(pid);
  if (!_snap || !id) return null;
  const { procs, kids, ttys } = _snap;
  // darwin — pid의 tty(pty) 세션 전체에서 claude 탐색: 같은 surface의 프로세스는 형제라
  // 트리 워크가 못 본다(위 parsePs 주석). tty 없는 pid는 아래 트리 워크로 폴백.
  const tty = procs.get(id)?.tty;
  if (tty && ttys) {
    for (const sib of ttys.get(tty) || []) {
      const p = procs.get(sib);
      if (p && isClaudeProc(p.name, p.cmd)) return true;
    }
    return false;
  }
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

// true/false = 실측, null = 미상(미지원 플랫폼·pid 없음·콜드 스냅샷) → 대시보드 'unknown'(버튼 미노출).
export function claudeAlive(pid) {
  if (!IS_WIN && !IS_MAC) return null;
  if (Date.now() - _at >= TTL) refresh(); // 논블로킹 — 백그라운드 갱신
  return aliveInSnap(pid);
}

// 변이 결정용(POST /claude — already 판정) — 콜드/스테일이면 실조회를 기다린다(§9-①).
export async function claudeAliveFresh(pid) {
  if (!IS_WIN && !IS_MAC) return null;
  if (!_snap || Date.now() - _at >= TTL) await refresh();
  return aliveInSnap(pid);
}

export function invalidateProc() { _at = 0; refresh(); }
