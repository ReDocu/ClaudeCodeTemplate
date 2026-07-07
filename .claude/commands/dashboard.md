---
description: HTML 대시보드 갱신 — 셸의 DATA 블록 교체, 관리자 + 전 팀 페이지 (루트 전용)
---

HTML 대시보드를 갱신한다. md가 진실의 원천이며 이 명령은 **md를 수정하지 않는다** (읽기 전용 스캔 → HTML의 DATA 블록만 교체). **파이썬 등 외부 도구가 필요 없다.**

> **구조**: 루트 `10_Dashboard/dashboard.html`이 **셸(마크업·CSS·JS)의 단일 원본**이다. 렌더링은 셸 내 JS가 하고, 데이터는 `DASHBOARD-DATA-START/END` 마커 사이의 `const DATA`·`const CFG` 두 줄에 들어 있다. 이 명령은 그 두 줄만 다시 쓴다. **셸 자체는 수정 금지.**

## 1. 위치 확인 (루트 전용)
현재 폴더에 `00_Team/`과 `10_Dashboard/`가 있는지 확인. 없으면 루트 전용임을 안내하고 **중단**.
루트 `10_Dashboard/dashboard.html`이 없으면 git 이력에서 복원(`git checkout -- 10_Dashboard/dashboard.html`)을 안내하고 중단.
오늘 날짜(YYYY-MM-DD)를 확인한다.

## 2. 스캔·파싱 (읽기 전용 — PRD_dashboard.md 5장 규칙)

- **팀 열거**: `00_Team/ProjectTeam_*` — 양식 폴더(`_ProjectTeam_Template`)는 언더스코어 접두라 패턴에 걸리지 않는다 (**혹시 걸려도 제외**).
- 팀마다:
  - 역할 폴더 열거(필수 폴더 `00_Project`/`10_Dashboard`/`11_team_doc`/`90_result_output` 제외) → 각 `handover_{역할}.md` 파싱: 갱신일(제목의 `(갱신: YYYY-MM-DD)`), 현재 상태 첫 문단(2줄 절삭), 다음 할 일 상위 3건, 진행 중 목록. 파일 없으면 missing.
  - `00_Project/NN_*/process.md` 파싱: 갱신일, 제목의 `[종료]`/`[보류]`, 현재 단계(굵게), 상태 요약 표(상태등·진행률·담당·목표일), 진행 기록 상단 1~2건, 다음 할 일 상위 3건, 블로커.
  - 팀 상태등·진행률·마일스톤: 팀 `10_Dashboard/DASHBOARD.md`·최신 `11_team_doc/report_*.md`에서. 없으면 `reported:false`(미보고), 상태등은 idle.
  - **휴면 판정**: 팀 `handover.md`의 「현재 상태」에 `휴면` 선언이 있으면 `dormant:true` (기한 `휴면 ~YYYY-MM-DD` 또는 `until` 표기 시 `dormantUntil`). 휴면 팀은 STALE로 치지 않는다.
  - **STALE**: 갱신일이 오늘 기준 7일 초과. 갱신일 파싱 실패 시 `git log -1 --format=%as -- {경로}`로 대체.
  - 최근 문서: 팀 `11_team_doc/`(파일명 날짜 역순 5건)·`90_result_output/` 5건.
- 루트: `11_doc_result/` 최신 5건 → `rootDocs`.
- **파싱 실패 내성**: 섹션 누락은 해당 항목만 비우고 계속. 구조 문제는 해당 팀 `warnings`에 기록. **전체 작업은 중단하지 않는다.**

## 3. DATA 스키마 (셸 JS와 계약 — 키 이름 변경 금지)

```js
const DATA = {"teams": [Team...], "rootDocs": ["파일명"...]};
const CFG  = {"brand":"ClaudeTemplate", "generated":"YYYY-MM-DD", "isTeamPage":false, "backHref":""};

Team = { "name":str, "st":"good|warn|crit|idle", "pct":int|null, "milestone":str|null,
  "updated":"YYYY-MM-DD"|null, "stale":bool, "dormant":bool, "dormantUntil":str|null,
  "reported":bool, "warnings":[str],
  "blockers":[{"project":str,"text":str}],
  "projects":[{"name":str,"st":str,"stage":str|null,"pct":int|null,"date":str|null,
    "stale":bool,"hold":bool,"closed":bool,"missing":bool,
    "recent":[str],"next":[str],"blockers":[str],"owner":str|null,"due":str|null}],
  "roles":[{"role":str,"folder":str,"date":str|null,"stale":bool,"missing":bool,
    "state":str|null,"doing":[str],"next":[str]}],
  "docs":[str], "backups":[str] }
```

## 4. HTML 갱신

1. **루트 페이지**: `10_Dashboard/dashboard.html`의 마커 사이 `const DATA`·`const CFG` 두 줄을 교체 — DATA는 전 팀, CFG는 `{"brand":"ClaudeTemplate","generated":"{오늘}","isTeamPage":false,"backHref":""}`.
2. **팀 페이지** (각 팀마다): 팀 `10_Dashboard/dashboard.html`이 없거나 셸 버전이 다르면 **루트 파일을 통째로 복사**한 뒤, 마커 사이만 교체 — DATA는 `teams`에 **해당 팀 1개만**, CFG는 `{"brand":"{팀명}","generated":"{오늘}","isTeamPage":true,"backHref":"../../../10_Dashboard/dashboard.html"}`.

## 5. 마무리
- 요약 보고: 팀 수, 상태 분포, STALE/휴면 팀, 경고(handover 미작성·process 없음 — 해당 팀 조치 안내).
- 커밋을 제안한다: `docs(dashboard): HTML 갱신 {YYYY-MM-DD}`

※ `/report_root`(6단계)·`/handover_root`(마지막 단계)가 이 절차를 그대로 수행한다 — md 갱신 후 HTML 갱신 순서.
