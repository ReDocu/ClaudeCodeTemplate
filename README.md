# Claude Cockpit

> 여러 Claude Code 세션을 **프로젝트(팀)별 · 역할별**로 한 대시보드에서 관찰·제어·인수인계하는 로컬 관제 도구.
> 새 mux나 터미널을 만들지 않고, **wmux 위에 얇게 얹는 오케스트레이션 레이어**.

- **상태**: 실동작 — 대시보드가 실제 wmux에 붙어 세션 스폰·종료·상태 3분류·세션 상세·커넥터·usage·단체 핸드오버까지 라이브로 동작 (진행 기록: [handover.md](handover.md))
- **환경**: Windows 11 · wmux 0.13.0 · Claude Code · Node 20+ · **npm 런타임 의존성 0**

## 왜 만드는가

Claude Code로 여러 작업을 동시에 굴리면 터미널이 흩어지고, 어느 프로젝트의 어떤 세션이 지금 무슨 상태인지 파악할 수 없다. 세션이 끝나면 "무엇을 했는지"도 휘발된다.

**타깃**: 여러 프로젝트(또는 여러 클라이언트)를 병렬로 진행하는 1인 개발자·프리랜서.

**핵심 가치**
1. **트리아지 우선 관제** — 정상은 침묵하고, **조치가 필요한 세션(승인 대기·포트 다운)만** 상단에 띄운다
2. **점프 없는 판단** — 세션 카드 클릭 → 드로어에서 "지금 하는 일·활동 피드·변경 파일"을 확인, 개입이 필요할 때만 wmux로 점프
3. **선언적 팀 운영** — `root/<팀>/team.json` 폴더 선언이 진실. 부트 때 wmux를 선언에 수렴(멱등)시키고, 선언 밖 세션은 표시만(자동 종료 금지)

## 빠른 시작

**`ClaudeCockpit.exe` 더블클릭** — wmux 보장 → 서버 → 팀 수렴 → 기본 브라우저에 대시보드. 멱등이라 몇 번 눌러도 안전. (막히면 `start.cmd`)

CLI로 직접:

```bash
node teamctl/bin/teamctl.js boot              # 콜드 부트 (위와 동일)
node teamctl/bin/teamctl.js serve             # 서버만 (기본 포트 7420)
node teamctl/bin/teamctl.js up [--dry]        # 폴더 선언 → wmux 수렴만
```

사용법은 **[Manual.md](Manual.md)** (초보자용 화면 안내·FAQ) 참조.

## 개념 매핑

모든 개념이 wmux 네이티브 프리미티브로 실현된다.

| 기획 개념 | 실체 |
|-----------|------|
| 팀 (프로젝트) | wmux workspace + `root/<팀>/team.json` 선언 |
| 역할 (세션) | workspace 내 pane의 agent (터미널로 시작, ▶ 버튼으로 claude 전환) |
| 관리자 | HTML 대시보드 (`dashboard-triage.html`, 기본 브라우저) |
| 인수인계 | 각 세션의 `handover.md` 갱신 → `/exit` (⏻ 전체 핸드오버) |

## 아키텍처

```
root/<팀>/team.json (desired·폴더가 진실) ──reconcile(멱등)──▶ wmux (actual)
                                                            drift는 표시만

브라우저 대시보드 ── fetch(127.0.0.1:7420 + 토큰) ──▶ teamctl serve
                                                       ├─ core/wmux.js (파이프 직결 — 모든 wmux 명령의 단일 창구)
                                                       ├─ live/* (트랜스크립트 tail·프로세스 실측·usage·git diff)
                                                       └─ connectors/* (git·env·node·ports 프로브)
```

## 지금 동작하는 것

| 분류 | 기능 |
|------|------|
| 관찰 | 팀/세션 카드 · 상태 분류(⏸입력대기/●작업중/◆명령대기/❯터미널 — 프로세스·트랜스크립트 실측) · 트리아지 존 · 드로어 세션 상세(now·피드·변경파일) · git/env/node/ports 커넥터 · 글로벌 포트맵 · usage 배지(오늘·5h·한도 비교) |
| 행동 | 세션 스폰(중복이면 열려있는 세션 채택) · ▶ Claude 시작(이미 켜져 있으면 재실행 생략) · wmux 점프 · 종료(확인+실행취소) · ⏻ 전체 핸드오버 · 폴더/원격 저장소 열기 |
| 운영 | 콜드 부트 exe(F12) · wmux 위치 자동 발견(F12b) · 새 팀에 ops 세션 디폴트(F13) · 오프라인 시 데모 폴백 |

## 폴더 구조

```
├─ dashboard-triage.html   # 대시보드 (단일 파일 — teamctl이 상대경로 참조, 이동 금지)
├─ teamctl/                # 로컬 컨트롤 브리지 (bin/ · src/core|live|connectors|server)
├─ root/                   # 팀 선언 (폴더=진실): <팀>/team.json · ops/ · roles/
├─ ClaudeCockpit.exe · start.cmd · launcher/   # 콜드 부트 런처
├─ doc/backup/planner/     # 연구·기획 체인 보관 (01 인터뷰 → … → 12 기능 매트릭스, 구 목업·프로토)
├─ planner.md · Tech.md    # 제품 결정 로그(D#·F#) · 기술 설계
├─ handover.md             # 세션별 개발 기록 (최신 상태의 진실)
├─ CLAUDE.md               # Claude Code용 코드맵 (수정 지점 인덱스 · 불변 규칙)
└─ Manual.md               # 초보자용 사용 설명서
```

## 원칙

- **재발명 금지** — PTY·렌더·detach는 wmux가 다 한다. Cockpit은 관찰·수렴·인수인계만.
- **의존성 최소** — Node 내장 모듈 + wmux/git/claude CLI만. 런타임 npm 의존성 0.
- **보안** — 서버는 `127.0.0.1` + 토큰 전용, 원격 비목표. `.env` 값은 절대 저장·표시하지 않음(키 존재만).
- **파괴적 동작은 더 안전한 마찰** — 종료는 확인+실행취소. 선언 밖 세션 자동 종료 금지.
- **우아한 성능 저하** — wmux 다운 시 데모 폴백, 프로브 실패 시 표시 생략. 어떤 프로브도 폴링을 막지 않는다.

## 문서 안내

| 문서 | 내용 |
|------|------|
| [Manual.md](Manual.md) | 사용 설명서 — 시작법·화면 읽는 법·FAQ |
| [handover.md](handover.md) | 세션별 개발 기록 — **재개 시 여기부터** |
| [CLAUDE.md](CLAUDE.md) | 개발자/Claude용 코드맵 — 수정 지점·불변 규칙 |
| [planner.md](planner.md) | 제품 기획 — 결정 로그(D1~D14) · 기능 맵(F1~F8) |
| [Tech.md](Tech.md) | 기술 설계 — 데이터 모델·wmux 통합·API |
| [teamctl/README.md](teamctl/README.md) | 브리지 API 상세 |
| doc/backup/planner/01~12 | 연구 체인 보관 — 인터뷰→전략→레드팀→PRD→시장조사→기능 매트릭스 |

## 다음 작업 (요약 — 상세는 handover.md §9)

- 인수인계 accept/kick-back 루프(F6) · 드로어 포커스 이동/복귀(F9) · 온보딩 빈 상태(F23)
- 검증 게이트: stale 라벨(E1)·인라인 승인(E2)·청구 롤업(E3)
- optional 커넥터(supabase/github/docker) · `expectedPorts` 포트 다운 판정 · MCP 스캔(D15)
