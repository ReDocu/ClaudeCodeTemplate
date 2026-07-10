// 커넥터 러너 + 캐시. 렌더 논블로킹(Tech.md §9): 2.5s 폴링을 막지 않도록
// 결과를 메모리 캐시하고 TTL 지나면 백그라운드로만 재프로브. buildState는 스냅샷을 즉시 읽음.
import { homedir } from 'node:os';
import { gitProbe } from './git.js';
import { envProbe } from './env.js';
import { nodeProbe } from './node.js';
import { scanPorts } from './ports.js';
import { listWorkspaces } from '../core/wmux.js';

const HOME = homedir().toLowerCase().replace(/[\\/]+$/, '');
// 홈 디렉터리·그 상위·드라이브 루트 = 커맨드라인 대부분을 부분일치로 빨아들임 → 포트 오귀속. 귀속 대상에서 제외.
function tooBroad(cwd) {
  const c = cwd.toLowerCase().replace(/[\\/]+$/, '');
  const segs = c.split(/[\\/]/).filter(Boolean).length;
  return segs <= 1 || c === HOME || HOME.startsWith(c + '\\');
}

const TTL = 15000;
let cache = { byTeam: {}, globalPorts: [], checkedAt: 0 };
let inflight = null;

// 포트맵 노이즈 억제 — 팀 귀속됐거나 dev/db 프로세스만 글로벌 맵에 노출.
const DEVPROC = /node|python|deno|bun|ruby|php|dotnet|java|mysqld|postgres|pg_|redis|mongo|docker|nginx|caddy|vite|next/i;

function portLabel(row) {
  const cmd = (row.cmd || '').toLowerCase();
  const known = [['next', 'next dev'], ['vite', 'vite'], ['astro', 'astro dev'], ['nodemon', 'nodemon'],
    ['webpack', 'webpack'], ['rails', 'rails'], ['uvicorn', 'uvicorn'], ['flask', 'flask'], ['mysqld', 'mysql']];
  for (const [k, v] of known) if (cmd.includes(k) || (row.proc || '').toLowerCase().includes(k)) return v;
  return (row.proc || '?').replace(/\.exe$/i, '');
}

async function probeTeamConns(cwd) {
  const [g, e, n] = await Promise.all([
    gitProbe(cwd).catch(() => null),
    envProbe(cwd).catch(() => null),
    nodeProbe(cwd).catch(() => null),
  ]);
  return [g, e, n].filter(Boolean);
}

export async function refreshAll(workspaces) {
  if (inflight) return inflight; // single-flight
  inflight = (async () => {
    const listeners = await scanPorts().catch(() => []);
    // 귀속 후보: 광범위 cwd(홈/루트) 제외 + 최장 cwd 우선(하위 워크스페이스 정확 귀속)
    const bySpecific = workspaces.filter((w) => w.cwd && !tooBroad(w.cwd)).sort((a, b) => b.cwd.length - a.cwd.length);
    const nameById = {}; workspaces.forEach((w) => { nameById[w.id] = w.title || w.id; });

    const teamPorts = {};
    const globalPorts = [];
    for (const row of listeners) {
      const cmd = (row.cmd || '').toLowerCase();
      let team = null;
      // 경로 경계(cwd + 구분자) 매칭 — Educraft가 Educraft2에 오매칭되는 접두 충돌 방지
      if (cmd) { const hit = bySpecific.find((w) => cmd.includes(w.cwd.toLowerCase() + '\\')); if (hit) team = hit.id; }
      const label = portLabel(row);
      if (team) (teamPorts[team] ||= []).push({ p: `:${row.port}`, proc: label, st: 'up', tag: 'running', pid: row.procId });
      if (team !== null || DEVPROC.test(row.proc || '') || DEVPROC.test(cmd)) {
        globalPorts.push({ p: `:${row.port}`, proc: label, pid: row.procId, team, teamName: team ? nameById[team] : null });
      }
    }

    const byTeam = {};
    await Promise.all(workspaces.map(async (w) => {
      byTeam[w.id] = { conns: w.cwd ? await probeTeamConns(w.cwd) : [], ports: teamPorts[w.id] || [] };
    }));

    cache = { byTeam, globalPorts, checkedAt: Date.now() };
    return cache;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function snapshot() { return cache; }

// 캐시 신선하거나 이미 갱신 중이면 no-op. 아니면 백그라운드 갱신(fire-and-forget) — 폴링을 막지 않음.
export function maybeRefresh(workspaces) {
  if (Date.now() - cache.checkedAt < TTL || inflight) return;
  refreshAll(workspaces).catch(() => {});
}

// 강제 신선 갱신(POST /refresh·부팅). 워크스페이스를 직접 조회.
export async function forceRefresh() {
  let ws = [];
  try { ws = (await listWorkspaces()).workspaces || []; } catch {}
  return refreshAll(ws);
}
