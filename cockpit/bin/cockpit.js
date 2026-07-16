#!/usr/bin/env node
// cockpit CLI — serve · boot (FS-3·13). 리라이트: 구 teamctl boot/locate 참고 재작성.
//   node cockpit/bin/cockpit.js serve [--port 7420]
//   node cockpit/bin/cockpit.js boot  [--port 7420]
// boot 시퀀스(FS-13): ① 멀티플렉서 보장(발견·기동은 드라이버 소관 — mux.ensureApp) — 갓 기동했고
//                       cockpit이 앱을 독점 소유하면(mux.ownsApp) ①-b 클린 슬레이트(복원분 정리)
//                    ② 서버 보장(멱등 재사용) ③ active 프로젝트 자동 재수렴(C3 — 앱 재시작 복원)
//                    ④ 기본 브라우저 오픈.
// 플랫폼 분기는 src/mux.js가 끝낸다 — 여기서 wmux/cmux를 나눠 알지 않는다(④의 URL 오픈만 OS 관심사).
import { spawn } from 'node:child_process';
import { readConfig, scanProjects } from '../src/registry.js';
import { ensureApp, name as MUX, ownsApp } from '../src/mux.js';

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

// 기존 서버 감지 — 재클릭 멱등성. 401도 alive(우리 계열 서버가 응답 중 — 새로 띄우면 EADDRINUSE만 남).
async function serverAlive(port, token) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'X-Cockpit-Token': token || '' }, signal: ctl.signal });
    clearTimeout(t);
    return res.ok || res.status === 401;
  } catch { return false; }
}

async function boot() {
  const setup = args.includes('--setup');
  console.log(`[boot] ① ${MUX} 확인/기동`);
  const w = await ensureApp({ setup });
  console.log(`[boot]    ${MUX} ${w.action === 'reused' ? '이미 실행 중 — 재사용' : `기동 완료${w.pid ? ` (pid ${w.pid})` : ''}`}`);

  // ①-b 클린 슬레이트 — boot이 앱을 **직접 기동했고** cockpit이 앱을 독점 소유할 때만(mux.ownsApp).
  // 앱이 자동 복원한 이전 세션·워크스페이스(같은 제목 중복 → 순서 따라 오바인딩)를 전부 걷어내고
  // 대시보드 선언 기준으로 재구성한다. 이미 실행 중이던 앱(reused)은 살아있는 작업일 수 있어 절대
  // 건드리지 않는다. ownsApp=false(cmux)도 제외 — 일상 터미널이라 비-cockpit 작업을 파괴한다.
  // 중복 제목 위험은 reconcile·title 매칭이 흡수.
  if (w.action === 'started' && ownsApp) {
    console.log(`[boot] ①-b ${MUX} 초기화 — 자동 복원된 이전 세션·워크스페이스 정리`);
    try {
      const { cleanSlate } = await import('../src/lifecycle.js');
      const r = await cleanSlate();
      console.log(`[boot]    복원 세션 ${r.killed}개 종료 · 워크스페이스 ${r.closed}개 닫음 — 대시보드 상태로 재구성`);
    } catch (e) { console.warn(`[boot]    초기화 실패 — ${e.message} (그대로 진행)`); }
  }

  const cfg = readConfig();
  const PORT = Number(flag('--port')) || cfg.port || 7420;
  const url = `http://127.0.0.1:${PORT}/`;

  console.log('[boot] ② 서버 확인');
  let served = false;
  if (await serverAlive(PORT, cfg.token)) {
    console.log(`[boot]    기존 서버 재사용 — ${url}`);
  } else {
    const { serve } = await import('../src/server.js');
    await serve({ port: PORT });
    served = true;
  }

  // ③ active 프로젝트 자동 재수렴(FS-13-1 ③, C3) — 멱등: 정상 상태에선 no-op(agent 수 불변).
  console.log('[boot] ③ active 프로젝트 재수렴 (멱등)');
  const { activate } = await import('../src/lifecycle.js');
  const actives = scanProjects().projects.filter((p) => p.status === 'active');
  for (const p of actives) {
    try {
      const r = await activate(p.name);
      console.log(`[boot]    ▸ ${p.name}: 스폰 ${r.spawned} · 재사용 ${r.reused}${r.failed?.length ? ` · 실패 ${r.failed.join('·')}` : ''}`);
    } catch (e) { console.warn(`[boot]    ▸ ${p.name}: 재수렴 실패 — ${e.message}`); }
  }
  if (!actives.length) console.log('[boot]    active 프로젝트 없음 — 건너뜀');

  console.log('[boot] ④ 대시보드 오픈 (기본 브라우저)');
  // URL 오픈은 멀티플렉서가 아니라 OS의 관심사 — 드라이버가 아니라 여기서 분기(server.js POST /open과 동형).
  try { spawn(process.platform === 'darwin' ? 'open' : 'explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { console.warn(`[boot]    오픈 실패(${e.message}) — 수동으로 여세요: ${url}`); }

  console.log(served
    ? '[boot] 완료 — 이 창이 서버 콘솔입니다(127.0.0.1 전용 — 방화벽 허용 불필요). 다시 클릭하면 같은 상태로 복귀합니다.'
    : '[boot] 완료 — 기존 서버를 재사용했으므로 이 창은 닫아도 됩니다.');
}

if (cmd === 'serve') {
  const { serve } = await import('../src/server.js');
  await serve({ port: Number(flag('--port')) || undefined });
} else if (cmd === 'boot') {
  await boot().catch((e) => { console.error(`[boot] 실패 — ${e.message}`); process.exitCode = 1; });
} else {
  console.log('사용법: cockpit.js serve [--port 7420] | boot [--port 7420] [--setup]');
  process.exitCode = cmd ? 1 : 0;
}
