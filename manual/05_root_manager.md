# 매뉴얼 — Root 관리자 (총괄자)

> 대상: 템플릿 전체를 관리하는 사람. 팀을 만들고, 전체 현황을 취합하고, 결과물을 관리한다.

## 1. 당신은 누구인가

- **세션 위치**: 템플릿 최상위 폴더(루트)에서 `claude`를 실행한다.
- **권한**: 모든 하위 폴더를 읽을 수 있다 (하향 접근 허용). 단, **팀의 작업 파일은 직접 수정하지 않는다** — 수정은 해당 팀/역할 세션에 위임한다. 예외: 대시보드·색인·루트 문서·아카이브 이동.
- **관리 대상**: 루트 `10_Dashboard/`(전체 현황판), `11_doc_result/`(결과물+색인), `handover_root.md`, `00_Team/`(팀 생성·아카이브), `90_Templates/`·양식 폴더(표준 양식).

## 2. 핵심 원칙

- **root 명령 원칙**: `*_root` 명령은 전 팀 **일괄 작업**을 먼저 수행한 뒤, 결과를 최종 관리자(루트) 문서 기준으로 취합·관리한다.
- 각 팀의 `10_Dashboard/`는 루트 대시보드가 취합한다. 추후 팀 대시보드들을 연결한 **웹페이지(HTML)** 로 통합할 예정 (템플릿 완성 후 작업) — md 파일이 항상 진실의 원천이다.
- 명명은 **영문만** (한글은 특이 경우, 최대한 짧게).

## 3. 명령 레퍼런스

| 명령 | 하는 일 | 결과 |
|---|---|---|
| `/status` | 전체 대시보드 요약 조회 (갱신 안 함) | 출력만 |
| `/new_team {팀명}` | 양식 폴더 복사로 팀 스캐폴딩 | `00_Team/ProjectTeam_{팀명}/` |
| `/report_root` | 전 팀 보고 일괄 생성 → 루트 대시보드·색인 갱신 + 아카이브 후보 제안 + HTML 재생성 | `11_doc_result/`, `DASHBOARD.md`, `INDEX.md`, `dashboard.html` |
| `/dashboard` | HTML 대시보드만 재생성 (md 수정 없음) | 루트 + 전 팀 `dashboard.html` |
| `/handover_root` | 전 팀 handover 취합 (요약+링크) | `handover_root.md` |
| `/pipeline {주제}` | 4단계 분석 (Explorer→Educator→Critic→Advisor) | `11_doc_result/` + INDEX |

## 4. 루틴

### 처음 세팅
```
1. /new_team TeamA                → 팀 생성 (필수 폴더 + 역할 3공간 자동 생성)
2. 팀 CLAUDE.md의 「팀 목표」 작성 안내 (작성은 팀 관리자 몫)
3. 커밋: chore(team): TeamA 생성
```

### 주간 관리 (권장: 주 1회 이상)
```
1. /report_root     → 전 팀 일괄 보고 + 루트 대시보드 갱신
2. /status          → 요약 확인 (STALE·블로커 점검)
3. /handover_root   → (필요 시) 전체 인수인계 취합
4. 커밋: docs(dashboard): 정기 갱신 YYYY-MM-DD
```

### 프로젝트/팀 종료 시
```
1. /report_root가 제안한 아카이브 후보 확인
2. 사용자(당신) 확인 후 99_Archive/로 이동 — 이동은 항상 확인 후
```

## 5. 하면 안 되는 것

- 팀·역할 폴더의 작업 파일 직접 수정 (조율이 필요하면 해당 팀 세션에 지시를 전달).
- 대시보드 수동 편집 — `/report_root`가 덮어쓴다. 반영할 내용은 팀 handover/report에 쓰게 한다.
- 사용자 확인 없는 아카이브 이동·팀 폴더 삭제.
- 양식 폴더(`_ProjectTeam_Template`)를 팀으로 취급하는 것 — 보고·취합 대상이 아니다.

## 6. 표준 양식을 바꾸고 싶을 때

- 팀 구조: `00_Team/_ProjectTeam_Template/`을 수정 → 이후 `/new_team`에 반영. 예비 사본 `90_Templates/CLAUDE.team.template.md`도 함께 갱신.
- 문서 양식: `90_Templates/` 원본 + 같은 양식이 내장된 `.claude/commands/*.md`를 함께 수정.
