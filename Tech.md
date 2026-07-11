# Tech.md — 기술 설계 문서 (Claude Cockpit)

> **성격**: 엔지니어링 스펙. `planner.md`(제품·결정)와 짝. 결정 근거는 planner의 `D#`, 기능은 `F#` 참조.
> **대상 독자**: M0~M1 구현자(사람 또는 claude 역할 세션).
> **검증 환경**: Windows 11 · wmux 0.13.0 · Claude Code v2.1.205 · Node 20 · git 설치됨.
> **상태**: v0.1 (planner v0.9 기준 · v0.10 D15 MCP 연결 상태 스팟 동기화 반영)

---

## 1. 시스템 개요

Claude Cockpit은 **wmux 위에 얹는 얇은 오케스트레이션 레이어**다. 새 mux·PTY·터미널 렌더러를 만들지 않는다(D4).

```
┌───────────────────────────────────────────────┐
│  브라우저 패널 HTML 대시보드 (wmux browser)      │  ← 주 UI (D14)
│    fetch(same-origin) ↕ /api/state · /attach …  │
├───────────────────────────────────────────────┤
│  teamctl (Node)                                 │
│   ├ serve   : 로컬 HTTP(127.0.0.1) 컨트롤 브리지 │
│   ├ core    : registry / wmux 래퍼 / 경로 해석   │
│   ├ commands: new-team · spawn-role · kill · …   │
│   ├ capctl  : 기능 인벤토리 스캐너 (F6)          │
│   └ connectors: 연결 상태·포트 프로브 (F4·F5)    │
├───────────────────────────────────────────────┤
│  wmux CLI  (node $WMUX_CLI …)  ← 파이프 IPC      │
│   workspace=팀 · agent(pane)=역할 · markdown …   │
├───────────────────────────────────────────────┤
│  Claude Code 세션들 (역할)                       │
│   settings/hooks/transcripts (~/.claude, cwd)   │
└───────────────────────────────────────────────┘
```

**개념 매핑**: 팀 = wmux workspace · 역할 = workspace 내 pane의 claude agent · 관리자 = 대시보드 + registry.

---

## 2. 기술 스택 & 런타임 요구사항

| 계층 | 선택 | 비고 |
|------|------|------|
| 세션/터미널/레이아웃 | **wmux 0.13.0** | 필수. `capabilities`로 버전 가드 |
| 오케스트레이션 | **Node.js 20+ (ESM)** | Claude Code 런타임에 항상 존재 |
| HTTP 서버 | Node 내장 `http` | 외부 의존 최소화, 무프레임워크 지향 |
| 상태 저장 | JSON 파일 → (확장 시) SQLite | `workspace/` 하위 |
| 자동화 | Claude Code Hooks | `settings.json` / 플러그인 `hooks.json` |
| 셸 | PowerShell(주) + Git Bash | 포트 감지는 PowerShell 경로 |
| 대시보드 | 자체 서빙 HTML + Vanilla JS | 빌드리스. 필요 시 Vite 도입 |

**의존성 정책**: 런타임 npm 의존성 0을 목표(Node 내장 + wmux CLI + git/claude CLI). 파서류만 필요 시 추가.

---

## 3. 리포지토리 폴더 구조

**3층 분리(D11)**: ① 도구 코드(버전관리) ② 런타임 상태(gitignore) ③ 실제 프로젝트(외부, 경로 참조).

```
ClaudeTemplate/
├─ planner.md                      # 제품·결정 문서
├─ Tech.md                         # (이 문서) 엔지니어링 스펙
├─ README.md
├─ package.json                    # "type":"module", bin: teamctl
├─ .gitignore                      # workspace/ 제외 (구조 유지용 .gitkeep만)
│
├─ bin/
│    teamctl.js                    # CLI 진입점. 인자 파싱 → src/commands/* 디스패치
│
├─ src/
│    core/
│      wmux.js                     # wmux CLI 래퍼 (§5). 모든 wmux 호출 단일 창구
│      registry.js                 # registry.json + team.json 읽기/쓰기 (원자적)
│      paths.js                    # 경로 해석: workspace, 트랜스크립트 enc-cwd(§15)
│      config.js                   # 토큰·포트·설정 로드 (~/.cockpit or workspace/config)
│      log.js                      # 구조적 로그
│    commands/
│      new-team.js  spawn-role.js  list.js  kill.js  attach.js  status.js  serve.js
│    capabilities/
│      capctl.js                   # 4스코프 스캐너 (§10)
│      scopes.js                   # global/project/plugin/session 해석
│    connectors/
│      index.js                    # 레지스트리 + 러너 (detect→probe, 캐시)
│      ports.js  env.js  node.js  mcp.js         # core (항상)
│      git.js  supabase.js  github.js  docker.js # optional (선택제)
│    server/
│      serve.js                    # http 서버 (§7). /api/state·/attach·/send·/kill·/spawn
│      static/                     # 대시보드 HTML/CSS/JS (서빙)
│        index.html  app.js  styles.css
│    live/
│      transcript.js               # ~/.claude/projects/<enc>/<uuid>.jsonl tail·파싱 (§12)
│      screen.js                   # read-screen 래퍼(폴백)
│    hooks/
│      on-session-start.js  on-tool-use.js  on-notification.js  on-stop.js
│
├─ templates/                      # 새 팀·역할 생성 시 복사되는 원본
│    roles/  role-planner.md  role-frontend.md  role-backend.md  role-qa.md
│    project-template.md  handover-template.md  team-CLAUDE.md
│
└─ workspace/                      # ② 런타임 상태 (gitignore)
     config.json                   # 브리지 토큰·포트 등
     manager/
       registry.json               # 팀 인덱스 + 상태 요약 (§4)
       globalCapabilities.json     # 글로벌 능력 세트 (1회, §4·§10)
       dashboard.md                # 마크다운 폴백 뷰 (D8)
       inbox/                      # 인수인계 도착함 (*.md)
     teams/
       <team-id>/
         team.json                 # projectPath·workspaceId·roles·connectors·expectedPorts
         project.md                # 공유 컨텍스트 (드릴다운 패널)
         capabilities.json         # 이 팀 능력 델타 (§10)
         connections.json          # 연결 상태 캐시 (§9·§11)
         handovers/                # 팀별 인수인계 아카이브
     connectors/                   # ③ 사용자 커스텀 커넥터(확장) — src/connectors와 병합 로드

# ③ 실제 프로젝트 코드는 외부에 존재 (예: D:\clients\acme-web). team.json.projectPath로 참조.
#    wmux workspace의 cwd = projectPath · 역할 세션 cwd = projectPath(또는 worktree).
```

---

## 4. 런타임 데이터 모델

**분할 저장**: `registry.json`은 가벼운 인덱스, 팀 상세는 `teams/<id>/*.json`. 모든 쓰기는 `tmp→rename` 원자적.

### 4.1 `manager/registry.json`
```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-09T09:44:00Z",
  "globalCapabilitiesRef": "manager/globalCapabilities.json",
  "teams": [
    { "id": "team-alpha", "name": "Project Alpha", "client": "Acme",
      "workspaceId": "ws-b4b0…", "path": "workspace/teams/team-alpha",
      "status": { "roles": 4, "working": 2, "waiting": 1, "error": 0 },
      "health": { "worst": "warn" } }        // 연결 상태 롤업 (신호등)
  ]
}
```

### 4.2 `teams/<id>/team.json`
```jsonc
{
  "id": "team-alpha", "name": "Project Alpha", "client": "Acme",
  "projectPath": "D:\\clients\\acme-web",     // ③ 실제 프로젝트 (커넥터 프로브 대상)
  "workspaceId": "ws-b4b0…",
  "connectors": { "enabled": ["git", "supabase"] },   // optional opt-in (D12)
  "expectedPorts": [ { "port": 5173, "label": "vite dev" } ],
  "roles": [
    { "id": "backend", "agentId": "agent-…", "paneId": "pane-…", "surfaceId": "surf-…",
      "status": "waiting",                    // idle|working|waiting|done|error
      "model": "claude-opus-4-8",
      "cwd": "D:\\clients\\acme-web",
      "transcript": "C:\\Users\\LEE\\.claude\\projects\\D--clients-acme-web\\<uuid>.jsonl",
      "startedAt": "2026-07-09T09:19:00Z", "lastActivity": "2026-07-09T09:42:33Z",
      "toolUses": 130, "cost": { "tokens": 210000, "usd": 1.40 },
      "handover": null }
  ]
}
```

### 4.3 `teams/<id>/connections.json` (§9·§11)
```jsonc
{
  "teamId": "team-alpha", "checkedAt": "2026-07-09T09:44:00Z",
  "connectors": [
    { "id": "git", "category": "optional", "state": "connected",
      "summary": "feat/auth ·clean", "details": { "branch": "feat/auth", "ahead": 0, "dirty": 0, "remote": "github.com/acme/web" } },
    { "id": "supabase", "category": "optional", "state": "needs-auth", "summary": "SUPABASE key 없음" },
    { "id": "ports", "category": "core", "state": "degraded", "summary": ":5173 expected down",
      "details": { "listening": [ { "port": 3000, "pid": 27360, "proc": "node", "team": null } ] } }
  ]
}
```
`state ∈ connected | degraded | needs-auth | pending-approval | error | disconnected | not-configured | tool-missing` (`pending-approval`: 미승인 `.mcp.json` MCP 서버, D15)

### 4.4 `capabilities.json` / `globalCapabilities.json` (§10)
```jsonc
// teams/<id>/capabilities.json — 세션 델타
{ "teamId":"team-alpha", "inheritedGlobal":true, "scannedAt":"…",
  "items":[ { "kind":"agent", "name":"pr-reviewer", "scope":"project", "enabled":true,
              "source":"…/.claude/agents/pr-reviewer.md", "shadowsGlobal":false } ] }

// manager/globalCapabilities.json — 공통(1회)
{ "scannedAt":"…",
  "plugins":[ {"name":"pm-execution","marketplace":"pm-skills","enabled":true} ],
  "mcp":[ {"name":"chrome-devtools","enabled":true} ],
  "skills":[ {"name":"write-prd","scope":"plugin:pm-execution"} ],
  "agents":[], "commands":[], "hooks":[ {"event":"PostToolUse","matcher":"Bash"} ] }
```
`kind ∈ plugin|skill|agent|command|mcp|hook`, `scope ∈ global|project|plugin:<x>|session`.

---

## 5. wmux 통합 레이어 (`src/core/wmux.js`)

wmux CLI는 `node $WMUX_CLI …` 로 호출(래퍼가 흡수). 모든 응답은 JSON.

```js
// 진입(1회 캐시): ① WMUX_CLI env ② PATH의 wmux ③ config wmuxBin 역산(<루트>/resources/cli/wmux.js)
// 탐색기 더블클릭(env 없음)에서는 ③이 실질 경로. 셋 다 실패 → ['wmux'] ENOENT = boot의 no-cli 신호.
// execFile(base[0], [...base.slice(1), ...args]) → JSON.parse(stdout)
```

### 5.1 teamctl 동작 → wmux 명령 매핑 (0.13.0 실측)
| teamctl 동작 | wmux 명령 | 반환/비고 |
|--------------|-----------|-----------|
| 팀 생성 | `new-workspace` → `rename-workspace <id> <name>` | `{workspaceId}` |
| 팀 목록 | `list-workspaces` | `{workspaces:[{id,title,cwd,isActive}]}` |
| 팀 열기 | `select-workspace <ws>` | 뷰포트 전환 |
| 역할 스폰 | `agent spawn --cmd "<launch>" --label <role> --cwd <path> --workspace <ws>` | agent 객체 |
| 역할 일괄 | `agent spawn-batch --json '[…]' --strategy distribute` | — |
| 역할 목록/상태 | `agent list [--workspace <ws>]` · `agent status <agentId>` | `status: running|exited`, `exitCode` |
| 역할 종료 | `agent kill <agentId>` | — |
| 세션 포커스 | `focus-pane <paneId>` (또는 `focus-surface <surfaceId>`) · `zoom-pane <paneId>` | 클릭→점프 핵심 |
| 화면 캡처 | `read-screen --lines <N>` (`surface.read_text`) | **렌더러 필요**(§12) |
| 입력 주입 | `send <text>` · `send-key <key>` | 포커스된 surface 대상 |
| 마크다운 폴백 | `markdown <file>` · `markdown set <id> --file <path>` | 폴백 대시보드 |
| 사이드바 | `set-status <k> <v>` · `set-progress <v> --label <l>` · `log <lvl> <msg>` | cockpit |
| 능력 가드 | `capabilities` | `{protocols,features}` |

### 5.2 역할 스폰 커맨드(launch)
`launch-agent.js` 패턴 재사용(오케스트레이터). 셸 쿼팅 회피 위해 `--` 뒤에 프롬프트 위치인자.
```
claude --dangerously-skip-permissions -- "<role bootstrap prompt>"
```
- `--dangerously-skip-permissions`: 인터랙티브 자동승인. `--bare` 금지(로그인 깨짐).
- cwd = `projectPath`(또는 worktree). 역할 지침은 프롬프트 + `<cwd>/.claude` + SessionStart 훅.

---

## 6. teamctl CLI

```
teamctl new-team <name> [--path <projectPath>] [--client <c>]
teamctl spawn-role <team> <role> [--prompt <p>] [--worktree]
teamctl list [--json]
teamctl status <team>/<role>
teamctl attach <team>/<role>          # select-workspace + focus-pane
teamctl kill  <team>/<role>
teamctl scan  <team>                  # capctl + connectors 재실행
teamctl serve [--port 7420]           # 컨트롤 브리지 + 대시보드
teamctl dashboard                     # 마크다운 폴백 렌더 → wmux markdown
```
각 명령은 `core/wmux.js`·`core/registry.js`를 통해 상태를 갱신하고 `updatedAt`을 찍는다.

---

## 7. 컨트롤 브리지 — `teamctl serve` (§4.5, D14)

Node 내장 `http`. `127.0.0.1`만 바인드. 정적 대시보드 + JSON API를 **같은 오리진**에서 서빙(CORS 불필요).

| 메서드·경로 | 바디 | 동작 |
|-------------|------|------|
| `GET /` | — | `src/server/static/index.html` |
| `GET /api/state` | — | registry + 팀별 team/connections/capabilities 집계 JSON (페이지 1~2s 폴링) |
| `POST /attach` | `{team,role}` | `select-workspace` + `focus-pane` (+옵션 `zoom-pane`) |
| `POST /spawn` | `{team,role,prompt?}` | `agent spawn` → registry 반영 |
| `POST /send` | `{team,role,text}` | 대상 surface focus 후 `send` |
| `POST /kill` | `{team,role}` | `agent kill` |
| `POST /refresh` | `{team?}` | `agent list` + 커넥터 재스캔 |

**인증**: 요청 헤더 `X-Cockpit-Token`(= `workspace/config.json`의 토큰). 페이지에는 서버가 주입.
**보안(R8)**: 외부 인터페이스 바인드 금지, 토큰 없으면 401. wmux 명령 실행 주체이므로 로컬 전용.
**degrade**: 서버 미기동 시 `teamctl dashboard`(마크다운 폴백)로 운용 가능.

---

## 8. 훅 (Hooks)

오케스트레이터 훅 패턴 재사용. `settings.json`(또는 플러그인 `hooks.json`)에 배선, 스크립트는 `src/hooks/*`.

| 이벤트 | 스크립트 | 동작 |
|--------|----------|------|
| `SessionStart` | on-session-start.js | 역할 세션에 `project.md`+역할지침 주입, registry 상태 → working |
| `PostToolUse` | on-tool-use.js | `toolUses++`, `lastActivity` 갱신, 활동 피드 append |
| `Notification` | on-notification.js | 상태 → waiting, 사이드바 알림 |
| `Stop`/`SubagentStop` | on-stop.js | 인수인계 문서 생성 → `manager/inbox/`, 상태 → done |

훅과 teamctl은 **같은 registry/team.json**을 읽고 쓴다(원자적 쓰기로 경합 방지). 훅은 `agentId`/세션 식별을 페이로드에서 얻어 역할에 매핑.

> 현재 머신 `settings.json`엔 wmux-hook 9종이 이미 있음 — 우리 훅은 **추가**(덮어쓰기 금지).

---

## 9. 커넥터 시스템 (`src/connectors/`)

연동 하나 = 모듈 하나. `src/connectors/*`(빌트인) + `workspace/connectors/*`(사용자) 자동 병합.

### 9.1 인터페이스
```js
export default {
  id: 'supabase', label: 'Supabase',
  category: 'optional',            // 'core'(항상) | 'optional'(팀별 opt-in, D12)
  scope: 'project',                // 'project' | 'global'(머신 로그인류)
  async detect(ctx) { /* 파일·env 기반, CLI 불필요 → bool */ },
  async probe(ctx)  { /* → { state, summary, details } */ },
};
// ctx = { projectPath, env, globalConfig, exec }   exec: 안전한 CLI 실행 헬퍼
```
- **탐지 원칙**: 파일·env 우선, CLI/네트워크는 보강. CLI 부재 시 `state:'tool-missing'`. 예외로 죽지 않음.
- **러너**: `core`는 항상, `optional`은 `team.json.connectors.enabled`에 있을 때만. 결과는 `connections.json`에 `checkedAt`와 캐시. **렌더 논블로킹**(온디맨드/주기 갱신).
- 🔴 **보안**: `.env` **값 미노출**. 키 이름·존재·마스킹만.

### 9.2 빌트인
| id | category | 탐지 | 프로브 |
|----|----------|------|--------|
| ports | core | 상시 | §11 |
| env | core | `.env*` | 키 존재/누락(`.env.example` 대비) |
| node | core | `package.json` | `node_modules`·락파일·`npm outdated` |
| mcp | core | 5소스 스캔: `settings.json.mcpServers` · `~/.claude.json`(user/`projects[<cwd>]`) · `.mcp.json` · 플러그인/세션 플래그 | 정적: 승인 여부 + `mcp-needs-auth-cache.json` / 동적: cwd `claude mcp list` 파싱(✓/✗/⏸) → connected·needs-auth·pending-approval·error. ⚠️ list는 settings.json 소스 미표시 → 파일+CLI 교차검증 (planner D15·§6.6) |
| git | optional | `.git/` | `git status --porcelain=v2 --branch` + `remote` |
| supabase | optional | `supabase/config.toml`·`SUPABASE_URL` | URL+키→핑 `/auth/v1/health` |
| github | optional | git remote | `gh auth status`·PR·CI (gh 있을 때) |
| docker | optional | `docker-compose.yml`/`Dockerfile` | `docker ps` (docker 있을 때) |

> 이 머신 실측: `git`·`node` 있음 / `gh`·`docker`·`supabase` 없음 → optional은 `tool-missing`으로 정상 degrade.

---

## 10. 기능 인벤토리 스캐너 (`src/capabilities/capctl.js`, F6)

Claude Code는 능력 열거 JSON CLI가 없음(`claude mcp`/`agents`만) → **파일·설정 스캔**(부팅 방식 재현).

| 스코프 | 소스 |
|--------|------|
| global | `~/.claude/settings.json`(`enabledPlugins`·`mcpServers`·`hooks`), `~/.claude/{agents,commands,skills}/`, `~/.claude/CLAUDE.md` |
| project | `<cwd>/.claude/{settings.json,settings.local.json,agents,commands,skills}`, `<cwd>/.mcp.json`, `~/.claude.json`의 `projects[<cwd>]` |
| plugin | 활성 플러그인 → `~/.claude/plugins/cache/<mp>/<plugin>/<ver>/.claude-plugin/plugin.json` + 그 하위 skills/agents/commands/hooks |
| session | spawn 플래그 `--agents --mcp-config --plugin-dir --plugin-url --agent --settings` (teamctl이 직접 기록 → 가장 정확) |

- **활성 판정**: `enabledPlugins[name@marketplace] === true`. `plugins/marketplaces/`는 "사용가능"일 뿐.
- **교차검증**: 역할 cwd에서 `claude mcp list`.
- **출력**: global → `globalCapabilities.json`(1회), 나머지 델타 → `capabilities.json`. `shadowsGlobal` 표시.

### 10.1 플러그인 탐색 정본 (실측)
플러그인은 **3파일 조합**으로 해석한다:
1. **설치·스코프**: `~/.claude/plugins/installed_plugins.json` — `"<plugin>@<mp>": [{ scope, projectPath?, installPath, version, gitCommitSha }]`
   - `scope:"user"` = **글로벌**(모든 세션) · `scope:"project"`+`projectPath` = **그 프로젝트 전용** ← 글로벌 vs 세션별의 핵심 소스
2. **활성 여부**: `~/.claude/settings.json` → `enabledPlugins { "<plugin>@<mp>": true|false }`
3. **실제 내용**: `installPath`(=`plugins/cache/<mp>/<plugin>/<ver>/`) 하위를 **디렉토리 규약**으로 열거
   - `skills/<name>/SKILL.md` · `commands/*.md` · `agents/*.md` · `hooks/hooks.json` · `.claude-plugin/plugin.json`(매니페스트, 스킬 목록은 담지 않음 → 폴더로 열거)

- **특수 케이스**: `wmux-orchestrator@wmux`는 `enabledPlugins`엔 true지만 `installed_plugins.json`엔 없음 → wmux 번들(`C:\wmux-0.13.0-…\resources\wmux-orchestrator`, `known_marketplaces.json`의 `wmux` 마켓). 스캐너는 **enabledPlugins 기준 + installPath를 다중 루트**로 해석.
- **기타 정본**: `known_marketplaces.json`(등록 마켓) · `plugin-catalog-cache.json` · `plugins/marketplaces/`(사용가능 카탈로그, 설치 아님).
- **주의**: dot 디렉토리(`.claude-plugin`)는 일부 glob 도구가 숨김 처리 → 스캐너는 dot-dir 포함 열거.

---

## 11. 로컬 포트 감지 (`connectors/ports.js`, F4)

Windows 실측 경로:
```
1) 리스너      : Get-NetTCPConnection -State Listen  → {LocalPort, OwningProcess(PID)}
                 (크로스플랫폼 폴백: netstat -ano)
2) 프로세스명  : Get-Process -Id <PID>
3) 커맨드라인  : Get-CimInstance Win32_Process -Filter "ProcessId=<PID>"  → CommandLine
4) 팀 귀속     : CommandLine 에 team.projectPath 포함되면 그 팀으로 귀속
```
실측 예: `:3000` = PID 27360 = node, CommandLine `…\WordDocCommunity\.next\dev…` → team-word.

- **글로벌 포트맵**: 모든 리스너 = `{port, proc, pid, team|null}`.
- **팀별**: projectPath 매칭 + `expectedPorts` 대비 up/down(🔴 안 뜸, ⚠️ 예상 밖).
- PowerShell 호출은 `powershell -NoProfile -Command …`, 결과는 `ConvertTo-Json`.

---

## 12. 역할 세션 라이브 뷰 (`src/live/`, F3)

"작업중인 내용" 소스 3중화(견고도 순).

| 소스 | 구현 | 견고도 |
|------|------|--------|
| pane 클릭 | `focus-pane`/`select-workspace` → 실제 TUI | ★★★ |
| **트랜스크립트 tail** | `~/.claude/projects/<enc-cwd>/<uuid>.jsonl` 마지막 N줄 파싱 → 최신 발화·툴콜·변경 파일 | ★★★ (주 소스) |
| read-screen | `read-screen --lines N` | ★☆ **렌더러 필요** |
| PostToolUse 훅 | 활동 타임라인 | ★★★ |

- **enc-cwd**: cwd에서 `\`·`:` → `-`. 예 `C:\Users\LEE\Desktop\GitProject\ClaudeTemplate` → `C--Users-LEE-Desktop-GitProject-ClaudeTemplate`. (§15)
- **최신 jsonl 선택**: 디렉토리 내 mtime 최신. `subagents/` 하위는 서브에이전트.
- **read-screen 주의**: 헤드리스 호출 시 `{"text":"","note":"renderer-side xterm serializer 필요"}` 반환 → 실패 시 트랜스크립트 렌더로 폴백(R7).

---

## 13. 핵심 시퀀스

**팀 생성 → 역할 스폰**
```
new-team: new-workspace → rename → team.json/폴더 생성 → registry 등록
spawn-role: (projectPath로 worktree 옵션) → agent spawn --cwd projectPath --workspace ws
            → agentId/paneId/surfaceId 기록 → capctl+connectors 초기 스캔
```
**상태 동기화(폴링/훅 이중화)**
```
serve 폴링: agent list → running/exited 하한선 갱신
훅        : PostToolUse(working) · Notification(waiting) · Stop(done)
```
**세션 클릭 → 점프(D14)**
```
대시보드 클릭 → POST /attach{team,role} → select-workspace ws + focus-pane pane
```
**인수인계**
```
Stop 훅 → handover-template로 초안 → manager/inbox/<ts>_<team>_<role>.md → registry.handover
```

---

## 14. 설정 & 환경변수

| 항목 | 값/소스 |
|------|---------|
| `WMUX_CLI` | `C:\wmux-0.13.0-win-x64\resources\cli\wmux.js` (wmux가 주입) |
| `WMUX_PIPE` / `WMUX_PIPE_TOKEN` | 파이프 IPC (CLI가 자동 사용) |
| `WMUX_SURFACE_ID` | 현재 surface |
| `workspace/config.json` | `{ "port": 7420, "token": "<랜덤>", "wmuxCli": "…", "claudeHome": "~/.claude" }` |

---

## 15. 네이밍·인코딩 규약

- 팀 id: kebab-case(`team-alpha`). wmux `workspaceId`(UUID)는 registry가 번역.
- 역할 id: `planner|frontend|backend|qa|…`. 세션 키: `<team>/<role>`.
- 인수인계 파일: `<ISO-compact>_<team>_<role>.md` (예 `2026-07-09T0930_team-alpha_backend.md`).
- 트랜스크립트 enc-cwd: `\`,`:` → `-` (§12).
- 상태 enum: `idle|working|waiting|done|error`. 커넥터 state: §4.3.

---

## 16. 빌드·실행

```bash
# 설치
npm i -g .            # 또는 npm link  (런타임 의존성 0 목표)

# 사용
teamctl new-team alpha --path "D:\clients\acme-web" --client Acme
teamctl spawn-role alpha backend
teamctl serve                                  # → http://127.0.0.1:7420
wmux browser open http://127.0.0.1:7420/       # 브라우저 패널에 대시보드
```
Windows에서 `wmux`가 PATH에 없으면 `node "%WMUX_CLI%" …` 사용(래퍼가 처리).

---

## 17. 미해결·주의

- **버전 종속**: wmux CLI 시그니처·`settings.json`/`~/.claude.json` 구조·트랜스크립트 jsonl 포맷은 버전 종속. `capabilities` 가드 + 방어적 파서. (R1·R5·R7)
- **read-screen**: 렌더러 없으면 빈 값 → 트랜스크립트 tail 주 소스.
- **상태 정밀도**: `agent list`는 running/exited만 확실. working/waiting/done은 훅 의존.
- **비용 추적(F8)**: 토큰·비용은 트랜스크립트 usage에서 집계(구현은 M4).
- **동시 세션 비용**: 동시 실행 상한 + 세션별 비용 표기.
- **잔여 정리**: 조사 중 생성된 빈 workspace/pane 1개 수동 정리 필요(안전 분류기가 자동 정리 차단).
```

