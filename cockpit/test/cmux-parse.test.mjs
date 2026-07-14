// cmux 드라이버 순수 파서 검증 — 실 cmux 불필요(출력 형태는 2026-07-14 실측 고정본).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewPane, parseTop, buildInitLine } from '../src/cmux.js';
import { parsePs } from '../src/proc.js';

test('parseNewPane — 실측 출력에서 surface/pane UUID 추출', () => {
  const out = 'OK surface:32 (66E196A2-295F-4B40-9803-FC654D6B65BD) pane:22 (1BBC91C0-E2D8-4C9B-A56C-3BC3D41B1475) workspace:4 (985D0B55-62F0-456D-8C36-88708B75F0FA)';
  assert.deepEqual(parseNewPane(out), {
    surfaceId: '66E196A2-295F-4B40-9803-FC654D6B65BD',
    paneId: '1BBC91C0-E2D8-4C9B-A56C-3BC3D41B1475',
  });
  assert.equal(parseNewPane('뭔가 실패'), null);
});

test('parseTop — surface ref별 대표 pid (claude > 셸 > 첫 행)', () => {
  const tsv = [
    '0.0\t1814528\t1\tpane\tpane:22\tworkspace:4\t',
    '0.0\t1814528\t1\tsurface\tsurface:32\tpane:22\t/tmp',
    '0.0\t1814528\t1\tprocess\t49662\tsurface:32\tzsh',
    '0.0\t100\t1\tprocess\t50000\t49662\tclaude', // 셸의 자식 행 — surface 직속 아님(무시)
    // claude 세션 실측 형태: 직속 형제로 caffeinate·claude.exe·zsh가 나열
    '0.0\t2301952\t1\tsurface\tsurface:24\tpane:18\t제목',
    '0.0\t2301952\t1\tprocess\t61029\tsurface:24\tcaffeinate',
    '0.0\t2301952\t1\tprocess\t37295\tsurface:24\tclaude.exe',
    '0.0\t2301952\t1\tprocess\t36971\tsurface:24\tzsh',
    // 데몬(tty 없음)이 첫 행인 경우 — 셸을 골라야 함
    '0.0\t2301952\t1\tsurface\tsurface:21\tpane:15\t제목2',
    '0.0\t2301952\t1\tprocess\t58884\tsurface:21\tadb',
    '0.0\t2301952\t1\tprocess\t77777\tsurface:21\tbash',
  ].join('\n');
  const m = parseTop(tsv);
  assert.equal(m.get('surface:32'), 49662); // 셸뿐 — 셸
  assert.equal(m.get('surface:24'), 37295); // claude 우선
  assert.equal(m.get('surface:21'), 77777); // 데몬보다 셸
});

test('parsePs — ps -axo pid,ppid,tty,args 해석 (tty 세션 그룹 포함)', () => {
  const txt = [
    '  100     1 ttys003  -/bin/zsh',                   // 로그인 셸 '-' 접두어
    '49662   100 ttys003  /usr/local/bin/node /x/@anthropic-ai/claude-code/cli.js',
    '  200     1 ttys003  /usr/local/bin/claude --resume abc', // 셸의 자손 아님(형제) — cmux pty 실측 형태
    '  300     1 ??       /usr/libexec/launchd_helper',
  ].join('\n');
  const { procs, kids, ttys } = parsePs(txt);
  assert.equal(procs.get(100).name, 'zsh');            // '-' 제거 + basename
  assert.equal(procs.get(200).name, 'claude');         // comm 16자 절단 회피 — args 첫 토큰에서
  assert.match(procs.get(49662).cmd, /claude-code/);
  assert.deepEqual(kids.get(100), [49662]);
  assert.deepEqual(ttys.get('ttys003'), [100, 49662, 200]); // 같은 pty = 같은 세션
  assert.equal(procs.get(300).tty, null);              // tty 없음(??)은 세션 그룹 제외
});

test('buildInitLine — cd + env export + 셸 cmd 생략', () => {
  assert.equal(
    buildInitLine({ cwd: "/a/b's", cmd: 'bash', env: { COCKPIT_PROJECT: 'p', COCKPIT_ROLE: 'ops' } }),
    "cd '/a/b'\\''s' && export COCKPIT_PROJECT='p' COCKPIT_ROLE='ops'",
  );
  // 셸이 아닌 cmd는 이어서 실행
  assert.equal(buildInitLine({ cwd: '/a', cmd: 'claude' }), "cd '/a' && claude");
  // bare 셸(bash/zsh/…)은 생략 — 새 surface가 이미 셸이므로 중첩 방지
  assert.equal(buildInitLine({ cwd: '/a', cmd: 'zsh' }), "cd '/a'");
});
