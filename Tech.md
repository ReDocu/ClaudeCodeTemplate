# Tech.md — ClaudeCockpit 기능명세서

**대상**: ClaudeCockpit(리라이트 v1) 실동작 산출물 — `cockpit/`
**갱신**: 2026-07-13 (세션13 기준 — 코드 실측으로 작성)
**함께 읽을 것**: `CLAUDE.md`(코드맵·수정 지점·불변 규칙) · `handover.md`(세션별 진행) · `Manual.md`(사용법)

이 문서는 ClaudeCockpit에 **현재 내재된 기능**을 코드 기준으로 명세한다. 각 기능은 목적·동작·API·가드·관련 파일로 기술한다. 계획/미구현 항목은 §17(범위 밖)에만 둔다.

---

## 1. 개요

ClaudeCockpit은 여러 Claude Code 세션을 **세션에 들어가지 않고** 브라우저 대시보드에서 관찰·제어하는 로컬 관제 도구다.

- **3계층 매핑**: 관리자(wmux 사용자) ─ 프로젝트(wmux **workspace**) ─ 역할(workspace 안의 **agent**/pane).
- **전제 환경**: Windows 11 + wmux(0.13) + Node(내장 모듈만) + git CLI. **npm 런타임 의존성 0.**
- **경계**: 서버는 `127.0.0.1` 바인드 + `X-Cockpit-Token` 전용, **포트 7420 정본**(config로 재지정 가능). 원격 노출 비목표.
- **부트 체인**: `exe/boot` → wmux 보장(갓 기동 시 복원분 클린 슬레이트) → 서버 보장 → active 프로젝트 재수렴 → 기본 브라우저.

### 1.1 실동작 산출물

| 산출물 | 역할 |
|---|---|
| `cockpit/dashboard.html` | 단일 파일 대시보드(인라인 JS/CSS · 의존 0) |
| `cockpit/bin/cockpit.js` | CLI — `serve`·`boot` |
| `cockpit/bin/activity-hook.mjs` | Claude Code 훅 런타임 + 전역 settings 설치/제거 |
| `cockpit/src/*.js` | 브리지 모듈(§2.2) |
| `ClaudeCockpit.exe`·`start.cmd` | 콜드 부트 런처(boot에 위임) |
| `root/<프로젝트>/project.json` | 프로젝트 선언(진실의 원천) |
| `cockpit/workspace/` | 런타임(config·logs·activity — **gitignore**) |

---

## 2. 아키텍처

### 2.1 두 상태의 수렴

```
root/<프로젝트>/project.json  (desired — 폴더가 진실)      wmux  (actual — workspace·agent 실측)
        └ lifecycle: activate=워크스페이스 보장 · spawn=역할별 개별 스폰 · killSession=개별 종료
                     deactivate=일괄 kill+close · archive/reopen=선언 상태 전이. 무명령 자동 종료 없음.

브라우저 대시보드 ── fetch(same-origin·토큰) ─▶ server.js (유일 HTTP 레이어 · buildState)
```

핵심 원리: **선언(폴더)** 과 **실측(wmux·프로세스)** 을 매번 병합해 노출한다. 대시보드는 상태를 소유하지 않고 `GET /api/state`를 폴링한다.

### 2.2 모듈 지도

| 모듈 | 책임 |
|---|---|
| `server.js` | HTTP 레이어(유일) · `buildState`(선언⊕실측 병합) · 라우트 · 토큰 |
| `wmux.js` | 모든 wmux 명령의 단일 창구(파이프 직결) · 상태 캐시(`getState`/`getFresh`/`invalidate`) · `isDead` 필터 · **명령 콘솔 로깅** |
| `registry.js` | 프로젝트 선언 스캔·생성·연동 · 격리 스캐폴드 · ops git 스캐폴드 · 역할 폴더 · config 읽기/쓰기 |
| `lifecycle.js` | 생명주기 전이 · 워크스페이스 보장 · 개별 스폰/kill · 채택 판정 근거 |
| `proc.js` | claude on/off 프로세스 트리 실측(논블로킹 캐시) |
| `activity.js` | 세션 활동(working/waiting/attention) 상태 파일 읽기 |
| `bin/activity-hook.mjs` | Claude Code 훅 런타임 · 전역 `~/.claude/settings.json` 병합 설치/제거 |
| `ports.js` | 활성 포트맵(리스너 실측·프로젝트 귀속·노이즈 필터) |
| `caps.js` | 기능 인벤토리(global/세션 skill·agent·MCP — 이름·종류만) |
| `git.js` | git 칩(브랜치·원격·웹링크) · 원격 clone/connect · URL→이름 파생 |
| `log.js` | 중앙 이벤트 로그(JSONL) 기록·조회 |
| `bin/cockpit.js` | CLI — `serve`(서버) · `boot`(콜드 부트) |

### 2.3 데이터 계약 — `GET /api/state`

```
{ projects[], unlinked[], ports[] }
```

- **`projects[]`** = `{ name, status('active'|'idle'|'archived'), createdAt, archivedAt, links[], roles[{id}], wsLive, git{branch,remote,web}, sessions[] }`
- **`sessions[]`** = `{ role, agentId, connected, adopted, claude('on'|'off'|'unknown'), activity('working'|'waiting'|'attention'|null) }`
  - `connected` = 선언 역할 label 일치 또는 채택됨 · `activity`는 **claude on일 때만** 채워짐
- **`unlinked[]`** = `{ wsId, title, sessions[{role, agentId, claude}] }` — 프로젝트에 매칭 안 된 wmux workspace(직접 연 외부 세션)
- **`ports[]`** = `{ p(':포트'), proc, project|null }`

생명주기 상태 = 프로젝트 `status`(선언) · 세션 활성 = `claude` 프로세스 실측 · 세션 활동 = 훅 실측.

---

## 3. 기능 명세 (FS)

### FS-1 · 부트 & 서버 기동

| 항목 | 내용 |
|---|---|
| 목적 | exe 더블클릭 한 번으로 wmux·서버·대시보드까지 무입력 기동 |
| 명령 | `cockpit.js serve [--port]` (서버 단독) · `cockpit.js boot [--port] [--setup]` (콜드 부트) |
| boot 단계 | ① wmux 발견·기동 보장 → ①-b **클린 슬레이트**(boot이 wmux를 직접 기동한 경우만 — 자동 복원된 이전 세션·워크스페이스 전부 정리 후 선언 기준 재구성, 실행 중이던 wmux는 불변) → ② 서버 보장(기존 리스너 재사용, 멱등) → ③ **active 프로젝트 자동 재수렴** → ④ 기본 브라우저 오픈 |
| 포트 우선순위 | `--port` > `config.port` > **7420**(정본) |
| 서버 정책 | `127.0.0.1` 바인드 · `GET /` 제외 전 경로 `X-Cockpit-Token` 필수 · body 1MB 상한(413) |
| 토큰 주입 | `GET /`가 `dashboard.html` 서빙 시 `<head>`에 토큰 meta 주입 → same-origin fetch 인증 |
| 관련 | `bin/cockpit.js`, `server.js` |

### FS-2 · 프로젝트 선언 & 스캔

| 항목 | 내용 |
|---|---|
| 선언 파일 | `root/<프로젝트>/project.json` (구 `team.json`과 **비호환** — 마이그레이션 없음) |
| 스캔 | `root/` 1-depth · `project.json` 있는 폴더만 프로젝트 · 점(`.`) 폴더 제외 |
| 관용 파싱 | status 부재/오타 → `idle` · createdAt 없으면 폴더 생성시각 · 깨진 JSON은 스캔 에러로 표기하고 스캔 계속 |
| 경로 진실 | 프로젝트 경로·역할 cwd는 **선언 폴더**에서만 파생(`p._dir`, `ensureRoleDir`) — wmux cwd 드리프트 의존 안 함 |
| 관련 | `registry.js`(`scanProjects`·`findProject`) |

### FS-3 · 상태 조회 (`GET /api/state`)

| 항목 | 내용 |
|---|---|
| 동작 | 선언 스캔 ⊕ wmux 실측 병합 → §2.3 페이로드. 대시보드 폴링 진입점 |
| 세션→역할 해석 | 채택 매핑(`adopted[agentId]`) 우선, 없으면 label · 선언 역할이면 `connected:true` |
| 세션 정렬 | ops 먼저 → 선언 역할 순서 → orphan 뒤 |
| 비차단 | 모든 온디맨드 프로브(git·proc·activity·ports·caps)는 논블로킹 — 응답을 막지 않음 |
| 관련 | `server.js`(`buildState`) |

### FS-4 · 생명주기 — 활성화/비활성화/보관/재개

| 전이 | API | 동작 |
|---|---|---|
| idle→active | `POST /activate {name}` | **워크스페이스만 보장 · 세션 스폰 없음**(초기 미연결). archived면 409 |
| active→idle | `POST /deactivate {name, confirm:true}` | ws의 산 세션 **ops 포함 전부 kill → workspace close → idle**. `confirm` 없으면 400 |
| idle→archived | `POST /archive {name}` | 보관(폴더·선언 유지). active면 409(비활성화 먼저) |
| archived→idle | `POST /reopen {name}` | 재개 — 대기중 복귀(즉시 활성화 없음) |
| 원칙 | — | **무명령 자동 종료 없음.** kill은 아래 두 명시 경로뿐(§FS-5) |
| 관련 | — | `lifecycle.js` |

### FS-5 · 세션 관리 — 개별 스폰 & 종료 (3단계)

세션은 활성화 시 자동 생성되지 않고, 역할별로 개별 오픈한다.

| 단계 | UI | API | 동작 |
|---|---|---|---|
| ① 초기 미연결 | `○ 미연결` 행 + `[＋ 세션 활성화]` | — | 선언 역할이 실측 세션 없음 |
| ② 세션 열기 | `[＋ 세션 활성화]` | `POST /spawn {name, role}` | 3단계: **① 그 workspace로 wmux 초점 이동**(`workspace.select` · best-effort, 응답 `focused`) → **② 그 자리에서 역할 pane 스폰**(role 생략 시 빠진 전체 · 매 회 `getFresh`로 중복 방지, 중복은 재사용) → **③ 연결 검증**(대상 workspace 실측 확인, 최대 ~3초 — label 미부착 시 채택 자동 바인딩 · 오배치 pane은 정리 · 확인 실패는 `failed`로 보고돼 대시보드가 [＋ 세션 활성화] 버튼 유지) |
| ③ 연결 확인 후 | `[↗ 세션 열기] [세션 비활성화] [▶ Claude 실행]` | — | claude 프로브가 resolved(off)되면 실행 버튼 노출 |
| 개별 종료 | `[세션 비활성화]`(드로어) | `POST /kill-session {name, agentId}` | 세션 하나 kill. claude 실행 중이면 대시보드가 확인 다이얼로그 |
| ops 고정 | `📌 ops 고정` | — | ops = 프로젝트별 1번 세션(git/DB/배포 확인 거처) |
| 관련 | — | `lifecycle.js`(`spawnRole`·`killSession`·`ensureWorkspace`) |

**kill 경로는 둘뿐**: 개별 `killSession` + 전체 `deactivate`(확인 게이트). 그 외 자동 종료 없음.

### FS-6 · Claude 실행 & on/off 실측

| 항목 | 내용 |
|---|---|
| 실행 | `POST /claude {agentId}` → 해당 pane surface에 `claude\n` 전송. 이미 실행 중이면 재전송 생략(`already`) |
| 전송 규칙 | **surfaceId 명시 필수**(포커스 기반 전송은 오발송) |
| on/off 실측 | wmux는 pane 내부 프로세스를 모름 → agent 셸 pid에서 **프로세스 트리를 내려가** claude CLI(네이티브/npm) 자손 확인 |
| 상태 3값 | `on`(실측 참) · `off`(실측 거짓) · `unknown`(콜드 스냅샷·비Windows — 실행 버튼 미노출) |
| 캐시 | PowerShell CIM 1회 조회 → TTL 4s + single-flight + 논블로킹 |
| 관련 | `proc.js`, `server.js`(`POST /claude`) |

### FS-7 · 세션 활동 배지 (working/waiting/attention) ⊕ 모델·effort 칩

| 항목 | 내용 |
|---|---|
| 목적 | "명령 진행중 / 대기중 / 입력 대기"와 **세션이 쓰는 모델·effort**를 표시 — 모델·effort는 **세션 행 경로 슬롯(.now)** 에(실측 있으면 `root/<proj>/<role>/` 대신 표시, 경로는 title로 이동 · 실측 없으면 경로 유지)·드로어에 pill로 |
| 원리 | wmux는 pane 내부 상태를 모르므로 **Claude Code 훅**으로 얻는다 — 전부 로컬 파일 실측(토큰 소비 0) |
| 훅 매핑 | `UserPromptSubmit`→**working** · `Stop`→**waiting** · `Notification`→**attention** |
| 기록 | 훅 런타임이 cwd가 `root/<proj>/<role>/` 아래일 때만 `cockpit/workspace/activity/<proj>__<role>.json` 기록(그 외 세션 즉시 종료) · 항상 exit 0(세션 안 막음) |
| 모델·effort | effort=훅 stdin의 공식 common field `effort.level`(모델이 effort 미지원이면 부재) · 모델=훅이 받은 `transcript_path` 꼬리(마지막 256KB)에서 최신 assistant `message.model` — §13 "트랜스크립트 파싱 제거"의 유일한 예외. 이번 관측이 null이면 직전 값 보존(칩 깜빡임 방지) |
| 읽기 | `getActivity(proj,role)` → `{state, model, effort}`. state의 working은 10분 초과 시 stale→null(크래시 방어) · model/effort는 썩지 않는 값이라 stale이어도 유지 |
| 노출 | buildState가 **claude on일 때만** `activity`·`model`·`effort` 필드 부착(꺼진 세션 잔존 파일 무시) |
| 배지 | `⏳ 진행중`(accent) · `⌛ 대기중`(faint) · `⚠ 입력 대기`(warn) · `◆ 모델·effort`(violet·mono — 세션 행은 경로 슬롯 텍스트·드로어는 pill, 축약 표기·title에 원문과 cwd) |
| 설치 | `activity-hook.mjs install|uninstall` — 전역 `~/.claude/settings.json` 병합(백업·멱등, 기존 wmux 훅 보존) |
| 설치 안내 | 미설치 실측(`hookInstalled()` — settings.json에 항목 없음) 시 대시보드가 배너 노출: 수동 설치 명령 표기 + **[🪝 훅 설치]** 원클릭(`POST /hook-install` — install을 자식 프로세스로 실행) · [숨기기]=localStorage `ck-hook-hide` · 반영은 새로 시작하는 Claude 세션부터 |
| 관련 | `bin/activity-hook.mjs`, `src/activity.js`(`getActivity`·`hookInstalled`), `server.js`(buildState·`POST /hook-install`), `dashboard.html`(`hook-banner`) |

### FS-8 · 미연결 세션 & 채택 (adopt)

| 항목 | 내용 |
|---|---|
| 미연결(orphan) | 선언 역할에 매칭 안 된 산 pane(wmux 자동 첫 pane 등) — `○ 미연결` 표기 |
| 채택 | `POST /adopt {name, agentId, role}` → `adopted{agentId→role}`를 project.json에 저장 |
| 가드 | agentId 없으면 400 · 미선언 역할 400 · 프로젝트 workspace의 세션만 404 · 역할이 이미 차 있으면 409 |
| 효과 | 미점유·같은 역할의 열린 세션은 스폰 대신 **재사용** |
| 관련 | `server.js`(`POST /adopt`), `buildState` |

### FS-9 · 프로젝트 생성 & 연동

| 경로 | API | 동작 |
|---|---|---|
| 새 프로젝트 | `POST /create {name, roles[]}` | `root/<이름>/` 격리 스캐폴드 생성 → 대기중. 재호출은 역할 병합(멱등) · 폴더 있으면 409 |
| 기존 폴더 연동 | `POST /import {path, name?}` | 외부 폴더를 `root/<이름>/ops/`로 **이동(rename)** · `root/` 아래 경로면 **제자리 등록**(구 팀 재등록) |
| 폴더 고르기 | `POST /pick-folder {title?}` | 서버가 **네이티브 폴더 선택창**(Windows FolderBrowserDialog)을 띄워 선택 절대경로 반환(`{path}`). 대시보드 `📁 찾아보기`가 경로 타이핑 대신 사용 — 순수 읽기, 실제 이동은 `/import` |
| git 주소로 생성 | `POST /create-git {url, name?}` | 스캐폴드 생성 ⊕ ops에 clone 합성. 이름 미입력 시 URL에서 파생(못 뽑으면 400) |
| 이름 검증 | — | 파일시스템 금지문자 제거 · 빈/점 시작 400 |
| 이동 안전 | — | 동일 볼륨만 · 실패 시 원본 무변경(백업 복원) |
| 관련 | — | `registry.js`(`createProject`·`importProject`), `git.js` |

### FS-10 · 역할 추가 / 제거

| 동작 | API | 규칙 |
|---|---|---|
| 추가 | `POST /create {name, roles}` 병합 | 선언에 역할 추가 + 역할 폴더 보장(자유 스폰 아님 — 스폰은 `/spawn`) |
| 제거 | `POST /roles {name, role, action:'remove'}` | 선언에서만 제거, **폴더 보존**. ops는 400 · 살아있는 세션이면 409 |
| 관련 | — | `registry.js`(`removeRole`), `server.js` |

### FS-11 · git 연동 (ops 단일 저장소)

| 항목 | 내용 |
|---|---|
| **불변 원칙** | git 저장소는 **`ops/`에만**. 프로젝트 루트는 저장소가 아니다(중첩 저장소 금지) |
| 스캐폴드 | 빈 프로젝트는 `scaffoldOpsGit`이 ops를 `git init` + 시크릿 `.gitignore`. 원격 프로젝트는 ops에 clone |
| 원격 연결 | `POST /git-remote {name, url}` → ops에 clone. **스켈레톤 ops면 clone 교체, 실내용 저장소면 원격만 갱신(로컬 작업 보존)** |
| git 칩 | `getGit(ops)` → 브랜치·원격 URL·웹링크(ssh/git→https 정규화). 논블로킹 캐시(TTL 30s) |
| 관련 | `git.js`, `registry.js`(`scaffoldOpsGit`) |

### FS-12 · 격리 스캐폴드 (D16)

| 파일 | 목적 |
|---|---|
| 프로젝트 CLAUDE.md | 상위 cockpit 정책 무효화 선언(조상 로드 차단 불가 → 유일 차단선) · git은 ops 명시 |
| ops `git init` + `.gitignore` | ops = 유일 저장소 · 시크릿(deploy-keys·connections.json·.env.*·logs) 선제 차단 |
| 역할별 CLAUDE.md 뼈대 | **갓 만든 빈 역할 폴더에만** 주입(clone된 ops·import 코드엔 미주입 — 오염 방지) |
| 멱등 | 기존 파일 절대 미덮어쓰기 |
| 관련 | `registry.js`(`scaffoldIsolation`·`ensureRoleDir`) |

### FS-13 · 서비스 링크

| 항목 | 내용 |
|---|---|
| 목적 | 배포·DB 콘솔 등 외부 링크를 프로젝트 카드에 칩으로 등록 |
| API | `POST /links {name, action:'add'|'remove', url, label?}` — **http(s)만**(그 외 400) |
| 열기 | 대시보드에서 기본 브라우저 새 탭 |
| 관련 | `server.js`(`POST /links`) |

### FS-14 · 활성 포트맵 ⊕ 서버 ON/OFF

| 항목 | 내용 |
|---|---|
| 목적 | dev/db 리스너 실측 → 프로젝트 귀속 표시(우측 레일) · **귀속 리스너 중지(OFF) · 선언 명령으로 시작(ON)** |
| 귀속 | active 프로젝트의 세션 pid ↔ 리스너 소유 프로세스 매칭 |
| 필터 | 시스템·노이즈 리스너 분리(접기) |
| 노출 | `GET /api/state`의 `ports[]`(**port·pid 포함**) · 프로젝트 `serve` 선언(`{role, cmd}` — project.json) |
| OFF | 레일 귀속 행의 **[✕]** → `POST /port-kill` — kill 경유 확인 필수(§9-3) + 낙관적 재검증(⑤: 강제 재스캔에서 (port,pid) 정확 일치 + **프로젝트 귀속 재확인** — 시스템·wmux 오격추 방지) → `taskkill /T` 프로세스 트리 종료(pane 셸은 리스너의 부모라 무사 — 세션 유지) |
| ON | cockpit은 시작 명령을 모른다 → 카드 **[＋ 서버]**로 선언(`POST /serve` — 비우고 확인=해제) → **[▶ 서버 시작]** `POST /serve-start`가 역할 pane 셸에 sendLine(`POST /claude` 동형). **pane에 claude on/unknown이면 409**(명령이 claude 입력창으로 들어가는 오염 방지) |
| 관련 | `ports.js`(`freshListener`·`killPid`), `server.js`(`projPortInfo`), `dashboard.html`(`portKillPrompt`·`servePrompt`) |

### FS-15 · 기능 인벤토리 (caps)

| 항목 | 내용 |
|---|---|
| 목적 | 세션이 상속/보유한 skill·agent·MCP를 **이름·종류만** 표시(값·키 비노출) |
| 스코프 | global(`~/.claude` — 우측 레일) · project/session(역할 폴더 `.claude/`·`.mcp.json` — 드로어) |
| API | `GET /api/caps` (global) · `GET /api/caps?project=&role=` (세션 스코프) |
| 관련 | `caps.js` |

### FS-16 · 사용량 — **제거됨**

로컬 트랜스크립트 합산으로 사용량/한도를 표시했으나 제거했다. 이유: Claude의 실제 한도는 **5시간·7일 두 창**으로 서버가 관리하고 그 사용률은 트랜스크립트에서 재현할 수 없다 — 롤링 7일 ≠ 고정 리셋 창, 캐시 읽기·모델별 가중치 미상, 타 기기 사용량 부재. 분모도 공식 한도가 아닌 학습치라 `/usage`와 구조적으로 불일치했다.

서버 실측값을 쓰려면 statusline stdin의 `rate_limits.five_hour` / `rate_limits.seven_day`(`used_percentage`·`resets_at`)가 유일한 공식 경로다 — 단 **퍼센트만** 제공되고(절대 토큰·한도값 없음) 세션의 첫 API 응답 이후에만 존재한다. "일간" 창은 Claude 한도 구조에 존재하지 않는다.

### FS-17 · 중앙 이벤트 로그

| 항목 | 내용 |
|---|---|
| 목적 | 상태 전이·스폰/kill·생성/연동·claude·git·에러를 중앙 JSONL로 남김 |
| 저장 | `cockpit/workspace/logs/events.jsonl`(gitignore) |
| 조회 | `GET /api/log?project=&limit=` — 대시보드 로그 뷰 · 프로젝트 카드 최근 이벤트 |
| 레벨 | `info` · `error` |
| 관련 | `log.js` |

### FS-18 · 세션 상세 드로어

| 항목 | 내용 |
|---|---|
| 진입 | 세션 행 클릭 |
| 표시 | claude 상태 · **활동 배지** · ops 고정/미연결 태그 · cwd · agentId · 기능 인벤토리(global/project/session 스코프) · 범위 안내 |
| 액션 | `[열기 ↗ (wmux 점프)]` · `[📁 폴더]` · `[▶ Claude 실행]`(off일 때) · `[⎇ 역할로 동기화]`(orphan) · `[세션 비활성화]` |
| 관련 | `dashboard.html`(`openSession`) |

### FS-19 · wmux 명령 콘솔 로깅

| 항목 | 내용 |
|---|---|
| 목적 | wmux로 나가는 명령·설명·성공/실패를 서버 콘솔에 출력 — 진단용. 대시보드 토스트도 `POST /console`로 함께 미러 |
| 포맷 | 전부 `log.js`의 `logConsole` 경유 → **`[오류]내용 : …`** 접두 통일. 예: `[오류]내용 : <t> [wmux→] <method> <설명>` · `[wmux✓] <method> → <id>` · `[wmux✗] <method> — <에러>` (wmux 마커는 내용에 보존) |
| 소음 억제 | 고빈도 폴링(`workspace.list`·`agent.list`)은 성공 로그 제외(실패는 항상 — 오프라인 진단) |
| 토글 | `COCKPIT_WMUX_LOG=0`으로 wmux 로그만 끔(토스트 미러는 별개) · **detached 서버는 stdout 숨김** → 콘솔 보려면 터미널에서 `serve` 실행 |
| 관련 | `wmux.js`(`request`·`CMD_DESC`), `log.js`(`logConsole`), `server.js`(`POST /console`), `dashboard.html`(`ping`·`mirrorToConsole`) |

### FS-20 · 폴더 열기 & wmux 점프

| 동작 | API | 내용 |
|---|---|---|
| 탐색기 열기 | `POST /open {name, role?}` | 프로젝트/역할 폴더를 탐색기로. `root/` 밖 경로는 400(가드) |
| wmux 점프 | `POST /attach {agentId}` | 해당 workspace 선택 + pane 포커스(사용자가 보는 pane으로 이동) |
| 관련 | — | `server.js` |

---

## 4. API 엔드포인트 레퍼런스

`GET /` 제외 전 경로 `X-Cockpit-Token` 필수(없으면 401).

### GET

| 경로 | 반환 | 비고 |
|---|---|---|
| `/` | 대시보드 HTML | 토큰 주입 |
| `/api/state` | `{projects, unlinked, ports, hookInstalled}` | 폴링 진입점 · `hookInstalled=false`면 대시보드가 훅 설치 안내 배너 노출(FS-7) |
| `/api/log?project=&limit=` | `{events}` | limit 최대 100 |
| `/api/caps?project=&role=` | `{global}` 또는 세션 caps | project 없으면 global |

### POST (body = JSON)

| 경로 | body | 성공 | 주요 가드 |
|---|---|---|---|
| `/activate` | `{name}` | `{wsId, spawned:0}` | 503 wmux-offline · 409 archived |
| `/spawn` | `{name, role?}` | `{wsId, spawned, reused, failed, focused}` | 400 unknown-role · 503 |
| `/kill-session` | `{name, agentId}` | `{killed, role}` | 404 session-not-found · 409 project-inactive |
| `/deactivate` | `{name, confirm:true}` | `{killed}` | **400 confirm-required** |
| `/archive` | `{name}` | `{ok}` | 409 project-active |
| `/reopen` | `{name}` | `{ok}` | — |
| `/create` | `{name, roles[]}` | `{created, added}` | 409 folder-exists · 400 invalid-name |
| `/import` | `{path, name?}` | `{name, inPlace, backup}` | 400 path/이동 실패 |
| `/pick-folder` | `{title?}` | `{path}` (취소=`null` · 비Win=`unsupported`) | — (네이티브 탐색창) |
| `/console` | `{msg}` | `{ok}` | — (대시보드 토스트를 서버 콘솔 `[오류]내용 : …`로 미러) |
| `/hook-install` | — | `{ok}` | 500 hook-install-failed (활동 배지 훅 설치 — FS-7 배너 [🪝 훅 설치]) |
| `/create-git` | `{url, name?}` | `{name, action, git}` | 400 git-url-invalid · name-underivable |
| `/roles` | `{name, role, action:'remove'}` | `{removed}` | 400 ops-fixed · 409 role-alive |
| `/claude` | `{agentId}` | `{ok, already?}` | 502 no-surface |
| `/attach` | `{agentId}` | `{ok}` | 404 agent |
| `/open` | `{name, role?}` | `{ok}` | 400 bad-path |
| `/adopt` | `{name, agentId, role}` | `{agentId, role}` | 409 role-filled · 404 · 400 |
| `/git-remote` | `{name, url}` | `{action, backup, git}` | 400 git-url-invalid |
| `/links` | `{name, action, url, label?}` | `{links}` | 400 http-only |
| `/port-kill` | `{port, pid, confirm:true}` | `{ok}` | **400 confirm-required** · 409 listener-gone·not-project-listener · 502 kill-failed (FS-14 OFF) |
| `/serve` | `{name, action:'set'\|'clear', role?, cmd?}` | `{serve}` | 400 cmd-required·cmd-too-long·unknown-role·unknown-action (FS-14 ON 선언) |
| `/serve-start` | `{name}` | `{ok}` | 400 no-serve-config · 409 project-inactive·role-session-missing·pane-claude-on·pane-state-unknown · 502 no-surface · 503 wmux-offline (FS-14 ON) |
| `/shutdown` | `{confirm:true}` | `{deactivated, failed}` | **400 confirm-required** — 전 프로젝트 비활성화 → 응답 플러시 → **wmux 앱 종료(taskkill)** → 서버 종료. 평시엔 wmux 수명 비소유, ⏻ 전체 종료만 예외 |

공통 에러: 401(토큰) · 413(body>1MB) · 400 bad-json · 404 unknown-project · 503 wmux-offline.

---

## 5. UI 구성

```
┌ 상단바: 로고 · ministat(진행중/대기중/종료·소스 배지) · [새로고침][기존 프로젝트 연동][＋ git 주소][＋ 새 프로젝트]
├ 범례: 상태 = 색+형태+텍스트 삼중부호화
├ 좌측 메인 컬럼
│   ● 진행중  — tcard(세션 행 3단계·활동 배지·conn 칩·최근 이벤트·[＋ 모든 세션 활성화][＋ 역할][비활성화])
│   ⏸ 대기중  — 접힘 가능 · 역할 칩 · [▶ 활성화][＋ 역할][아카이브]
│   ○ 미연결  — 외부 wmux workspace(기본 접힘)
│   ▪ 종료됨  — 보관(접힘) · [재개]
└ 우측 레일: 🔌 활성 포트(귀속 표시) · 🧩 기능 인벤토리(global)
드로어: 세션 상세(FS-18) · 다이얼로그: confirm/namer/logbox 공용 골격 · 토스트 · SR 라이브 리전
```

- **소스 배지**: `● live`(서버 정상) · `▲ offline`(서버 죽음) · `○ demo`(file:// 폴백).
- 대시보드를 `file://`로 직접 열면 내장 데모 데이터로 폴백(서버 없이 UX 확인).

---

## 6. 상태 전이

```
                 POST /activate (ws 보장, 스폰 없음)
        idle  ───────────────────────────────────▶  active
          ▲                                            │
          │   POST /deactivate (confirm · 전체 kill+close)
          └────────────────────────────────────────────┘
        idle  ──POST /archive──▶ archived ──POST /reopen──▶ idle

    active 내부(세션): POST /spawn (역할별 추가) · POST /kill-session (개별 종료)
```

- 활성화는 **세션을 스폰하지 않는다**(초기 미연결) — 세션은 개별 스폰.
- archive는 active면 409(비활성화 먼저 — kill을 아카이브에 숨기지 않음).

---

## 7. 불변 규칙 (실측 확정 — 어기면 재발하는 버그)

1. **wmux 캐시 계약**: 읽기·폴링 = `getState()`(stale 허용) · 변이 결정(스폰 여부) = `getFresh()`(실왕복) · 변이 후 `invalidate()`. stale로 스폰 결정 시 중복 생성.
2. **agent 실측 필드**: `agentId`·`label`·`cmd`·`status`·`paneId`·`surfaceId`·`pid`·`workspaceId`. kill은 리스트에서 안 지워짐 → `getState()`가 `isDead` 중앙 필터.
3. **세션 전송은 surfaceId 명시 필수** — 포커스 기반은 오발송. paneId를 send_text에 주면 "no PTY".
4. **경로 진실 = 폴더** — spawn엔 항상 `--cwd` 명시(홈 드리프트 차단).
5. **git = ops 단일 저장소** — 루트는 저장소 아님. `connectRemote`는 스켈레톤 ops면 clone, 실저장소면 원격 갱신.
6. **kill은 두 명시 경로뿐** — `killSession`(개별) + `deactivate`(전체·confirm 게이트). 무명령 자동 종료 없음.
7. **세션 개별 스폰** — activate는 스폰 안 함. 스폰 결정은 매 회 `getFresh`(중복 방지).
8. **세션 활동 = Claude 훅 실측(wmux 아님)** — cwd 가드 · claude on일 때만 노출 · working 10분 stale 방어.
9. **채택(adopt)** — `connected = adopted[agentId] || declaredRoles.has(label)`. 미점유·같은 역할 열린 세션은 재사용.
10. **논블로킹 프로브** — ports/proc/caps/git/activity는 어떤 것도 `/api/state`를 막지 않는다.
11. **격리 스캐폴드** — clone된 ops·import 코드엔 cockpit 파일 미주입. 기존 파일 미덮어쓰기.
12. **cmd 배치는 ASCII 전용**(CP949 파싱) — 한국어 메시지는 JS/C# 계층.
13. **`.env` 값 비저장·비표시** — 키 이름·존재만.

---

## 8. 보안 · 정책

- 서버는 `127.0.0.1` 전용 · 토큰(`config.token`, gitignore) 필수 · 원격 노출 비목표.
- 시크릿: `.env`·deploy-keys·connections.json은 격리 `.gitignore`가 선제 차단, 값은 저장/표시 안 함.
- `POST /open`은 `root/` 밖 경로 400(경로 탈출 방지).
- 링크는 http(s)만.

---

## 9. 런타임 파일 (gitignore — 새 클론엔 없음)

| 파일 | 내용 |
|---|---|
| `cockpit/workspace/config.json` | port·token·wmuxBin·shell (서버 자동 생성) |
| `cockpit/workspace/logs/events.jsonl` | 중앙 이벤트 로그 |
| `cockpit/workspace/activity/<proj>__<role>.json` | 세션 활동 상태(훅 기록) |
| `root/<프로젝트>/` 런타임 | project.json 외 코드·역할 폴더(상위 저장소는 `root/*` 무시) |

---

## 10. 검증 컨벤션 (테스트 프레임워크 없음)

1. `node --check <파일>` — 수정한 모든 JS. 대시보드는 `<script>` 추출 후 검사.
2. **라이브 프로브** — 스크래치패드 일회성 `.mjs`로 실 wmux/HTTP/모듈에 검증(미커밋). 프로브는 반드시 뒷정리(스폰 agent kill·`root/_Tmp*` 삭제·잔존 pwsh kill·config 원복).
3. wmux는 셸 PATH에 없음 — 프로브에서 `src/wmux.js` import. `wmux browser`는 사용자 대화형 셸(`!`) 전용.
4. **코드 수정 후 서버 재시작 필수**(HTML만 수정 시 브라우저 새로고침 — `readFileSync` 매 요청).

---

## 11. 범위 밖 (v1 비목표)

- 원격 노출·인증 계층 확장 · DB/배포 **조작**(현재 표시·링크 전용) · 트랜스크립트 파싱(훅의 모델 판별만 예외) · git diff·활동 피드 뷰 · **사용량·한도 표시**(FS-16 — 제거됨) · 크로스 볼륨 이사(동일 볼륨만).
