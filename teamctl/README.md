# teamctl — Claude Cockpit 로컬 컨트롤 브리지 (D14)

트리아지 대시보드(`../dashboard-triage.html`)를 실제 wmux에 연결하는 로컬 HTTP 브리지.
브라우저는 wmux를 직접 못 때리므로, 이 브리지가 **같은 오리진**에서 대시보드를 서빙하고
`fetch → teamctl → core/wmux.js → wmux CLI` 경로로 명령을 실행한다.

## 실행

```bash
node teamctl/bin/teamctl.js serve            # 기본 포트 7420
node teamctl/bin/teamctl.js serve --port 8080
node teamctl/bin/teamctl.js boot             # 콜드 부트(F12): wmux→서버→reconcile→기본 브라우저(크롬)에 대시보드
node teamctl/bin/teamctl.js boot --panel     # 대시보드를 wmux 브라우저 패널에(구 동작)
```

`ClaudeCockpit.exe`(루트) 더블클릭 = `boot`와 동일 — **기본 브라우저(크롬)** 로 대시보드가 열린다.

serve만 띄운 경우:

```bash
wmux browser open http://127.0.0.1:7420/     # 브라우저 패널에 대시보드
```

- wmux CLI 해석 순서: ① `WMUX_CLI` 환경변수(`node <cli>`) ② PATH의 `wmux` ③ config.json `wmuxBin`에서 역산(`<설치루트>/resources/cli/wmux.js`). `teamctl boot`는 셋 다 실패 시 설치 위치를 자동 탐색해 `wmuxBin`을 config에 저장(F12b).
- wmux 파이프에 못 붙으면(`ping` 실패) `/api/state`가 `live:false`로 응답 → 대시보드는 내장 데모 데이터로 폴백.

## API (전부 `X-Cockpit-Token` 필수, 정적 `/`만 예외)

| 메서드·경로 | 바디 | wmux 명령 |
|-------------|------|-----------|
| `GET /` | — | 대시보드 HTML(토큰 주입) |
| `GET /api/state` | — | `list-workspaces` + `agent list` → `{teams,sessions}` — 세션 `st`는 3분류: `terminal`(claude 아님) / `ready`(Claude 실행중·명령 대기) / `working`(Claude 작업중, 트랜스크립트 활동 기준) |
| `GET /api/usage` | — | (wmux 무관) 트랜스크립트 실측 사용량 + `limit`(5h 최대/사용/남음/%) — 최대치는 config `usageMax5h` 수동 지정 > 과거 실측 학습(`workspace/usage-max.json`) |
| `POST /attach` | `{ws,pane?}` | `select-workspace` (+ `focus-pane`) |
| `POST /kill` | `{agentId}` | `agent kill` |
| `POST /send` | `{text,pane?}` | (`focus-pane` +) `send` |
| `POST /refresh` | — | 상태 재조회 |

## 보안 (R8)

- `127.0.0.1`만 바인드 — 외부 인터페이스 노출 금지.
- 토큰은 `workspace/config.json`에 저장(gitignore), 서버가 페이지 `<head>`에 주입.
- `execFile`(셸 미경유)로 명령 인젝션 차단.
- **로컬 전용.** 원격 접근은 비목표(별도 위협모델 필요).

## 구조

```
teamctl/
  bin/teamctl.js          # CLI 진입
  src/core/wmux.js        # wmux CLI 단일 창구 (§5)
  src/core/state.js       # /api/state 빌더 (workspaces+agents → teams/sessions)
  src/server/serve.js     # http 서버 (§7): 정적 + API + 토큰
  workspace/config.json   # 런타임: 포트·토큰 (gitignore)
```

## 후속 (미구현)

- connectors 스캐너(git/env/node/ports) → 팀 카드의 conns/ports 채우기
- capabilities 스캐너(기능 인벤토리)
- registry.json 영속화(팀 메타·상태 요약)
- read-screen/트랜스크립트 → 세션 상세(지금 작업·피드·diff)
