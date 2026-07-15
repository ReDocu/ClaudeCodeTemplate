#!/bin/bash
# ClaudeCockpit 더블클릭 콜드 부트 (macOS) — Windows의 ClaudeCockpit.exe 대응.
# 멱등: cmux 보장 → 서버 보장 → active 재수렴 → 기본 브라우저에 대시보드.
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 20+가 필요합니다 — https://nodejs.org"; read -r -p "[Enter로 닫기]"; exit 1; }
node cockpit/bin/cockpit.js boot || read -r -p "[boot 실패 — 위 메시지 확인 후 Enter로 닫기]"
