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

// git URL → 저장소(폴더) 이름 파생. `.git`·뒤 구분자 제거 후 마지막 경로 세그먼트.
//   https://host/owner/repo(.git) · git@host:owner/repo(.git) · ssh://…/owner/repo(.git) → 'repo'
export function repoNameFromUrl(url) {
  if (!url) return null;
  const s = String(url).trim().replace(/^["']|["']$/g, '').replace(/[/\\:]+$/, ''); // 뒤 구분자 먼저 제거
  const seg = (s.split(/[/\\:]/).filter(Boolean).pop() || '').replace(/\.git$/i, ''); // 세그먼트 추출 후 .git 제거
  return seg || null;
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
// ops가 비었거나 cockpit 스켈레톤(.git·.gitignore·CLAUDE.md만)뿐인가 — clone 전 교체/백업 판단.
// scaffoldOpsGit이 빈 ops를 git init 해두므로, .git이 있어도 '실내용 0'이면 스켈레톤으로 보고 clone이 교체한다.
const SKELETON = new Set(['.git', '.gitignore', 'CLAUDE.md']);
function isSkeletonOnly(dir) {
  let e; try { e = readdirSync(dir); } catch { return true; }
  return e.every((n) => SKELETON.has(n)); // 빈 배열도 true
}

// 원격 연결 + main을 opsDir로 clone (POST /git-remote). 설계: ops = 저장소. 사용자 선택: 백업 후 진행.
//   · opsDir이 이미 저장소면 재-clone 없이 origin 갱신 + fetch(로컬 작업 보존).
//   · 아니면 스켈레톤은 지우고, 실내용이면 ops_bak_<stamp>로 백업 → git clone. 실패 시 백업 복원(손실 0).
export async function connectRemote(opsDir, url, stamp = Date.now()) {
  // 실내용 있는 저장소면 재-clone 없이 원격만 갱신(로컬 작업 보존). 빈 스켈레톤 저장소
  // (scaffoldOpsGit의 git init 뿐)이면 아래 clone 경로가 지우고 교체한다.
  if (existsSync(join(opsDir, '.git')) && !isSkeletonOnly(opsDir)) {
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
