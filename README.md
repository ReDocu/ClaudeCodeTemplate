# Claude Cockpit

> 여러 Claude Code 세션을 **프로젝트별 · 역할별**로 한 대시보드에서 관찰·제어하는 로컬 관제 도구.
> 새 터미널 멀티플렉서를 만들지 않고, **wmux 위에 얇게 얹는 오케스트레이션 레이어**.

- **상태**: 실동작 — 대시보드가 실제 wmux에 붙어 프로젝트 생명주기·세션 개별 스폰·claude 켜짐 실측·**세션 활동 배지**·활성 포트맵·기능 인벤토리·usage 게이지까지 라이브로 동작
- **환경**: Windows 11 · wmux · Claude Code · Node 20+ · **npm 런타임 의존성 0**
- **정본 시스템**: `cockpit/` (구 `teamctl/`는 리라이트로 폐기 — 미추적 잔존물, 재배선 금지)

![ClaudeCockpit 대시보드 개요](screenshot/overview.png)

*한 화면 관제: 프로젝트 카드(진행중/대기중/종료) · 세션 3단계(○ 미연결 → [＋ 세션 활성화] → [▶ Claude 실행]) · 활성 포트맵 · 기능 인벤토리*

---

## ⬇️ 다운로드 · 실행

### 📥 [최신 릴리스 다운로드][releases] — 현재 **v0.1.0**

1. **[`ClaudeCockpit-v0.1.0.zip`][zip]** 바로 다운로드 → 압축 해제
2. **`ClaudeCockpit.exe`** 더블클릭 (실행이 막히면 `start.cmd`)
3. 자동으로 wmux 보장 → 서버 → 브라우저에 대시보드가 열립니다 (`http://127.0.0.1:7420/`)

> **요구사항**: Windows 11 · Node.js 20+ · wmux · Claude Code(`claude` 명령). **설치할 패키지 없음**(npm 의존성 0).
> 처음 사용이라면 [Manual.md](Manual.md)와 [시각 가이드](ClaudeCockpit-Guide.html)를 함께 보세요.

---

## 📖 어디서부터 읽을까

| 나는… | 먼저 읽으세요 |
|---|---|
| **처음 써봐요** | **[Manual.md](Manual.md)** (초보자용 설명서) → **[ClaudeCockpit-Guide.html](ClaudeCockpit-Guide.html)** (화면 예시 시각 가이드) |
| **책상에 붙여둘 요약이 필요해요** | **[ClaudeCockpit-Cheatsheet.html](ClaudeCockpit-Cheatsheet.html)** (인쇄용 1페이지 · `Ctrl+P`) |
| **기능·API를 자세히 알고 싶어요** | **[Tech.md](Tech.md)** (기능명세서 — 전 기능·엔드포인트·규칙) |
| **문제가 생겼거나 제안이 있어요** | **[문의 폼][form]** 하나로 접수 (1분) |

---

## 왜 만드는가

Claude Code로 여러 작업을 동시에 굴리면 터미널이 흩어지고, 어느 프로젝트의 어떤 세션이 지금 켜져 있는지·무엇을 하는 중인지 파악하기 어렵다.

**타깃**: 여러 프로젝트(또는 여러 클라이언트)를 병렬로 진행하는 1인 개발자·프리랜서.

**핵심 가치 3가지**

1. **프로젝트 생명주기 관제** — 프로젝트를 **대기중 / 진행중 / 종료됨**으로 나열하고, 활성화한 프로젝트만 wmux 워크스페이스로 연다. 세션은 역할별로 하나씩 열고(개별 스폰), 종료도 개별/전체 두 경로뿐(자동 종료 없음).
2. **점프 없는 판단** — 세션에 들어가지 않고도 **claude 켜짐 + 활동(진행중/대기중/입력 대기)** 을 배지로 보고, 개입이 필요할 때만 wmux로 점프한다.
3. **선언적 · 격리 운영** — `root/<프로젝트>/project.json` 폴더 선언이 진실. 각 프로젝트는 `ops/` 안에 자체 git·CLAUDE.md를 가져 cockpit 정책과 **격리**된다.

---

## 빠른 시작

**`ClaudeCockpit.exe` 더블클릭** — wmux 보장 → 서버 → active 프로젝트 재수렴 → 기본 브라우저에 대시보드. 멱등이라 몇 번 눌러도 안전 (막히면 `start.cmd`).

CLI로 직접:

```bash
node cockpit/bin/cockpit.js boot          # 콜드 부트 (위와 동일)
node cockpit/bin/cockpit.js serve          # 서버만 (기본 포트 7420)
node cockpit/bin/cockpit.js boot --setup   # wmux 설치 경로 재지정
```

대시보드 열리면: **[＋ 새 프로젝트]** → **[▶ 활성화]** → 각 역할 **[＋ 세션 활성화]** → **[▶ Claude 실행]**.
(자세한 그림 설명은 [Manual.md](Manual.md) / [시각 가이드](ClaudeCockpit-Guide.html))

---

## 💬 문의하기

버그·문의·제안이 있으면 **문의 폼 하나로** 받습니다 (1분).

### 👉 [문의 폼 열기][form]

빠른 처리를 위해 폼에 담아 주세요 — **유형(버그/문의/요청) · 앱 버전 · Windows 버전 · 내용**, 버그라면 **서버 콘솔의 마지막 `[wmux✗]` 줄**(원인 진단에 큰 도움).

---

## 핵심 기능

| 분류 | 기능 |
|---|---|
| **관찰** | 프로젝트 카드(대기중/진행중/종료됨) · **claude 켜짐 실측**(on/off/unknown) · **세션 활동 배지**(⏳ 진행중 / ⌛ 대기중 / ⚠ 입력 대기 — Claude 훅) · 세션 드로어(상태·작업 폴더·기능 인벤토리·점프·폴더·세션 비활성화) · git 칩(원격 웹링크) · 활성 포트맵(프로젝트 귀속) · Global 기능 인벤토리 · usage 게이지 3윈도(5시간·주간·주간 Opus) · 미연결(외부) 세션 · 중앙 이벤트 로그 |
| **행동** | 프로젝트 생성/연동/`＋ git 주소`(clone) · 역할 추가/제거 · `▶ 활성화`(워크스페이스만, 세션 스폰 없음) · `＋ 세션 활성화`(역할별 개별 스폰) · `＋ 모든 세션 활성화`(빠진 전체) · `▶ Claude 실행`(이미 켜져 있으면 생략) · `↗ 세션 열기`(wmux 점프) · `세션 비활성화`(개별) · `비활성화`(전체·확인) · `아카이브`/`재개` · `＋ 링크` · `＋ 원격`(ops에 git clone/연결) |
| **운영** | 콜드 부트 exe · wmux 위치 자동 발견 · boot 시 active 자동 재수렴 · **wmux 명령 콘솔 로깅**(`[wmux→]`/`[wmux✗]` 진단) · offline/demo 배지 구분 |

> 세션은 **3단계**로 연다: `○ 미연결` → `[＋ 세션 활성화]` → 연결 확인 → `[▶ Claude 실행]`. 활성화는 방을 여는 것일 뿐 세션을 자동 생성하지 않는다.

---

## 개념 매핑

| 개념 | 실체 |
|---|---|
| 프로젝트 | wmux workspace + `root/<프로젝트>/project.json` 선언 |
| 역할(세션) | workspace 내 pane의 agent (터미널로 시작 → `▶` 로 claude 전환) |
| ops | 프로젝트마다 1번 고정 역할 (`root/<프로젝트>/ops/` — **git 저장소·배포·운영 기준**) |
| 관리자 | HTML 대시보드 (`cockpit/dashboard.html`, 기본 브라우저) |

---

## 아키텍처

```
root/<프로젝트>/project.json (desired·폴더가 진실) ──lifecycle──▶ wmux (actual)
      activate=워크스페이스 보장 · spawn=역할별 개별 스폰 · killSession/deactivate=명시 종료

브라우저 대시보드 ── fetch(127.0.0.1:7420 + 토큰) ──▶ cockpit serve (src/server.js · buildState)
       ├─ wmux.js   (파이프 직결 — 모든 wmux 명령의 단일 창구 · 명령 콘솔 로깅)
       ├─ proc.js   (claude 켜짐/꺼짐 프로세스 실측)
       ├─ activity.js  (세션 활동 — Claude Code 훅 상태 읽기)
       ├─ ports·caps·usage·git  (온디맨드 프로브 · 논블로킹 캐시)
       └─ log.js    (중앙 이벤트 로그 JSONL)

Claude Code 훅(bin/activity-hook.mjs) ──▶ cockpit/workspace/activity/*.json ──▶ activity.js
```

핵심 데이터 계약: `GET /api/state = { projects, unlinked, ports }`. 자세히는 [Tech.md](Tech.md).

---

## 폴더 구조

```
├─ cockpit/                     # 정본 시스템
│  ├─ dashboard.html            #   대시보드 (단일 파일 · 인라인 JS · 의존 0)
│  ├─ bin/cockpit.js            #   CLI: serve · boot
│  ├─ bin/activity-hook.mjs     #   Claude Code 훅 런타임 + 전역 settings 설치/제거
│  ├─ src/*.js                  #   registry·wmux·lifecycle·proc·activity·log·ports·caps·usage·git·server
│  └─ workspace/                #   런타임(config·logs·usage·activity) — gitignore
├─ root/                        # 프로젝트 선언(폴더=진실): <프로젝트>/project.json · ops/(git) · <역할>/
├─ ClaudeCockpit.exe · start.cmd · launcher/   # 콜드 부트 런처
├─ README.md                    # (이 문서) 인트로 · 문서 허브
├─ Manual.md                    # 초보자용 사용 설명서
├─ ClaudeCockpit-Guide.html     # 시각 가이드 (화면 예시 + 주석)
├─ ClaudeCockpit-Cheatsheet.html# 인쇄용 1페이지 치트시트
└─ Tech.md                      # 기능명세서 (전 기능·API·규칙)
```

---

## 원칙

- **재발명 금지** — PTY·렌더·detach는 wmux가 다 한다. Cockpit은 관찰·수렴만.
- **의존성 최소** — Node 내장 모듈 + wmux/git/claude CLI만. 런타임 npm 의존성 0.
- **보안** — 서버는 `127.0.0.1` + 토큰 전용, 원격 비목표. `.env` 값은 저장·표시하지 않음(존재만).
- **파괴적 동작은 안전한 마찰** — 세션 종료는 개별/전체 두 경로뿐, 둘 다 확인. 자동 종료 없음. **되돌리기 없음**.
- **우아한 성능 저하** — wmux 다운 시 demo/offline 배지, 프로브 실패 시 표시 생략. 어떤 프로브도 폴링을 막지 않는다.
- **프로젝트 격리** — `root/<프로젝트>/`는 cockpit과 무연계 독립 프로젝트. **git은 `ops/`에만**, 자체 CLAUDE.md로 cockpit 규칙을 상속하지 않는다.

---

## 참고: Claude 토큰 소모

대시보드의 **관찰·제어는 전부 로컬 동작이라 Claude 토큰을 쓰지 않는다.** 폴링·드로어·기능 인벤토리·usage 게이지는 wmux 파이프와 로컬 파일만 읽는다(usage 게이지는 소비량의 *측정*이지 *소비*가 아니다). 활동 배지도 Claude Code 훅이 남긴 로컬 상태 파일을 읽을 뿐이다.

토큰이 관련되는 경로는 **[▶ Claude 실행]** 뿐이며, 그것도 claude를 *켜기만* 한다(기동 자체는 API 호출 없음 — 토큰은 그 세션에 첫 프롬프트를 줄 때부터). "폴링마다 토큰이 드는 구조는 만들지 않는다"가 설계 원칙이다.

---

## 문서 지도 (전체)

| 문서 | 대상 | 내용 |
|---|---|---|
| [Manual.md](Manual.md) | 사용자(초보자) | 시작법·화면 읽는 법·세션 3단계·FAQ |
| [ClaudeCockpit-Guide.html](ClaudeCockpit-Guide.html) | 사용자 | 화면 예시 재현 + 번호 주석 시각 가이드 |
| [ClaudeCockpit-Cheatsheet.html](ClaudeCockpit-Cheatsheet.html) | 사용자 | 인쇄용 1페이지 요약 |
| [Tech.md](Tech.md) | 개발자 | 기능명세서 — FS·API·상태 전이·불변 규칙 |

<!-- 문의 폼 링크(단일 교체 지점) — 바꾸려면 이 URL 한 줄만 수정하면 README 내 모든 "문의 폼" 링크에 반영됩니다. -->
[form]: https://docs.google.com/forms/d/e/1FAIpQLSfdAAODOXSfYg8bQp-WLewENrP_otXglztMzfR7bL678wqdHg/viewform

<!-- 릴리스 링크(단일 교체 지점) — 새 릴리스마다 [zip] 한 줄의 버전(v0.1.0 두 곳)과 위 "현재 vX.Y.Z" 표기만 갱신. -->
[zip]: https://github.com/ReDocu/ClaudeCodeTemplate/releases/download/v0.1.0/ClaudeCockpit-v0.1.0.zip
[releases]: https://github.com/ReDocu/ClaudeCodeTemplate/releases/latest
