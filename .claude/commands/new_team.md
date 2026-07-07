---
description: 새 팀 폴더 스캐폴딩 — 역할 구성(표준/커스텀) 확인 후 양식 폴더 복사 (루트 전용)
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

## 2. 역할 구성 확인 (생성 전 필수)

복사하기 전에 **역할 구성을 사용자에게 확인**한다:

- **표준 3역할** — `01_planner`(기획·디자인) / `02_developer`(개발) / `03_package`(배포·최종 선정, `90_result_output` 쓰기 주체). 코드 산출물이 있는 일반적인 팀에 적합.
- **커스텀** — 팀 성격에 맞는 역할 구성 (예: 창작 팀 `01_writer`/`02_editor`/`03_publisher`). 다음 3가지를 받는다:
  1. **역할 목록** — 작업 흐름 순서대로, 영문 소문자 (폴더명은 `NN_{역할}`, 01부터).
  2. **각 역할의 임무 1~3줄.**
  3. **완료 백업(`90_result_output`) 쓰기 주체** 역할 1개 — 보통 마지막 역할. 지정이 없으면 마지막 역할로 제안하고 확인받는다.
  - 표준 역할 일부를 유지하고 추가·교체하는 혼합 구성도 가능하다 (예: developer 유지 + `04_designer` 추가).

역할 구성과 함께 **「팀 목표」(1~2문장 — 이 팀이 달성하려는 것)도 받는다** — 표준/커스텀 공통. 생성 시 팀 CLAUDE.md에 바로 채운다. 사용자가 아직 정하지 못했으면 "(미정 — 첫 세션 전에 작성)"으로 두고 마무리에서 다시 상기시킨다.

## 3. 생성 — 양식 폴더 복사

팀 구조의 원본은 `00_Team/_ProjectTeam_Template/`이다. (언더스코어 접두 — 팀 스캔 패턴 `ProjectTeam_*`에 걸리지 않는 양식 폴더)

1. 양식 폴더 전체를 `00_Team/ProjectTeam_{팀명}/`으로 복사한다. 표준 구조 (커스텀 구성이면 역할 폴더 부분은 아래 3단계에서 재구성):

```
ProjectTeam_{팀명}/
├── CLAUDE.md                     # 팀 관리자 (Builder 겸임 · process.md 전담)  [필수]
├── handover.md                   # 팀 인수인계 (역할·프로젝트 취합)
├── 00_Project/                   # 진행 중 프로젝트 작업물 (공유)              [필수]
│   ├── README.md                 #   규칙: NN_{프로젝트명}/process.md · git 연결
│   └── 01_Project01/process.md   #   양식 예시 — 복사 후 삭제 (아래 2단계)
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

2. **복사한 새 팀에서 양식 예시 프로젝트 `00_Project/01_Project01/`을 삭제한다** — 첫 실제 프로젝트가 01번을 갖고, 플레이스홀더 예시가 보고·대시보드에 유령 프로젝트로 잡히지 않도록. (예시 원본은 양식 폴더에만 유지 — process 양식의 동기화 지점이다.)
3. **(커스텀 구성일 때) 역할 공간을 재구성한다** — §2(역할 구성 확인)에서 받은 목록대로:
   - 각 커스텀 역할 `NN_{역할}/`마다 3종을 생성한다:
     1. `.claude/settings.json` — 표준 역할 폴더(예: `01_planner/.claude/settings.json`)에서 복사 (3개 모두 동일 내용, 삭제 전에 복사할 것).
     2. `CLAUDE.md` — `90_Templates/CLAUDE.role.template.md`에서 생성: `{역할명}`·`{역할}`·`{NN_역할}`·`{팀명}`·`{임무}`를 치환하고, `90_result_output` 행은 백업 주체 역할이면 "✅ 쓰기 주체", 아니면 "📖 읽기만"으로 확정한다.
     3. `handover_{역할}.md` — 표준 역할 handover와 같은 골격 (제목 `# Handover — {팀명}/{역할명}({역할}) (갱신: 오늘)`, 현재 상태 "역할 공간 생성 직후 — 작업 전", 태그 규칙 주석 포함).
   - 사용하지 않는 표준 역할 폴더(`01_planner`/`02_developer`/`03_package`)는 삭제한다 (유지하기로 한 것은 남긴다).
   - **팀 `CLAUDE.md`를 실제 구성에 맞게 갱신한다**: 「역할 작업 공간」 표(폴더·역할·임무), 「접근 권한 매트릭스」의 역할 열, 「작업 흐름」 문장(역할 순서), `90_result_output` 쓰기 주체 표기. 필수 4폴더 행과 규칙은 그대로 둔다.
4. **팀 `CLAUDE.md`의 「팀 목표」를 §2에서 받은 내용으로 채운다** (미정이면 "(미정 — 첫 세션 전에 작성)").
5. 복사된 모든 파일에서 플레이스홀더를 치환한다: `{팀명}` → 팀명, `{YYYY-MM-DD}` → 오늘 날짜. (반드시 2~4단계 **후에** 치환한다.)
6. 양식 폴더가 없으면(삭제·이동된 경우) **git 이력에서 복원하는 것을 우선 안내**한다: `git checkout {최근 커밋} -- 00_Team/_ProjectTeam_Template`. 복원이 불가능할 때만 위 구조를 직접 생성하되, CLAUDE.md·handover·process·역할 문서는 `90_Templates/CLAUDE.team.template.md`·`handover.template.md`·`process.template.md`·`CLAUDE.role.template.md`에서 출발한다 (표준 역할 문서·settings.json은 이 템플릿들로 재구성할 수 없으므로 git 복원이 우선이다).

## 4. 역할 사후 추가·변경 (생성 후 구성을 바꿀 때 — 안내용)
- 역할 폴더는 생성 후에도 추가·변경할 수 있다 (`NN_{역할}` 권장, 예: `04_designer`).
- **직접 명령(세션)을 주는 폴더에는 반드시 3종을 만든다**: `CLAUDE.md`(역할 정의 — `90_Templates/CLAUDE.role.template.md`에서 출발) + `handover_{역할}.md` + 공유 접근이 필요하면 `.claude/settings.json`(기존 역할 폴더에서 복사).
- 역할을 바꾸면 팀 `CLAUDE.md`의 역할 표·매트릭스·작업 흐름도 함께 갱신한다.
- 필수 폴더(`00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output`)와 팀 `CLAUDE.md`는 삭제·개명하지 않는다.

## 5. 마무리
- 사용자에게 안내:
  - 생성 결과 요약: **팀 목표(채워진 내용)** + 역할 구성(폴더 목록 + 각 임무 1줄 + 백업 주체). 팀 목표를 미정으로 뒀다면 첫 세션 전에 작성할 것을 상기시킨다. 커스텀이면 각 역할 CLAUDE.md의 「임무」를 다듬을 것을 권한다.
  - 첫 프로젝트는 팀 폴더에서 `/new_project {프로젝트명}` → `00_Project/`에 생성.
  - **팀원 세션은 자기 역할 폴더에서 연다** — 공유 폴더(00_Project·11_team_doc·90_result_output)는 settings.json으로 접근 가능, 타 역할 폴더는 금지.
  - 작업 흐름: 역할 순서대로 (표준: 기획 → 개발 → 패키지). 팀원은 handover에 `[NN_프로젝트명]` 태그로 기록 → **팀 관리자가 `/handover`로 취합하며 process.md 갱신**.
  - 구현(Builder)은 팀 관리자가 겸임하며 `00_Project/{프로젝트}/`에서 수행.
- 커밋을 제안한다: `chore(team): {팀명} 생성`
