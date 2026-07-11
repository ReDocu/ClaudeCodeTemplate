// 단체 핸드오버 오케스트레이터 — "모든 Claude 세션: handover.md 갱신 → /exit → 터미널 복귀".
// 세션별 상태기계: queued → working(턴 진행) → exiting(/exit 전송) → done
//                  실패 갈래: error(전송 실패) · timeout(턴/종료 미완)
// 판정 근거: 턴 종료 = 트랜스크립트 lastEvent==='text' + QUIET_MS 조용(sessionActivity),
//           종료 확인 = 프로세스 실측 claudeAlive(pid)===false(proc.js).
// 한계: 승인 대기에 걸린 세션은 턴이 안 끝나 timeout으로 보고된다(건너뛰고 나머지는 계속).
//       같은 cwd에 claude 세션 여럿이면 최신 트랜스크립트를 공유해 판정이 섞일 수 있음.
import { sendLine } from './wmux.js';
import { buildState } from './state.js';
import { sessionActivity } from '../live/transcript.js';
import { claudeAlive, invalidateProc, procReady } from '../live/proc.js';

const DEFAULT_PROMPT = 'handover.md를 이 세션의 현재 작업 기준으로 갱신해줘. 갱신만 하고 다른 작업은 시작하지 마. 완료하면 추가 질문 없이 턴을 끝내.';
const QUIET_MS = 8_000;              // 턴 종료 발화 후 이만큼 조용하면 완료 판정
const TICK_MS = 5_000;
const TURN_TIMEOUT_MS = 15 * 60_000; // 프롬프트 전송 → 턴 완료 허용 시간
const EXIT_TIMEOUT_MS = 60_000;      // /exit → 프로세스 소멸 대기(1회 재전송 포함)
const EXIT_BLIND_MS = 15_000;        // pid 없어 실측 불가일 때 이만큼 지나면 성공 간주

let _job = null;

export function handoverSnapshot() {
  if (!_job) return null;
  return {
    running: _job.running,
    startedAt: _job.startedAt,
    finishedAt: _job.finishedAt || null,
    items: _job.items.map((i) => ({ key: i.key, team: i.team, role: i.role, phase: i.phase, err: i.err || null })),
  };
}

// claude-on(ready/working) 세션 전체가 대상. waiting(승인 대기)은 프롬프트를 밀어넣으면
// 승인 응답으로 오인될 수 있어 제외 — 스냅샷의 timeout/제외 내역으로 사용자가 후속 조치.
export async function startHandover({ text } = {}) {
  if (_job?.running) throw new Error('핸드오버가 이미 진행 중');
  const st = await buildState();
  const items = Object.entries(st.sessions || {})
    .filter(([, s]) => s.st === 'ready' || s.st === 'working')
    .map(([key, s]) => ({
      key, team: s.team, role: s.role, surface: s.surface, cwd: s.cwd, pid: s.pid,
      phase: 'queued', sentAt: 0, exitAt: 0, exitRetried: false, err: null,
    }));
  _job = { running: true, startedAt: Date.now(), finishedAt: null, prompt: text || DEFAULT_PROMPT, items };
  if (!items.length) { _job.running = false; _job.finishedAt = Date.now(); }
  else _run().catch(() => { _job.running = false; _job.finishedAt = Date.now(); });
  return handoverSnapshot();
}

async function _run() {
  const job = _job;
  // ① 프롬프트 전송 — 세션별 surfaceId 명시 타깃(오발송 불가). surface 미상이면 전송하지 않음.
  for (const it of job.items) {
    if (!it.surface) { it.phase = 'error'; it.err = 'surface 미상 — 전송 생략'; continue; }
    try {
      await sendLine(job.prompt, it.surface);
      it.sentAt = Date.now(); it.phase = 'working';
    } catch (e) { it.phase = 'error'; it.err = String(e.message || e); }
  }
  // ② 감시 루프 — 턴 종료 → /exit → 프로세스 소멸 확인
  while (job === _job && job.items.some((i) => i.phase === 'working' || i.phase === 'exiting')) {
    await new Promise((r) => setTimeout(r, TICK_MS));
    for (const it of job.items) {
      try {
        if (it.phase === 'working') {
          const act = sessionActivity(it.cwd);
          const turnDone = act && act.mtimeMs > it.sentAt && act.lastEvent === 'text'
            && (Date.now() - act.mtimeMs) >= QUIET_MS;
          if (turnDone) {
            await sendLine('/exit', it.surface);
            it.exitAt = Date.now(); it.phase = 'exiting'; invalidateProc();
          } else if (Date.now() - it.sentAt > TURN_TIMEOUT_MS) {
            it.phase = 'timeout'; it.err = '턴 미완료 — 승인 대기 중이거나 장시간 작업';
          }
        } else if (it.phase === 'exiting') {
          await procReady();
          const alive = claudeAlive(it.pid);
          if (alive === false) it.phase = 'done';
          else if (alive === null && Date.now() - it.exitAt > EXIT_BLIND_MS) it.phase = 'done'; // 실측 불가 — 시간 경과로 간주
          else if (Date.now() - it.exitAt > EXIT_TIMEOUT_MS) {
            if (!it.exitRetried) {
              it.exitRetried = true; it.exitAt = Date.now();
              await sendLine('/exit', it.surface);
            } else { it.phase = 'timeout'; it.err = 'claude 종료 확인 실패'; }
          }
        }
      } catch (e) { it.phase = 'error'; it.err = String(e.message || e); }
    }
  }
  job.running = false; job.finishedAt = Date.now();
}
