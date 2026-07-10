// 커넥터 공용 exec 헬퍼 — execFile(셸 미경유, 인젝션 차단). Node 내장만.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExec = promisify(execFile);

export async function git(cwd, args) {
  const { stdout } = await pExec('git', ['-C', cwd, ...args], {
    windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 8000,
  });
  return stdout;
}

// PowerShell 1회 실행 → stdout(JSON 문자열 기대). -NoProfile로 프로필 로드 회피(속도).
export async function pwsh(script) {
  const { stdout } = await pExec('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 12000,
  });
  return stdout;
}
