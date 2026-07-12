#!/usr/bin/env node
// teamctl CLI 진입점. serve(컨트롤 브리지 D14) · up(폴더→wmux reconcile).
import { serve } from '../src/server/serve.js';

const argv = process.argv.slice(2);
const cmd = argv[0] || 'serve';
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const port = flag('--port') ? Number(flag('--port')) : undefined;
const USAGE = 'usage: teamctl serve [--port 7420]  |  teamctl up [--team <id>] [--dry]  |  teamctl boot [--port 7420] [--setup] [--panel] [--clean]  |  teamctl cleanup [--dry]';

if (cmd === 'serve') {
  serve({ port }).catch((e) => {
    console.error('[teamctl] 서버 시작 실패:', e.message);
    process.exit(1);
  });
} else if (cmd === 'up') {
  // 폴더 선언대로 wmux를 수렴 (멱등). 서버 없이도 실행 — "실행파일" 콜드 부트의 코어.
  const { reconcile } = await import('../src/core/reconcile.js');
  const r = await reconcile({ team: flag('--team'), dryRun: argv.includes('--dry') });
  for (const t of r.teams) {
    console.log(`▸ ${t.name}  [ws ${t.ws.action}${t.ws.id ? ' ' + t.ws.id : ''}]`);
    for (const role of t.roles) console.log(`    ${role.id}: ${role.action}${role.agentId ? ' ' + role.agentId : ''}`);
  }
  if (r.drift.length) console.log(`⚠ drift ${r.drift.length}: ${r.drift.map((d) => d.role).join(', ')} (폴더에 없음 — 표시만)`);
  console.log(`${r.dryRun ? '[dry-run] ' : ''}변경 ${r.changed}건${r.changed === 0 ? ' — 이미 동기화됨 (멱등 ✓)' : ''}`);
} else if (cmd === 'boot') {
  // F12 콜드 부트 — wmux 보장 → 서버 보장(없으면 이 프로세스가 서버) → reconcile → 대시보드 오픈.
  // --setup: wmux 경로 설정 프롬프트를 강제로 띄움(자동 발견을 건너뛰고 직접 선택/입력).
  // --panel: 대시보드를 기본 브라우저 대신 wmux 브라우저 패널에 연다(구 동작).
  // --clean: reconcile 전에 root/ 선언에 없는 워크스페이스·세션 종료(config.cleanOnBoot로도 켤 수 있음).
  const { boot } = await import('../src/core/boot.js');
  await boot({ port, setup: argv.includes('--setup'), panel: argv.includes('--panel'), clean: argv.includes('--clean') }).catch((e) => {
    console.error('[teamctl] 콜드 부트 실패:', e.message);
    process.exit(1);
  });
} else if (cmd === 'cleanup') {
  // 선언 밖 정리 — root/ 선언에 연결되지 않은 wmux 워크스페이스와 안의 세션을 종료(옵트인 전용).
  const { cleanup } = await import('../src/core/cleanup.js');
  const r = await cleanup({ dryRun: argv.includes('--dry') }).catch((e) => {
    console.error('[teamctl] cleanup 실패:', e.message);
    process.exit(1);
  });
  for (const w of r.closed) {
    console.log(`✕ ${w.title || w.id}  [${w.action}]  세션 ${w.agents.length}개${w.agents.length ? ` (${w.agents.map((a) => a.label || a.agentId).join(', ')})` : ''}`);
  }
  for (const w of r.kept) console.log(`· 유지 ${w.title || w.id} — ${w.reason}`);
  if (r.errors.length) console.log(`⚠ 오류 ${r.errors.length}건: ${r.errors.map((e) => e.error).join(' / ')}`);
  console.log(`${r.dryRun ? '[dry-run] ' : ''}닫음 ${r.closed.length}개 · 유지 ${r.kept.length}개`);
} else if (cmd === 'help' || cmd === '--help') {
  console.log(USAGE);
} else {
  console.error(`알 수 없는 명령: ${cmd}\n${USAGE}`);
  process.exit(1);
}
