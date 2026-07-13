// 세션 활동 상태 읽기 — Claude Code 훅(bin/activity-hook.mjs)이 쓴 상태 파일을 읽어 대시보드에 노출.
//   working=명령 진행중 · waiting=응답 완료 대기 · attention=입력/권한 대기.
//   작은 JSON sync read(세션 수만큼, /api/state 폴링당 — 무시 가능한 비용). 파일 없음/파싱 실패=null(미상).
//   working이 오래되면 stale로 간주(크래시한 세션이 영원히 '진행중' 표시되는 것 방지).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ACT_DIR = fileURLToPath(new URL('../workspace/activity/', import.meta.url));
const WORKING_STALE = 10 * 60 * 1000; // working이 이보다 오래되면 미상(크래시/이탈 방어)
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// project 폴더명 · role → 'working'|'waiting'|'attention'|null. 훅 키(activity-hook.mjs)와 동일 규칙.
export function getActivity(project, role) {
  try {
    const j = JSON.parse(readFileSync(join(ACT_DIR, `${sanitize(project)}__${sanitize(role)}.json`), 'utf8'));
    if (!j || !j.state) return null;
    if (j.state === 'working' && Date.now() - (Number(j.ts) || 0) > WORKING_STALE) return null;
    return j.state;
  } catch { return null; }
}
