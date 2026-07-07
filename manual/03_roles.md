# 4역할 사용법 — Explorer · Educator · Critic · Advisor

> **구분**: 이 문서의 4역할은 `/pipeline`이 호출하는 **분석 에이전트**다.
> 팀 폴더 안의 **팀 작업 역할**(`01_planner` 기획 / `02_developer` 개발 / `03_package` 패키지)과는 다르다 —
> 팀 작업 역할은 사람이 세션을 여는 작업 공간이고, 분석 4역할은 명령이 호출하는 서브에이전트다.
> 팀 구조는 `manual/02_folder_rules.md` 참조.

## 역할 개요

| 역할 | 임무 | 권한 | 정의 파일 |
|---|---|---|---|
| Explorer | 코드베이스 탐색, 사실 보고 | 읽기 전용 | `.claude/agents/explorer.md` |
| Educator | 정확하고 이해하기 쉬운 설명 | 문서만 | `.claude/agents/educator.md` |
| Critic | 허점·리스크·반례 적대적 검증 + 판정 | 읽기·지적만 | `.claude/agents/critic.md` |
| Advisor | 단일 권고 + 실행 계획 | 문서만 | `.claude/agents/advisor.md` |

역할 폴더(`01_Explorer/` 등)의 CLAUDE.md는 사람이 읽는 역할 정의서이고,
`.claude/agents/*.md`는 실제로 실행되는 서브에이전트 정의다. **내용 수정 시 둘을 함께 갱신한다.**

## 파이프라인으로 쓰기 (권장)

```
/pipeline 결제 모듈의 재시도 로직이 안전한지
```

흐름: Explorer(탐색) → Educator(설명) → Critic(검증·판정) → Advisor(권고)
- Critic이 **반려**하면 지목 단계를 1회 재실행 후 재검증 (최대 1회 재순환).
- 중간 산출물은 루트 실행 시 각 역할의 `output/`에, 팀 폴더 실행 시 `./_pipeline/`에 저장.

## 개별로 쓰기

세션 중 자연어로 요청하면 해당 서브에이전트가 실행된다:
- "explorer 에이전트로 인증 흐름을 탐색해줘"
- "이 설계 문서를 critic 에이전트로 검증해줘"

## 왜 Builder(구현 역할)가 없는가
4역할은 **분석 전용**이다. 코드 수정은 팀의 `02_developer` 작업 세션이 수행한다.
분석과 구현의 주체를 분리해야 Critic의 검증이 자기 코드 감싸기로 오염되지 않는다.
