# 00_Team — 팀별 작업 공간

팀 폴더는 손으로 만들지 말고 **루트 세션에서 `/new_team {팀명}`으로 생성**하세요.
(`_ProjectTeam_Template/` 양식 폴더가 통째로 복사되어 표준 구조가 자동 스캐폴딩됩니다.)

## 구조

```
00_Team/
├── _ProjectTeam_Template/         ← 팀 구조 양식 원본 (수정하면 이후 팀 생성에 반영)
└── ProjectTeam_{팀명}/            ← 팀 폴더 (예: ProjectTeam_TeamA)
    ├── CLAUDE.md                  팀 관리자 — Builder 겸임 · process 전담   [필수]
    ├── handover.md                팀 인수인계 (역할·프로젝트 취합)
    ├── 00_Project/                진행 중 프로젝트 작업물 (공유)            [필수]
    │   └── NN_{프로젝트명}/        /new_project로 생성 · 독립 git 저장소 가능
    │       └── process.md         유일한 상태 문서 (팀 관리자 전담 갱신)
    ├── 01_planner/                기획·디자인 담당        ┐ 각 CLAUDE.md
    ├── 02_developer/              프로그램 개발 과정 담당  ├ + handover_{역할}.md
    ├── 03_package/                배포·최종 선정 담당      ┘ + .claude/settings.json
    ├── 10_Dashboard/              팀 현황판 (관리자 전용)                   [필수]
    ├── 11_team_doc/               문서 취합 (공유) — 보고서·회의록          [필수]
    └── 90_result_output/          완료 후 백업 (패키지 쓰기 주체)           [필수]
```

## 규칙 (팀 내 상호 호환)

- **팀원 세션은 자기 역할 폴더에서 연다.** 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`)는 역할 폴더의 `.claude/settings.json`이 접근을 허용한다. **타 역할 폴더·`10_Dashboard`는 비공유.**
- **작업물은 공유 폴더에, 기록은 내 handover에**: 프로젝트 산출물은 `00_Project/{프로젝트}/`, 기록은 `handover_{역할}.md`에 **`[NN_프로젝트명]` 태그**로.
- **`process.md` 갱신은 팀 관리자 전담** — 팀 폴더 `/handover`가 태그 항목을 각 process.md에 반영하고 팀 인수인계를 취합한다.
- 코드 수정은 `00_Project/{프로젝트}/` 안에서만 (개발 역할·팀 관리자). 완료 백업은 패키지 역할이 `90_result_output/`에.
- 작업 흐름: **기획 → 개발 → 패키지**. 다음 역할로 넘길 일은 handover 「다음 할 일」에 태그와 함께.
- 커스텀 역할 추가 시 `CLAUDE.md` + `handover_{역할}.md` 필수 (공유 접근 필요 시 settings.json 복사).
- 팀명·폴더·파일명은 **영문만** (한글은 특이 경우, 최대한 짧게).
- `_ProjectTeam_Template/`은 팀이 아니라 **양식 원본**이다 — 언더스코어 접두라 팀 스캔 패턴(`ProjectTeam_*`)에 걸리지 않으며, 보고·취합 대상에서 제외된다.
