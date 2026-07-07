---
description: 새 팀 폴더 스캐폴딩 — 양식 폴더 복사 (루트 전용)
argument-hint: {팀명}
---

팀명: $ARGUMENTS
(비어 있으면 팀명을 물어본다.)

새 팀 작업 공간을 표준 구조로 생성한다.

## 1. 검증 (루트 전용)
- 현재 폴더에 `00_Team/`이 있는지 확인. 없으면 루트 전용임을 안내하고 중단.
- 팀명 검증: **영문/숫자/하이픈만 사용한다.** 한글은 특이 경우에 한해 허용하되, 파일명·링크 호환성 리스크를 안내하고 **사용자 확인 후** 최대한 짧게 쓰도록 권한다.
- 팀 폴더명은 `ProjectTeam_{팀명}`.
- `00_Team/ProjectTeam_{팀명}/`이 이미 존재하면 거부하고 중단.

## 2. 생성 — 양식 폴더 복사

팀 구조의 원본은 `00_Team/ProjectTeam_양식[팀명]/`이다.

1. 양식 폴더 전체를 `00_Team/ProjectTeam_{팀명}/`으로 복사한다. 표준 구조:

```
ProjectTeam_{팀명}/
├── CLAUDE.md                     # 팀 관리자 (Builder 겸임 · process.md 전담)  [필수]
├── handover.md                   # 팀 인수인계 (역할·프로젝트 취합)
├── 00_Project/                   # 진행 중 프로젝트 작업물 (공유)              [필수]
│   ├── README.md                 #   규칙: NN_{프로젝트명}/process.md · git 연결
│   └── 01_Project01/process.md   #   양식 예시 (실제 팀에선 /new_project로 생성)
├── 01_planner/                   # 기획·디자인 담당
│   ├── CLAUDE.md · handover_planner.md
│   └── .claude/settings.json     #   공유 폴더 접근 허용 (00_Project·11_team_doc·90_result_output)
├── 02_developer/                 # 프로그램 개발 과정 담당 (코드 작업은 00_Project에서)
│   ├── CLAUDE.md · handover_developer.md
│   └── .claude/settings.json
├── 03_package/                   # 배포·최종 선정 담당 (90_result_output 쓰기 주체)
│   ├── CLAUDE.md · handover_package.md
│   └── .claude/settings.json
├── 10_Dashboard/                 # 팀 현황판 DASHBOARD.md (관리자 전용)        [필수]
├── 11_team_doc/                  # 문서 취합 (공유) [필수]
│   └── 00_final/ · 10_working/ · 90_old/   #   수명 단계 폴더 — 보고서는 11_team_doc 바로 아래
└── 90_result_output/             # 완료 후 백업 (패키지 역할 쓰기 주체)         [필수]
```

2. 복사된 모든 파일에서 플레이스홀더를 치환한다: `{팀명}` → 팀명, `{YYYY-MM-DD}` → 오늘 날짜.
3. 양식 폴더가 없으면(삭제·이동된 경우) 위 구조를 직접 생성하되, CLAUDE.md·handover 내용은 `90_Templates/CLAUDE.team.template.md`·`handover.template.md`·`process.template.md`에서 출발한다.

## 3. 커스텀 역할 안내 (표준 양식과 다른 구성이 필요할 때)
- 역할 폴더는 팀에 맞게 추가·변경할 수 있다 (`NN_{역할}` 권장, 예: `04_designer`).
- **직접 명령(세션)을 주는 폴더에는 반드시 `CLAUDE.md`(역할 정의)와 `handover_{역할}.md`를 생성**하고, 공유 접근이 필요하면 `.claude/settings.json`을 표준 역할 폴더에서 복사한다.
- 필수 폴더(`00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output`)와 팀 `CLAUDE.md`는 삭제·개명하지 않는다.

## 4. 마무리
- 사용자에게 안내:
  - 팀 CLAUDE.md의 「팀 목표」를 작성할 것.
  - 첫 프로젝트는 팀 폴더에서 `/new_project {프로젝트명}` → `00_Project/`에 생성.
  - **팀원 세션은 자기 역할 폴더에서 연다** — 공유 폴더(00_Project·11_team_doc·90_result_output)는 settings.json으로 접근 가능, 타 역할 폴더는 금지.
  - 작업 흐름: 기획 → 개발 → 패키지. 팀원은 handover에 `[NN_프로젝트명]` 태그로 기록 → **팀 관리자가 `/handover`로 취합하며 process.md 갱신**.
  - 구현(Builder)은 팀 관리자가 겸임하며 `00_Project/{프로젝트}/`에서 수행.
- 커밋을 제안한다: `chore(team): {팀명} 생성`
