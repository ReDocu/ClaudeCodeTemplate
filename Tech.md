# Tech.md — 템플릿 기술 문서 (상태 점검 가이드)

| 항목 | 내용 |
|---|---|
| 목적 | 템플릿의 **현재 기술 상태를 확인**하고, 구조가 표준에서 벗어났는지 점검하는 기준 문서 |
| 기준 버전 | PRD v1.3 · PRD_dashboard v0.1 (2026-07-07) |
| 대상 독자 | 총괄자(루트 세션), 템플릿을 점검·확장하려는 사람 |
| 관련 문서 | 사양 [PRD.md](PRD.md) · 대시보드 사양 [PRD_dashboard.md](PRD_dashboard.md) · 사용법 `manual/` |
| 열람용 뷰 | [Tech.html](Tech.html) — 이 문서의 시각화 페이지 (본 md가 원천, 수정 시 함께 갱신) |

---

## 1. 시스템 개요

이 템플릿은 **폴더 = 권한, 문서 = 상태**로 동작하는 Claude Code 멀티팀 협업 시스템이다.

| 원칙 | 구현 메커니즘 |
|---|---|
| 격리 (Isolation) + 팀 내 공유 | 세션은 시작 폴더 하위만 접근. 단 **역할 세션은 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`)에 접근** — 역할 폴더의 `.claude/settings.json`(additionalDirectories)이 허용. 타 역할·타 팀·루트는 금지 |
| 상속 (Inheritance) | CLAUDE.md가 상위→하위로 자동 로드. 루트 「전 세션 공통 규칙」이 전 세션에 적용 |
| 문서가 곧 상태 (Docs as State) | 컨텍스트는 휘발 — 팀원은 `handover_{역할}.md`에 `[NN_프로젝트명]` 태그로 기록, **팀 관리자가 `process.md`에 취합·반영** (전담). 세션 시작 시 읽어 복원, 종료 시 갱신 |

**root 명령 원칙**: `*_root` 명령은 전 팀 일괄 작업 후, 결과를 최종 관리자(루트) 문서 기준으로 취합·관리한다.

## 2. 현재 상태 스냅샷 (2026-07-07 기준)

| 영역 | 상태 |
|---|---|
| 구조·명령·문서 (M1~M5) | ✅ 구현 완료 (v1.3 구조 반영) |
| 팀 | 0개 — `00_Team/`에 양식 폴더(`_ProjectTeam_Template`)만 존재 |
| 대시보드 | 루트 `DASHBOARD.md` 초기 상태 (팀 없음) |
| HTML 대시보드 | ✅ **구현됨** (C안 · v1.1 셸+DATA) — 셸 `10_Dashboard/dashboard.html`(단일 원본)의 `DASHBOARD-DATA` 블록을 `/dashboard`·`/report_root`·`/handover_root`가 교체. **파이썬 불필요** (구 생성기: `99_Archive/2026-07-07_dashboard_generator/`). D4(실전 검증)만 대기 |
| 실전 검증 (M6) | ⏳ 대기 |
| git | `manager` 브랜치에서 작업 중 (원격: github.com/ReDocu/ClaudeCodeTemplate) |

## 3. 폴더 구조와 필수 파일

```
(루트)
├── CLAUDE.md                 총괄자 거버넌스 (전 세션 상속)      [필수]
├── PRD.md / PRD_dashboard.md 사양 문서
├── Tech.md                   본 문서
├── handover_root.md          전체 인수인계 취합본                [필수]
├── 00_Team/
│   ├── README.md
│   └── _ProjectTeam_Template/    팀 구조 양식 원본 (/new_team이 복사)
│       ├── CLAUDE.md · handover.md
│       ├── 00_Project/README.md + 01_Project01/process.md
│       ├── 01_planner · 02_developer · 03_package/  (각 CLAUDE.md + handover_{역할}.md)
│       ├── 10_Dashboard/DASHBOARD.md · 11_team_doc/README.md · 90_result_output/README.md
├── 01_Explorer ~ 04_Advisor/     분석 역할 (각 CLAUDE.md + output/)
├── 10_Dashboard/DASHBOARD.md     전체 현황판 + design/ (HTML 예시안 3종)
├── 11_doc_result/INDEX.md        결과물 색인
├── 90_Templates/                 문서 양식 원본 5종 + 폐지 스텁 1종
├── 99_Archive/                   teams/ + doc_result/
├── main_manual.md                처음 사용자용 안내서 (진입점)
├── manual/                       00~04 공통 + 05~07 맥락별 매뉴얼
└── .claude/
    ├── commands/                 명령 8종
    ├── agents/                   분석 에이전트 4종
    └── settings.json             읽기 명령 allowlist
```

**팀 폴더 표준** (`/new_team`이 생성): 필수 4폴더(`00_Project` 공유·작업물 / `10_Dashboard` 관리자 전용 / `11_team_doc` 공유·문서 취합 / `90_result_output` 완료 백업·패키지 주체) + `CLAUDE.md` + `handover.md` + 역할 3공간(각 CLAUDE.md + handover + **`.claude/settings.json`** 공유 접근 허용). 번호 의미: **00 = 진행 작업, 01~0N = 역할, 10~11 = 현황·문서, 90 = 보관**.

## 4. 상태 문서 모델 (데이터 흐름)

상태는 아래 위계로 취합된다 — 팀원의 역할 handover가 1차 기록이고, 팀 관리자가 process에 통합한다:

```
[팀원]  0N_{역할}/handover_{역할}.md  ← [NN_프로젝트명] 태그로 기록 (역할 /handover)
              │
              ▼ 팀 관리자 /handover (팀 폴더)
[팀]    ① 00_Project/NN_x/process.md 갱신 (태그 반영 + 수명주기, 전담)
        ② handover.md 취합
              │
              ├→ (/handover_root) → 루트 handover_root.md
              └→ (팀 /report) → 11_team_doc/report_*.md + 팀 10_Dashboard/DASHBOARD.md
                                  └→ (/report_root) → 루트 DASHBOARD.md + 11_doc_result + INDEX
```

| 문서 | 위치 | 쓰기 주체 | 역할 |
|---|---|---|---|
| `handover_{역할}.md` | 역할 폴더 | 역할 세션 (`/handover`) | 팀원의 1차 기록 (`[NN_프로젝트명]` 태그) · 역할 간 전달 |
| `process.md` | 프로젝트 폴더 | **팀 관리자 전담** (팀 `/handover`) | 프로젝트의 **유일한** 상태 문서 (단계·기록·블로커·수명주기) |
| `handover.md` | 팀 폴더 | 팀 세션 (`/handover`) | 역할·프로젝트 취합 |
| 팀 `DASHBOARD.md` | 팀 10_Dashboard | 팀 `/report` **만** | 팀 현황판 |
| 루트 `DASHBOARD.md` | 루트 10_Dashboard | `/report_root` **만** | 전체 현황판 |
| `handover_root.md` | 루트 | `/handover_root` | 전체 인수인계 |
| `90_result_output/` | 팀 | **패키지 역할** (완료 백업) | 최종 선정 작업물 보관 |

## 5. 명령어 배선표

| 명령 | 실행 위치 | 읽기 (근거) | 쓰기 (산출물) |
|---|---|---|---|
| `/new_team` | 루트 | 양식 폴더 전체 | `00_Team/ProjectTeam_{팀명}/` (복사+치환) |
| `/new_project` | 팀 폴더 | `00_Project/` 기존 번호 | `00_Project/NN_{이름}/process.md` |
| `/handover` (역할) | 역할 폴더 | 이번 세션 작업 + git log | `handover_{역할}.md` (`[NN_프로젝트명]` 태그 기록) |
| `/handover` (팀) | 팀 폴더 | 역할 handover 3개 + 기존 process | **각 `process.md` 갱신** + `handover.md` 취합 |
| `/handover_root` | 루트 | 전 팀 `handover.md` | `handover_root.md` |
| `/report` | 팀 폴더 | process.md 전체 + 역할 handover | `11_team_doc/report_{날짜}.md` + 팀 `DASHBOARD.md` |
| `/report_root` | 루트 | 팀 보고서(7일 캐시)·대시보드·process | `11_doc_result/*` + 루트 `DASHBOARD.md` + `INDEX.md` |
| `/status` | 루트/팀 | 해당 위치 `DASHBOARD.md` | 없음 (조회 전용) |
| `/pipeline` | 어디서나 | 분석 대상 | 결과물 md (루트→`11_doc_result`, 팀→`11_team_doc`, 역할→현재 폴더) |
| `/dashboard` | 루트 | 전 팀 md 스캔 (읽기 전용) | HTML 재생성: 루트 + 전 팀 `dashboard.html` |

위치 판별 규칙: 루트 = `00_Team/` 보유 · 팀 = `.../00_Team/{팀폴더}` · 역할 = 팀 직속 중 필수 4폴더 제외. **프로젝트 폴더 직접 세션은 폐지** (v1.4) — 팀원은 역할 세션의 공유 접근으로 작업한다. (팀에도 `10_Dashboard`가 있으므로 **루트 판별에 10_Dashboard를 쓰지 않는다**.)

## 6. 불변식 (Invariants) — 이것이 깨지면 비표준 상태

1. 팀 폴더명은 `ProjectTeam_{팀명}`, 필수 4폴더 + `CLAUDE.md`는 삭제·개명 금지.
2. **세션을 여는 폴더에는 CLAUDE.md + `handover_{역할}.md`가 있다** (프로젝트 폴더에는 세션을 열지 않는다 — `process.md` 단독, CLAUDE.md·handover.md 금지).
3. 코드 수정은 `00_Project/{프로젝트}/` 안에서만 — 주체는 개발 역할 세션(공유 접근) 또는 Builder 겸임 팀 관리자. **`process.md` 갱신은 팀 관리자 전담** (팀원은 handover에 `[NN_프로젝트명]` 태그로 기록).
4. 쓰기 주체 단일화: 팀 대시보드=`/report`, 루트 대시보드=`/report_root`, `90_result_output`=패키지 역할. 손 편집 금지.
5. 명명: 영문만(한글은 특이 경우·최단), 날짜 `YYYY-MM-DD`, 결과물 `YYYY-MM-DD_{팀명}_{제목}.md`.
6. 분석 4역할(Explorer/Educator/Critic/Advisor)은 분석 전용 — 파일 수정 금지. 별도 Builder 에이전트 없음.
7. 양식 폴더(`_ProjectTeam_Template`)는 팀이 아니다 — 언더스코어 접두로 팀 스캔 패턴(`ProjectTeam_*`)에서 자연 제외되며, 보고·취합·대시보드 집계 대상이 아니다.
8. md가 진실의 원천 — HTML(예정)은 열람용 뷰.

## 7. 상태 점검 체크리스트 (루트 세션에서)

| # | 점검 항목 | 확인 방법 |
|---|---|---|
| 1 | 루트 필수 파일 존재 | `CLAUDE.md` `PRD.md` `handover_root.md` `10_Dashboard/DASHBOARD.md` `11_doc_result/INDEX.md` 존재 확인 |
| 2 | 명령 9종·에이전트 4종 | `.claude/commands/` 9개 · `.claude/agents/` 4개 파일 수 확인 |
| 3 | 양식 폴더 무결성 | 양식 폴더에 필수 4폴더 + CLAUDE.md + handover.md + 역할 3공간(각 CLAUDE.md·handover·`.claude/settings.json`) + `00_Project/01_Project01/process.md` |
| 4 | 각 팀 구조 준수 | 팀마다 필수 4폴더 존재, 역할 폴더에 CLAUDE.md+handover+settings.json, `00_Project/NN_*`마다 process.md 단독 |
| 5 | 구식 참조 없음 | `00_result_output` · `handover_{팀명}` · `{메인폴더명}_` 검색 → PRD 변경 이력 외 0건 |
| 6 | 신선도 | 각 handover/process 제목의 `(갱신: …)` 7일 초과 → STALE, `/report_root` 권고 |
| 7 | 아카이브 후보 | process.md 제목에 `[종료]` 검색 → 후보를 대시보드에 제안 (이동은 사용자 확인 후) |
| 8 | 양식↔사본 동기화 | §8 표의 쌍이 같은 내용인지 (수정일 비교) |

## 8. 동기화 지점 (한쪽 수정 시 함께 갱신)

| 원본 | 함께 갱신할 사본 |
|---|---|
| 양식 `_ProjectTeam_Template/CLAUDE.md` | `90_Templates/CLAUDE.team.template.md` |
| 양식 `00_Project/01_Project01/process.md` | `90_Templates/process.template.md` + `/new_project` 내장본 |
| 양식 역할 `.claude/settings.json` (공유 접근) | 3개 역할 폴더에 동일 내용 — 한쪽 수정 시 셋 다 |
| `90_Templates/handover.template.md` | `/handover` 내장본 |
| `90_Templates/report.template.md` | `/report` 내장본 |
| `90_Templates/result.template.md` | `/pipeline` 내장본 |
| PRD 7장 명령 사양 | `.claude/commands/*.md` + `manual/01_commands.md` |

폐지: `90_Templates/CLAUDE.project.template.md`는 v1.3에서 스텁으로 전환 (프로젝트 문서 = process.md 단독).

## 9. 알려진 제약 · 예정 작업

- **HTML 대시보드**: ✅ 구현됨 (C안). 남은 것: D4 — 실제 팀 데이터로 M6 실전 검증·스타일 보완.
- **명령어 인식 범위**: 하위 폴더 세션의 슬래시 명령 인식은 M6에서 실측 (미인식 시 대응은 `manual/04_faq.md`).
- **`.claude/settings.json`**: 읽기 명령(git status/log/diff, ls, pwd)만 allowlist — 스캐폴딩(cp/mkdir)은 세션마다 승인 필요.
- **격리의 한계**: 격리는 Claude Code 권한 + CLAUDE.md 조항의 조합 — 사람이 직접 여는 파일까지 막지는 못한다.

## 10. 변경 이력 요약 (상세: PRD 13장)

| 버전 | 핵심 변경 |
|---|---|
| v1.3 | 프로젝트를 팀 직속 `00_Project/`로 이동, `process.md` 단일 상태 문서, `90_result_output` 개명 |
| v1.2 | 팀 필수 폴더, 커스텀 역할 규칙, 대시보드 2계층, Builder=팀 관리자, 영문 명명, 매뉴얼 3종 |
| v1.1 | `ProjectTeam_{팀명}` 명명, 역할 3공간, 양식 폴더 복사 방식 `/new_team` |
| v1.0 | 최초 구조 (M1~M5) |
