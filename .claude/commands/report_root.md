---
description: 전 팀 보고서 생성 + 대시보드/색인 갱신 + 아카이브 후보 제안 (루트 전용)
---

전체 팀의 보고서를 만들고 대시보드를 갱신한다.

> **root 명령 원칙**: `*_root` 명령은 전 팀 **일괄 작업**을 먼저 수행한 뒤, 결과를 최종 관리자(템플릿 최상위 폴더)의 문서(대시보드·색인·handover_root)로 취합해 루트 기준으로 관리한다.

## 1. 위치 확인 (루트 전용)
현재 폴더에 `00_Team/`과 `10_Dashboard/`가 있는지 확인. 없으면 루트 전용임을 안내하고 **중단**.
오늘 날짜를 확인한다 (`date` 또는 환경 정보, YYYY-MM-DD).

## 2. 팀별 보고서 생성 (병렬 — 일괄 작업)
`00_Team/` 아래 팀 폴더(`ProjectTeam_{팀명}`)를 열거하고 — 양식 폴더(`_ProjectTeam_Template`)는 언더스코어 접두라 패턴에 걸리지 않지만 혹시 걸려도 제외 — **각 팀마다 general-purpose 서브에이전트를 병렬로 실행**한다. 각 서브에이전트에게:
- 입력: 팀 폴더 경로, 오늘 날짜, 아래 보고 양식.
- 지시: 팀 `11_team_doc/` 내 최신 `report_{날짜}.md`가 **7일 이내**면 그것을 그대로 반환. 아니면 팀 `handover.md`·팀 대시보드(`10_Dashboard/DASHBOARD.md`)·`91_project_process/NN_*.md`(process 문서)·역할별 `handover_{역할}.md`와 `git log --since="14 days ago" -- {팀폴더}`를 근거로 양식에 맞춰 새 보고서를 작성해 반환. 파일 수정은 하지 말 것.
- 보고 양식: `90_Templates/report.template.md` (루트 세션이므로 읽어서 전달).

실패한 팀은 건너뛰지 말고 상태 ⚪ + "보고 실패"로 기록하되, **전체 작업은 중단하지 않는다.**

## 3. 결과물 저장
- 각 팀 보고서를 `11_doc_result/{YYYY-MM-DD}_{팀명}_정기보고.md`로 저장한다 (`90_Templates/result.template.md`의 메타 표를 상단에 붙인다. 유형: 정기보고).

## 4. 루트 대시보드 갱신 → `10_Dashboard/DASHBOARD.md` (덮어쓰기)
- 「팀 현황」 표: 각 팀 보고서의 상태 요약 표에서 상태등·진행률·마일스톤을 옮기고, 팀 대시보드 링크(`00_Team/{팀폴더}/10_Dashboard/DASHBOARD.md`)를 건다. 최근 보고일 기준 **7일 초과 시 `⚠STALE`** 표기.
- 「크로스팀 이슈 / 블로커」: 각 팀 보고서의 블로커 섹션을 취합 (시작일 포함).
- 「최근 결과물」: `11_doc_result`에서 최신 5건.
- 「아카이브 후보」: ① process 문서(`91_project_process/NN_*.md`) **제목**에 `[종료]` 표기된 프로젝트 ② 90일 경과한 결과물. **제안만 하고, 이동은 사용자 확인 후 `99_Archive/` 규칙(해당 README 참조)대로 수행한다.**
- 상단 갱신일을 오늘로.

## 5. 색인 갱신 → `11_doc_result/INDEX.md`
새로 저장한 결과물을 날짜 역순 표에 추가한다.

## 6. HTML 대시보드 갱신 (파이썬 불필요)
`/dashboard`의 절차(`.claude/commands/dashboard.md` 참조)를 수행한다 — 루트 `10_Dashboard/dashboard.html`의 `DASHBOARD-DATA` 마커 사이 `const DATA`·`const CFG` 두 줄을 md 기준으로 교체하고, 각 팀 페이지는 루트 셸 사본에 자기 팀 데이터만 넣는다. 2~4단계에서 이미 읽은 문서를 재활용한다.

## 7. 마무리
- 사용자에게 보고: 팀 수, 상태등 분포, STALE 팀, 블로커 목록, 아카이브 후보, HTML 재생성 결과.
- 커밋을 제안한다: `docs(dashboard): 정기 갱신 {YYYY-MM-DD}`
