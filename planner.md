# Claude Code 멀티세션 관제 대시보드 — 기획서 (planner.md)

> **한 줄 정의**: 1인 개발자·프리랜서가 여러 Claude Code 세션을 **프로젝트(팀)별·역할별**로 한 대시보드에서 상시 운영·관찰·인수인계하는 관리 템플릿. **wmux 위에 얇게 얹는 레이어**로 구현한다.

- **문서 상태**: 🟢 Draft (v0.10) — MCP 연결 상태 상세 설계 추가 (D15 · §6.6, 이 머신 실측 기반)
- **최종 수정**: 2026-07-09
- **작성 주체**: 관리자(사용자) + Claude
- **실행 환경**: Windows 11 · wmux 0.13.0 (설치 확인됨)

---

## 0. 확정된 결정 (Decision Log)

| # | 결정 사항 | 선택 | 근거 |
|---|-----------|------|------|
| D1 | 세션 운영 방식 | **실시간 인터랙티브** | 살아있는 claude 세션을 pane에서 관찰·개입 |
| D2 | 백엔드 스택 | **wmux 네이티브 프리미티브** | tmux·node-pty·웹서버 신규 구현 불필요. wmux가 Windows에서 이미 다 함 |
| D3 | 첫 마일스톤 | **모니터링 + 세션 생성/제어** | new-team / spawn-role / kill / attach / list |
| D4 | mux 신규 구현 | **하지 않음** | wmux가 PTY·렌더·detach·워크스페이스·에이전트 전부 제공 |
| D5 | 통신 토폴로지 | **Star (관리자 경유)** | 역할 간 직접 통신 대신 관리자 허브 경유 → 추적·감사 용이 |
| D6 | 계층 구조 | **3층 유지** `[관리자]-[팀]-[역할]` | 팀 메타에 `client` 필드만 미리 넣고, 다중 고객은 나중에 그룹핑 |
| D7 | 구현 형태 | **wmux 위 얇은 스크립트+훅+규약 레이어** | 기존 `wmux-orchestrator` 패턴 재사용, 지속형으로 변형 |
| D8 | 대시보드(경량 폴백) | **markdown surface** (`dashboard.md` → `wmux markdown`) | 서버 없이 뜨는 at-a-glance. 주 대시보드는 D14로 승격 |
| D14 | 주 대시보드 = 인터랙티브 HTML | **로컬 서버 서빙 HTML(브라우저 패널) + 컨트롤 브리지 → 세션 클릭 시 wmux 점프** | 클릭→점프 요구(§6.7). teamctl serve의 `/attach`→`select-workspace`+`focus-pane` (§4.5) |
| D9 | 신규 기능: 기능 인벤토리 | **글로벌 vs 세션/프로젝트별 능력 구분 표시** | 4스코프(global/project/plugin/session) 스캔, 활성/사용가능 구분 (§6.5) |
| D10 | 신규 기능: 연결 상태 | **git·Supabase 등 외부 연동 상태 확인** | 확장형 커넥터, 파일·env 우선 탐지(CLI 옵션), 시크릿 미노출 (§6.6) |
| D11 | 폴더 아키텍처 | **도구코드 / 런타임상태 / 실제프로젝트 3층 분리, 팀=projectPath 포인터** | 프리랜서 외부 리포 수용, registry 분할로 스케일 (§5) |
| D12 | 커넥터 정책 + 포트 | **core(항상) vs optional(선택제·팀별 opt-in), 로컬 포트/서버는 core** | git·supabase 미연결 가능 → 선택제 분리; 포트는 상시 관제 (§6.6) |
| D13 | 신규 기능: 역할 세션 라이브 뷰 | **"작업중인 내용" 보기 — 소스 3중화(pane 클릭·트랜스크립트 tail·read-screen)** | read-screen 렌더러 의존 → 트랜스크립트 tail 1순위 (§6.7) |
| D15 | 신규 기능: MCP 연결 상태 상세 | **5소스 열거 + 2계층 판정(정적 파일 스캔 + `claude mcp list` 헬스체크), 파일·CLI 교차검증 필수** | 실측: `claude mcp list`가 settings.json 소스를 누락 → 단일 소스 신뢰 금지. `pending-approval` 상태 신설 (§6.6) |

---

## 0.5 기능 맵 (한눈 요약)

| # | 기능 | 핵심 | 섹션 | 마일스톤 | MVP |
|---|------|------|------|----------|-----|
| F1 | 세션 운영 | 팀=workspace · 역할=agent · 생성·제어·인수인계 | §2·7·8 | M0–M2 | ✅ |
| F2 | 인터랙티브 대시보드 + 브리지 | HTML(브라우저 패널) + 로컬 서버, **클릭→점프** | §4.5 | M1 | ✅ |
| F3 | 역할 세션 라이브 뷰 | "작업중인 내용" 3중 소스(pane·트랜스크립트·read-screen) | §6.7 | M1.7 | ✅ |
| F4 | 로컬 포트/서버 | 🌐 글로벌 포트맵 + 📌 팀 귀속 | §6.6 | M1.6 | ✅ |
| F5 | 연결 상태(Integration Health) | core(ports·env·node·**MCP 헬스**)+optional(선택제) 커넥터 | §6.6 | M1.6 | ◐ core만 |
| F6 | 기능 인벤토리 | 글로벌 vs 세션별 능력 | §6.5 | M1.5 | ◐ 활성만 |
| F7 | 격리·병합 | worktree·contract·리뷰 게이트 | M3 | M3 | ✕ later |
| F8 | 관측·비용·청구 | 세션별 토큰·시간 · 프리랜서 청구 | M4 | M4 | ✕ later |

> **MVP 경계선**: F1–F4 완전 + F5·F6 부분(core/활성만)이 **첫 출하분**. F7·F8은 이후. 대시보드는 D14(HTML+브리지)가 주, 마크다운(D8)은 폴백.

---

## 1. 제품 개요

### 문제
Claude Code로 여러 작업을 동시에 굴리면 터미널이 흩어지고, 어느 프로젝트의 어떤 작업이 지금 무슨 상태인지 파악이 안 된다. 세션이 끝나도 "무엇을 했는지"가 휘발된다.

### 타깃
1인 개발자 / 프리랜서. 여러 프로젝트(또는 여러 클라이언트)를 병렬로 진행하고, 세션 결과를 축적해 (필요시) 청구·리포트로 연결하고 싶은 사람.

### 핵심 가치
1. **한 눈에 관제**: 운영 중인 모든 팀·역할 세션의 상태를 대시보드에서 일괄 확인
2. **드릴다운**: 팀 선택 → 그 팀 역할 세션 pane 실시간 관찰 + 프로젝트 공유 정보(project.md) 패널
3. **인수인계 자동화**: 세션 완료 시 인수인계 문서가 관리자 inbox로 자동 전달·축적

---

## 2. 조직 메타포 → wmux 네이티브 매핑 ⭐

**이 표가 이 프로젝트의 심장이다.** 모든 개념이 이미 있는 wmux 명령으로 실현된다 (0.13.0 CLI 검증 완료).

| 기획 개념 | wmux 실체 | 실제 명령 |
|-----------|-----------|-----------|
| **관리자** | 대시보드 workspace + 사이드바 cockpit | `set-status`, `set-progress`, `log`, `markdown` |
| **팀(프로젝트)** | workspace (자체 cwd·title 보유) | `new-workspace` → `rename-workspace <id> <name>` |
| **역할** | workspace 내 pane의 에이전트 | `agent spawn --cmd "claude …" --label <role> --cwd <dir> --workspace <ws>` |
| **역할 상태** | 에이전트 상태 | `agent list --workspace <ws>` · `agent status <id>` |
| **팀 드릴다운** | 워크스페이스 전환 | `select-workspace <ws>` |
| **pane 관찰/개입** | 실시간 TUI | 사용자가 pane 클릭 → 직접 타이핑 (인터랙티브) |
| **터미널 자동조작** | 화면 읽기/입력 | `read-screen`, `send <text>`, `send-key <key>` |
| **역할 종료** | 에이전트 kill | `agent kill <id>` |
| **인수인계/공유문서** | markdown surface | `markdown <file>` · `markdown set <id> --file <path>` |

### 검증된 CLI 시그니처 (구현 시 그대로 사용)
```
wmux new-workspace                         → { workspaceId }
wmux rename-workspace <id> <title>
wmux list-workspaces                       → { workspaces:[{id,title,cwd,isActive}] }
wmux select-workspace <id>
wmux agent spawn --cmd "<cmd>" [--label <n>] [--cwd <dir>] [--pane <id>] [--workspace <id>]
wmux agent spawn-batch --json '[...]' [--strategy distribute]
wmux agent list [--workspace <id>]         → 역할 목록 + status(running|exited) + exitCode
wmux agent status <agentId>
wmux agent kill <agentId>
wmux split [--down] [--type terminal]      → { paneId, surfaceId }
wmux layout grid --count <N> [--type terminal]
wmux markdown <file>  |  markdown set <id> --file <path>
wmux set-status / set-progress / log       → 사이드바 cockpit 갱신
wmux hook --event <type> --tool <name> [--agent <id>]
```

---

## 3. 기존 `wmux-orchestrator`와의 관계 (매우 중요)

wmux에는 이미 **`wmux-orchestrator` 플러그인**이 내장돼 있다. 반드시 구분하고 재사용할 것.

| 항목 | wmux-orchestrator (기존) | 우리 템플릿 (신규) |
|------|--------------------------|--------------------|
| 목적 | **큰 작업 1개를 웨이브로 쪼개 병렬 실행 → 리뷰 → 끝** | **여러 프로젝트를 상시 관리하는 지속형 관제** |
| 수명 | 일회성. 끝나면 `/tmp/wmux-orch-*` 정리 | 영속. 팀·역할·인수인계 계속 축적 |
| 조직 단위 | wave / agent (임시) | workspace=팀 / agent=역할 (지속) |
| 상태 | `/tmp/.../state.json` | `manager/registry.json` (영속) |
| 결과물 | agent-result.md → 리뷰 후 폐기 | 인수인계.md → `manager/inbox/`에 축적 |
| 대시보드 | 실행 중에만 뜨는 사이드바 | 상시 대시보드 surface |

**재사용할 것 (재발명 금지):**
- `state.json` ↔ 사이드바 자동 워칭 패턴
- `launch-agent.js` 실행 패턴 (`claude --dangerously-skip-permissions -- <prompt>`, `execFileSync`로 셸 쿼팅 회피)
- 훅 배선: `PostToolUse`(활동 카운트) / `SubagentStop`·`Stop`(전환·인수인계) / `SessionStart`(복구·컨텍스트 주입)
- 결과파일 표준 포맷 → 인수인계 문서로 변형
- **coupling/contract** 개념 (병렬 역할이 같은 이름·타입·API를 공유할 때 드리프트 방지)

> 위치: `C:\wmux-0.13.0-win-x64\resources\wmux-orchestrator\` — 구현 착수 전 `skills/orchestrate/SKILL.md`와 `scripts/`를 정독할 것.

**차별점:** 우리는 "지속형 멀티프로젝트 레이어". 필요하면 **별도 플러그인**(가칭 `wmux-teams`)으로 만들되, 오케스트레이터의 스크립트 스타일을 그대로 따른다.

---

## 4. 아키텍처 개요

```
┌───────────────────────────────────────────────────────────┐
│  관리자 대시보드 (wmux markdown surface + 사이드바 cockpit)   │
│   · 전체 팀·역할 상태 테이블   · inbox 새 인수인계 알림       │
└───────────────┬───────────────────────────┬───────────────┘
      teamctl 스크립트가 렌더        select-workspace 로 드릴다운
                │                             │
                ▼                             ▼
┌───────────────────────────┐        ┌────────────────────────┐
│ teamctl (node/bash)        │        │  팀 workspace (=프로젝트) │
│  · wmux CLI 래퍼           │            ├ pane: role=planner    │
│  · registry.json 읽고/쓰기 │  spawn ──> ├ pane: role=frontend   │
│  · dashboard.md 렌더       │            ├ pane: role=backend    │
└───────────────┬───────────┘            └ project.md (markdown) │
        hooks 동기화 │                    └────────────────────────┘
                     ▼                         각 pane = claude 세션
   PostToolUse/Stop/SessionStart 훅            ▲ SessionStart: project.md 주입
   · Stop → 인수인계.md → manager/inbox/       └ Stop → 인수인계 작성
   · 상태 → registry.json → 대시보드 갱신
```

### 구성요소
| 요소 | 역할 | 구현 |
|------|------|------|
| **teamctl** | 팀/역할 CRUD, 대시보드 렌더 | Node 스크립트가 `wmux` CLI 호출 + registry.json 관리 |
| **capctl** | 능력 스캔 (플러그인·스킬·에이전트·MCP·훅) | `capctl.js` — `settings.json`·`plugins/`·`~/.claude.json`·`<cwd>/.claude` 스캔 (§6.5) |
| **connectors** | 외부 연동 상태 프로브 (git·supabase 등) | `src/connectors/*.js` — 파일·env·CLI 탐지, 확장 가능 (§6.6) |
| **teamctl serve** | 인터랙티브 대시보드 서빙 + 컨트롤 브리지 | 로컬 HTTP(127.0.0.1) → `/api/state`·`/attach`·`/send`·`/kill` → wmux CLI (§4.5) |
| **registry.json** | 단일 진실 소스 (팀·역할·상태·인수인계) | 영속 JSON (규모 커지면 SQLite) |
| **대시보드 surface** | 전체 관제 뷰 | `manager/dashboard.md` → `wmux markdown` |
| **사이드바 cockpit** | 한눈 요약 | `wmux set-status/set-progress/log` |
| **훅** | 상태 동기화·인수인계 자동화 | 오케스트레이터 훅 패턴 재사용 |
| **역할 템플릿** | 역할별 CLAUDE.md·부트 프롬프트 | `templates/role-*.md` |

---

## 4.5 인터랙티브 대시보드 & 컨트롤 브리지 ⭐ (D14 — 클릭→점프)

세션을 **대시보드에서 클릭하면 그 세션으로 점프**하려면 읽기전용 마크다운으론 부족 → **로컬 서버가 서빙하는 HTML 대시보드 + 컨트롤 브리지**로 구현.

```
wmux browser open http://127.0.0.1:PORT/        # 브라우저 패널에 대시보드
        │  fetch (same-origin)
        ▼
teamctl serve   (Node 로컬 서버 · 127.0.0.1 전용 · 토큰)
   GET  /api/state           → registry+포트+상태 JSON (페이지가 1~2s 폴링)
   POST /attach {team,role}  → wmux select-workspace + focus-pane   ← 클릭→점프
   POST /send   {role,text}  → wmux send
   POST /kill   {role}       → wmux agent kill
   POST /spawn  {team,role}  → wmux agent spawn
        │  child_process
        ▼
   wmux CLI   (WMUX_PIPE_TOKEN 환경 상속 → 파이프로 명령 전달)
```

- **왜 서버가 필요한가**: 브라우저 페이지는 네임드 파이프(`\\.\pipe\wmux`)를 직접 못 부름 → 로컬 서버가 브리지. 페이지를 이 서버가 서빙하므로 same-origin fetch (CSP·CORS 문제 없음).
- **보안(R8)**: `127.0.0.1` 바인드 + 토큰. wmux 명령을 실행하므로 외부 노출 금지.
- **마크다운 surface(D8)는 폴백**: 서버 없이도 뜨는 경량 at-a-glance 뷰로 유지.
- **비용**: 마크다운 MVP보다 손이 더 감(서버+폴링+브리지) → M1 범위 ↑. 대신 "세션 클릭→점프" 핵심 UX 확보.

---

## 5. 폴더 / 네이밍 규약 (리포지토리 구조)

**3층 분리 원칙**: ① 도구 코드(버전관리) ② 런타임 상태(gitignore) ③ 실제 프로젝트(외부, 경로로 참조). 팀은 폴더가 아니라 **`projectPath`(실제 프로젝트 경로) 포인터 + 관리 사이드카**다.

```
ClaudeTemplate/                          # ① 도구 리포지토리 (버전관리)
├─ planner.md  README.md  package.json  .gitignore
├─ bin/
│    teamctl.js                          # CLI 진입점 (팀·역할·상태·인벤토리)
├─ src/
│    core/         registry.js  wmux.js  scopes.js  paths.js
│    commands/     new-team  spawn-role  list  kill  attach  status
│    capabilities/ capctl.js             # §6.5 능력 스캐너
│    connectors/                         # §6.6 연결 상태 프로브 (빌트인·확장점)
│      index.js  ports.js  env.js  node.js  mcp.js       # core (항상)
│      git.js  supabase.js  github.js  docker.js         # optional (선택제·opt-in)
│    dashboard/    render.js  templates/(dashboard.md · team.md)
│    hooks/        on-session-start.sh  on-stop.sh  on-tool-use.sh  on-notification.sh
├─ templates/                            # 새 팀·역할 생성 시 복사되는 원본
│    roles/  role-planner.md  role-frontend.md  role-backend.md  role-qa.md
│    project-template.md  handover-template.md  team-CLAUDE.md
└─ workspace/                            # ② 런타임 상태 (gitignore) — 도구가 관리하는 데이터
     manager/
       registry.json                     # 단일 진실 소스: 팀 인덱스 + 상태 요약
       globalCapabilities.json           # 글로벌 능력 세트 1회 저장 (§6.5)
       dashboard.md                      # 렌더된 관제 뷰 (wmux markdown)
       inbox/                            # 인수인계 도착함 (예: 2026-07-09T0930_team-alpha_backend.md)
     teams/
       team-alpha/                       # 팀 "사이드카"(메타데이터). 실제 코드 아님
         team.json                       # projectPath·workspaceId·client·connectors(opt-in)·expectedPorts
         project.md                      # 공유 컨텍스트 (드릴다운 패널)
         capabilities.json               # 이 팀 능력 델타 (§6.5)
         connections.json                # 이 팀 연결 상태 캐시 (§6.6)
         roles/                          # 역할별 메타(agentId·paneId·프롬프트): planner.json …
         handovers/                      # 인수인계 아카이브
     connectors/                         # ③ 사용자 커스텀 커넥터(확장) — 빌트인과 병합 로드

# ③ 실제 프로젝트: 외부에 그대로 존재 (예: D:\clients\acme-web) — team.json.projectPath 로 참조.
#    wmux workspace의 cwd = projectPath, 역할 세션 cwd = projectPath(또는 그 worktree).
```

**핵심 원칙**
- **팀 = projectPath 포인터**: 프리랜서의 실제 클라이언트 리포는 어디에나 있음 → 템플릿 안으로 옮기지 않고 경로로 등록. 새 프로젝트는 도구가 scaffold도 가능(둘 다 지원).
- **registry 분할**: `registry.json`은 가벼운 팀 인덱스, 팀 상세는 `teams/<team>/*.json`로 분산 → 팀 수십 개도 스케일.
- **확장점**: `src/connectors/*.js`(빌트인) + `workspace/connectors/*.js`(사용자) 자동 병합. 역할 템플릿도 동일 패턴.

**식별 규약**: registry가 `team.name` ↔ `wmux workspaceId`, `role.id` ↔ `wmux agentId`/`paneId`, `team.projectPath` ↔ 실제 경로를 매핑(wmux ID는 UUID라 registry가 번역기 역할).

---

## 6. 데이터 모델 — `manager/registry.json`

> 물리적 저장은 §5대로 분할 가능: `registry.json`=팀 인덱스+상태 요약, 팀 상세(roles·capabilities·connections)는 `teams/<team>/*.json`. 아래는 **논리 스키마**.

```jsonc
{
  "updatedAt": "2026-07-09T09:30:00Z",
  "teams": [
    {
      "id": "team-alpha",
      "name": "Project Alpha",
      "client": null,                       // D6: 다중 고객 대비 필드
      "workspaceId": "ws-b4b061be-…",       // wmux workspace
      "path": "teams/team-alpha",
      "roles": [
        {
          "id": "backend",
          "agentId": "agent-…",             // wmux agent (spawn 결과)
          "paneId": "pane-…",
          "surfaceId": "surf-…",
          "status": "working",              // idle|working|waiting|done|error
          "startedAt": "2026-07-09T09:10:00Z",
          "lastActivity": "2026-07-09T09:28:12Z",
          "toolUses": 0,
          "cost": { "tokens": 0, "usd": 0 },// M4
          "handover": null                  // 완료 시 inbox 경로
        }
      ]
    }
  ]
}
```

### 상태 정의 & 감지 방법
| 상태 | 의미 | 감지 신호 |
|------|------|-----------|
| `idle` | 생성됐으나 대기 | 초기값 |
| `working` | 작업 중 | `wmux agent status` = running + PostToolUse 훅 활동 |
| `waiting` | 사용자 입력 대기 | Notification 훅 (또는 read-screen 프롬프트 감지) |
| `done` | 완료 + 인수인계 작성됨 | Stop 훅 |
| `error` | 비정상 종료 | `agent list` status=exited & exitCode≠0 |

> 상태 소스 이중화: (1) `wmux agent list`의 running/exited는 항상 신뢰 가능한 하한선, (2) 훅이 working/waiting/done의 세밀한 구분을 채움.

---

## 6.5 기능 인벤토리 (Capability Inventory) — 글로벌 vs 세션별 ⭐ (신규 D9)

**목적**: 각 세션(역할)이 지금 어떤 능력(플러그인·스킬·에이전트·MCP·훅·커맨드)을 갖고 있는지, 그게 **글로벌 상속**인지 **이 세션/프로젝트 전용**인지 구분해 대시보드에 표시.

### 능력의 4가지 스코프 (이 머신 실측 기반)
| 스코프 | 소스 (실측 경로) | 적용 범위 |
|--------|------------------|-----------|
| **global (사용자)** | `~/.claude/settings.json`(`enabledPlugins`·`mcpServers`·`hooks`), `~/.claude/{agents,commands,skills}/`, `~/.claude/CLAUDE.md` | 모든 세션 상속 |
| **project (프로젝트)** | `<cwd>/.claude/{settings.json,settings.local.json,agents,commands,skills}`, `<cwd>/.mcp.json`, `<cwd>/CLAUDE.md`, `~/.claude.json`의 `projects[<cwd>]`(mcpServers·enabled/disabledMcpjsonServers) | 그 workspace(팀)만 |
| **plugin (기여)** | 활성 플러그인이 펼치는 skills/agents/commands/hooks/mcp. 소스: `~/.claude/plugins/cache/<mp>/<plugin>/<ver>/` | 활성 스코프 따라 global 또는 project |
| **session (실행 플래그)** | spawn 시 넘긴 `--agents --mcp-config --plugin-dir --plugin-url --agent --settings` | 그 세션 프로세스만 (휘발성) |

### 활성화(enabled) vs 사용가능(available) — 반드시 구분
- **사용가능**: `plugins/marketplaces/`에 카탈로그로 존재 (이 머신엔 `antigravity-awesome-skills` 186개+ 등)
- **활성**: `settings.json`의 `enabledPlugins`에서 `true`인 것만. 실측:
  ```
  wmux-orchestrator@wmux        : true
  pm-execution@pm-skills        : true
  pm-toolkit@pm-skills          : true
  chrome-devtools-mcp@official  : false   ← 설치돼 있으나 비활성
  ```
- 대시보드는 **활성만 기본 표시**, 토글로 "사용가능(비활성)"까지 확장.

### 수집 방법 — `capctl.js` (teamctl의 스캐너 모듈)
Claude Code는 skills/agents를 JSON으로 뱉는 CLI가 없음(v2.1.205엔 `claude mcp`·`claude agents`만) → **파일시스템+설정 스캔**이 정석(= Claude Code가 부팅 때 하는 방식):
1. `~/.claude/settings.json` → global `enabledPlugins`·`mcpServers`·`hooks`
2. `~/.claude.json` → `projects[<cwd>]` → project MCP·enabled/disabled 서버
3. `<cwd>/.claude/*` + `.mcp.json` + `CLAUDE.md` → project agents/commands/skills
4. **플러그인**: `plugins/installed_plugins.json`(설치+scope: `user`=글로벌 / `project`=전용) × `settings.json.enabledPlugins`(활성) → `installPath` 하위를 폴더 규약으로 열거 (`skills/<name>/SKILL.md`·`commands/*.md`·`agents/*.md`·`hooks/`). ※ wmux-orchestrator처럼 번들 플러그인은 installed_plugins에 없어 다중 루트 해석
5. teamctl이 spawn 때 쓴 실행 플래그 → session 스코프로 직접 기록 (가장 정확)
6. 교차검증: 역할 cwd에서 `claude mcp list` 실행 → MCP 실측 대조 (⚠️ 단, list는 `settings.json.mcpServers`를 안 보여줌 — §6.6 MCP 절의 5소스 스캔과 병행 필수)
→ 각 항목을 `{kind, name, scope, enabled, source}` 로 태깅해 registry에 저장.

### registry 확장 (역할 객체에 `capabilities` 추가)
```jsonc
"capabilities": {
  "inheritedGlobal": true,               // 글로벌 세트 상속 여부
  "items": [
    { "kind":"plugin", "name":"pm-execution", "scope":"global", "enabled":true,
      "source":"~/.claude/settings.json#enabledPlugins" },
    { "kind":"skill",  "name":"write-prd", "scope":"plugin:pm-execution", "enabled":true },
    { "kind":"agent",  "name":"backend-reviewer", "scope":"project", "enabled":true,
      "source":"teams/team-alpha/.claude/agents/backend-reviewer.md", "shadowsGlobal":false },
    { "kind":"mcp",    "name":"chrome-devtools", "scope":"global", "enabled":true },
    { "kind":"mcp",    "name":"unity", "scope":"session", "enabled":true,
      "source":"--mcp-config (spawn 시 주입)" }
  ]
}
```
- `shadowsGlobal`: project 항목이 같은 이름의 global을 덮어쓰면 표시(관리자에게 중요한 오버라이드 정보).
- 글로벌 세트는 registry 최상위 `globalCapabilities` 블록에 **1회** 저장 → 세션별은 **델타만** 저장(중복 제거).

### 대시보드 표현
- **🌐 글로벌 패널**: 모든 세션 공통 능력(활성 플러그인·MCP·훅·글로벌 agents/skills) — 상단 접이식 요약.
- **📌 세션별 패널**: 팀/역할 선택 시 "글로벌 상속 N개"는 접고, **이 세션 전용 델타(project/session 스코프)**를 강조.
- **배지**: `global`/`project`/`plugin:x`/`session` 색상 구분, 비활성은 흐리게, `shadowsGlobal`은 ⚠️.

---

## 6.6 연결 상태 (Integration Health) — git·Supabase 등 외부 연동 ⭐ (신규 D10)

**목적**: 각 팀(프로젝트)이 물려 있는 **외부 서비스 연결의 실시간 상태**를 확인. §6.5(Claude 능력)와 **다른 축** — 여기선 "지금 이 프로젝트가 어디에 연결돼 있고 건강한가".

### 커넥터 모델 (확장 가능)
연동 하나 = 커넥터 모듈 1개. `src/connectors/*.js`(빌트인) + `workspace/connectors/*.js`(사용자) 자동 병합 → "등등"을 코드로 확장.
```js
{
  id: 'supabase', label: 'Supabase', scope: 'project',   // 또는 'global'(머신 로그인)
  detect(ctx),         // 이 프로젝트에 존재? (파일·env 기반, CLI 불필요)
  probe(ctx) => { state, summary, details, checkedAt }
}
// ctx = { projectPath, env, globalConfig }
```

### 탐지 원칙 — CLI 없어도 동작 (이 머신엔 git·node만 설치됨)
1. **파일·env 우선**: 설정/락/`.env` 키로 존재 판단 (예: `supabase/config.toml`·`SUPABASE_URL`)
2. **CLI/네트워크는 보강**: 있으면 실측(로그인·마이그레이션·CI), 없으면 `tool-missing`
→ 커넥터는 예외로 죽지 않고 상태만 낮춰 보고.

### 상태값
| state | 표시 | 의미 |
|-------|------|------|
| `connected` | 🟢 | 정상 연결 |
| `needs-auth` | 🟡 | 설정됐으나 인증 필요 (예: MCP `mcp-needs-auth-cache.json`) |
| `pending-approval` | 🟡 | `.mcp.json` 서버 미승인 — 승인 전엔 연결 시도 자체를 안 함 (실측: `claude mcp list` ⏸ 표시, D15) |
| `degraded` | 🟡 | 부분 이상 (변경 미커밋, 마이그레이션 밀림 등) |
| `error` / `disconnected` | 🔴 | 연결 실패 |
| `not-configured` | ⚪ | 이 프로젝트엔 해당 연동 없음 |
| `tool-missing` | ⚪ | 설정은 있으나 프로브할 CLI 부재 |

### 커넥터 분류 — core(항상) vs optional(선택제) ⭐
git·supabase 등은 **연결 안 돼 있을 수 있어** 항상 돌리면 노이즈 → **선택제(opt-in)로 분리**. 팀별 `team.json.connectors.enabled`에 넣은 것만 실행. `new-team` 시 `detect()`로 후보를 **제안**하고 사용자가 확정.

**Core (항상 실행 · 값싸고 보편적)**
| 커넥터 | 탐지 | 프로브(요약 예) |
|--------|------|------------------|
| **ports** | 상시 | 이 프로젝트가 띄운 로컬 서버 포트 (아래 전용 절) |
| **env** | `.env*` | **키 존재 여부만**(값 노출 ✕), `.env.example` 대비 누락 키 |
| **node** | `package.json` | `node_modules` 설치?·락파일·`npm outdated` 수 |
| **mcp** | 5소스 스캔 (아래 전용 절) | 서버별 connected/needs-auth/pending-approval/error — 정적 스캔 + `claude mcp list` 헬스체크 (D15) |

**Optional (선택제 · 팀별 opt-in · 기본 off)**
| 커넥터 | 탐지 | 프로브(요약 예) |
|--------|------|------------------|
| **git** | `.git/` | `main ↑2 ↓0 · 3 uncommitted · origin: github.com/…` (git 설치 확인됨) |
| **supabase** | `supabase/config.toml`·`SUPABASE_URL` | URL+키→connected(+`/auth/v1/health` 핑), 키 없으면 needs-auth |
| **github** | git remote | remote 추출; `gh` 있으면 auth·PR·CI run |
| **docker** | `docker-compose.yml`/`Dockerfile` | `docker` 있으면 `ps` 실행 상태 |

> 미설정/미선택 커넥터는 대시보드에서 숨김(또는 접힘). "사용가능하지만 off"는 토글로 표시.

### 로컬 포트 / 실행 중 서버 (core: `ports`) ⭐ (신규 D12)
"지금 어떤 로컬 서버가 몇 번 포트에 떠 있나"를 확인 — 포트 충돌 방지·실행 현황 파악의 핵심.

**감지 (Windows 실측 검증됨)**
1. 리스닝 포트: `Get-NetTCPConnection -State Listen` → `{LocalPort, OwningProcess(PID)}` (크로스플랫폼 폴백 `netstat -ano`)
2. PID → 프로세스명: `Get-Process -Id`
3. PID → 커맨드라인: `Get-CimInstance Win32_Process` — **커맨드라인에 프로젝트 경로가 담겨** 팀 귀속 가능
   - 실측 예: 포트 `3000` = PID 27360 = node, 커맨드라인 `…\WordDocCommunity\.next\dev…` → 그 팀 dev 서버로 귀속

**표현 (두 층)**
- **🌐 글로벌 포트맵**(매니저 패널): 머신의 모든 리스너 = `포트 · 프로세스 · PID · 귀속 팀(or –)`. 예: `3000 node → team-word`, `3306 mysqld → –`, `9222 wmux → –`
- **📌 팀별**: `projectPath`가 커맨드라인에 매칭되는 리스너 + `team.json.expectedPorts` 대비 up/down. 미귀속은 "기타" 버킷.

> `expectedPorts`: 팀이 기대하는 포트를 선언(또는 `package.json`/`vite.config`/`.env PORT`에서 자동 추론) → 떠야 할 서버가 안 떠 있으면 🔴, 예상 밖 점유는 ⚠️.

### MCP 서버 연결 상태 (core: `mcp`) ⭐ (신규 D15)
"이 팀(프로젝트)의 각 MCP 서버가 지금 실제로 붙어 있는가"를 **서버 단위**로 관제. §6.5 인벤토리가 "무엇이 설정돼 있나(존재·활성)"라면, 여기는 "그게 살아 있나(연결 건강)" — 같은 서버가 양쪽에 다른 축으로 나타난다.

**정의 소스 5곳 (이 머신 실측)** — 어느 한 곳만 봐서는 반드시 누락된다:
| 스코프 | 소스 | 실측 |
|--------|------|------|
| **global(settings)** | `~/.claude/settings.json` → `mcpServers` | `chrome-devtools`(stdio·npx) 존재. ⚠️ **`claude mcp list`에 안 나옴** |
| **user** | `~/.claude.json` → `mcpServers` (`claude mcp add -s user`) | 현재 `{}` (빈 객체) |
| **local(프로젝트-개인)** | `~/.claude.json` → `projects[<cwd>].mcpServers` | `UnityMCP`(uvx stdio) 1건 발견 |
| **project(공유)** | `<cwd>/.mcp.json` — **승인 게이트** (`projects[<cwd>].enabledMcpjsonServers`/`disabledMcpjsonServers`) | 미승인 서버는 `⏸ Pending approval`, 연결 시도 자체를 안 함 |
| **plugin / session** | 활성 플러그인의 MCP · spawn 플래그 `--mcp-config` | teamctl이 spawn 시 직접 기록 (가장 정확, §6.5와 동일) |

**상태 판정 2계층**
1. **정적 스캔 (값싸고 항상)**: 위 5소스 파일 스캔 → 서버 존재·스코프·transport(stdio/http/sse)·승인 여부 + `~/.claude/mcp-needs-auth-cache.json`(OAuth 필요 서버 캐시, 실측: 현재 `{}`) → `pending-approval`/`needs-auth`/`not-configured`까지는 **연결 없이** 판정 가능
2. **동적 헬스체크 (온디맨드·캐시)**: 역할 cwd에서 `claude mcp list` 실행 → 승인된 서버를 실제 spawn해 검사. 출력 파싱: `✓ Connected` → `connected` · `✗ Failed to connect` → `error` · `⏸ Pending approval` → `pending-approval`(⏸는 실측 확보, ✓/✗는 공식 문서 형식 — 구현 시 실측 검증). **stdio 서버는 헬스체크가 곧 프로세스 spawn이라 느림(수 초~)** → 주기 폴링 금지, 온디맨드 + 수동 새로고침 + `connections.json` 캐시(§6.6 공통 원칙)

**실측 주의 (스캐너 필수 반영)**
- `claude mcp list`는 `~/.claude/settings.json`의 `mcpServers`를 **표시하지 않음** (실측: chrome-devtools 설정돼 있으나 "No MCP servers configured" 출력) → **파일 스캔 + CLI 교차검증 필수**, CLI 단독 신뢰 금지 (R5 연계)
- `~/.claude.json`의 `projects`엔 **삭제된 프로젝트 항목이 잔존** (실측: 80개 항목 중 실존하지 않는 경로 확인) → `projectPath` 실존 확인 후만 집계 (스테일 가드)
- 승인 상태 변경(`enabledMcpjsonServers` 편집)은 **신뢰 게이트** — 도구가 대신 승인하지 않는다. `pending-approval`이면 대시보드에 "세션에서 승인 필요" 안내만 표시

**상태 매핑** (§6.6 공통 상태값 사용, `pending-approval` 신설)
| 판정 근거 | state | 표시 |
|-----------|-------|------|
| `✓ Connected` | `connected` | 🟢 |
| `mcp-needs-auth-cache.json` 등재 / OAuth 미완 | `needs-auth` | 🟡 |
| 미승인 `.mcp.json` 서버 (⏸) | `pending-approval` | 🟡 |
| `✗ Failed to connect` | `error` | 🔴 |
| `disabledMcpjsonServers` 등재 | `not-configured` (비활성 명기) | ⚪ |

**대시보드 표현**
- 팀 카드 요약 배지: `MCP 2/3 🟢` (연결/전체) — 신호등 롤업에 포함
- 드릴다운: 서버별 행 = `이름 · 스코프 배지(global/user/local/project/plugin/session) · transport · 상태 · 마지막 체크 시각 · [재검사]`
- §6.5 인벤토리 패널과 상호 링크: 인벤토리의 mcp 항목 클릭 → 이 연결 상태 행으로 (존재 축 ↔ 건강 축)

### 글로벌 vs 세션별 (§6.5와 동일 축)
- **project 스코프**: git·supabase·env·node — 팀(projectPath)마다 다름
- **global 스코프**: aws/gcloud 로그인 등 머신 전역 → 글로벌 패널에
→ 배지·패널을 §6.5와 공유(같은 global/project/session 구분).

### 저장·표현·안전
- 팀 사이드카 `teams/<team>/connections.json`에 `checkedAt`와 함께 캐시. 프로브가 느릴 수 있어 **렌더를 블록하지 않음** — 캐시 표시 + 온디맨드/주기 갱신.
- 🔴 **보안**: 시크릿 **값**은 절대 저장·표시 금지. 키 이름·존재·마스킹만.
- 대시보드: 팀 카드에 상태 신호등 요약, 클릭 시 커넥터별 상세.

---

## 6.7 역할 세션 라이브 뷰 — "작업중인 내용" 보기 ⭐ (신규 D13)

**목적**: 팀 카드에서 역할을 클릭 → 그 세션이 **지금 무엇을 하는지** 상세 확인(현재 작업·라이브 화면·활동 피드·변경 파일·컨트롤).

### "작업중인 내용" 소스 3중화 (견고도 순)
| 소스 | 방법 | 견고도 | 용도 |
|------|------|--------|------|
| **pane 클릭(네이티브)** | `focus-pane <id>` / `select-workspace` → 실제 claude TUI 관찰·개입 | ★★★ 항상 | 완전한 라이브 뷰·직접 개입 |
| **트랜스크립트 tail** | `~/.claude/projects/<enc-cwd>/<uuid>.jsonl` 마지막 N줄 파싱 → 최신 발화·현재 툴콜·변경 파일·토큰 | ★★★ 견고 | 대시보드 "지금 하는 일"·활동 피드 |
| **read-screen** | 대상 surface focus 후 `read-screen --lines N` (`surface.read_text`) | ★☆ 렌더러 의존 | 라이브 화면 캡처(있으면 보강) |
| **PostToolUse 훅** | 툴콜마다 `{tool,target,ts}` 로그 | ★★★ | 경량 활동 타임라인 |

- **경로 인코딩**: 트랜스크립트 디렉토리 = cwd의 `\`·`:`를 `-`로 치환 (예: `C--Users-LEE-…-WordDocCommunity`). teamctl이 역할 cwd로 위치 계산. (이 머신에 400+ 트랜스크립트 실측 확인)
- **read-screen 주의**: 이 버전은 헤드리스 호출 시 `{"text":"","note":"renderer-side xterm serializer 필요"}` 반환 → 렌더러 붙은 실제 패널에서만 캡처. 그래서 **트랜스크립트 tail을 1순위 소스**로 하고 read-screen은 보강용.

### 상세 뷰 구성 (목업 `role-detail-mockup.html` 참조)
- **지금 하는 일**: 트랜스크립트 최신 assistant 발화 요약
- **라이브 화면**: read-screen 캡처(가능 시) — 실패 시 트랜스크립트 렌더로 대체
- **활동 피드**: 최근 툴콜 타임라인(훅)
- **변경 파일**: `git diff --stat`(있으면) + 트랜스크립트 Edit/Write 집계
- **세션 메타**: 모델·경과·토큰·비용·cwd·transcript 경로
- **컨트롤**: 열기(`focus-pane`)·메시지 보내기(`send`)·종료(`agent kill`)

### "열기" 동작 — 세션 클릭 → wmux 점프 (중요)
- **핵심 능력(가능)**: `select-workspace <팀ws>` + `focus-pane <역할pane>`(또는 `focus-surface`) → wmux 뷰포트가 그 팀 workspace로 전환되고 해당 세션 pane에 포커스 → **바로 그 claude TUI로 들어가 타이핑·개입 가능** (`zoom-pane`으로 전체화면).
- **단, MVP 대시보드는 read-only markdown surface(D8)** → 마크다운 안에서 직접 "클릭 실행"은 불가. 열기는:
  1. `teamctl attach <팀>/<역할>` 명령(위 focus 조합 실행) 또는 단축키, 또는
  2. **wmux 네이티브 UI에서 그 pane/탭을 직접 클릭**(항상 가능)
- **인-대시보드 클릭→점프 = 채택(D14)**: 브라우저 패널 HTML 대시보드 + 컨트롤 브리지(§4.5). 세션 클릭 → `/attach` → `select-workspace`+`focus-pane`. (마크다운 surface는 경량 폴백)

---

## 7. Hook 설계 (오케스트레이터 패턴 재사용)

| 훅 | 시점 | 동작 |
|----|------|------|
| `SessionStart` | 역할 세션 시작 | 팀 `project.md` + 역할 지침 주입, registry 상태 → working |
| `PostToolUse` | 툴 사용마다 | `toolUses++`, `lastActivity` 갱신 → 대시보드 반영 |
| `Notification` | 입력 대기 | 상태 → waiting, 사이드바 알림 |
| `Stop`/`SubagentStop` | 세션 종료 | 인수인계 문서 생성 → `manager/inbox/`, 상태 → done, 대시보드 갱신 |

> 훅 스크립트와 teamctl은 **같은 registry.json**을 읽고 쓴다 → 상태 일관성.

---

## 8. 인수인계 문서 규약 (`templates/handover-template.md`)

세션 종료 시 남기는 표준 문서. 관리자가 30초 안에 파악 가능해야 함.

```markdown
# 인수인계 — {team} / {role} — {ISO datetime}

## 무엇을 했나 (2~3문장 요약)
## 변경된 파일 / 브랜치
## 내린 결정과 이유
## 미해결 / 다음 할 일
## 검증 방법 (어떻게 확인하나)
## 비용 (토큰 / 시간)   ← M4
```

Stop 훅이 세션 종료 시 이 템플릿으로 초안을 만들고, 세션 자신이 마지막 액션으로 내용을 채우는 방식(오케스트레이터의 result-file 패턴과 동일).

---

## 9. 마일스톤 로드맵

### M0 — 뼈대 & 규약 *(반나절)*
- [ ] 폴더 구조 + `registry.json` 스키마 확정
- [ ] `wmux-orchestrator` 스크립트/스킬 정독 (`skills/orchestrate`, `scripts/launch-agent.js`, `hooks.json`)
- [ ] 역할 템플릿 2~3종 (`planner`, `frontend`, `backend`)
- [ ] `teamctl.js` 골격 (wmux CLI 래퍼 + registry 로드/세이브)

### M1 — 모니터링 + 세션 생성/제어 *(첫 마일스톤 ⭐)*
- [ ] `teamctl new-team <name>`: new-workspace → rename → cwd 설정 → 폴더·project.md 생성 → registry 등록
- [ ] `teamctl spawn-role <team> <role>`: `agent spawn --cmd "claude … -- <role-prompt>" --label <role> --cwd … --workspace …` → agentId 기록
- [ ] `teamctl kill-role` / `list` (`agent list` 집계 → registry) / `attach` (`select-workspace` + focus)
- [ ] `teamctl serve`: 로컬 HTTP(127.0.0.1) — `/api/state`(폴링) + `/attach`·`/send`·`/kill`·`/spawn` (D14 컨트롤 브리지)
- [ ] HTML 대시보드 → `wmux browser open http://127.0.0.1:PORT/` (브라우저 패널)
- [ ] **세션 클릭 → 점프**: `/attach` → `select-workspace`+`focus-pane` (필요 시 `zoom-pane`)
- [ ] 드릴다운·포트·인벤토리·연결상태 뷰를 HTML로 렌더 (§6.5–6.7)
- [ ] 폴백: 경량 `dashboard.md` → `wmux markdown` (서버 없이 at-a-glance)

### M1.5 — 기능 인벤토리 *(신규 D9, 모니터링 성격이라 M1과 함께)*
- [ ] `capctl.js`: global/project/plugin/session 4스코프 스캐너
- [ ] registry `capabilities`(역할별 델타) + `globalCapabilities`(공통) 채우기
- [ ] `enabledPlugins` 활성/비활성 구분, `shadowsGlobal` 오버라이드 감지
- [ ] `claude mcp list` 교차검증
- [ ] 대시보드에 🌐 글로벌 패널 + 📌 세션별 델타 패널 + 스코프 배지

### M1.6 — 연결 상태 + 로컬 포트 (신규 D10·D12, 모니터링 성격이라 M1과 함께)
- [ ] 커넥터 러너 (core/optional 분류, 팀별 opt-in `connectors.enabled`)
- [ ] Core: `ports`(Get-NetTCPConnection→PID→커맨드라인 귀속)·`env`·`node`·`mcp`
- [ ] MCP 정적 스캐너 (D15): 5소스 열거(settings.json · ~/.claude.json user/local · .mcp.json · 플러그인/세션 플래그) + 승인·needs-auth 판정 + 스테일 프로젝트 가드
- [ ] MCP 동적 헬스체크 (D15): 역할 cwd `claude mcp list` 파서(✓/✗/⏸) — 온디맨드+캐시, 렌더 논블로킹
- [ ] Optional(선택제): `git`·`supabase`·`github`·`docker`
- [ ] 🌐 글로벌 포트맵 + 📌 팀별 포트(`expectedPorts` 대비 up/down)
- [ ] `connections.json` 캐시 + 상태 신호등, 렌더 논블로킹
- [ ] 시크릿 미노출 가드 (`.env` 값 저장·표시 금지)

### M1.7 — 역할 세션 라이브 뷰 (신규 D13)
- [ ] 역할 클릭 → 상세 뷰(현재 작업·활동 피드·변경 파일·메타)
- [ ] 트랜스크립트 tail 파서 (`~/.claude/projects/<enc-cwd>/*.jsonl`)
- [ ] read-screen 캡처(가능 시) + 실패 시 트랜스크립트 폴백
- [ ] 컨트롤: 열기(`focus-pane`)·메시지(`send`)·종료(`agent kill`)

### M2 — 인수인계 파이프라인
- [ ] Stop/SubagentStop 훅 → 인수인계 자동 생성 → `manager/inbox/`
- [ ] inbox 신규 파일 → 대시보드 알림 배지
- [ ] 관리자 리뷰: accept(아카이브 → `handovers/`) / kick-back(후속 역할 spawn)

### M3 — 격리 & 병합
- [ ] 역할별 git worktree (파일 충돌 방지) — 오케스트레이터의 `--worktree` 패턴 참고
- [ ] 병렬 역할 coupling → contract 파일 (오케스트레이터 Phase 4.5 재사용)
- [ ] 관리자 리뷰 게이트 → 병합

### M4 — 관측 & 비용
- [ ] 세션별 토큰·시간 추적
- [ ] **프리랜서 청구 리포트** (프로젝트별 비용 집계) ← 차별화 포인트

---

## 10. 기술 스택

- **터미널/세션/레이아웃**: wmux 0.13.0 (workspace·agent·pane·markdown·sidebar)
- **오케스트레이션 레이어**: Node.js 스크립트 (`teamctl.js` 등) → `wmux` CLI 호출 (`execFileSync`)
- **자동화**: Claude Code Hooks (settings.json / 플러그인 hooks.json)
- **상태**: `manager/registry.json` → 규모 시 SQLite
- **대시보드**: wmux markdown surface (+ 향후 옵션: 브라우저 패널에 HTML 대시보드)

---

## 11. 핵심 리스크 & 미해결 질문

### 🟡 R1. wmux CLI/버전 종속
전 기능이 wmux 0.13.0 CLI·IPC 파이프에 의존. 버전 업 시 명령 시그니처 변할 수 있음 → `capabilities` 체크 + 버전 가드.

### 🟡 R2. 동시 세션 비용 폭증
세션 N개 = 비용 N배 → 동시 실행 상한, 세션별 비용 추적(M4).

### 🟡 R3. 병렬 역할 파일 충돌
같은 프로젝트를 동시 수정 → 충돌 → worktree 격리 + contract 파일(M3).

### 🟡 R4. 상태 감지 정확도
`agent list`는 running/exited만 확실. working vs waiting 구분은 훅·`read-screen` 휴리스틱에 의존 → 오탐 가능. 초기엔 보수적으로.

### 🟡 R5. 기능 열거의 정확도·버전 종속
Claude Code가 능력을 JSON으로 노출 안 함 → 파일·설정 스캔 휴리스틱. enablement 저장 위치(`settings.json`·`~/.claude.json`)가 버전 따라 바뀔 수 있음 → **v2.1.205 기준 구현** + 스키마 가드 + `claude mcp list` 교차검증. 플러그인이 펼치는 스킬 목록은 `plugin.json`·디렉토리 규약에 의존.
**실측 보강 (D15)**: `claude mcp list`는 `settings.json`의 `mcpServers`를 표시하지 않으며, `~/.claude.json.projects`엔 삭제된 프로젝트가 잔존(80개 중 실존 안 하는 경로 확인) → **어느 단일 소스도 신뢰 금지**. 파일 스캔+CLI 교차검증과 경로 실존 가드가 필수(§6.6 MCP 절).

### 🟡 R6. 커넥터 프로브 비용·시크릿 안전
네트워크 프로브(핑·CI 조회)는 느리거나 레이트리밋 → 캐시+온디맨드, 렌더 논블로킹. `.env` 취급 시 **값 절대 미노출**(키 이름·존재만). CLI 부재 환경(이 머신: gh·docker·supabase 없음)에서 정상 degrade(`tool-missing`).

### 🟡 R7. read-screen 렌더러 의존
`read-screen`은 렌더러 붙은 패널에서만 화면 캡처(헤드리스 호출 시 빈 값 확인). → 라이브 화면은 best-effort, **트랜스크립트 tail을 주 소스**로. 트랜스크립트 jsonl 포맷도 버전 종속 → 파서 방어적으로.

### 🟡 R8. 로컬 컨트롤 서버 보안 (D14)
`teamctl serve`는 wmux 명령을 실행 → `127.0.0.1` 바인드 + 토큰 필수, 외부 노출·CORS 개방 금지. 페이지를 같은 서버가 서빙해 same-origin 유지. 서버 다운 시 마크다운 폴백으로 degrade.

### ✅ Q1. 대시보드 형태 → **인터랙티브 HTML 승격** (D14, D8 개정)
클릭→점프 요구로 주 대시보드는 로컬 서버 서빙 HTML(§4.5)로 확정. 마크다운 surface(D8)는 서버 없이 뜨는 경량 폴백으로 유지.

### ❔ Q2. 별도 플러그인화 여부
`wmux-teams` 플러그인으로 패키징할지, 프로젝트 로컬 스크립트로 둘지. (초기엔 로컬 스크립트 추천, 안정화 후 플러그인)

### ❔ Q3. 세션 지속성/복구 범위
대시보드·wmux 재시작 시 복구 정책. wmux workspace는 살아있음 → registry로 재바인딩 + `claude --resume` 어디까지 자동화할지.

---

## 12. 다음 액션
1. **M0 착수** *(다음)*: 폴더 구조 스캐폴딩 + `registry.json` 스키마 파일 + 역할 템플릿 3종 + `teamctl.js` 골격
2. M0 중 `wmux-orchestrator`(`skills/orchestrate/SKILL.md`, `scripts/launch-agent.js`, `hooks.json`) 정독해 재사용 패턴 확정
3. M1로 진입: `new-team` / `spawn-role` / `list` / `render-dashboard` 순으로 구현·검증
4. 잔여 정리: 이번에 실수로 생성된 빈 workspace/pane 1개씩 수동 정리 (안전 분류기가 자동 정리를 차단함)
