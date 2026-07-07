# 폴더·명명 규칙

## 폴더 맵

| 폴더 | 용도 | 쓰기 주체 |
|---|---|---|
| `00_Team/` | 팀별 작업 공간 (`ProjectTeam_{팀명}`) + 팀 구조 양식 원본 | 각 팀·역할 세션 |
| `01_Explorer/`~`04_Advisor/` | 역할 정의 + 파이프라인 중간 산출물(output/) | /pipeline (루트 실행 시) |
| `10_Dashboard/` | 전체 현황판 | /report_root 만 |
| `11_doc_result/` | 최종 결과물 + 색인 | /report_root, /pipeline |
| `90_Templates/` | 표준 양식 원본 | 사람 (수정 시 명령어 내장본도 함께) |
| `99_Archive/` | 종료·구버전 보관 | 루트 세션 (사용자 확인 후) |
| `manual/` | 사용 설명서 | 사람 |

## 팀 폴더 내부 구조

팀 폴더는 `/new_team`이 양식 원본 `00_Team/ProjectTeam_양식[팀명]/`을 복사해 만든다:

```
00_Team/ProjectTeam_{팀명}/
├── CLAUDE.md                 팀 관리자 (Builder 겸임 · process 전담)      [필수]
├── handover.md               팀 인수인계 (역할·프로젝트 취합)
├── 00_Project/               진행 중 프로젝트 작업물 (공유)               [필수]
│   └── NN_{프로젝트명}/       /new_project로 생성 · 독립 git 저장소 가능
│       └── process.md        유일한 상태 문서 (팀 관리자 전담 갱신)
├── 01_planner/               기획·디자인 담당        ┐ 각 CLAUDE.md
├── 02_developer/             프로그램 개발 과정 담당  ├ + handover_{역할}.md
├── 03_package/               배포·최종 선정 담당      ┘ + .claude/settings.json
├── 10_Dashboard/             팀 현황판 (관리자 전용, /report 갱신)        [필수]
├── 11_team_doc/              문서 취합 (공유) [필수]
│   ├── 00_final/             확정본 (팀의 현재 진실) · 10_working/ 작업 중 · 90_old/ 대체본
│   └── report_*.md           팀 보고서·파이프라인 결과는 바로 아래 (명령이 파싱)
└── 90_result_output/         완료 후 백업 (패키지 쓰기 주체)              [필수]
```

- **팀 내 상호 호환**: 팀원 세션은 자기 역할 폴더에서 열되, 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`)에 접근할 수 있다 — 역할 폴더의 `.claude/settings.json`(additionalDirectories)이 허용. **타 역할 폴더·`10_Dashboard`는 비공유.**
- **프로젝트는 `00_Project/`에서 팀 직속으로 관리한다.** 각 프로젝트에는 **`process.md` 하나만** 둔다. **갱신은 팀 관리자 전담** — 팀원은 자기 handover에 `[NN_프로젝트명]` 태그로 기록하면 팀 `/handover`가 반영한다. 프로젝트 폴더 직접 세션은 없다.
- 코드 수정은 `00_Project/{프로젝트}/` 안에서만 — 주체는 개발 역할 세션 또는 팀 관리자(Builder 겸임).
- git 연결: 프로젝트 폴더는 독립 git 저장소 가능 — 템플릿 저장소는 process.md만 추적 (루트 .gitignore).
- **커스텀 역할**: `NN_{역할}` 권장. **세션을 여는 폴더에는 `CLAUDE.md` + `handover_{역할}.md` 필수** (공유 접근 필요 시 settings.json 복사).
- 필수 폴더(00_Project/10/11/90)와 팀 CLAUDE.md는 삭제·개명하지 않는다.
- 작업 흐름: **기획 → 개발 → 패키지**. 역할 간 전달은 `handover_{역할}.md`(태그 포함), 프로젝트 진행은 팀 관리자가 `process.md`로 통합.
- 대시보드는 2계층: 팀 `10_Dashboard/`(팀 `/report`가 갱신) → 루트 `10_Dashboard/`(`/report_root`가 취합). 추후 팀 대시보드들을 연결한 웹페이지로 통합 예정.

## 격리와 상속 (이 템플릿의 핵심 원리)

- **격리**: 하위 폴더에서 시작한 세션은 상위 폴더 파일에 접근하지 않는다.
  Claude Code의 기본 권한(작업 디렉터리 밖 읽기 제한)이 이를 강제하고, 각 CLAUDE.md에도 명시되어 있다.
  → 팀 세션은 타 팀·루트 문서를 볼 수 없다. 전사 정보가 필요하면 사용자에게 요청한다.
- **팀 내 공유 예외**: 역할 세션은 자기 팀의 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`)에 접근할 수 있다 — 역할 폴더의 `.claude/settings.json`(additionalDirectories)이 허용한다. 타 역할 폴더·`10_Dashboard`는 여전히 금지.
- **상속**: CLAUDE.md는 상위 폴더에서 하위로 자동 로드된다.
  → 팀/프로젝트 세션에도 루트의 「전 세션 공통 규칙」이 적용된다. 규칙은 내려오고, 데이터는 격리된다.
- **하향 접근**: 루트 세션은 모든 하위 폴더를 읽을 수 있다 (그래서 /report_root·/handover_root가 가능).
  단, 팀 작업 파일의 직접 수정은 팀 세션에 위임한다.

## 명명 규칙

| 대상 | 규칙 | 예 |
|---|---|---|
| 날짜 | `YYYY-MM-DD` 고정 | 2026-07-07 |
| 언어 | **영문만** (한글은 특이 경우, 최대한 짧게) | — |
| 결과물 | `YYYY-MM-DD_{팀명}_{제목}.md` | 2026-07-07_TeamA_perf-analysis.md |
| 팀 폴더 | `ProjectTeam_{팀명}` | ProjectTeam_TeamA |
| 팀 필수 폴더 | `00_Project` / `10_Dashboard` / `11_team_doc` / `90_result_output` 고정 | — |
| 프로젝트 폴더 | `00_Project/NN_{프로젝트명}` (번호 = 생성순 고정) | 00_Project/01_login-system |
| 프로젝트 상태 문서 | `process.md` (프로젝트당 1개, 팀 관리자 전담 갱신) | — |
| 프로젝트 태그 | handover 항목 앞 `[NN_프로젝트명]` | [01_login-system] UI 완료 |
| 역할 폴더 | 표준 `01_planner`/`02_developer`/`03_package`, 커스텀 `NN_{역할}` | 04_designer |
| 팀·프로젝트명 | 영문/숫자/하이픈 | TeamA, my-feature |
| 팀 handover | `handover.md` (팀 폴더 직속) | — |
| 역할 handover | `handover_{역할}.md` | handover_planner.md |
| 팀 보고서 | `11_team_doc/report_{YYYY-MM-DD}.md` | report_2026-07-07.md |

## handover 갱신 방식
**덮어쓰기**가 원칙이다. 과거본이 필요하면 `git log -- handover.md`로 조회한다.
(파일을 날짜별로 늘리면 "어느 게 최신인가" 문제가 생긴다 — 최신본 1개 + git 이력이 답이다.)

## 아카이브 규칙
- 종료 프로젝트(`process.md` 제목에 `[종료]`) → `99_Archive/teams/{팀명}/{프로젝트명}/`
- 90일 경과 결과물 → `99_Archive/doc_result/{YYYY}/`
- `/report_root`가 후보를 제안하고, **이동은 항상 사용자 확인 후** 루트 세션이 수행한다.
