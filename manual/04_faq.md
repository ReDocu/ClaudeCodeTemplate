# FAQ

## Q. 팀 폴더 안의 01_planner / 02_developer / 03_package는 뭔가요?
팀의 **역할 작업 공간**(역할 관점 문서 전용)입니다. 기획(01_planner) → 개발(02_developer) → 패키지(03_package) 순으로 작업이 흐르고,
각 역할 폴더에서 세션을 열어 작업한 뒤 `/handover`로 `handover_{역할}.md`를 갱신합니다.
역할 간 전달은 handover의 「다음 할 일」로 합니다. 상세: [07_individual_manager.md](07_individual_manager.md)

## Q. 프로젝트는 어디서 관리하나요?
작업물은 팀 직속 **`00_Project/NN_{프로젝트명}/`**, 상태는 **`91_project_process/NN_{프로젝트명}.md`**(process 문서)에서 관리합니다 (팀 폴더에서 `/new_project`로 한 쌍 생성).
`00_Project/`는 팀원 전원이 역할 세션에서 **공유 접근**으로 작업물을 두는 협업 공간이며, 프로젝트별 독립 git 저장소를 연결할 수 있습니다 (템플릿 저장소는 `00_Project`를 추적하지 않고 process 문서만 추적 — 중첩 git 저장소 안의 파일은 상위가 추적할 수 없어 상태 문서를 밖에 둡니다).
프로젝트마다 **process 문서 하나**가 유일한 상태 문서이고 **갱신은 팀 관리자 전담**입니다 — 팀원은 자기 handover에 `[NN_프로젝트명]` 태그로 기록하면 팀 `/handover`가 반영합니다.
**코드 수정은 프로젝트 폴더 안에서만** 합니다 (개발 역할 세션 또는 팀 관리자).

## Q. 팀원인데 다른 폴더에 접근해도 되나요?
공유 4폴더(`00_Project`/`11_team_doc`/`90_result_output`/`91_project_process` — 91은 읽기만)는 접근 가능합니다 — 역할 폴더의 `.claude/settings.json`이 허용하며, 접근 확인 프롬프트가 뜨면 이 범위 안에서 승인하면 됩니다.
**타 역할 폴더·`10_Dashboard`·상위/타 팀은 금지**입니다. 필요한 정보는 사용자(또는 팀 관리자)에게 요청하세요.

## Q. 표준 역할(planner/developer/package)과 다른 구성이 필요해요.
**팀을 새로 만드는 시점이라면** `/new_team`이 역할 구성(표준/커스텀)을 물어봅니다 — 역할 목록·임무·백업 주체만 답하면 역할별 3종 파일이 자동 생성됩니다 (예: 창작 팀 `01_writer`/`02_editor`/`03_publisher`).
**이미 만든 팀에 추가할 때는** 직접 만듭니다 (`NN_{역할}` 권장, 예: `04_designer`) — 세션을 주는 폴더에 반드시 `CLAUDE.md`(역할 정의)와 `handover_{역할}.md`, 공유 접근이 필요하면 기존 역할 폴더의 `.claude/settings.json`을 복사하고, 팀 CLAUDE.md의 역할 표도 갱신합니다.
필수 폴더(`00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output`/`91_project_process`)와 팀 `CLAUDE.md`는 삭제·개명하면 안 됩니다.

## Q. 구현(Builder)은 누가 하나요?
별도 Builder 에이전트는 없습니다. **팀 관리자가 Builder 역할을 겸임**하며, 구현 작업은 `00_Project/{프로젝트}/` 폴더에서 수행합니다.
분석 4역할(Explorer 등)은 분석 전용을 유지합니다.

## Q. 팀 폴더에서 세션을 열었는데 슬래시 명령어(/handover 등)가 안 보여요.
명령어는 루트 `.claude/commands/`에 정의되어 있고, 이 저장소가 하나의 git 저장소이므로 하위 폴더 세션에서도 인식되는 것이 기대 동작입니다.
만약 인식되지 않으면 (환경에 따라 다를 수 있음):
1. 팀 폴더에 `.claude/commands/`를 만들고 필요한 명령 파일(handover.md, report.md, new_project.md, pipeline.md)을 복사하거나,
2. 사용자 레벨(`~/.claude/commands/`)에 설치하세요 (모든 프로젝트에서 사용 가능해짐).

## Q. 팀 세션에서 다른 팀 상황이 필요해요.
팀 세션은 상위·타 팀 폴더에 접근하지 않는 것이 규칙입니다.
총괄자(루트 세션)에게 요청해 `handover_root.md`나 해당 팀 handover의 내용을 전달받으세요.

## Q. 팀명을 한글로 써도 되나요?
**영문만 사용하는 것이 규칙**입니다 (팀명·폴더·파일명 공통). 한글은 특이 경우에 한해 허용하되 **최대한 짧게** 씁니다.
`/new_team`이 한글 팀명 입력 시 리스크를 안내하고 확인을 받습니다.

## Q. handover가 자꾸 길어져요.
handover는 "다음 사람이 5분 안에 이어받게 하는 문서"입니다. 완료된 것의 상세 내역은 결과물 문서나 git 이력에 맡기고, handover에는 요약+링크만 남기세요. 덮어쓰기가 원칙입니다.

## Q. 예전 handover 내용을 보고 싶어요.
`git log --oneline -- handover.md` 후 `git show {커밋}:{경로}`로 조회하세요. 이력 보존은 git의 몫입니다.

## Q. /report_root 실행 시 특정 팀 보고가 실패했어요.
설계된 동작입니다 — 실패한 팀은 대시보드에 ⚪ "보고 실패"로 표기되고 전체 갱신은 계속됩니다. 해당 팀 폴더의 handover 상태를 확인한 뒤 다시 실행하세요.

## Q. 대시보드를 직접 수정해도 되나요?
`DASHBOARD.md`의 쓰기 주체는 `/report_root` 하나입니다. 손으로 고치면 다음 갱신 때 덮어써집니다.
반영하고 싶은 내용이 있으면 팀 handover/report에 쓰세요 — 다음 `/report_root` 때 반영됩니다.

## Q. 표준 양식을 바꾸고 싶어요.
- **문서 양식**(handover·report·result): `90_Templates/`의 원본을 수정하고, **같은 양식이 내장된 `.claude/commands/*.md`도 함께** 수정하세요.
  (하위 세션은 90_Templates에 접근할 수 없어 명령어 파일에 사본이 내장되어 있습니다.)
- **팀 폴더 구조**: 원본은 `00_Team/_ProjectTeam_Template/`입니다. 이 폴더를 수정하면 이후 `/new_team`이 만드는 팀에 반영됩니다.
  (예비 사본인 `90_Templates/CLAUDE.team.template.md`도 함께 갱신하세요.)

## Q. 프로젝트가 끝났어요. 어떻게 정리하나요?
1. **팀 관리자**(팀 폴더 세션)가 process 문서(`91_project_process/NN_{프로젝트명}.md`)의 완료 조건 충족을 확인합니다.
2. **패키지 역할**이 최종 작업물을 `90_result_output/`에 백업합니다 (무엇을 넣는지는 해당 폴더 README의 권장 3종 참조).
3. 팀 관리자가 process 문서 **제목 앞에 `[종료]`** 표기 + 진행 기록에 `[팀 관리자]` 한 줄을 남깁니다.
4. 다음 `/report_root`가 아카이브 후보로 제안 → 사용자 확인 후 `99_Archive/` 규칙대로 이동합니다.
   **주의**: 작업물 전체가 아니라 **process 문서·최종 문서만** 이동합니다 — 이동 전 처리는 `99_Archive/README.md` 참조.
