---
description: 전체 인수인계 문서 갱신 — 모든 팀의 handover를 취합 (루트 전용)
---

전체 인수인계 문서 `handover_root.md`를 갱신한다.

> **root 명령 원칙**: `*_root` 명령은 전 팀 **일괄 작업**(수집)을 먼저 수행한 뒤, 결과를 최종 관리자(템플릿 최상위 폴더)의 문서로 취합해 루트 기준으로 관리한다.

## 1. 위치 확인 (루트 전용)
현재 폴더에 `00_Team/`과 `10_Dashboard/`가 있는지 확인한다. 없으면 이 명령은 루트 전용이며 하위 세션은 상위에 접근할 수 없다고 안내하고 **중단**한다. (팀/프로젝트 폴더에서는 `/handover`를 사용.)

## 2. 수집
- `00_Team/` 아래 모든 팀 폴더를 열거한다 (`ProjectTeam_{팀명}`). 양식 폴더(`ProjectTeam_양식[팀명]`)는 제외한다.
- 각 팀의 `handover.md`(팀 인수인계)를 읽는다. 없으면 역할 폴더들(`01_planner`/`02_developer`/`03_package`)의 `handover_{역할}.md`라도 확인하고, 팀 handover는 "미작성"으로 기록한다.

## 3. `handover_root.md` 작성 (덮어쓰기)

```markdown
# Handover Root — 전체 인수인계 (갱신: {YYYY-MM-DD})

## 전체 요약
(전 팀을 관통하는 현황 3~5줄 — 어디가 활발하고 어디가 막혀 있는가)

## 팀별 현황
### {팀명}
- 요약: (3줄 이내)
- 다음 할 일 최상위 1건:
- 원문: [handover.md](00_Team/ProjectTeam_{팀명}/handover.md)

## 미작성 / 경고
- {팀명}: 팀 handover 미작성 (마지막 활동: git log 기준 날짜)
```

원문을 통째로 복사하지 말고 **요약 + 링크**만 넣는다.

## 4. 마무리
- 전체 요약을 사용자에게 보여준다.
- 커밋을 제안한다: `docs(handover): root 취합 {YYYY-MM-DD}`
