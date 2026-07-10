// env 커넥터 — .env* 키 존재/누락. 🔴 값은 절대 읽지 않음(키 이름만). (Tech.md §9.2)
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// KEY=... 에서 KEY만 추출(값 무시). 주석/빈줄 제외.
function keysOf(file) {
  const keys = new Set();
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return keys; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) keys.add(m[1]); // 값은 참조조차 안 함
  }
  return keys;
}

export async function envProbe(cwd) {
  if (!cwd || !existsSync(cwd)) return null;
  let names = [];
  try { names = readdirSync(cwd).filter((n) => /^\.env(\.|$)/.test(n)); } catch { return null; }
  if (!names.length) return null; // detect: .env* 없으면 커넥터 미표시

  const isExample = (n) => /\.(example|sample|template)$/i.test(n);
  const actual = names.filter((n) => !isExample(n));
  const exampleFile = names.find(isExample);

  const keys = new Set();
  for (const n of actual) for (const k of keysOf(join(cwd, n))) keys.add(k);

  // .env.example만 있고 실제 .env 없음 → 미설정 경고
  if (!actual.length && exampleFile) {
    const ex = keysOf(join(cwd, exampleFile));
    return { k: 'env', v: `example only ·${ex.size} keys`, st: 'warn' };
  }

  let missing = 0;
  if (exampleFile) {
    const ex = keysOf(join(cwd, exampleFile));
    for (const k of ex) if (!keys.has(k)) missing++;
  }
  const miss = missing ? ` ·${missing} missing` : '';
  return { k: 'env', v: `${keys.size} keys${miss}`, st: missing ? 'warn' : 'ok' };
}
