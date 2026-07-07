# 명령어 레퍼런스

> 정의 파일: `.claude/commands/*.md` · 상세 사양: `PRD.md` 7장

| 명령 | 실행 위치 | 하는 일 | 산출물 |
|---|---|---|---|
| `/handover` | 역할 폴더 | 역할 인수인계 갱신 (`[NN_프로젝트명]` 태그 기록) | `handover_{역할}.md` |
| `/handover` | 팀 폴더 | **① 태그 항목을 각 process.md에 반영·수명주기 갱신 ② 취합** | 갱신된 `process.md`들 + `handover.md` |
| `/handover_root` | 루트 | 전 팀 handover 취합 (요약+링크) | `handover_root.md` |
| `/report` | 팀 폴더 | 팀 정기 보고서 작성 (프로젝트·역할별 상세) + **팀 대시보드 갱신** | `11_team_doc/report_{날짜}.md`, 팀 `10_Dashboard/DASHBOARD.md` |
| `/report_root` | 루트 | 전 팀 보고(병렬 일괄) + 루트 대시보드·색인 갱신 + 아카이브 후보 제안 | `11_doc_result/*_정기보고.md`, `DASHBOARD.md`, `INDEX.md` |
| `/status` | 루트/팀 폴더 | 해당 위치의 대시보드 요약 조회 (**갱신 안 함**) | 없음 (출력만) |
| `/dashboard` | 루트 | HTML 대시보드 재생성 (전 팀 스캔, md 수정 없음) — /report_root가 자동 실행 | 루트 + 전 팀 `dashboard.html` |
| `/pipeline {주제}` | 어디서나 | Explorer→Educator→Critic→Advisor 4단계 분석 | 결과물 md + 중간 산출물 |
| `/new_team {팀명}` | 루트 | 양식 폴더 복사로 팀 스캐폴딩 (필수 4폴더 + 역할 3공간) | `ProjectTeam_{팀명}/` 전체 구조 |
| `/new_project {이름}` | 팀 폴더 | 프로젝트 스캐폴딩 (번호 자동 증가) | `00_Project/NN_{이름}/process.md` |

## 위치 규칙
- 각 명령은 실행 전 위치를 판별하고, 허용되지 않는 위치에서는 이유와 함께 거부한다.
- 루트 판별: 현재 폴더에 `00_Team/` 존재.
- 팀 폴더 판별: 경로가 `.../00_Team/{팀폴더}`로 끝남 (팀폴더 = `ProjectTeam_{팀명}`).
- 역할 폴더 판별: 경로가 `.../00_Team/{팀폴더}/{역할폴더}`. 역할폴더 = 팀 폴더 바로 아래 폴더 중 필수 폴더(`00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output`)를 제외한 것 (표준: `01_planner`/`02_developer`/`03_package`, 커스텀 포함).
- **프로젝트 폴더 직접 세션은 폐지** (v1.4) — `00_Project/{프로젝트}`에서 `/handover` 실행 시 팀 폴더로 안내하고 중단. 팀원은 역할 세션의 공유 접근으로 작업한다.
- **팀 내 공유 접근**: 역할 세션은 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`)에 접근 가능 — 역할 폴더의 `.claude/settings.json`이 허용.
- **root 명령 원칙**: `*_root` 명령은 전 팀 일괄 작업 후, 결과를 최종 관리자(루트) 문서 기준으로 취합·관리한다.

## 커밋 컨벤션 (명령 1회 = 커밋 1회 제안)
```
docs(handover): {대상}
docs(report): {팀명} YYYY-MM-DD
docs(dashboard): 정기 갱신 YYYY-MM-DD
docs(result): {제목}
chore(team): {팀명} 생성
chore(project): {팀명}/{역할폴더}/{프로젝트명} 생성
```

## /pipeline 재순환 규칙
Critic이 **반려**하면 지목된 단계(탐색/설명)를 지적 사항과 함께 **최대 1회** 재실행 후 재검증한다.
재반려 시 중단하지 않고 반려 사유를 결과물에 그대로 기록한다 — 실패도 결과다.
