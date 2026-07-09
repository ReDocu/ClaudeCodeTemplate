# Claude Cockpit

> 여러 Claude Code 세션을 **프로젝트(팀)별 · 역할별**로 한 대시보드에서 상시 운영·관찰·인수인계하는 관제 도구.
> 새 mux나 터미널을 만들지 않고, **wmux 위에 얇게 얹는 오케스트레이션 레이어**로 구현한다.

- **상태**: 설계 완료 (planner v0.9 · Tech v0.1) — M0 착수 전
- **환경**: Windows 11 · wmux 0.13.0 · Claude Code v2.1.205 · Node 20+

---

## 왜 만드는가

Claude Code로 여러 작업을 동시에 굴리면 터미널이 흩어지고, 어느 프로젝트의 어떤 세션이 지금 무슨 상태인지 파악할 수 없다. 세션이 끝나면 "무엇을 했는지"도 휘발된다.

**타깃**: 여러 프로젝트(또는 여러 클라이언트)를 병렬로 진행하는 1인 개발자·프리랜서.

**핵심 가치**
1. **한 눈에 관제** — 운영 중인 모든 팀·역할 세션 상태를 대시보드에서 일괄 확인
2. **드릴다운** — 팀 선택 → 역할 세션 실시간 관찰, **클릭하면 그 세션으로 점프**
3. **인수인계 자동화** — 세션 완료 시 인수인계 문서가 관리자 inbox로 자동 축적

## 개념 매핑

모든 개념이 wmux 네이티브 프리미티브로 실현된다 (0.13.0 CLI 검증 완료).

| 기획 개념 | wmux 실체 |
|-----------|-----------|
| 팀 (프로젝트) | workspace |
| 역할 (세션) | workspace 내 pane의 claude agent |
| 관리자 | HTML 대시보드 (브라우저 패널) + registry |
| 인수인계 / 공유 문서 | markdown surface + `manager/inbox/` |

## 아키텍처

```
브라우저 패널 HTML 대시보드 (wmux browser)      ← 주 UI, 클릭→점프
    ↕ fetch (same-origin, 127.0.0.1 + 토큰)
teamctl (Node, 무프레임워크 · npm 의존성 0 목표)
    serve │ core │ commands │ capctl │ connectors
    ↕ wmux CLI (파이프 IPC)
wmux 0.13.0 — workspace · agent · pane · markdown
    ↕
Claude Code 세션들 (역할) — hooks · transcripts
```

## 기능 맵

| # | 기능 | 핵심 | MVP |
|---|------|------|-----|
| F1 | 세션 운영 | 팀=workspace · 역할=agent · 생성/제어/인수인계 | ✅ |
| F2 | 인터랙티브 대시보드 + 브리지 | 로컬 서버 HTML, **세션 클릭→점프** | ✅ |
| F3 | 역할 세션 라이브 뷰 | "지금 하는 일" — 트랜스크립트 tail 주 소스 | ✅ |
| F4 | 로컬 포트/서버 감지 | 글로벌 포트맵 + 팀 귀속 | ✅ |
| F5 | 연결 상태 (git·supabase 등) | core(항상) + optional(팀별 opt-in) 커넥터 | ◐ core만 |
| F6 | 기능 인벤토리 | 플러그인·스킬·MCP·훅, 글로벌 vs 세션 델타 | ◐ 활성만 |
| F7 | 격리·병합 (worktree·contract) | — | later (M3) |
| F8 | 관측·비용·청구 리포트 | — | later (M4) |

## 사용법 (목표 인터페이스)

```bash
npm i -g .                                      # 설치 (런타임 의존성 0)

teamctl new-team alpha --path "D:\clients\acme-web" --client Acme
teamctl spawn-role alpha backend
teamctl serve                                   # → http://127.0.0.1:7420
wmux browser open http://127.0.0.1:7420/        # 브라우저 패널에 대시보드
```

```
teamctl new-team <name> [--path <projectPath>] [--client <c>]
teamctl spawn-role <team> <role> [--prompt <p>] [--worktree]
teamctl list | status <team>/<role> | attach <team>/<role> | kill <team>/<role>
teamctl scan <team>            # 능력 인벤토리 + 커넥터 재스캔
teamctl serve [--port 7420]    # 컨트롤 브리지 + 대시보드
teamctl dashboard              # 마크다운 폴백 뷰
```

## 폴더 구조 — 3층 분리

① 도구 코드(버전관리) · ② 런타임 상태(gitignore) · ③ 실제 프로젝트(외부, `projectPath` 포인터로 참조)

```
├─ planner.md            # 제품 기획·결정 로그 (D#·F# 정본)
├─ Tech.md               # 엔지니어링 스펙 (구현자용)
├─ bin/teamctl.js        # CLI 진입점
├─ src/                  # core · commands · capabilities · connectors · server · live · hooks
├─ templates/            # 역할·프로젝트·인수인계 템플릿
└─ workspace/            # 런타임 상태 (gitignore)
     manager/            #   registry.json · 대시보드 폴백 · inbox/
     teams/<team-id>/    #   team.json · project.md · 능력/연결 캐시 · handovers/
```

## 문서 안내

| 문서 | 내용 |
|------|------|
| [planner.md](planner.md) | 제품 기획서 — 결정 로그(D1~D14), 기능 맵(F1~F8), 마일스톤(M0~M4), 리스크 |
| [Tech.md](Tech.md) | 기술 설계 — 데이터 모델, wmux 통합, 커넥터/스캐너, API, 시퀀스 |
| [dashboard-mockup.html](dashboard-mockup.html) | 관제 대시보드 목업 |
| [role-detail-mockup.html](role-detail-mockup.html) | 역할 세션 상세(라이브 뷰) 목업 |

## 로드맵

- **M0** — 뼈대·규약: 폴더 스캐폴딩, registry 스키마, 역할 템플릿, teamctl 골격
- **M1 ⭐** — 모니터링 + 세션 생성/제어: new-team / spawn-role / serve / 클릭→점프
  - M1.5 기능 인벤토리 · M1.6 연결 상태+포트 · M1.7 라이브 뷰
- **M2** — 인수인계 파이프라인 (Stop 훅 → inbox → 리뷰)
- **M3** — 격리·병합 (worktree · contract · 리뷰 게이트)
- **M4** — 관측·비용 → **프리랜서 청구 리포트** (차별화 포인트)

## 원칙

- **재발명 금지 (D4·D7)** — PTY·렌더·detach는 wmux가 다 한다. 기존 `wmux-orchestrator` 플러그인의 실행·훅 패턴을 재사용하되, 일회성 웨이브가 아닌 **지속형 멀티프로젝트 관제**로 변형.
- **의존성 최소** — Node 내장 모듈 + wmux/git/claude CLI만. 런타임 npm 의존성 0 목표.
- **보안** — 컨트롤 서버는 `127.0.0.1` + 토큰 전용. `.env` 시크릿 값은 절대 저장·표시하지 않음(키 이름·존재만).
- **우아한 성능 저하** — CLI 부재 시 `tool-missing`, read-screen 실패 시 트랜스크립트 tail, 서버 다운 시 마크다운 폴백.
