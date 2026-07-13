// 프로젝트 git 원격 실측 — remote.origin.url → 브라우저로 열 수 있는 https URL 정규화 + 현재 브랜치.
// 논블로킹 캐시(dir별 TTL·single-flight, §9-⑥) — /api/state 응답을 절대 막지 않는다(콜드는 null 반환,
// 다음 폴링에 채워짐). git 미설치·비저장소·원격 없음은 전부 관용 처리(해당 필드 null).
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TTL = 30_000;
const cache = new Map(); // dir → { at, info, inflight }

// ssh·git·https 원격을 https 웹 URL로. 못 바꾸면 null(대시보드는 '로컬 전용'으로 표시).
export function remoteToWeb(remote) {
  if (!remote) return null;
  const u = remote.trim().replace(/\.git$/i, '');
  let m;
  if ((m = u.match(/^git@([^:]+):(.+)$/))) return `https://${m[1]}/${m[2]}`;                        // git@host:owner/repo
  if ((m = u.match(/^ssh:\/\/(?:[^@]+@)?([^/:]+)(?::\d+)?\/(.+)$/))) return `https://${m[1]}/${m[2]}`; // ssh://[user@]host[:port]/owner/repo
  if (/^https?:\/\//i.test(u)) return u;                                                            // 이미 http(s)
  return null;
}

function probe(dir) {
  return new Promise((resolveP) => {
    const opt = { cwd: dir, timeout: 4000, windowsHide: true };
    execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opt, (e1, bOut) => {
      execFile('git', ['config', '--get', 'remote.origin.url'], opt, (e2, rOut) => {
        const branch = e1 ? null : (String(bOut).trim() || null);
        const remote = e2 ? null : (String(rOut).trim() || null);
        resolveP({ branch, remote, web: remoteToWeb(remote) });
      });
    });
  });
}

function refresh(dir) {
  const entry = cache.get(dir) || {};
  if (entry.inflight) return entry.inflight;
  entry.inflight = probe(dir)
    .then((info) => { cache.set(dir, { at: Date.now(), info, inflight: null }); return info; })
    .catch(() => { cache.set(dir, { at: Date.now(), info: null, inflight: null }); return null; });
  cache.set(dir, entry);
  return entry.inflight;
}

// 논블로킹 — 콜드/만료면 백그라운드 갱신만 트리거하고 캐시(또는 null) 즉시 반환.
export function getGit(dir) {
  if (!dir) return null;
  const entry = cache.get(dir);
  if (!entry || Date.now() - entry.at >= TTL) { if (!entry || !entry.inflight) refresh(dir).catch(() => {}); }
  return (entry && entry.info) || null;
}

// git 명령(비대화·타임아웃) — 자격증명/SSH 프롬프트로 서버가 멈추지 않도록 강제(BatchMode).
const NOPROMPT = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=accept-new' };
function run(args, opts = {}) {
  return new Promise((resolveP, rejectP) => {
    execFile('git', args, { windowsHide: true, timeout: 4000, maxBuffer: 16 * 1024 * 1024, ...opts }, (e, out, stderr) => {
      if (e) return rejectP(new Error(String(stderr || '').trim() || e.message));
      resolveP(String(out));
    });
  });
}
// ops가 비어있거나 cockpit 스켈레톤(CLAUDE.md만)뿐인가 — clone 전 백업 여부 판단.
function isSkeletonOnly(dir) {
  let e; try { e = readdirSync(dir); } catch { return true; }
  return e.length === 0 || (e.length === 1 && e[0] === 'CLAUDE.md');
}

// 원격 연결 + main을 opsDir로 clone (POST /git-remote). 설계: ops = 저장소. 사용자 선택: 백업 후 진행.
//   · opsDir이 이미 저장소면 재-clone 없이 origin 갱신 + fetch(로컬 작업 보존).
//   · 아니면 스켈레톤은 지우고, 실내용이면 ops_bak_<stamp>로 백업 → git clone. 실패 시 백업 복원(손실 0).
export async function connectRemote(opsDir, url, stamp = Date.now()) {
  if (existsSync(join(opsDir, '.git'))) {
    await run(['remote', 'add', 'origin', url], { cwd: opsDir })
      .catch(() => run(['remote', 'set-url', 'origin', url], { cwd: opsDir }));
    await run(['fetch', 'origin'], { cwd: opsDir, timeout: 120000, env: NOPROMPT }).catch(() => {}); // 네트워크 실패는 무시(원격은 설정됨)
    cache.delete(opsDir);
    return { action: 'updated', backup: null, git: await refresh(opsDir) };
  }
  let backup = null;
  if (existsSync(opsDir)) {
    if (isSkeletonOnly(opsDir)) rmSync(opsDir, { recursive: true, force: true });
    else { backup = `${opsDir}_bak_${stamp}`; renameSync(opsDir, backup); }
  }
  try {
    await run(['clone', url, opsDir], { timeout: 180000, env: NOPROMPT });
  } catch (e) {
    if (backup && existsSync(backup) && !existsSync(opsDir)) renameSync(backup, opsDir); // 복원
    else if (!existsSync(opsDir)) mkdirSync(opsDir, { recursive: true });
    throw new Error(`clone 실패 — ${e.message}${backup ? ' (기존 ops 복원됨)' : ''}`);
  }
  cache.delete(opsDir);
  return { action: 'cloned', backup, git: await refresh(opsDir) };
}
