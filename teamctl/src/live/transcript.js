// 트랜스크립트 tail 파서 (Tech.md §12 주 소스) — ~/.claude/projects/<enc-cwd>/<uuid>.jsonl
// 최신(mtime) jsonl의 끝부분만 읽어 최신 발화(now)·툴콜(feed)·변경파일(touched) 추출.
import { statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const PROJECTS = join(homedir(), '.claude', 'projects');
// enc-cwd: Claude Code는 비영숫자 전부 `-`로 치환(§15). 예 D:\_Claude\X → D---Claude-X
// (구버전은 `[:\\/]`만 치환 → `_`·`.`·공백 포함 경로에서 디렉터리 못 찾던 버그)
const encCwd = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

function newestTranscript(cwd) {
  const dir = join(PROJECTS, encCwd(cwd));
  let files;
  try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return null; }
  let best = null, bestM = -1;
  for (const f of files) {
    try { const m = statSync(join(dir, f)).mtimeMs; if (m > bestM) { bestM = m; best = join(dir, f); } } catch {}
  }
  return best;
}

// 파일 끝에서 최대 maxBytes만 읽어 라인 배열(부분 첫 줄 버림) — 거대 트랜스크립트 대비.
function tailLines(file, maxBytes = 512 * 1024) {
  const size = statSync(file).size;
  const start = Math.max(0, size - maxBytes);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) { const nl = text.indexOf('\n'); if (nl >= 0) text = text.slice(nl + 1); }
    return text.split(/\r?\n/).filter(Boolean);
  } finally { closeSync(fd); }
}

const TOOL_CLASS = { Read: 'read', Grep: 'grep', Glob: 'grep', Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write', Bash: 'bash', PowerShell: 'bash' };
const WRITE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
const hhmmss = (ts) => (ts || '').slice(11, 19);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function toolDetail(name, input = {}) {
  if (name === 'Bash' || name === 'PowerShell') return (input.command || input.description || '').split(/\r?\n/)[0].slice(0, 64);
  if (WRITE_TOOLS.test(name) || name === 'Read') return basename(input.file_path || input.notebook_path || '');
  if (name === 'Grep' || name === 'Glob') return input.pattern || '';
  if (name === 'Task' || name === 'Agent') return input.description || '';
  const s = JSON.stringify(input || {});
  return s === '{}' ? '' : s.slice(0, 50);
}

// cwd의 최신 트랜스크립트를 파싱해 { now, feed, touched, source } 반환. 없으면 null.
export function readTranscript(cwd, { feedN = 8 } = {}) {
  const file = cwd && newestTranscript(cwd);
  if (!file) return null;
  let lines;
  try { lines = tailLines(file); } catch { return null; }

  const feed = [];
  const touched = new Set();
  let now = '';
  for (const ln of lines) {
    let e; try { e = JSON.parse(ln); } catch { continue; }
    if (e.type !== 'assistant' && e.type !== 'user') continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    const ts = e.timestamp;
    for (const c of content) {
      if (c.type === 'text' && e.type === 'assistant' && c.text?.trim()) {
        now = c.text.trim(); // 최신 발화로 계속 덮어씀
      } else if (c.type === 'tool_use') {
        feed.push([hhmmss(ts), c.name || '?', TOOL_CLASS[c.name] || 'read', esc(toolDetail(c.name, c.input))]);
        const fp = c.input?.file_path;
        if (fp && WRITE_TOOLS.test(c.name)) touched.add(fp);
      }
    }
  }
  return {
    now: esc(now.replace(/\s+/g, ' ').slice(0, 220)) || '(최근 발화 없음)',
    feed: feed.slice(-feedN).reverse(), // 최신이 위로
    touched: [...touched],
    source: basename(file),
  };
}
