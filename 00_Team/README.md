# 00_Team — 팀별 작업 공간

팀 폴더는 손으로 만들지 말고 **루트 세션에서 `/new_team {팀명}`으로 생성**하세요.
(`ProjectTeam_양식[팀명]/` 양식 폴더가 통째로 복사되어 표준 구조가 자동 스캐폴딩됩니다.)

## 구조

```
00_Team/
├── ProjectTeam_양식[팀명]/        ← 팀 구조 양식 원본 (수정하면 이후 팀 생성에 반영)
└── ProjectTeam_{팀명}/            ← 팀 폴더 (예: ProjectTeam_TeamA)
    ├── CLAUDE.md                  팀 관리자 — Builder(구현) 겸임      [필수]
    ├── handover.md                팀 인수인계 (역할 handover 취합)
    ├── 00_result_output/          팀 최종 결과물                      [필수]
    ├── 10_Dashboard/              팀 현황판 DASHBOARD.md              [필수]
    ├── 11_team_doc/               팀 공용 문서                        [필수]
    ├── 01_planner/                기획 — 요구사항·설계·기획 문서
    │   ├── CLAUDE.md
    │   └── handover_planner.md
    ├── 02_developer/              개발 — 구현·코드 작업 (코드 수정은 여기서만)
    │   ├── CLAUDE.md
    │   ├── handover_developer.md
    │   └── {프로젝트명}/           ← (선택) 역할 폴더에서 /new_project로 생성
    └── 03_package/                패키지 — 빌드·패키징·배포 준비
        ├── CLAUDE.md
        └── handover_package.md
```

## 규칙

- 작업 세션은 **자기 역할 폴더(01_planner 등)에서 시작**한다. 팀 조율·구현(Builder)은 팀 관리자가 팀 폴더 기준으로 수행한다. 그러면 타 팀·타 역할·루트 문서에 접근하지 않는 격리가 유지된다.
- 작업 흐름: **기획 → 개발 → 패키지**. 역할 간 전달은 각 역할의 `handover_{역할}.md` 「다음 할 일」로 한다.
- **커스텀 역할**을 추가할 때는 그 폴더에 `CLAUDE.md`와 `handover_{역할}.md`를 반드시 만든다 (`NN_{역할}` 권장).
- 필수 폴더(`00_result_output`/`10_Dashboard`/`11_team_doc`)와 팀 `CLAUDE.md`는 삭제·개명하지 않는다.
- 세션 종료 시 `/handover`, 팀 보고·대시보드 갱신은 팀 폴더에서 `/report`.
- 팀명·폴더·파일명은 **영문만** (한글은 특이 경우, 최대한 짧게).
- `ProjectTeam_양식[팀명]/`은 팀이 아니라 **양식 원본**이다 — 보고·취합 대상에서 제외된다.
