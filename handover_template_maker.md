# Handover — 템플릿 제작 (template-maker) (갱신: 2026-07-07, 3회차 가상 검증 + P0 2차 + F6 커스텀 역할 반영)

> 이 문서는 **템플릿 자체를 만드는 작업**의 인수인계다. 컨텍스트를 비운 뒤 이 문서를 읽으면 제작 맥락이 복원된다.
> (운영용 인수인계는 `handover_root.md`, 상태 점검은 `Tech.md` 참조)

## 목표
Claude Code **1인 다프로젝트 운영 템플릿** 완성 — 회사의 업무 프로세스(팀=사업 영역·역할=작업 모드)를 1인 회사에 도입해 다량의 프로젝트를 분류·운영하고, HTML 대시보드로 포트폴리오 현황을 시각화한다. (다인 협업은 동일 구조의 확장)

## 현재 상태
**PRD v1.5 — 정체성 전환(1인 다프로젝트 운영) + HTML 대시보드(C안) 구현 완료.** 팀은 아직 0개(양식만 존재), M6 실전 검증 대기.
2026-07-07 사용성 테스트 2회(가상 인터뷰 10인) → 기능 백로그 `feature_changes.md`(F1~F24)로 정리, P0 1차 전건 + F10·F11·F12 반영 완료.
**같은 날 3회차 = M6 가상 검증 수행** (시나리오 7트랙 P11~P17 + 기계 점검 1트랙): "구현 완료" 기록 중 8건 통과, F1·F2는 유실 경로 잔존 판정 → 신규 발견 35건을 **F25~F32**로 등재. 통합 원장: `99_Archive/2026-07-07_virtual_verification/verification_report.md`.
**P0 2차(F25·F26·F27·F28) 구현 완료** — 태그 안전망 폐쇄형(F1·F2 재개정), 완료·아카이브 핫픽스, `/new_team` 첫 실행 경로(**양식 폴더 `_ProjectTeam_Template` 개명** — 사용자 결정), 90_Templates 드리프트 수정.
**F6(커스텀 역할 자동 생성) 구현 완료** — `/new_team`이 생성 전에 역할 구성(표준 3역할/커스텀)을 확인, 커스텀이면 역할별 3종 자동 생성(`90_Templates/CLAUDE.role.template.md` 신설). **구조 결정: 팀→역할∥프로젝트 현행 유지** (팀→프로젝트→역할 중첩안은 검토 후 기각 — 세션 수 폭증·v1.4 결정 3개 역행). 잔여: P1(F4·F5·F15·F18·F20+F31·F22+F31·F29·F30)과 M6.
git: `manager` 브랜치에서 작업 (origin: github.com/ReDocu/ClaudeCodeTemplate). `8d6c0dd`(README 정리)까지는 `main`에 병합·푸시됨. 이후 manager에만 있는 것: `13a2323`(3회차 가상 검증 원장) + P0 2차 구현 커밋 — **main 병합·푸시는 M6 시작 전에 수행 권장** (마일스톤마다 manager → main 병합).

## 완료된 것 (버전 순)

1. **v1.1 — 팀 구조 개편**: 팀 폴더명 `ProjectTeam_{팀명}`, 역할 작업 공간 3개(01_planner/02_developer/03_package), `/new_team`을 양식 폴더(`00_Team/ProjectTeam_양식[팀명]/`) 복사 방식으로 변경.
2. **v1.2 — 팀 필수 폴더·운영 규칙**: 필수 폴더 도입, 커스텀 역할 규칙(세션 폴더에 CLAUDE.md+handover 필수), 대시보드 2계층(팀→루트), Builder=팀 관리자 겸임, 명명 영문만, root 명령 원칙(일괄 작업 후 루트 기준 관리), 맥락별 매뉴얼 3종(manual/05~07).
3. **v1.3 — 프로젝트 관리 개편**: 프로젝트를 팀 직속 `00_Project/NN_{프로젝트명}/`으로 이동, **`process.md` 단일 상태 문서** 도입(프로젝트 CLAUDE.md·handover 폐지), `90_result_output` 개명(90번대=보관).
4. **v1.4 — 팀 내 공유 권한 (상호 호환)**:
   - 역할 세션이 공유 3폴더(`00_Project`/`11_team_doc`/`90_result_output`) 접근 — 역할 폴더별 `.claude/settings.json`(additionalDirectories).
   - **process.md 갱신 = 팀 관리자 전담**: 팀원은 handover에 `[NN_프로젝트명]` 태그로 기록 → 팀 `/handover`가 process 반영+취합. 프로젝트 직접 세션 폐지.
   - 역할 재정의: 기획·디자인 / 프로그램 개발 과정 / 배포·최종 선정(90_result_output 쓰기 주체).
   - 팀 보고서·파이프라인 결과 → `11_team_doc`, 90은 완료 백업 전용.
   - `.gitignore`: 00_Project 프로젝트는 독립 git 저장소 가능 — 템플릿은 process.md만 추적 (check-ignore 검증 완료).
5. **HTML 대시보드 (PRD_dashboard v1.0)**: 디자인 예시안 3종(`10_Dashboard/design/`) 제작 → **C안(사이드바 드릴다운) 채택** → 생성기 `10_Dashboard/tools/generate_dashboard.py` 구현(D1~D3: 폴더 스캔+process/handover 파싱, 관리자+팀별 페이지, STALE·경고, 단일 파일·외부요청 0) + `/dashboard` 명령 신설 + `/report_root` 6단계 연동. 테스트 팀으로 검증 후 초기 상태로 재생성.
6. **거버넌스·문서**: 루트 CLAUDE.md에 세션 시작/종료 필수 루틴(문서 읽기→요약→작업→/handover) 명문화, `Tech.md`/`Tech.html`(상태 점검 가이드), `main_manual.md`(초심자 진입점), manual 00~07 전면 동기화, README를 진입 안내로 개편.
7. **v1.5 — 정체성 전환 + 사용성 테스트 (2026-07-07)**: 가상 인터뷰 5페르소나×8문항(`interview.csv`) → 우선순위표 20건(`interview_priority.md`, P0~P3). 템플릿 목적을 **1인 다프로젝트 운영(멀티팀 구조 차용)**으로 재정의 — CLAUDE.md·PRD·README·main_manual §1 반전, main_manual §8 「기본 사용 모델 — 1인 회사 모드」(2축 모델·사이클·가드레일 5·다인 확장) 신설, 격리 근거 재서술(컨텍스트 오염 방지·사고 모드 분리). **P0 잔여 3건 방향 합의됨**: #1 태그 검증(3중 방어 + 미분류 보류함) / #2 11_team_doc 수명 단계 폴더(00_final/10_working/90_old — 중요도 아닌 수명 기준) / #3 대시보드 파이썬 제거(HTML 셸 고정 + JSON 데이터 블록만 명령이 교체, 생성기 은퇴).
8. **커밋·배포·백업 정리 (2026-07-07)**: `5e48ee1`(v1.3~v1.4) · `f972c5a`(v1.5 정체성+사용성+P0 구현) · `8d6c0dd`(README 정리) 커밋 → **`main` fast-forward 병합·푸시** (GitHub 첫 화면에 새 README 반영). 사용 종료 문서 백업: 인터뷰 원자료·이슈 원장 → `99_Archive/2026-07-07_usability_test/`, 디자인 예시안 3종 → `99_Archive/2026-07-07_dashboard_design/`. **F24(Lifecycle 고정 팀 — 완료 프로젝트의 라이브/보관/폐기 분류) 설계 합의**, P2 등재.
9. **3회차 — M6 가상 검증 + 사용성 테스트 (2026-07-07)**: 가상 사용자 8트랙(온보딩/팀 생성/역할 세션/팀 취합/루트 총괄/완료·보관/복원·격리/기계 점검)이 실제 문서·명령을 따라 시나리오 수행. **통과**: 격리·권한 실측 전항(settings.json 3개 동일·상대경로 정합), 셸+DATA 삼각 일치·파이썬 잔재 0, F14·F19·F21·F10·F11·F12 실재, 복원 15분 내. **미달**: F1·F2 태그 안전망(미감지 항목 유실 경로), 아카이브 gitignore 충돌(사고형), new_team 첫 실행 경로 3결함, 90_Templates 드리프트(report_root 실질 영향), Tech.md/Tech.html 신선도. → F25~F32 등재 + 원장 정정(F17 완료 확인, F9·F3 각주).
10. **P0 2차 구현 (2026-07-07)**: ① **F26** — 팀 취합 처분 폐쇄형(catch-all 미분류)·멱등성·태그 부착 위치 정리·역할 근거를 파일 목록 기반으로(handover.md), 양식 팀 handover에 미분류 섹션. ② **F27** — report_root [종료] 검색을 process.md 제목으로, FAQ 종료 절차 정본 4단계 교체, 99_Archive 이동 전 처리(process·최종 문서만)·이동 후 분포 명시, 90_result_output 권장 3종+패키지 체크리스트. ③ **F25** — 양식 폴더를 **`_ProjectTeam_Template`로 git mv 개명**(참조 20여 곳 갱신 — 팀 스캔 `ProjectTeam_*`에서 자연 제외, 한글 특례 해소), new_team에 예시 프로젝트 삭제 단계 신설, 11_team_doc README 패턴 `{날짜}` 표기, 폴백을 git 복원 우선으로. ④ **F28** — handover·report 템플릿을 내장본 수준으로 갱신, new_project 주석 원문 복원. gitignore 새 이름 3케이스 실측 통과.
11. **F6 — 커스텀 역할 자동 생성 (2026-07-07)**: `/new_team`에 「역할 구성 확인」 단계 신설 — 표준 3역할 또는 커스텀(역할 목록·임무·백업 주체 입력) 선택 후 생성. 커스텀이면 역할별 3종(settings.json 복사 · CLAUDE.md는 신설 양식 `90_Templates/CLAUDE.role.template.md`에서 생성 · handover) 자동 생성 + 미사용 표준 역할 삭제 + 팀 CLAUDE.md 역할 표·매트릭스·작업 흐름 갱신. 동기화: 팀 CLAUDE 양식·team.template 쌍, manual 01/04/06, PRD 7장, Tech.md §5. **main_manual 보강**: §4 「역할 구성 고르기」 신설(표준/커스텀 표·커스텀 입력 3가지·혼합 구성), §6 커스텀 역할 읽기 안내, §8 커스텀 포인터 갱신, §9에 /new_team 역할 구성·`/handover_root` 행 추가 (V#30·V#24 해소). **팀 목표 생성 시 입력**: /new_team이 역할 구성과 함께 팀 목표(1~2문장)를 받아 팀 CLAUDE.md에 즉시 기입 — "생성 후 숙제" 제거 (quickstart·manual 05/06·main_manual §4·PRD 7장·팀 CLAUDE 양식 쌍 동기화). **메인/보조 작업 위치 원칙 명문화 (F21 보강)**: "메인 작업물 = `00_Project/{프로젝트}/`, 보조 작업물(초안·메모·역할 일반 문서) = 자기 역할 폴더" — 역할 CLAUDE.md 3종+커스텀 양식 작업 규칙 1번, 팀 CLAUDE 쌍 작업 흐름, manual/07 결정 흐름(①을 프로젝트 산출물로 재배열), main_manual §6, 11_team_doc README 동기화. **구조 논의**: 팀→프로젝트→역할 중첩안 기각, 현행(팀→역할∥프로젝트) 유지 + "대형 프로젝트는 팀으로 승격" 패턴 권고 (문서화는 F20에 병합).

## 진행 중인 것
- 없음.

## 다음 할 일 (우선순위 순)
1. **M6 실전 검증 (1인 시나리오)**: 1인 사용자가 도메인 팀 2~3개 + 프로젝트 다수를 2주 운영 — 명령 인식 범위·additionalDirectories 상대경로 실측 → manual/양식 보완. **가상 검증이 넘긴 확인 항목 5건은 원장 §4 참조** (F26 반영 후 유실률·개명된 양식 폴더 복사 실측 포함).
2. **P1 잔여 구현 (M6 병행)** — `feature_changes.md` 참조: F18(동기화 점검 — **F28 수정 직후인 지금이 착수 적기**, CLAUDE.role.template 포함해 점검 대상 갱신) → F29(Tech.md·Tech.html 신선도 — 개명 반영 포함)·F30(대시보드 셸 버전 마커 등) → F4(이중 커밋 확인)·F5·F15(공용 자산 위치 — **설계 결정 선행**, V#17 타 팀 참조 경로 포함)·F20(+F31, "대형 프로젝트는 팀으로 승격" 경계 사례 포함)·F22(+F31).
3. **D4**: 실제 운영 데이터로 대시보드 수용 기준(PRD_dashboard 8장) 재확인 — 프로젝트 중심 정보구조 검토 포함.
4. **F24 — Lifecycle 고정 팀** (완료 프로젝트를 라이브/보관/폐기로 분류하는 수명 관리 팀): **설계 합의됨** — 상세는 `feature_changes.md` F24. M6 이후 착수.
5. (선택) `/projects` 명령 — 팀 폴더에서 process 요약 조회 (제안만 된 상태, 미승인).
6. (보류) 각 팀 대시보드를 연결한 웹 통합 뷰 고도화 — 현재는 관리자 페이지가 그 역할.

## 주의사항 / 함정
- **정체성 = 1인 다프로젝트 운영** (PRD v1.5): 설계·우선순위 판단은 1인 시나리오를 기본 가정으로. 다인 전제 이슈는 후순위. 격리 규칙의 근거는 "권한"이 아니라 "컨텍스트 오염 방지·사고 모드 분리".
- **아카이브 이동은 process.md·최종 문서만** (F27 반영됨, 99_Archive README에 명문화) — 작업물·중첩 .git을 통째로 옮기면 안 되는 이유도 거기 기록됨.
- **Tech.md·Tech.html은 낡음** (헤더 v1.3/v0.1, Tech.html은 옛 폴더명·"생성기 예정" 잔존 — F29): 정비 전까지 점검 기준으로 쓸 때 §2 스냅샷·§7 체크리스트 위주로만 신뢰. Tech.md의 개명 반영은 4곳만 선반영됨.
- **동기화 지점** (Tech.md §8): 양식 폴더 ↔ 90_Templates 예비 사본 ↔ 명령어 내장본. 특히 process 양식은 3곳(양식/템플릿/new_project 내장), 역할 settings.json은 3개 폴더 동일 내용.
- **루트 판별에 `10_Dashboard`를 쓰면 안 된다** — 팀 폴더에도 있음. 루트 판별은 `00_Team/` 보유로.
- **dashboard.html은 생성물** — 직접 수정 금지, `/dashboard`로 재생성. md가 진실의 원천.
- `additionalDirectories`의 **상대경로 동작은 미실측** — 안 되면 `claude --add-dir` 또는 프롬프트 승인 (규칙은 팀 CLAUDE.md 매트릭스).
- 양식 폴더는 `_ProjectTeam_Template`로 개명됨 (2026-07-07, F25) — 언더스코어 접두라 팀 스캔 패턴(`ProjectTeam_*`)에서 자연 제외. 과거 문서·이력의 `ProjectTeam_양식[팀명]`은 옛 이름.
- 개명으로 한글 폴더명 특례가 해소됨 — 이제 전 폴더 영문만.
- PRD 오픈 이슈 4(명령 인식 범위)와 settings.json allowlist 최소 구성은 M6에서 실측 예정.

## 핵심 파일 경로
- `CLAUDE.md` — 루트 거버넌스 (전 세션 상속 규칙 1~7)
- `PRD.md` — 템플릿 사양 v1.4 (13장 변경 이력) / `PRD_dashboard.md` — 대시보드 사양 v1.0
- `Tech.md` · `Tech.html` — 상태 점검 가이드 (불변식·체크리스트·동기화 지점)
- `main_manual.md` — 초심자 진입점 / `manual/00~07` — 상세 매뉴얼
- `00_Team/_ProjectTeam_Template/` — 팀 구조 양식 원본 (/new_team이 복사)
- `10_Dashboard/dashboard.html` — **대시보드 셸 단일 원본** (DATA 블록만 명령이 교체 — 셸 수정은 제작 세션에서만)
- `feature_changes.md` — **활성 기능 백로그 (F1~F32)** — P0 2차(§E)·P1·P2 잔여와 F24 설계가 여기 있음
- `99_Archive/2026-07-07_*` — 백업: 사용성 테스트 원자료·이슈 원장(usability_test) / 디자인 예시안 3종(dashboard_design) / 구 파이썬 생성기(dashboard_generator) / **3회차 가상 검증 통합 원장(virtual_verification)**
- `.claude/commands/` — 명령 9종 (dashboard 포함) / `.gitignore` — 프로젝트 git 연결 규칙

<!-- 규칙: 이 문서는 템플릿 제작 세션을 마칠 때 덮어쓰기로 갱신한다. 이력은 git이 보존한다. -->
