// workspace git 추적 (FS-21) — 활성 workspace가 바뀌면 그 저장소 페이지를 멀티플렉서 내장
// 브라우저 패널에 띄운다. 코크핏의 **유일한 백그라운드 루프** — 나머지는 전부 요청 기반이다.
//
// 왜 루프인가: wmux는 이벤트를 밀어주지 않고(파이프는 요청/응답뿐), 서버는 누가 부를 때만 파이프를
// 본다. 사용자가 wmux에서 Ctrl+1~9로 직접 전환하는 걸 잡으려면 폴링 외에 방법이 없다.
// 대시보드 폴링에 얹지 않은 이유: 대시보드를 닫으면 추적이 조용히 멈춰 "왜 안 되지"가 된다.
// 파이프 부하는 추가되지 않는다 — getState()의 TTL 캐시(1.5s)를 대시보드 폴링과 공유한다.
//
// 설계 규칙:
//  ① **변경 시 1회만** 이동 — 매 틱 재이동하면 패널이 2초마다 리로드돼 스크롤·로그인 상태가 날아간다.
//  ② 원격을 못 구하면 **패널을 건드리지 않는다** — 빈 화면·엉뚱한 페이지로 덮는 것보다 그대로가 낫다.
//  ③ 실패는 삼킨다(로그만) — 추적은 부가 기능이라 서버·폴링을 절대 막지 않는다(§9-⑥).
//  ④ 오프라인/재연결(epoch 변화)에선 **기준선만 잡고 이동하지 않는다** — wmux 재시작마다 패널이
//     제멋대로 바뀌지 않게. reconcile(lifecycle.js)의 epoch 처리와 같은 규약.
//  ⑤ **cockpit 자기 유발 전환은 추적하지 않는다** — 스폰 ① 초점 이동·attach 점프·워크스페이스
//     생성이 부르는 noteSelect()가 기준선만 갱신한다. 이 기능의 계약은 "사용자가 직접 바꾼
//     전환(Ctrl+1~9)"이지, cockpit이 일으킨 전환에 패널을 덮는 게 아니다.
//  ⑥ **안정화 디바운스** — 새 활성 ws가 STABLE틱(2틱≈4s) 연속 관측될 때만 전환으로 인정.
//     실측(중앙 로그 57건 — 1~2초 간격 연쇄 이동)에서 스치는 전환이 패널을 반복해 덮었다.
//  ⑦ **같은 저장소 재이동 생략** — 마지막으로 실은 URL을 기억, 같으면 openWeb을 건너뛴다
//     (재이동은 스크롤·로그인만 날린다). 로컬 전용(원격 없음) 저장소는 재시도하지 않는다.
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { ROOT, readConfig, patchConfig } from './registry.js';
import { getGit } from './git.js';
import { getState, name as MUX, canOpenWeb, openWeb } from './mux.js';
import { logEvent } from './log.js';

const TICK = 2000;

// workspace cwd → 그 workspace와 연결된 git 저장소.
// **wmux의 workspace.cwd는 활성 pane을 따라 움직인다(실측 2026-07-16)** — 같은 workspace가 어떤 땐
// `root/<proj>`, 어떤 땐 `root/<proj>/ops`로 나온다. 사용자가 cd하면 하위 폴더로도 내려간다.
// 그래서 cwd 한 겹만 보면 추적이 조용히 멎는다 → 위로 거슬러 올라가 저장소를 찾는다.
//
// 다만 무작정 올라가면 **코크핏 저장소 자신**(root/의 조상 = ClaudeCodeTemplate/.git)을 잡아
// 엉뚱한 페이지를 띄운다. 그래서 두 겹의 방어:
//   ① 코크핏 프로젝트 루트는 ops/를 **먼저** 본다 — 루트는 저장소가 아니라는 격리 규칙(registry.js).
//   ② root/ 안이라면 `root/<프로젝트>/` 밖으로 절대 올라가지 않는다 — 못 찾으면 null(패널 불변).
// root/ 밖(코크핏이 모르는 workspace)이면 제한 없이 올라간다 — 그쪽은 cwd가 곧 사용자 저장소다.
const _norm = (p) => resolve(p).replace(/[\\/]+$/, '').toLowerCase();
function projectRootOf(cwd) { // cwd가 root/<proj>/… 이면 그 <proj> 폴더, 아니면 null
  const r = _norm(ROOT), c = _norm(cwd);
  if (c !== r && !c.startsWith(r + '\\') && !c.startsWith(r + '/')) return null;
  const rel = c.slice(r.length).split(/[\\/]/).filter(Boolean);
  return rel.length ? join(ROOT, rel[0]) : null;
}
export function repoDirOf(cwd) {
  if (!cwd) return null;
  if (existsSync(join(cwd, 'ops', '.git'))) return join(cwd, 'ops'); // ① 프로젝트 루트 — git은 ops에만
  const stop = projectRootOf(cwd);                                    // ② 경계(root/ 안일 때만)
  let d = resolve(cwd);
  for (;;) {
    if (existsSync(join(d, '.git'))) return d;
    if (stop && _norm(d) === _norm(stop)) return null;   // root/<프로젝트> 위로 안 나감 — 코크핏 저장소 오탐 차단
    const up = dirname(d);
    if (up === d) return null;                           // 드라이브 루트 도달
    d = up;
  }
}

// 설정 — 기본 켜짐. 끄면 루프는 계속 돌되 이동만 하지 않는다(서버 재시작 없이 즉시 반영).
export const isEnabled = () => readConfig().followWorkspaceGit !== false;
export function setEnabled(on) {
  patchConfig({ followWorkspaceGit: !!on });
  _lastWsId = null; _pend = null; _pendN = 0; // 껐다 켜도 현재 workspace를 기준선으로 다시 잡는다 — 켠 직후 즉시 덮지 않게
  return isEnabled();
}

let _timer = null;
let _lastWsId = null;   // 마지막으로 판정한 활성 workspace — 규칙 ①의 상태
let _seenEpoch = null;  // 연결 세대 — 규칙 ④
let _busy = false;      // 틱 겹침 방지(느린 왕복이 쌓이지 않게)
let _lastUrl = null;    // 패널에 마지막으로 실은 URL — 같은 저장소 재이동 생략(규칙 ⑦)
let _pend = null, _pendN = 0; // 안정화 디바운스(규칙 ⑥) — 후보 ws와 연속 관측 횟수
const STABLE = 2;       // 전환 인정에 필요한 연속 관측 틱 수(2틱 ≈ 4s)

// cockpit 자기 유발 전환 통지(규칙 ⑤) — 스폰 ① 초점 이동·attach 점프·워크스페이스 생성이 부른다.
// 기준선만 갱신해 follow가 이를 사용자 전환으로 오인해 패널을 덮지 않게 한다.
export function noteSelect(wsId) {
  if (!wsId) return;
  _lastWsId = wsId; _pend = null; _pendN = 0;
}

export async function tick() {
  if (_busy) return;
  _busy = true;
  try {
    const state = await getState(); // 논블로킹 — stale 허용(대시보드 폴링과 캐시 공유)
    if (!state.live) return;        // 오프라인 — 아무 판정도 하지 않는다(규칙 ④)
    const active = state.workspaces.find((w) => w.isActive);
    if (!active) return;

    // 재연결/부팅 첫 관측 — 기준선만 잡고 이동하지 않는다(규칙 ④)
    if (state.epoch !== _seenEpoch) { _seenEpoch = state.epoch; _lastWsId = active.id; _pend = null; return; }
    if (active.id === _lastWsId) { _pend = null; return; } // 변경 없음(규칙 ①)

    // 안정화 디바운스(규칙 ⑥) — 같은 새 활성 ws가 STABLE틱 연속일 때만 전환으로 인정.
    // 연속 스위칭·스폰 직후 반동 같은 스치는 전환은 여기서 걸러진다.
    if (_pend !== active.id) { _pend = active.id; _pendN = 1; return; }
    if (++_pendN < STABLE) return;
    _pend = null; _pendN = 0;

    const prev = _lastWsId;
    _lastWsId = active.id;
    if (prev === null) return;      // 기준선 미확립(껐다 켠 직후 등) — 이번엔 잡기만
    if (!isEnabled()) return;

    const dir = repoDirOf(active.cwd);
    if (!dir) return;               // 저장소 아님 — 패널 불변(규칙 ②)
    const g = getGit(dir);          // 논블로킹 — 콜드면 null
    if (!g) { _lastWsId = prev; _pend = active.id; _pendN = STABLE; return; } // 콜드(미실측) — 다음 틱 즉시 재시도(디바운스 재대기 없음)
    if (!g.web) return;             // 실측 완료·원격 없음(로컬 전용) — 재시도 무의미, 기준선 확정(규칙 ②·⑦)
    if (g.web === _lastUrl) return; // 패널이 이미 그 저장소(규칙 ⑦) — 재이동은 스크롤·로그인만 날린다
    await openWeb(g.web);
    _lastUrl = g.web;
    logEvent('info', null, 'follow', { k: 'log.follow.tracking', p: { target: active.title || active.id, url: g.web, mux: MUX } });
  } catch (e) {
    logEvent('error', null, 'follow', { k: 'log.follow.error', p: { err: e.message } }); // 규칙 ③ — 삼키고 계속
  } finally { _busy = false; }
}

// serve()가 시작. canOpenWeb=false(cmux)면 아예 돌지 않는다 — 이동할 수단이 없는데 폴링만 하면 낭비.
export function startFollow() {
  if (_timer) return { started: false, reason: 'already' };
  if (!canOpenWeb) return { started: false, reason: 'unsupported' };
  _timer = setInterval(() => { tick().catch(() => {}); }, TICK);
  _timer.unref?.(); // 이 루프가 프로세스 종료를 붙잡지 않게(전체 종료 흐름 비차단)
  return { started: true };
}
export function stopFollow() {
  if (_timer) clearInterval(_timer);
  _timer = null; _lastWsId = null; _seenEpoch = null; _lastUrl = null; _pend = null; _pendN = 0;
}
