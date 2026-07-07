# 매뉴얼 — 팀별 관리자 (팀 관리자)

> 대상: 한 팀의 운영을 책임지는 사람. 역할 작업을 조율하고, 팀 보고·인수인계를 관리하며, **구현(Builder) 역할을 겸임**한다.

## 1. 당신은 누구인가

- **세션 위치**: `00_Team/ProjectTeam_{팀명}/` (팀 폴더)에서 `claude`를 실행한다.
- **권한**: 팀 폴더 안의 문서(팀 CLAUDE.md·handover.md·대시보드·팀 공용 문서)와 `00_Project/`의 프로젝트를 관리한다. **`process.md` 갱신은 당신의 전담 업무**다. 역할 폴더의 작업 파일은 직접 수정하지 않는다 — 해당 역할 세션에 위임한다 (읽기는 가능 — 취합용).
- **Builder 겸임**: 별도 구현 에이전트가 없다. 구현이 필요하면 팀 관리자가 `00_Project/{프로젝트}/`에서 수행한다.
- **격리**: 상위 폴더(루트·타 팀)에 접근하지 않는다. 전사 현황이 필요하면 사용자에게 요청한다.

## 2. 팀 폴더 구조 (필수 구성은 삭제·개명 금지)

```
ProjectTeam_{팀명}/
├── CLAUDE.md              팀 관리자 정의 (팀 목표는 /new_team 생성 시 입력)  [필수]
├── handover.md            팀 인수인계 — /handover가 역할·프로젝트 취합
├── 00_Project/            진행 중 프로젝트 작업물 (공유 · git 연결 가능)  [필수]
├── 01_planner/            기획·디자인   ┐ 역할 작업 공간
├── 02_developer/          개발 과정     ├ (각 CLAUDE.md + handover
├── 03_package/            배포·최종 선정 ┘  + .claude/settings.json)
├── 10_Dashboard/          팀 현황판 (관리자 전용, /report가 갱신)        [필수]
├── 11_team_doc/           문서 취합 (공유) — 보고서·회의록               [필수]
└── 90_result_output/      완료 후 백업 (패키지 역할 쓰기 주체)            [필수]
```

팀원 세션은 자기 역할 폴더에서 열고, 공유 폴더(`00_Project`/`11_team_doc`/`90_result_output`)는 역할 폴더의 `.claude/settings.json`이 접근을 허용한다. 타 역할 폴더·`10_Dashboard`는 비공유.

### 프로젝트 관리 (00_Project) — 팀 관리자의 핵심 업무
- 생성: 팀 폴더에서 `/new_project {프로젝트명}` → `00_Project/NN_{프로젝트명}/process.md`.
- **`process.md` 갱신은 당신 전담**: 팀원은 자기 handover에 `[NN_프로젝트명]` 태그로 기록만 하고, 당신이 `/handover`로 취합하면서 각 process.md에 반영한다.
- **수명주기도 당신 전담**: 단계 전환(기획→개발→패키지)·우선순위·목표일·`[보류]`/`[종료]` — 변경 시 진행 기록에 `[팀 관리자]` 한 줄.
- 프로젝트 폴더는 독립 git 저장소일 수 있다 — 템플릿 저장소는 process.md만 추적 (.gitignore).
- 종료: 완료 조건 확인 → 패키지가 `90_result_output/` 백업 → `[종료]` 표기 → 아카이브 후보.

### 커스텀 역할이 필요할 때
**팀 생성 시점이라면 `/new_team`이 역할 구성(표준/커스텀)을 확인하고 자동 생성한다** — 역할 목록·임무·백업 주체만 정하면 된다.
생성 후에 추가·변경할 때: **표준 역할이라면 양식 폴더에서 해당 역할 폴더만 통째로 복사**하면 끝이다 (역할 공간 = 3종 자기완결 모듈, 복사 후 `{팀명}` 치환). 커스텀 역할은 직접 만든다 (`NN_{역할}` 권장, 예: `04_designer`). **직접 명령(세션)을 주는 폴더에는 반드시 3종을 만든다**:
1. `CLAUDE.md` — 역할 정의 (원본: `90_Templates/CLAUDE.role.template.md`)
2. `handover_{역할}.md` — 역할 인수인계
3. `.claude/settings.json` — 공유 폴더 접근 필요 시 기존 역할 폴더에서 복사
그리고 팀 `CLAUDE.md`의 역할 표·접근 매트릭스·작업 흐름을 함께 갱신한다.

## 3. 명령 레퍼런스

| 명령 | 하는 일 | 결과 |
|---|---|---|
| `/status` | 팀 대시보드 요약 조회 (갱신 안 함) | 출력만 |
| `/new_project {이름}` | 프로젝트 생성 (번호 자동 증가) | `00_Project/NN_{이름}/process.md` |
| `/handover` | **① 역할 handover의 태그 항목을 각 process.md에 반영·수명주기 갱신 ② 팀 인수인계 취합** | 갱신된 `process.md`들 + `handover.md` |
| `/report` | 팀 정기 보고 (프로젝트·역할별 상세) + **팀 대시보드 갱신** | `11_team_doc/report_{날짜}.md`, `10_Dashboard/DASHBOARD.md` |
| `/pipeline {주제}` | 4단계 분석 | `11_team_doc/` |

## 4. 루틴

### 팀 생성 직후
```
1. CLAUDE.md의 「팀 목표」 확인 (/new_team 생성 시 입력됨 — "미정"이면 지금 작성)
2. /new_project {프로젝트명}   → 00_Project/에 첫 프로젝트 생성, process.md 목표 작성
3. 작업 흐름 확인: 역할 순서대로 (표준: 기획 01_planner → 개발 02_developer → 패키지 03_package)
4. 각 역할 담당자에게 역할 폴더에서 세션을 열도록 안내
```

### 조율 + process 갱신 (수시 — 핵심 루틴)
```
1. /handover 실행
   → 역할 handover 3개의 [태그] 항목이 각 process.md에 반영되고
     팀 handover.md가 취합된다
2. 점검: 갱신 7일 초과(STALE) 프로젝트 → 담당 확인 등록,
   블로커 → 조율(역할 handover로 반송), 단계 완료 근거 → 단계 전환
3. 구현이 필요하면 00_Project/{프로젝트}/ 에서 직접 수행 (Builder 겸임)
```

### 보고 (루트 /report_root 전, 권장 주 1회)
```
1. /report      → 보고서 + 팀 대시보드 갱신
2. /handover    → 팀 인수인계 최신화
3. 커밋: docs(report): {팀명} YYYY-MM-DD
```

## 5. 하면 안 되는 것

- 상위 폴더(루트·타 팀) 접근 — 격리 원칙. 필요한 정보는 사용자에게 요청.
- 필수 폴더(`00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output`) 삭제·개명.
- 역할 폴더 작업 파일의 직접 수정 (구현 겸임은 `00_Project/{프로젝트}`에 한정).
- process.md 갱신을 팀원에게 시키는 것 — 팀원은 handover 태그로 기록, 반영은 당신의 `/handover`.
- 프로젝트 폴더에 CLAUDE.md·handover.md 추가 생성 — 프로젝트 상태 문서는 `process.md` 하나다.
- CLAUDE.md·handover 없는 역할 폴더에서 세션을 열게 하는 것 — 커스텀 역할도 두 파일(+공유 필요 시 settings.json)이 필수.
- 한글 폴더·파일명 (특이 경우에 한해 최대한 짧게).
