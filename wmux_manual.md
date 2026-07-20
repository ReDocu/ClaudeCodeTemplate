# wmux 매뉴얼

> 출처: https://wmux.org/docs
> Windows용 터미널 멀티플렉서 + AI 에이전트 통합 데스크톱 앱

---

## 1. wmux란?

wmux는 **Windows 데스크톱 애플리케이션**으로 동작하는 터미널 멀티플렉서이며, AI 에이전트 통합이 핵심 기능입니다. 하나의 창 안에서 여러 터미널을 세로 탭과 패널 분할로 조직화하여 동시에 운영할 수 있습니다. 특히 **여러 Claude Code 에이전트를 병렬 실행하고 실시간으로 모니터링**하도록 설계되었습니다.

### 해결하는 문제

Windows에서 여러 AI 에이전트를 돌릴 때 발생하는 워크플로 분산 문제를 해결합니다. 흩어진 터미널 창을 관리하는 대신, 작업 공간을 통합하고 알림을 일원화하며, 에이전트 활동을 시각화하는 내장 브라우저를 제공합니다.

---

## 2. 주요 기능

| 기능 | 설명 |
|------|------|
| **워크스페이스 조직화** | 프로젝트별 컨테이너. git 브랜치, 디렉터리, 활성 포트, GitHub PR 상태, 알림 배지 표시 |
| **패널 분할** | 수평(Ctrl+D)·수직(Ctrl+Shift+D) 분할로 여러 터미널 동시 표시 |
| **서피스(탭)** | 패널당 여러 터미널, 탭 전환(Ctrl+Tab) |
| **통합 브라우저** | Chromium 기반. chrome-devtools-mcp 프로토콜로 에이전트 활동 표시 |
| **실시간 사이드바** | 활성 워크스페이스와 메타데이터(git 상태, 작업 디렉터리, 열린 포트, 미읽음 알림) 표시 |
| **Claude Code 통합** | 수동 설정 없이 자동 감지·구성. 훅으로 세션 전반의 에이전트 활동 모니터링 |

---

## 3. 설치

1. GitHub 릴리스에서 `wmux-X.Y.Z-win-x64.zip` 다운로드
2. 원하는 위치에 압축 해제 (권장: `C:\Users\[사용자명]\wmux`)
3. "Mark of the Web" 제한 제거:
   - PowerShell에서 `Get-ChildItem -Recurse | Unblock-File` 실행, 또는
   - 압축 해제 전에 속성에서 차단 해제 체크박스 해제
4. `wmux.exe` 실행 후 Windows SmartScreen 경고 승인

> 별도 설치 파일 불필요 — 포터블 아카이브 배포 방식. 자동 업데이트 및 알림 지원.

---

## 4. 키보드 단축키

| 단축키 | 동작 |
|--------|------|
| `Ctrl+T` | 현재 패널에 새 탭 |
| `Ctrl+D` | 수평 분할 |
| `Ctrl+Shift+D` | 수직 분할 |
| `Ctrl+W` | 현재 탭 닫기 |
| `Ctrl+Tab` | 다음 탭 |
| `Ctrl+N` | 새 워크스페이스 |
| `Ctrl+1~9` | 워크스페이스 전환 |
| `Ctrl+Shift+P` | 명령 팔레트 |
| `Ctrl+Shift+B` | 브라우저 토글 |
| `F11` | 전체 화면 |
| `Ctrl+,` | 설정 |

---

## 5. CLI 명령어

```bash
wmux new-workspace --title "name" --cwd "path"   # 새 워크스페이스 생성
wmux split --down                                 # 패널 분할
wmux send "command"                               # 명령 전송
wmux list-workspaces                              # 워크스페이스 목록
wmux browser open https://url                     # 브라우저 열기
wmux notify "message"                             # 알림 전송
wmux tree                                          # 구조 트리 표시
```

---

## 6. 핵심 개념

- **워크스페이스(Workspace)** — 터미널과 콘텐츠를 담는 프로젝트 단위 컨테이너
- **패널(Pane)** — 터미널·브라우저·마크다운을 표시하는 시각 블록
- **서피스(Surface)** — 패널 내 탭, 개별 터미널을 담음
- **사이드바(Sidebar)** — 워크스페이스 목록과 실시간 메타데이터를 표시하는 좌측 패널

---

## 7. 설정 및 부가 기능

- **셸 통합**: PowerShell·Bash·cmd.exe 자동 주입. 브랜치 감지, 변경(dirty) 상태, 디렉터리 추적, 포트 표시 지원
- **환경 변수**: 터미널 세션에서 `WMUX`, `WMUX_SURFACE_ID`, `WMUX_PIPE`, `WMUX_CLI` 사용 가능
- **테마**: 450+ Ghostty 프리셋 + Windows Terminal 임포트 (`wmux config import-wt`)
- **세션 관리**: 30초마다 자동 저장, 수동 저장은 `wmux session save "name"`
- **알림**: 시각(파란 패널 링), 사이드바 배지, 작업 표시줄 아이콘 깜빡임, Windows 토스트, 선택적 오디오 알림
- **명명 파이프**: `\\.\pipe\wmux` 로 외부 도구 연동

---

## 8. wmux-orchestrator 플러그인

번들로 제공되는 플러그인으로, 복잡한 작업을 위해 여러 Claude Code 에이전트를 조율합니다. 코드베이스를 분석하고 작업을 하위 작업으로 분해하며, 전용 패널에서 병렬 실행을 관리합니다.

```bash
/wmux-orchestrator:orchestrate "task description"
```

---

## 9. 라이선스 및 플랫폼

- **라이선스**: AGPL-3.0 오픈소스
- **플랫폼**: Windows 전용 (macOS/Linux 미지원)
- **macOS 대응**: cmux가 macOS 버전에 해당

---

## 10. 자주 발생하는 문제 & 해결

| 문제 | 해결 |
|------|------|
| 모듈 로딩 실패 | 압축 해제 후 파일 차단 해제(Unblock) |
| 단축키 충돌 | 백신·생산성 소프트웨어 간섭 확인 |
| Claude Code 미인식 | `WMUX` 환경 변수 및 `~/.claude/CLAUDE.md` 주입 확인 |
| 브라우저 성능 저하 | 설정에서 GPU 가속 활성화 |
