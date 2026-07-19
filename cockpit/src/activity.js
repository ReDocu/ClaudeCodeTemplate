// 세션 활동 상태 읽기 — Claude Code 훅(bin/activity-hook.mjs)이 쓴 상태 파일을 읽어 대시보드에 노출.
//   working=명령 진행중 · waiting=응답 완료 대기 · attention=입력/권한 대기.
//   작은 JSON sync read(세션 수만큼, /api/state 폴링당 — 무시 가능한 비용). 파일 없음/파싱 실패=null(미상).
//   working이 오래되면 stale로 간주(크래시한 세션이 영원히 '진행중' 표시되는 것 방지).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ACT_DIR = fileURLToPath(new URL('../workspace/activity/', import.meta.url));
const WORKING_STALE = 10 * 60 * 1000; // working이 이보다 오래되면 미상(크래시/이탈 방어)
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// 훅 설치 여부 실측 — ~/.claude/settings.json의 훅 커맨드가 **이 리포의** activity-hook.mjs를 가리키는지
//   (대시보드 설치 안내 배너 + 서버 기동 시 자동 수리 판정용). 파일명만 보면 리포를 옮기거나 이름 바꾼 뒤
//   옛 경로 훅도 '설치됨'으로 오판해 조용히 실패한다 — 그래서 절대경로로 대조한다(옛 경로만 있으면 미설치=수리 필요).
//   커맨드는 activity-hook.mjs cmdFor가 SELF를 forward-slash로 넣으므로 같은 형태·소문자(윈도 대소문자 무시)로 비교.
//   TTL 캐시로 폴링당 홈 read 방지, 설치 직후엔 invalidateHook()으로 즉시 재실측. settings.json 없음/읽기 실패=미설치.
const SETTINGS = join(homedir(), '.claude', 'settings.json');
const HOOK_PATH = fileURLToPath(new URL('../bin/activity-hook.mjs', import.meta.url)).replace(/\\/g, '/').toLowerCase();
const HOOK_TTL = 30 * 1000;
let _hook = { v: false, at: 0 };
export function invalidateHook() { _hook.at = 0; }
export function hookInstalled() {
  if (_hook.at && Date.now() - _hook.at < HOOK_TTL) return _hook.v;
  let v = false;
  try { v = readFileSync(SETTINGS, 'utf8').replace(/\\/g, '/').toLowerCase().includes(HOOK_PATH); } catch { /* 없음=미설치 */ }
  _hook = { v, at: Date.now() };
  return v;
}

// project 폴더명 · role → { state, model, effort } | null. 훅 키(activity-hook.mjs)와 동일 규칙.
//   state: 'working'|'waiting'|'attention'|null(미상/stale). model·effort는 훅이 함께 기록한
//   세션 실측(모델=트랜스크립트 꼬리 · effort=훅 페이로드) — 썩지 않는 값이라 stale이어도 유지.
export function getActivity(project, role) {
  try {
    const j = JSON.parse(readFileSync(join(ACT_DIR, `${sanitize(project)}__${sanitize(role)}.json`), 'utf8'));
    if (!j) return null;
    let state = j.state || null;
    if (state === 'working' && Date.now() - (Number(j.ts) || 0) > WORKING_STALE) state = null;
    return { state, model: j.model || null, effort: j.effort || null };
  } catch { return null; }
}
