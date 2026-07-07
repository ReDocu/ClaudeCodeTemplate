# 퀵스타트 — 5분 안에 시작하기

이 템플릿의 핵심: **어느 폴더에서 세션을 여는지가 곧 역할이다.**

> **내 상황에 맞는 상세 매뉴얼**:
> 전체를 관리한다 → [05_root_manager.md](05_root_manager.md) ·
> 한 팀을 운영한다 → [06_team_manager.md](06_team_manager.md) ·
> 역할 하나를 맡아 작업한다 → [07_individual_manager.md](07_individual_manager.md)

| 하고 싶은 것 | 세션을 여는 위치 | 첫 명령 |
|---|---|---|
| 전체 현황 파악·관리 (총괄자) | 루트 | `/status` |
| 팀 만들기 | 루트 | `/new_team TeamA` |
| 기획 작업 | `00_Team/{팀폴더}/01_planner/` | (그냥 작업) → 끝나면 `/handover` |
| 개발(코드) 작업 | `00_Team/{팀폴더}/02_developer/` | (그냥 작업) → 끝나면 `/handover` |
| 패키지·빌드·배포 작업 | `00_Team/{팀폴더}/03_package/` | (그냥 작업) → 끝나면 `/handover` |
| 팀 현황 정리·구현 조율 (팀 관리자) | `00_Team/{팀폴더}/` | `/handover` 또는 `/report` |
| 심층 분석 (탐색→설명→검증→권고) | 분석 대상이 보이는 위치 | `/pipeline {주제}` |

## 시나리오 1 — 처음 세팅 (총괄자)

```
1. 루트에서 claude 실행
2. /new_team TeamA          → 양식 폴더 복사로 팀 스캐폴딩
                              (01_planner / 02_developer / 03_package 포함)
3. 00_Team/ProjectTeam_TeamA/CLAUDE.md 의 「팀 목표」 작성
4. 커밋
```

## 시나리오 2 — 역할 작업 (팀원)

```
1. 00_Team/{팀폴더}/{역할폴더}/ 에서 claude 실행
   (기획은 01_planner, 코드 작업은 02_developer, 빌드·배포는 03_package)
2. handover_{역할}.md 를 읽고 작업 수행
   (개발 작업이 커지면 02_developer에서 /new_project my-feature)
3. 세션 종료 전 /handover    → handover_{역할}.md 갱신
4. 다음 역할로 넘길 것은 「다음 할 일」에 남긴다 (기획 → 개발 → 패키지)
```

## 시나리오 3 — 주간 보고 (총괄자)

```
1. 루트에서 claude 실행
2. /report_root              → 전 팀 보고 + 대시보드 갱신
3. /status                   → 요약 확인
4. (필요 시) /handover_root  → 전체 인수인계 취합
```

## 시나리오 4 — 인수인계 받기 (새 팀원 / 새 세션)

```
1. 담당 폴더에서 claude 실행
2. handover.md 를 읽는다 (목표 → 현재 상태 → 다음 할 일 순)
3. "다음 할 일" 1번부터 시작
```

## 꼭 지킬 것 3가지
1. 팀 작업은 반드시 **자기 역할 폴더(또는 팀 폴더)에서 세션을 연다** — 그래야 격리가 유지된다. 코드 수정은 `02_developer`에서만.
2. 의미 있는 세션을 마치면 **`/handover`** — 문서가 곧 상태다.
3. 문서 갱신 후 **커밋** — 이력은 git이 보존한다.
