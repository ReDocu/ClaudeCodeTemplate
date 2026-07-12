// 기능 인벤토리 스캐너 (FS-15) — claude가 쓰는 skill/plugin/agent/MCP의 "이름·종류·활성 여부만".
// 파일 내용·설정 값·키는 절대 수집·노출하지 않는다(§9-4).
// ① global: ~/.claude(모든 세션 상속) ② project/session: 프로젝트 루트·역할 폴더의 .claude/·.mcp.json.
// 짧은 TTL 캐시 — 스캔이 /api 응답을 막지 않게(작은 동기 IO지만 계약은 동일, §9-⑥).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const TTL = 30_000;

const dirNames = (p) => {
  try { return readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name); }
  catch { return []; }
};
const mdNames = (p) => {
  try { return readdirSync(p).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')); }
  catch { return []; }
};
// mcpServers 키 이름만 — 값(command·env·url)은 읽되 버린다(비노출).
function mcpKeys(file) {
  try { return Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers || {}); }
  catch { return []; }
}

// 한 디렉터리 기준의 claude 기능 스캔(.claude/skills·agents + .mcp.json)
function scanDir(base) {
  const out = [];
  const dot = join(base, '.claude');
  for (const nm of dirNames(join(dot, 'skills'))) out.push({ nm, k: 'skill' });
  for (const nm of mdNames(join(dot, 'agents'))) out.push({ nm, k: 'agent' });
  for (const nm of mcpKeys(join(base, '.mcp.json'))) out.push({ nm, k: 'mcp' });
  for (const nm of mcpKeys(join(dot, '.mcp.json'))) out.push({ nm, k: 'mcp' });
  return out;
}

let _global = null, _globalAt = 0;
export function globalCaps() {
  if (_global && Date.now() - _globalAt < TTL) return _global;
  const out = [];
  const dot = join(HOME, '.claude');
  for (const nm of dirNames(join(dot, 'skills'))) out.push({ nm, k: 'skill' });
  for (const nm of mdNames(join(dot, 'agents'))) out.push({ nm, k: 'agent' });
  // 플러그인 — 설치 캐시의 이름만(퍼블리셔 폴더 아래 플러그인 폴더명)
  const cache = join(dot, 'plugins', 'cache');
  for (const pub of dirNames(cache)) for (const nm of dirNames(join(cache, pub))) out.push({ nm, k: 'plugin' });
  // 글로벌 MCP — ~/.claude.json의 mcpServers 키 이름만
  for (const nm of mcpKeys(join(HOME, '.claude.json'))) out.push({ nm, k: 'mcp' });
  _global = out; _globalAt = Date.now();
  return out;
}

// 세션 스코프 — project(프로젝트 루트) / session(역할 폴더). global은 재전송 안 함(FS-15-2).
const _sess = new Map(); // key → {at, data}
export function sessionCaps(projDir, roleDir) {
  const key = projDir + '|' + (roleDir || '');
  const hit = _sess.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = {
    project: existsSync(projDir) ? scanDir(projDir) : [],
    session: roleDir && existsSync(roleDir) ? scanDir(roleDir) : [],
  };
  _sess.set(key, { at: Date.now(), data });
  return data;
}
