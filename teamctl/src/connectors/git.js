// git 커넥터 — 브랜치 + dirty + ahead/behind. detect=.git 존재. (Tech.md §9.2)
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './run.js';

export async function gitProbe(cwd) {
  if (!cwd || !existsSync(join(cwd, '.git'))) return null; // detect: 파일 기반
  let out;
  try { out = await git(cwd, ['status', '--porcelain=v2', '--branch']); }
  catch { return { k: 'git', v: 'git 오류', st: 'warn', opt: true }; }

  let branch = '?', ahead = 0, behind = 0, upstream = false, detached = false, dirty = 0;
  for (const line of out.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('# branch.head ')) {
      branch = line.slice(14).trim();
      if (branch === '(detached)') detached = true;
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = true;
    } else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) { ahead = +m[1]; behind = +m[2]; }
    } else if (/^[12u?] /.test(line)) {
      dirty++; // 변경/미추적 엔트리
    }
  }

  const ab = (ahead || behind) ? ` ↑${ahead}↓${behind}` : '';
  const dirtyLabel = dirty ? `${dirty} dirty` : 'clean';
  const noUp = !detached && !upstream ? ' ·no-upstream' : '';
  const st = (detached || (!upstream && !detached)) ? 'warn' : 'ok';
  return { k: 'git', v: `${branch} ·${dirtyLabel}${ab}${noUp}`, st, opt: true };
}
