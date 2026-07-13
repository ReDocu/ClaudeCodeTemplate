// 프로젝트 레지스트리 — root/<프로젝트>/project.json 이 선언(진실). (FS-2·8·9, PRD §8.2)
// 리라이트: 구 team.json과 비호환(마이그레이션 없음) — 구 팀은 importProject 제자리 등록으로 재등록.
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, rmSync, statSync,
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
      if (!obj.adopted || typeof obj.adopted !== 'object' || Array.isArray(obj.adopted)) obj.adopted = {}; // agentId→role 채택 매핑
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
- git 저장소는 이 폴더가 아니라 **\`ops/\`** 다. 코드베이스는 ops/에 두고, 커밋·브랜치·리뷰·원격(clone/push)은
  전부 ops/ 저장소 기준이다. 프로젝트 루트(이 폴더)는 git 저장소가 아니며, 상위 cockpit 저장소도 대상이 아니다.
- \`project.json\`은 cockpit 제어 파일(런타임 바인딩 되쓰기 포함) — 프로젝트 코드가 참조·수정하지
  않고, 이 저장소에서도 추적하지 않는다(.gitignore).

## 프로젝트 규칙

(여기서부터 이 프로젝트 고유 규칙을 추가)
`;
// ops(=유일 git 저장소)용 .gitignore — 시크릿·로그 선제 차단. project.json은 프로젝트 루트에 있어
// ops 저장소 범위 밖이므로 제외 대상 아님. 갓 만든 빈 ops에만 주입(clone된 실저장소엔 미주입).
const OPS_GITIGNORE = `# 시크릿·로그 — 커밋 금지 (선제 규칙)
deploy-keys/
connections.json
.env.*
logs/
`;

// 프로젝트 루트 = cockpit 래퍼(격리 CLAUDE.md만). **git 저장소가 아니다** — git은 ops/에만(scaffoldOpsGit).
export function scaffoldIsolation(dir, name) {
  const cm = join(dir, 'CLAUDE.md');
  if (!existsSync(cm)) writeFileSync(cm, ISOLATION_CLAUDE_MD(name));
}

// ops = 프로젝트의 유일한 git 저장소. 빈 ops를 git init + 시크릿 .gitignore 주입(멱등 — 기존 .git/.gitignore
// 절대 미덮어쓰기). clone으로 채워질 ops면 connectRemote가 이 빈 저장소를 스켈레톤으로 보고 교체한다(git.js).
export function scaffoldOpsGit(opsDir) {
  mkdirSync(opsDir, { recursive: true });
  const gi = join(opsDir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, OPS_GITIGNORE);
  if (!existsSync(join(opsDir, '.git'))) {
    try { execFileSync('git', ['init', '-b', 'main'], { cwd: opsDir, stdio: 'ignore' }); }
    catch {
      try { execFileSync('git', ['init'], { cwd: opsDir, stdio: 'ignore' }); }
      catch { /* git 미설치 — 문서 격리만으로 진행 */ }
    }
  }
}

// 역할 지침 뼈대 — 역할 세션의 cwd(root/<프로젝트>/<역할>/)에서 claude가 자동 로드하며,
// 조상인 프로젝트 루트 CLAUDE.md(격리 선언) 위에 층으로 얹힌다. 최소 뼈대만 두고 내용은 사용자가 채움.
const ROLE_CLAUDE_MD = (project, role) => `# ${project} · ${role} 역할

이 세션의 작업 폴더는 root/${project}/${role}. 상위 프로젝트 CLAUDE.md를 상속한다.

## 역할 규칙

(여기에 이 역할의 지침을 추가)
`;

// 역할 작업 폴더 보장 — root/<프로젝트>/<역할>/. 멱등. 역할 CLAUDE.md 뼈대는 **갓 만든 빈 폴더에만**
// 넣는다 — clone된 저장소·import된 코드가 들어있는 폴더(ops 등)엔 cockpit 파일을 주입하지 않는다(오염 방지).
export function ensureRoleDir(projDir, roleId) {
  const d = join(projDir, roleId);
  mkdirSync(d, { recursive: true });
  let empty = true; try { empty = readdirSync(d).length === 0; } catch { /* 접근 불가 — 주입 생략 */ empty = false; }
  if (empty) writeFileSync(join(d, 'CLAUDE.md'), ROLE_CLAUDE_MD(basename(projDir), roleId));
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
  scaffoldOpsGit(ensureRoleDir(dir, 'ops')); // ops = 유일 git 저장소(루트는 저장소 아님)
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

  const newProj = (dir, folder) => ({
    name: folder, status: 'idle', createdAt: new Date().toISOString(), archivedAt: null,
    wsId: null, roles: [], links: [], adopted: {}, _dir: dir, _folder: folder,
  });

  // 제자리 등록(root/ 아래 · 구 팀 재등록 B7) — 이동 없이 기존 동작 유지(ops 이동 대상 아님).
  if (underRoot(src)) {
    const folder = basename(src);
    if (existsSync(join(src, 'project.json'))) return { project: findProject(folder), already: true, inPlace: true, backup: null };
    scaffoldIsolation(src, folder);
    scaffoldOpsGit(ensureRoleDir(src, 'ops')); // 제자리 등록도 ops만 git(멱등 — 기존 ops .git 보존)
    const proj = newProj(src, folder);
    writeProject(proj);
    return { project: proj, already: false, inPlace: true, backup: null };
  }

  // 외부 연동 — 기본 프로젝트를 root/<name>/ops/ 코드베이스로 이동(D: ops = 저장소).
  const folder = validName(name || basename(src));
  const projDir = join(ROOT, folder);
  if (existsSync(join(projDir, 'project.json'))) return { project: findProject(folder), already: true, inPlace: false, backup: null };
  mkdirSync(projDir, { recursive: true });
  scaffoldIsolation(projDir, folder); // 프로젝트 루트 = cockpit 래퍼(CLAUDE.md·격리 git)
  const opsDir = join(projDir, 'ops');
  let backup = null;
  if (existsSync(opsDir)) { // 스캐폴드가 만든 스켈레톤은 지우고, 실내용이 있으면 백업(사용자 선택)
    let e = []; try { e = readdirSync(opsDir); } catch { /* 접근 불가 */ }
    if (e.length === 0 || (e.length === 1 && e[0] === 'CLAUDE.md')) rmSync(opsDir, { recursive: true, force: true });
    else { backup = `${opsDir}_bak_${Date.now()}`; renameSync(opsDir, backup); }
  }
  // src → ops 이동(원자적 rename). 실패 시 백업 복원(있으면) + 원본 무변경.
  try { renameSync(src, opsDir); }
  catch (e) {
    if (backup && existsSync(backup) && !existsSync(opsDir)) renameSync(backup, opsDir);
    const cross = e && e.code === 'EXDEV';
    throw Object.assign(new Error(cross ? 'cross-device — 같은 드라이브로 수동 이동 후 재시도(v1은 동일 볼륨만)' : `move-failed(${e.code || e.message}) — 원본 무변경`), { status: 400 });
  }
  scaffoldOpsGit(opsDir); // 이동한 코드가 저장소면 그대로 보존, 아니면 ops를 git init(멱등)
  const proj = newProj(projDir, folder);
  writeProject(proj);
  return { project: proj, already: false, inPlace: false, backup };
}
