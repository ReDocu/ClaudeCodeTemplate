// node 커넥터 — package.json → 의존성 설치 상태·패키지 매니저. (Tech.md §9.2)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCKS = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'], ['package-lock.json', 'npm'],
];

export async function nodeProbe(cwd) {
  if (!cwd) return null;
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return null; // detect: package.json 없으면 미표시

  let deps = 0;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    deps = Object.keys(pkg.dependencies || {}).length + Object.keys(pkg.devDependencies || {}).length;
  } catch { return { k: 'node', v: 'package.json 파싱 오류', st: 'warn' }; }

  const mgr = (LOCKS.find(([f]) => existsSync(join(cwd, f))) || [null, ''])[1];
  const installed = existsSync(join(cwd, 'node_modules'));

  if (deps > 0 && !installed) {
    return { k: 'node', v: `needs install ·${deps} deps${mgr ? ' ·' + mgr : ''}`, st: 'warn' };
  }
  const tail = mgr ? ` ·${mgr}` : '';
  return { k: 'node', v: `${deps} deps${installed ? ' ·ok' : ''}${tail}`, st: 'ok' };
}
