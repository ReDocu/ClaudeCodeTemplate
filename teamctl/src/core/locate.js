// wmux 설치 자동 발견 (F12b, handover §13-G①) — "묻기 전에 찾는다".
// 후보 = 설치 루트 폴더. 유효 조건: <root>/wmux.exe 존재. CLI는 <root>/resources/cli/wmux.js 고정 배치.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const EXE = process.platform === 'win32' ? 'wmux.exe' : 'wmux';

export const binFromRoot = (root) => join(root, EXE);
export const cliFromRoot = (root) => join(root, 'resources', 'cli', 'wmux.js');
export const cliFromBin = (bin) => cliFromRoot(dirname(resolve(bin)));
// WMUX_CLI(<root>/resources/cli/wmux.js) → 설치 루트 역산
export const rootFromCli = (cli) => dirname(dirname(dirname(resolve(cli))));

const isRoot = (root) => existsSync(binFromRoot(root));

// dir 바로 아래 wmux* 폴더 중 유효 루트 — 버전 폴더명이 바뀌어도 자기치유. 이름 역순(신 버전 우선).
function globRoots(dir) {
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => /^wmux/i.test(n)).sort().reverse()
    .map((n) => join(dir, n)).filter(isRoot);
}

// 발견 순서 = 신뢰도: ① WMUX_CLI 역산 ② config wmuxBin(깨졌으면 형제 폴더 글롭)
// ③ %LOCALAPPDATA%\Programs ④ 각 드라이브 Program Files(+x86). 중복 제거.
export function discoverRoots({ wmuxBin } = {}) {
  const out = [];
  const push = (root) => { if (root && isRoot(root) && !out.includes(root)) out.push(root); };

  if (process.env.WMUX_CLI) push(rootFromCli(process.env.WMUX_CLI));
  if (wmuxBin) {
    const bin = resolve(wmuxBin);
    push(dirname(bin));
    for (const r of globRoots(dirname(dirname(bin)))) push(r);
  }
  if (process.env.LOCALAPPDATA) for (const r of globRoots(join(process.env.LOCALAPPDATA, 'Programs'))) push(r);
  if (process.platform === 'win32') {
    for (let c = 67; c <= 90; c++) { // C: ~ Z:
      const drive = `${String.fromCharCode(c)}:\\`;
      if (!existsSync(drive)) continue;
      for (const pf of ['Program Files', 'Program Files (x86)'])
        for (const r of globRoots(join(drive, pf))) push(r);
    }
  }
  return out;
}

// 콘솔 프롬프트 — 자동 발견 0건(최후 수단) 또는 boot --setup(강제) + TTY일 때만(boot가 보장).
// candidates(자동 발견 후보)는 번호로 선택 가능, 직접 경로 입력도 허용. 따옴표 제거,
// 폴더 입력 시 wmux.exe 자동 결합, s=건너뛰기, 3회 재시도. 실패/건너뛰기 = null.
export async function promptForRoot({ candidates = [], current } = {}) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (current) console.log(`  현재 설정: ${current}`);
    candidates.forEach((r, i) => console.log(`  [${i + 1}] ${binFromRoot(r)}`));
    const hint = candidates.length ? `번호(1-${candidates.length}), ` : '';
    for (let i = 3; i > 0; i--) {
      const raw = (await rl.question(`wmux 위치 — ${hint}설치 폴더 또는 ${EXE} 경로 (s=건너뛰기): `))
        .trim().replace(/^["']|["']$/g, '');
      if (raw.toLowerCase() === 's') return null;
      if (/^\d+$/.test(raw) && Number(raw) >= 1 && Number(raw) <= candidates.length)
        return candidates[Number(raw) - 1];
      if (raw) {
        const p = resolve(raw);
        const root = p.toLowerCase().endsWith(EXE) ? dirname(p) : p;
        if (isRoot(root)) return root;
        console.error(`  ✗ ${binFromRoot(root)} 가 없습니다 (남은 시도 ${i - 1}회)`);
      }
    }
    return null;
  } finally { rl.close(); }
}
