# project_state.md — Claude Cockpit 개발 현황 스냅샷

**기준일**: 2026-07-12 (세션9 — Functional Spec v0.1 **FS-1~12 구현 완료 후 갱신**) · **작성 방식**: 문서 대조 + 실측(git·파일 인벤토리·포트 프로브)
**문서 역할 구분**: `planner.md`=제품 결정 정본(D#·F#) · `handover.md`=세션별 이력 · `doc/prd_Update_v0.1.md`=다음 계획(B/U/V·웨이브) · **본 문서 = "지금 어디까지 와 있나" 한 장** — 세션 시작 시 handover.md와 함께 읽는 현황판. 상태가 바뀌면 이 문서를 갱신한다.

---

## 1. 한 줄 상태

**대시보드가 실제 wmux에 붙어 관찰·행동(스폰/종료/점프/채택)·팀 선언 수렴(reconcile)·콜드 부트(exe 더블클릭)까지 동작하며, 세션9에서 Functional Spec v0.1 12건(FS-1~12)이 전부 구현·검증됐다** — 셸 자동 탐지(B2), 중복 판정 확장+선언 등재(B1·B4), 팀 생명주기(종료/재개·U1~U4), 역할 폴더/지침/인수인계 스캐폴드(U5·U7′·U8′), `claudeLayer` 릴리스 분리 플래그(WR). B3(ops 경로)은 신코드 라이브 E2E에서 **미재현**(구코드 서버 원인으로 수렴). 미커밋: 세션8(D16) + 세션9(PRD·명세서·구현 전체). 다음 결정 대기: 릴리스 스코프 ⓐ/ⓑ 확정, 커밋 정리.

---

## 2. 저장소 상태 (실측, 2026-07-12)

| 항목 | 값 |
|---|---|
| 현재 브랜치 | `fix/drawer-cwd-encoding-drift` @ `ed652ac` — **main·origin과 동일 커밋**(병합 완료 상태, 브랜치 정리 가능) |
| 미커밋 (세션8, D16) | `CLAUDE.md` · `planner.md` · `handover.md` · `teamctl/src/core/registry.js` |
| 미커밋 (세션9) | `doc/prd_Update_v0.1.md` · `doc/Functional_Spec_v0.1.md` · `project_state.md` · `README.md`(토큰 소모 참고사항) · **FS 구현**: `teamctl/src/core/{wmux,registry,state,plan,reconcile}.js` · `teamctl/src/server/serve.js` · `dashboard-triage.html` |
| 잔여 브랜치 | `docs/cockpit-research-brief`(@326f418) — 병합 여부 확인 후 정리 후보 |
| 서버 | 7420 **가동 중(신코드, 세션9 detached 기동)** — 이후 teamctl 수정 시 재시작 필수 |
| exe 바이너리 | `ClaudeCockpit.exe` **커밋됨**(4b0710b) — handover §9 0-3 "커밋 여부 미결"은 해소 |

**실동작 산출물(루트)**: `dashboard-triage.html`(817줄 단일 파일) · `teamctl/`(src 19개 모듈, npm 의존성 0) · `ClaudeCockpit.exe`·`start.cmd`·`launcher/` · `root/`(팀 선언, gitignore).

---

## 3. 기능 인벤토리 — 구현·검증 상태

✅ 라이브 검증 / ◐ 프로브만(라이브 미검증 또는 실사용 문제 보고) / ⚠️ 기록 불일치

| 기능 | 상태 | 검증 근거 | 위치 |
|---|---|---|---|
| 트리아지 대시보드 UI (T0 안전·접근성 포함) | ✅ | jsdom 20/20 + 브라우저 패널 실렌더 | `dashboard-triage.html` |
| 브리지 API 13종 (state·session·attach·spawn·kill·send·claude·refresh·usage·open·handover·up·boot) | ✅ | 세션별 HTTP 프로브 다수 | `teamctl/src/server/serve.js` |
| 커넥터 스캐너 (git/env/node/ports, 논블로킹 캐시) | ✅ | 8/8·6/6, `:3000` 자동 팀 귀속 실증 | `teamctl/src/connectors/` |
| 세션 상세 드로어 (트랜스크립트 tail + git diff) | ✅ | 세션3 브라우저 시각 검증 + 실버그 2건 수정 | `teamctl/src/live/` |
| 선언적 팀 운영 (root/ 선언 → reconcile → plan/drift) | ✅ | 세션4 E2E — 닫힌 워크스페이스 자동 재생성 실증 | `core/{registry,reconcile,plan}.js` |
| 콜드 부트 F12 (exe → wmux 보장 → 서버 → reconcile → 기본 브라우저) | ✅ | 세션4·6 E2E. **잔여**: wmux 완전 종료 상태에서의 스폰 경로 1개 미확인 | `core/boot.js` · `launcher/` |
| wmux 설치 자동 발견 F12b (`boot --setup`, 후보 글롭·프롬프트) | ⚠️ | **구현·커밋돼 있으나**(locate.js, boot 통합 확인) handover엔 "구현 대기"로 남음 — 검증 기록 부재, 문서 불일치 | `core/locate.js` |
| F13 ops 디폴트 역할 (`role.cwd`·스캐폴드·시크릿 gitignore) | ◐ | 프로브 17/17(dryRun까지). **라이브에서 경로 버그 보고** → PRD **B3** | `core/{registry,reconcile,state}.js` |
| 세션 상태 3분류 (terminal/ready/working, 트랜스크립트 활동 기준) | ✅ | 세션6 프로브+HTTP+렌더 (working 라이브 분기만 자연 확인 대기) | `live/transcript.js` · `core/state.js` |
| usage 배지 + 5h 한도 학습 | ✅ | 세션6 — 한도 학습·콜드 스타트 왜곡 수정 포함 | `live/usage.js` |
| 중복 세션 채택 adopt (spawn/reconcile/claude 3경로) | ◐ | 프로브 14/14 + stale 캐시 실버그 수정. **실사용 중복 재발 보고** → PRD **B1** | `core/{wmux,reconcile,plan}.js` · `serve.js` |
| 단체 핸드오버 파이프라인 (전 세션 handover.md 갱신 → /exit) | ⚠️ | 구현·커밋(68dbde9)이나 handover.md에 검증 세션 기록 없음 | `core/handover.js` |
| D16 root/ 팀 격리 (CLAUDE.md 무효화·git init·gitignore 스캐폴드) | ◐ | 세션8 프로브 10/10. **미커밋** + 기존 팀 소급·실사용 확인 잔여 → PRD **B5** | `core/registry.js` (미커밋) |
| UX 부속 (폴더/원격 URL 열기, adopted/already 안내) | ✅ | 세션5·7 모듈+HTTP+렌더 | `serve.js` · 대시보드 |
| **[세션9] 셸 자동 탐지** (pwsh→powershell→cmd, config 캐시) — FS-1 | ✅ | Phase A 프로브 + 라이브 스폰. ⚠️ 즉사 감지는 wmux 한계로 불가(명세서 §7) | `core/wmux.js resolveShell` |
| **[세션9] 중복 판정 확장** (label+binding 2경로, checked 로그) — FS-3 | ✅ | 라이브 — 재스폰 adopted·agent 수 불변·binding 엣지 | `serve.js /spawn` |
| **[세션9] 스폰→선언 등재** (`declare` 기본 on, `/declare` add/remove, 배지) — FS-4 | ✅ | 라이브 — team.json 등재→drift 해소 | `registry.js declareRole` · `serve.js` |
| **[세션9] 팀 생명주기** (status·createdAt·closedAt·백필·종료/재개·closed 게이트·종료 UI) — FS-5~8 | ✅ | Phase A+B + DOM — close→409→reopen 왕복, 종료 섹션 렌더 | `registry.js` · `reconcile.js` · `serve.js` · 대시보드 |
| **[세션9] 역할 폴더/지침/인수인계 스캐폴드** — FS-9~11 | ✅ | 프로브 — 멱등·시크릿 4규칙·CLAUDE.md 불변 | `registry.js scaffoldRoleDir/Doc/Handover` |
| **[세션9] `claudeLayer` 릴리스 분리 플래그** — FS-12 | ✅ | off 서버 매트릭스(404·git-only·상태 축소·meta) + on 회귀 | `serve.js` · `state.js` · `reconcile.js` · 대시보드 |

**미구현(설계만 존재)**: 기능 인벤토리 스캐너(D9) · MCP 5소스 스캔(D15) · optional 커넥터(supabase/github/docker) · expectedPorts down 판정 · 인수인계 inbox/accept(M2) — 전부 planner.md에 설계 완결, 코드 0. D9는 PRD §2에서 claude 레이어로 강등됨.

---

## 4. 버그 현황 (세션9 구현 반영, 상세 = `doc/Functional_Spec_v0.1.md` §7)

| # | 요약 | 세션9 후 상태 |
|---|---|---|
| B1 | 세션 중복 재발 | **판정 확장 구현**(binding 엣지 봉합 + `checked` 로그) — 실사용 재발 시 응답 로그로 즉시 원인 특정 가능. 실사용 관찰 대기 |
| B2 | 터미널 스폰 안 됨 | **예방 구현**(셸 자동 탐지+config) — 단 즉사 표면화는 wmux 0.13.0이 실패를 마스킹해 원리적 불가(실측). 실사용 확인 대기 |
| B3 | ops 경로 오염 | **신코드 라이브 E2E 미재현** — cwd=ops·role-cwd·pin 무오염 전부 통과. 원인은 구코드 서버로 수렴. 진단 계측(cwd 태그) 상시 탑재 |
| B4 | 스폰이 선언에 미반영 | **구현 완료** — 기본 등재+복원 계약 라이브 검증 |
| B5 | root/ 격리 | 세션8 구현 — 기존 팀 소급(`scaffoldIsolation` 수동) + 실사용 확인 잔여 |

---

## 5. 이번 실측에서 발견한 특이사항 (문서에 없던 것)

1. **F12b 문서 불일치** — `core/locate.js`(wmux 자동 발견)가 구현·커밋·boot 통합돼 있는데 handover §9 0-1은 "구현 대기". 검증 기록도 없음 → 다음 세션에서 handover 갱신 + 검증 여부 확인 필요.
2. **root/ 잔여 빈 폴더** — `_TmpE2E`·`_TmpProbe`·`_TmpUITest`(프로브 뒷정리에서 폴더만 남음)와 `CharCollector[Reality]`·`.manager`가 **전부 빈 폴더**(team.json 없음 → reconcile 스캔 대상 아님). `_Tmp*` 3개는 삭제 후보. CharCollector는 사용자 의도 확인 후 처리(실 프로젝트 선언이 유실된 것인지).
3. **브랜치 상태** — 작업 브랜치·main·origin이 전부 같은 커밋(ed652ac). 세션8 커밋 시 브랜치 전략(main 직행 vs 새 브랜치) 결정 필요.

---

## 6. 다음 작업 (세션9 이후)

~~W0 버그 → W1 생명주기 → W2 프로비저닝 → WR 플래그~~ ✅ **전부 구현 완료(세션9, FS-1~12)**. 남은 것:

1. **실사용 확인** — 대시보드 일상 사용에서 B1(중복)·B2(터미널) 재발 여부 관찰. 재발 시 `/spawn` 응답의 `checked` 로그·드로어 cwd 태그를 그대로 첨부하면 즉시 원인 특정 가능.
2. **커밋 정리** — 세션8(D16) + 세션9(PRD·명세서·FS 구현) 미커밋 분량. 브랜치 전략 결정(main 직행 vs 새 브랜치).
3. **결정 대기 소화(§7)** — 릴리스 스코프 ⓐ/ⓑ 확정 → ⓑ면 레이어 삭제로 격상, ⓐ면 배포 채널 결정 시 기본값 off 패키징.
4. **W3 탐색** — V2(사용성 평가 최소 지표 셋). V1·V3은 dev 백로그 유지.
5. 병행 잡무: handover.md F12b 항목 갱신(세션9에서 완료) · `_Tmp*` 빈 폴더 삭제 · wmux 완전 종료 콜드 부트 1경로 확인 · 잔여 브랜치 정리 · B5 소급.

**규율 유지** (PRD §2.3): 신규 코어 기능은 claude 레이어 의존 금지 — 세션9부터 코드에 강제됨(레이어 모듈은 전부 동적 import 게이트 뒤).

---

## 7. 결정 대기 (사용자 몫)

1. **릴리스 스코프 적용 범위** — claude 기능 제외가 ⓐ 배포판 한정(dev는 플래그로 유지, 현재 문서 가정) vs ⓑ 제품 전체 제거. → PRD §8-⑥
2. PRD 오픈 퀘스천 §8-①~⑤: status 저장 위치 · 역할 폴더 규약 · 스폰 시 선언 등재 기본값 · 종료 시 일괄 kill 제안 포함 여부 · 분리 기전(권고 (a) 플래그).
3. CharCollector[Reality] 빈 폴더 처리 방침.

---

## 8. 빠른 시작 / 검증 (요약)

- **시작**: `ClaudeCockpit.exe` 더블클릭(멱등) — wmux 보장 → 서버(7420) → reconcile → 기본 브라우저 대시보드. 첫 실행 wmux 위치 설정은 `teamctl boot --setup`.
- **teamctl 수정 후엔 서버 재시작 필수**(떠 있는 서버는 구코드) — 절차는 `CLAUDE.md` 명령 절.
- **검증 컨벤션**: `node --check` 전 수정 파일 + 스크래치패드 일회성 라이브 프로브(스폰 kill·`_Tmp*` 삭제·config 원복 뒷정리 필수). 상세는 `CLAUDE.md`.
