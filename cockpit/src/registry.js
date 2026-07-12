// 프로젝트 레지스트리 — root/<프로젝트>/project.json 이 선언(진실). (FS-2·8·9, PRD §8.2)
// 리라이트: 구 team.json과 비호환(마이그레이션 없음) — 구 팀은 importProject 제자리 등록으로 재등록.
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve, basename } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../root/', import.meta.url));

// cockpit 런타임 설정(workspace/config.json — gitignore) — 포트·토큰·wmuxBin·shell·usageMax*.
// 새 클론엔 없다는 전제(서버가 자동 생성). 다른 모듈이 순환 의존 없이 읽고 쓰는 최소 창구.
const CONFIG_PATH = fileURLToPath(new URL('../workspace/config.json', import.meta.url));
export function readConfig() { try { return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')); } catch { return {}; } }
export function patchConfig(patch) {
  const cfg = { ...readConfig(), ...patch };
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  return cfg;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
// tmp→rename 원자적 쓰기(경합 방지 — 계승)
function writeAtomic(p, o) { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n'); renameSync(tmp, p); }

const VALID_STATUS = new Set(['active', 'idle', 'archived']);

// root/ 1depth 스캔 — project.json 있는 폴더만 프로젝트(FS-2). 점 접두어 폴더 제외.
// 깨진 project.json은 errors로 표기하고 스캔은 계속(관용 파싱).
export function scanProjects() {
  let ents;
  try { ents = readdirSync(ROOT, { withFileTypes: true }); } catch { return { projects: [], errors: [] }; }
  const projects = [], errors = [];
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(ROOT, e.name);
    const pj = join(dir, 'project.json');
    if (!existsSync(pj)) continue;
    try {
      const obj = readJson(pj);
      if (!obj.name) obj.name = e.name;
      if (!VALID_STATUS.has(obj.status)) obj.status = 'idle'; // A-4 — 필드 부재/오타 관용
      if (!obj.createdAt) {
        try { const s = statSync(pj); obj.createdAt = new Date(s.birthtimeMs > 0 ? s.birthtimeMs : s.mtimeMs).toISOString(); } catch { /* 다음 스캔 재시도 */ }
      }
      if (obj.archivedAt === undefined) obj.archivedAt = null;
      if (obj.wsId === undefined) obj.wsId = null;
      if (!Array.isArray(obj.roles)) obj.roles = [];
      if (!Array.isArray(obj.links)) obj.links = [];
      obj._dir = dir; obj._folder = e.name;
      projects.push(obj);
    } catch (err) { errors.push({ name: e.name, message: String(err.message || err) }); }
  }
  return { projects, errors };
}

export function findProject(name) {
  return scanProjects().projects.find((p) => p.name === name || p._folder === name) || null;
}

// project.json 되쓰기 — 런타임 필드(_dir/_folder) 제거 후 원자적 저장.
export function writeProject(proj) {
  const { _dir, _folder, ...clean } = proj;
  writeAtomic(join(_dir, 'project.json'), clean);
}

// ── 격리 스캐폴드 (FS-8, 구 D16 계승) — 전부 멱등, 기존 파일 절대 미덮어쓰기 ──
const ISOLATION_CLAUDE_MD = (name) => `# ${name} — 독립 프로젝트

이 폴더는 ClaudeCockpit이 세션 기동·관찰만 담당하는 **독립 프로젝트**다.
Cockpit의 운영정책은 이 프로젝트와 무관하다.

## 격리 선언 (상위 지침보다 우선)

- 상위 폴더(ClaudeCockpit 저장소)의 CLAUDE.md는 **cockpit 도구 자체의 운영정책**이다 —
  불변 규칙·검증 컨벤션·handover 관례·커밋 컨벤션을 포함해 전부 **이 프로젝트에 적용하지 말 것**.
  이 프로젝트에서는 이 파일과 하위 문서만 따른다.
- 이 폴더는 자체 git 저장소다. 커밋·브랜치·리뷰 등 모든 git 작업은 이 저장소 기준이며,
  상위 cockpit 저장소를 대상으로 하지 않는다.
- \`project.json\`은 cockpit 제어 파일(런타임 바인딩 되쓰기 포함) — 프로젝트 코드가 참조·수정하지
  않고, 이 저장소에서도 추적하지 않는다(.gitignore).

## 프로젝트 규칙

(여기서부터 이 프로젝트 고유 규칙을 추가)
`;
const ISOLATION_GITIGNORE = `# ClaudeCockpit 제어 파일 — 이 머신의 런타임 바인딩(wsId)이 되써짐. 추적 금지.
/project.json
# 시크릿·로그 — 커밋 금지 (선제 규칙)
deploy-keys/
connections.json
.env.*
logs/
`;

export function scaffoldIsolation(dir, name) {
  const cm = join(dir, 'CLAUDE.md');
  if (!existsSync(cm)) writeFileSync(cm, ISOLATION_CLAUDE_MD(name));
  const gi = join(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, ISOLATION_GITIGNORE);
  if (!existsSync(join(dir, '.git'))) {
    try { execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' }); }
    catch {
      try { execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' }); }
      catch { /* git 미설치 — 문서 격리만으로 진행 */ }
    }
  }
}

// 역할 작업 폴더 보장 — 폴더만(R8: root/<프로젝트>/<역할>/). ops 포함. 파일 스캐폴드는
// 프로젝트 루트 .gitignore(시크릿 4규칙)가 담당 — 역할 지침·인수인계 템플릿은 범위 밖(§13).
export function ensureRoleDir(projDir, roleId) {
  const d = join(projDir, roleId);
  mkdirSync(d, { recursive: true });
  return d;
}

// ── 생성/역할 (FS-8) ──
const BAD_FS = /[<>:"/\\|?*]/g;
function validName(name) {
  const s = String(name || '').trim().replace(BAD_FS, '').replace(/[. ]+$/, '').trim();
  if (!s || s.startsWith('.')) throw Object.assign(new Error('invalid-name'), { status: 400 });
  return s;
}

export function createProject({ name, roles = [] } = {}) {
  const folder = validName(name);
  const dir = join(ROOT, folder);
  const roleIds = [...new Set(roles.map((r) => String(r && r.id !== undefined ? r.id : r).trim()).filter((r) => r && r !== 'ops'))];

  const existing = findProject(folder);
  if (existing) { // 재호출 = 역할 병합(멱등 — 기존 항목 불변)
    const added = [];
    for (const id of roleIds) {
      if (!(existing.roles || []).some((r) => r && r.id === id)) { existing.roles.push({ id }); added.push(id); }
      ensureRoleDir(existing._dir, id);
    }
    if (added.length) writeProject(existing);
    return { project: existing, added, created: false };
  }
  if (existsSync(dir)) throw Object.assign(new Error('folder-exists'), { status: 409 });

  mkdirSync(dir, { recursive: true });
  scaffoldIsolation(dir, folder);
  ensureRoleDir(dir, 'ops');
  for (const id of roleIds) ensureRoleDir(dir, id);
  const proj = {
    name: folder, status: 'idle', createdAt: new Date().toISOString(), archivedAt: null,
    wsId: null, roles: roleIds.map((id) => ({ id })), links: [],
    _dir: dir, _folder: folder,
  };
  writeProject(proj);
  return { project: proj, added: roleIds, created: true };
}

// 역할 제거(FS-8-3) — 선언에서만 제거, 폴더·파일 보존(파괴 없음). ops 불가.
// 살아있는 세션 가드(409)는 wmux 실측이 필요해 server가 lifecycle과 함께 판정.
export function removeRole(name, roleId) {
  if (roleId === 'ops') throw Object.assign(new Error('ops-fixed'), { status: 400 });
  const p = findProject(name);
  if (!p) throw Object.assign(new Error('unknown-project'), { status: 404 });
  const before = (p.roles || []).length;
  p.roles = (p.roles || []).filter((r) => !r || r.id !== roleId);
  if (p.roles.length === before) return { removed: false };
  writeProject(p);
  return { removed: true };
}

// ── 이사 (FS-9) — 동일 볼륨 rename(A-2) · root/ 아래면 제자리 등록(B7) ──
const norm = (p) => resolve(p).toLowerCase().replace(/[\\/]+$/, '');
const underRoot = (p) => (norm(p) + '\\').startsWith(norm(ROOT) + '\\');

export function importProject({ path, name } = {}) {
  if (!path) throw Object.assign(new Error('path-required'), { status: 400 });
  const src = resolve(String(path).trim().replace(/^["']|["']$/g, ''));
  let st;
  try { st = statSync(src); } catch { throw Object.assign(new Error('path-not-found'), { status: 400 }); }
  if (!st.isDirectory()) throw Object.assign(new Error('not-a-directory'), { status: 400 });
  if (norm(src) === norm(ROOT)) throw Object.assign(new Error('cannot-import-root'), { status: 400 });

  const inPlace = underRoot(src);
  const folder = inPlace ? basename(src) : validName(name || basename(src));
  const dest = inPlace ? src : join(ROOT, folder);

  if (!inPlace) {
    if (existsSync(dest)) throw Object.assign(new Error('name-conflict'), { status: 409 });
    // rename 원자성에 의존 — 실패(EXDEV·잠금·권한) 시 원본 무변경(A-2). 롤백 이동 없음.
    try { renameSync(src, dest); }
    catch (e) {
      const cross = e && e.code === 'EXDEV';
      throw Object.assign(new Error(cross ? 'cross-device — 같은 드라이브로 수동 이동 후 재시도(v1은 동일 볼륨만)' : `move-failed(${e.code || e.message}) — 원본 무변경`), { status: 400 });
    }
  }
  // 이동/제자리 이후: 스캐폴드는 멱등(기존 .git·CLAUDE.md·.gitignore 보존), 이미 등록돼 있으면 그대로.
  if (existsSync(join(dest, 'project.json'))) {
    return { project: findProject(basename(dest)), already: true, inPlace };
  }
  scaffoldIsolation(dest, folder);
  ensureRoleDir(dest, 'ops');
  const proj = {
    name: folder, status: 'idle', createdAt: new Date().toISOString(), archivedAt: null,
    wsId: null, roles: [], links: [], _dir: dest, _folder: folder,
  };
  writeProject(proj);
  return { project: proj, already: false, inPlace };
}
