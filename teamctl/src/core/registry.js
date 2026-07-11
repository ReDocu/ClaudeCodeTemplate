// 폴더 레지스트리 — root/ 를 팀 선언(desired state)의 진실로 읽고 쓴다.
// 규칙: root/ 바로 아래 점(.) 안 붙은 폴더 = 팀 하나. 그 안 team.json = 팀 신원.
// .manager/(런타임 캐시)·.templates/(스캐폴드 원본)는 점 접두어라 스캔에서 제외.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../../root/', import.meta.url));
const MANAGER = join(ROOT, '.manager');
const TEMPLATES = join(ROOT, '.templates');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, o) => writeFileSync(p, JSON.stringify(o, null, 2) + '\n');
// tmp→rename 원자적 쓰기(경합 방지, Tech.md D11)
function writeAtomic(p, o) { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n'); renameSync(tmp, p); }

// F13(§13-G②) — 배포·운영(ops) 기본 역할: 모든 새 팀에 포함, root/<팀>/ops/ 를 cwd로 autostart 스폰.
const OPS_ROLE = { id: 'ops', autostart: true, cwd: 'ops' };
const OPS_ROLE_MD = `# ops — 배포·운영 세션

작업 디렉터리는 팀 폴더의 \`ops/\`(팀 생성 시 자동 스캐폴드).

- 배포·환경·DB·포트 등 운영 작업 담당. 제품 코드 수정은 담당 역할에 넘긴다.
- 하위 폴더(deploy/env/db/logs)는 미리 만들지 말고 필요할 때 ops/README.md 규칙대로 생성.
- 시크릿(키·토큰·접속 문자열)은 ops/.gitignore가 가리는 경로에만 둔다 — 커밋 금지.
`;
const OPS_README = `# ops — 배포·운영 작업 폴더

이 팀의 배포·운영(ops) 세션 작업 디렉터리. \`team.json\`의 \`ops\` 역할이 이 폴더를 cwd로 스폰된다.

## 규칙
- **하위 구조는 필요할 때만 만든다**(유령 폴더 금지). 권장 이름:
  - \`deploy/\` 배포 스크립트·체크리스트 · \`env/\` 환경별 설정 문서(값 아님)
  - \`db/\` 마이그레이션·백업 절차 · \`logs/\` 작업 로그(gitignore 됨)
- **시크릿은 커밋 금지** — \`.gitignore\`가 선제 차단: \`deploy-keys/\`·\`connections.json\`·\`.env.*\`·\`logs/\`.
- 역할 지침: \`../roles/role-ops.md\`
`;
const OPS_GITIGNORE = `# 시크릿·로그 — 커밋 금지 (F13 선제 규칙)
deploy-keys/
connections.json
.env.*
logs/
`;

// root/<팀>/ops/ 절충 스캐폴드 — README+.gitignore(+역할 지침)만. 풀 트리 생성 금지(유령 구조).
export function scaffoldOps(dir) {
  const ops = join(dir, 'ops');
  mkdirSync(ops, { recursive: true });
  const rd = join(ops, 'README.md');
  if (!existsSync(rd)) writeFileSync(rd, OPS_README);
  const gi = join(ops, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, OPS_GITIGNORE);
  mkdirSync(join(dir, 'roles'), { recursive: true });
  const rm = join(dir, 'roles', 'role-ops.md');
  if (!existsSync(rm)) writeFileSync(rm, OPS_ROLE_MD);
}

// 서버 부팅 시 1회 — 없으면 .manager/.templates 뼈대만 생성(팀 폴더는 사용자/대시보드가 만듦).
export function ensureScaffold() {
  mkdirSync(MANAGER, { recursive: true });
  mkdirSync(join(TEMPLATES, 'team', 'roles'), { recursive: true });
  const tj = join(TEMPLATES, 'team', 'team.json');
  if (!existsSync(tj)) writeJson(tj, {
    id: '', name: '', projectPath: '.', workspaceId: null,
    roles: [{ id: 'lead', autostart: false }, { ...OPS_ROLE }],
    connectors: ['git', 'ports'], expectedPorts: [],
  });
  const rp = join(TEMPLATES, 'team', 'roles', 'role-lead.md');
  if (!existsSync(rp)) writeFileSync(rp, '# lead\n\n역할 지침을 여기에. 세션 부팅 시 주입됨.\n');
  const ro = join(TEMPLATES, 'team', 'roles', 'role-ops.md');
  if (!existsSync(ro)) writeFileSync(ro, OPS_ROLE_MD);
}

// root/*/team.json 스캔 → 팀 선언 배열. 각 객체에 _dir·_folder 부여(런타임 전용, 저장 시 제거).
export function scanTeams() {
  let ents;
  try { ents = readdirSync(ROOT, { withFileTypes: true }); } catch { return []; }
  const teams = [];
  for (const e of ents) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const dir = join(ROOT, e.name);
    const tj = join(dir, 'team.json');
    if (!existsSync(tj)) continue;
    try {
      const obj = readJson(tj);
      obj._dir = dir; obj._folder = e.name;
      if (!obj.id) obj.id = e.name;
      if (!obj.name) obj.name = e.name;
      if (!Array.isArray(obj.roles)) obj.roles = [];
      teams.push(obj);
    } catch { /* 깨진 team.json은 건너뜀 */ }
  }
  return teams;
}

// 새 팀 생성 — 대시보드 "＋ 새 팀"(POST /api/team)이 호출. 입력 이름 → 폴더명·id·표시명.
// 폴더명: Windows 금지문자 제거, 점 접두어 금지(스캔 제외 규칙과 충돌).
// id: 소문자 슬러그 — 기존 팀과 중복이면 거부(중복 id는 목록 표시·/up 필터를 오염시킴).
const BAD_FS = /[<>:"/\\|?*]/g;
export function createTeam({ name, projectPath } = {}) {
  const display = String(name || '').trim();
  if (!display) throw new Error('팀 이름이 비어 있습니다');
  const folder = display.replace(BAD_FS, '').replace(/[. ]+$/, '').trim();
  if (!folder || folder.startsWith('.')) throw new Error(`폴더명으로 쓸 수 없는 이름입니다: ${display}`);
  const dir = join(ROOT, folder);
  if (existsSync(dir)) throw new Error(`이미 존재하는 팀 폴더입니다: ${folder}`);
  const id = folder.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || folder.toLowerCase();
  const dup = scanTeams().find((t) => t.id === id);
  if (dup) throw new Error(`같은 id(${id})의 팀이 이미 있습니다: ${dup._folder}`);

  ensureScaffold();
  let tpl = {};
  try { tpl = readJson(join(TEMPLATES, 'team', 'team.json')); } catch { /* 템플릿 없거나 깨짐 — 기본값 사용 */ }
  const team = {
    ...tpl,
    id, name: display,
    projectPath: String(projectPath || '').trim() || '.',
    workspaceId: null,
    roles: Array.isArray(tpl.roles) && tpl.roles.length ? [...tpl.roles] : [{ id: 'lead', autostart: false }],
    connectors: Array.isArray(tpl.connectors) ? tpl.connectors : ['git', 'ports'],
    expectedPorts: Array.isArray(tpl.expectedPorts) ? tpl.expectedPorts : [],
  };
  // 배포용 ops 세션은 디폴트(F13) — 템플릿이 구버전이라 없으면 보충(템플릿이 ops를 커스텀했으면 존중).
  if (!team.roles.some((r) => r && r.id === OPS_ROLE.id)) team.roles.push({ ...OPS_ROLE });
  mkdirSync(join(dir, 'roles'), { recursive: true });
  try {
    for (const f of readdirSync(join(TEMPLATES, 'team', 'roles'))) {
      copyFileSync(join(TEMPLATES, 'team', 'roles', f), join(dir, 'roles', f));
    }
  } catch { /* 역할 지침 템플릿 없으면 생략 */ }
  scaffoldOps(dir);
  writeJson(join(dir, 'team.json'), team);
  return { ...team, _dir: dir, _folder: folder };
}

export function readTeam(dir) { return readJson(join(dir, 'team.json')); }
// team.json 되쓰기 — 런타임 필드(_dir/_folder) 제거 후 원자적 저장.
export function writeTeam(dir, obj) {
  const { _dir, _folder, ...clean } = obj;
  writeAtomic(join(dir, 'team.json'), clean);
}

// registry.json(가벼운 인덱스 스냅샷) 캐시 저장 — 정적/마크다운 폴백용(선택).
export function writeRegistry(index) { writeAtomic(join(MANAGER, 'registry.json'), index); }
