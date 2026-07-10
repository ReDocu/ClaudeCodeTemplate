// 세션 변경 파일 — git diff --numstat HEAD(추적 변경 +/−) + 미추적(new). 드로어 "📝 변경 파일".
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const pExec = promisify(execFile);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// → [[path, addLabel, delLabel], …]  addLabel: '+N'|'new'|'bin' · delLabel: '−M'|''
export async function changedFiles(cwd, { max = 14 } = {}) {
  if (!cwd || !existsSync(join(cwd, '.git'))) return [];
  const opts = { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 };
  const [numstat, others] = await Promise.all([
    pExec('git', ['-C', cwd, 'diff', '--numstat', 'HEAD'], opts).then((r) => r.stdout).catch(() => ''),
    pExec('git', ['-C', cwd, 'ls-files', '--others', '--exclude-standard'], opts).then((r) => r.stdout).catch(() => ''),
  ]);

  const files = [];
  for (const line of numstat.split(/\r?\n/)) {
    if (!line) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const add = m[1] === '-' ? 'bin' : `+${m[1]}`;
    const del = m[2] === '-' || m[2] === '0' ? '' : `−${m[2]}`;
    files.push([esc(m[3]), add, del]);
  }
  for (const line of others.split(/\r?\n/)) {
    if (!line.trim()) continue;
    files.push([esc(line.trim()), 'new', '']);
    if (files.length >= max * 2) break;
  }
  return files.slice(0, max);
}
