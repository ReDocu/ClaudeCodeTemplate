// 관리 로그 (FS-12) — 중앙 JSONL(workspace/logs/events.jsonl, gitignore).
// 상태 전이·create/import·spawn/kill·claude 전송·cockpit 에러(A-3). 시크릿·토큰 기록 금지(§9-4).
// 기록 실패가 본 동작을 막지 않는다(fire-and-forget). 에러는 콘솔에도 동시 출력(맥락2).
import { appendFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const LOG_FILE = fileURLToPath(new URL('../workspace/logs/events.jsonl', import.meta.url));

export function logEvent(level, project, event, detail) {
  const entry = { ts: Date.now(), level: level === 'error' ? 'error' : 'info', project: project || null, event, detail: String(detail || '') };
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch { /* 로그 실패 무시 — 본 동작 비차단 */ }
  if (entry.level === 'error') console.error(`[${entry.event}] ${entry.project || '-'} — ${entry.detail}`);
  return entry;
}

// 서버 콘솔 통합 싱크 — 대시보드 토스트(POST /console)와 wmux 파이프에 나오는 내용을 한 형식으로 콘솔에 출력.
// 사용자 요청: 토스트/ wmux에 나오는 내용 전부 '[오류]내용 : …'로 서버 콘솔에 기록(관측용). 여러 줄·중복 공백은 한 줄로.
export function logConsole(content) {
  const s = String(content == null ? '' : content).replace(/\s+/g, ' ').trim();
  if (!s) return;
  console.log(`[오류]내용 : ${s}`);
}

// 최신순 조회 — GET /api/log?project=&limit=. 파일 없음 = 빈 목록(수동 삭제 무해).
export function readLog({ project, limit = 20 } = {}) {
  let lines;
  try { lines = readFileSync(LOG_FILE, 'utf8').split('\n'); } catch { return []; }
  const out = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (project && e.project !== project) continue;
    out.push(e);
  }
  return out;
}
