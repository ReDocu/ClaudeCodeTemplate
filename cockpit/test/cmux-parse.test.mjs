// cmux 드라이버 순수 파서 검증 — 실 cmux 불필요(출력 형태는 2026-07-14 실측 고정본).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNewPane, parseTop, buildInitLine } from '../src/cmux.js';

test('parseNewPane — 실측 출력에서 surface/pane UUID 추출', () => {
  const out = 'OK surface:32 (66E196A2-295F-4B40-9803-FC654D6B65BD) pane:22 (1BBC91C0-E2D8-4C9B-A56C-3BC3D41B1475) workspace:4 (985D0B55-62F0-456D-8C36-88708B75F0FA)';
  assert.deepEqual(parseNewPane(out), {
    surfaceId: '66E196A2-295F-4B40-9803-FC654D6B65BD',
    paneId: '1BBC91C0-E2D8-4C9B-A56C-3BC3D41B1475',
  });
  assert.equal(parseNewPane('뭔가 실패'), null);
});

test('parseTop — surface ref별 셸 pid 매핑', () => {
  const tsv = [
    '0.0\t1814528\t1\tpane\tpane:22\tworkspace:4\t',
    '0.0\t1814528\t1\tsurface\tsurface:32\tpane:22\t/tmp',
    '0.0\t1814528\t1\tprocess\t49662\tsurface:32\tzsh',
    '0.0\t100\t1\tprocess\t50000\t49662\tclaude', // 셸의 자식 — surface 직속 아님
    '0.0\t2301952\t1\tsurface\tsurface:23\tpane:17\t~/x',
    '0.0\t2301952\t1\tprocess\t30545\tsurface:23\tzsh',
  ].join('\n');
  const m = parseTop(tsv);
  assert.equal(m.get('surface:32'), 49662);
  assert.equal(m.get('surface:23'), 30545);
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
