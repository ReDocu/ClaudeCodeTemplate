# 명령어 레퍼런스

> 정의 파일: `.claude/commands/*.md` · 상세 사양: `PRD.md` 7장

| 명령 | 실행 위치 | 하는 일 | 산출물 |
|---|---|---|---|
| `/handover` | 프로젝트 폴더 | 인수인계 문서 생성·갱신 (덮어쓰기) | `handover.md` |
| `/handover` | 팀 폴더 | 하위 프로젝트 handover 취합 | `handover_{팀명}.md` |
| `/handover_root` | 루트 | 전 팀 handover 취합 (요약+링크) | `handover_root.md` |
| `/report` | 팀 폴더 | 팀 정기 보고서 작성 | `report_{날짜}.md` (팀 폴더 내) |
| `/report_root` | 루트 | 전 팀 보고(병렬) + 대시보드·색인 갱신 + 아카이브 후보 제안 | `11_doc_result/*_정기보고.md`, `DASHBOARD.md`, `INDEX.md` |
| `/status` | 루트 | 대시보드 요약 조회 (**갱신 안 함**) | 없음 (출력만) |
| `/pipeline {주제}` | 어디서나 | Explorer→Educator→Critic→Advisor 4단계 분석 | 결과물 md + 중간 산출물 |
| `/new_team {팀명}` | 루트 | 팀 폴더 스캐폴딩 | 팀 CLAUDE.md + handover |
| `/new_project {이름}` | 팀 폴더 | 프로젝트 스캐폴딩 | 프로젝트 CLAUDE.md + handover |

## 위치 규칙
- 각 명령은 실행 전 위치를 판별하고, 허용되지 않는 위치에서는 이유와 함께 거부한다.
- 루트 판별: 현재 폴더에 `00_Team/`·`10_Dashboard/` 존재.
- 팀 폴더 판별: 경로가 `.../00_Team/{팀폴더}`로 끝남.
- 프로젝트 폴더 판별: 경로가 `.../00_Team/{팀폴더}/{프로젝트}`.

## 커밋 컨벤션 (명령 1회 = 커밋 1회 제안)
```
docs(handover): {대상}
docs(report): {팀명} YYYY-MM-DD
docs(dashboard): 정기 갱신 YYYY-MM-DD
docs(result): {제목}
chore(team): {팀명} 생성
chore(project): {팀명}/{프로젝트명} 생성
```

## /pipeline 재순환 규칙
Critic이 **반려**하면 지목된 단계(탐색/설명)를 지적 사항과 함께 **최대 1회** 재실행 후 재검증한다.
재반려 시 중단하지 않고 반려 사유를 결과물에 그대로 기록한다 — 실패도 결과다.
