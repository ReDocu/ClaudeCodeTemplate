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
| 기획·디자인 작업 | `00_Team/{팀폴더}/01_planner/` | (그냥 작업) → 끝나면 `/handover` |
| 개발(코드) 작업 | `00_Team/{팀폴더}/02_developer/` (코드는 공유 `00_Project/`에) | (그냥 작업) → 끝나면 `/handover` |
| 배포·최종 선정 작업 | `00_Team/{팀폴더}/03_package/` | (그냥 작업) → 끝나면 `/handover` |
| 팀 현황 정리·process 갱신·프로젝트 생성 (팀 관리자) | `00_Team/{팀폴더}/` | `/handover` / `/new_project` / `/report` |
| 심층 분석 (탐색→설명→검증→권고) | 분석 대상이 보이는 위치 | `/pipeline {주제}` |

## 시나리오 1 — 처음 세팅 (총괄자)

```
1. 루트에서 claude 실행
2. /new_team TeamA          → 역할 구성(표준/커스텀)·팀 목표 확인 후 팀 스캐폴딩
                              (표준: 01_planner / 02_developer / 03_package)
3. 팀 목표는 생성 시 입력한 내용으로 채워짐 — "미정"으로 뒀다면 지금 작성
4. 커밋
```

## 시나리오 2 — 팀 작업 (팀원)

```
0. (팀 관리자) 팀 폴더에서 /new_project my-feature
   → 00_Project/01_my-feature/process.md 생성
1. 자기 역할 폴더(01_planner / 02_developer / 03_package)에서 claude 실행
   → 공유 폴더(../00_Project 등)는 settings.json이 접근을 허용한다
2. handover_{역할}.md 를 읽고 작업 — 작업물은 ../00_Project/01_my-feature/ 에
3. 세션 종료 전 /handover → handover_{역할}.md 갱신
   ★ 프로젝트 관련 항목엔 [01_my-feature] 태그
4. (팀 관리자) 팀 폴더에서 /handover → 태그가 process.md에 반영 + 팀 취합
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
1. 팀원은 **자기 역할 폴더에서 세션을 연다** (작업물은 공유 `00_Project/`에). 코드 수정은 `00_Project/{프로젝트}` 안에서만, process.md 갱신은 팀 관리자만.
2. 의미 있는 세션을 마치면 **`/handover`** — 문서가 곧 상태다.
3. 문서 갱신 후 **커밋** — 이력은 git이 보존한다.
