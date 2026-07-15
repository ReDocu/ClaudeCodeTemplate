// Claude Code 훅 런타임 — 세션 활동(working/waiting/attention)⊕모델·effort를 cockpit이 읽을 상태 파일로 기록.
//   훅 호출: node activity-hook.mjs <working|waiting|attention>  (stdin=Claude 훅 JSON)
//   cwd가 cockpit root/<프로젝트>/<역할>/ 아래일 때만 기록 → cockpit/workspace/activity/<proj>__<role>.json
//   그 외(비-cockpit 세션)는 즉시 종료(무동작). 훅은 절대 세션을 막지 않는다 → 항상 exit 0.
//   설치/제거: node activity-hook.mjs install|uninstall  (~/.claude/settings.json 병합·백업, 기존 훅 보존)
//   모델·effort도 로컬 실측만(토큰 소비 0) — effort=훅 페이로드 공통 필드, 모델=트랜스크립트 꼬리(아래 주석).
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';

const SELF = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL('../../root/', import.meta.url));                // repo/root/
const ACT_DIR = fileURLToPath(new URL('../workspace/activity/', import.meta.url));  // cockpit/workspace/activity/
const norm = (p) => resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_');

// cwd가 root/<proj>/<role>[/...] 형태면 {project, role} 반환. 아니면 null(비-cockpit 세션).
function deriveKey(cwd) {
  const c = norm(cwd), r = norm(ROOT);
  if (!(c + '/').toLowerCase().startsWith(r.toLowerCase() + '/')) return null;
  const segs = c.slice(r.length).replace(/^\/+/, '').split('/').filter(Boolean);
  if (segs.length < 2) return null; // root/<proj>/<role> 최소
  return { project: segs[0], role: segs[1] };
}

function readStdin() {
  return new Promise((res) => {
    let d = '';
    try {
      if (process.stdin.isTTY) return res('');
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { d += c; });
      process.stdin.on('end', () => res(d));
      process.stdin.on('error', () => res(d));
      setTimeout(() => res(d), 400); // 안전 상한(정상은 즉시 end)
    } catch { res(d); }
  });
}

// ── ~/.claude/settings.json 병합 설치/제거 (기존 훅 보존 — activity-hook.mjs 항목만 취급) ──
const SETTINGS = join(homedir(), '.claude', 'settings.json');
const EVENTS = { UserPromptSubmit: 'working', Stop: 'waiting', Notification: 'attention' };
const cmdFor = (state) => `node "${SELF.replace(/\\/g, '/')}" ${state} 2>/dev/null || true`;
const isOurs = (h) => h && h.type === 'command' && /activity-hook\.mjs/.test(h.command || '');
const hasOurs = (grp) => (grp.hooks || []).some(isOurs);
const loadSettings = () => { try { return JSON.parse(readFileSync(SETTINGS, 'utf8')); } catch { return {}; } };
const saveSettings = (o) => { mkdirSync(dirname(SETTINGS), { recursive: true }); writeFileSync(SETTINGS, JSON.stringify(o, null, 2) + '\n'); };

function install() {
  const s = loadSettings();
  if (existsSync(SETTINGS) && !existsSync(SETTINGS + '.cockpit-bak')) copyFileSync(SETTINGS, SETTINGS + '.cockpit-bak');
  s.hooks = s.hooks || {};
  for (const [ev, state] of Object.entries(EVENTS)) {
    const arr = (Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []).filter((g) => !hasOurs(g)); // 기존 우리 항목만 제거(재설치 중복 방지)
    arr.push({ hooks: [{ type: 'command', command: cmdFor(state) }] });
    s.hooks[ev] = arr;
  }
  saveSettings(s);
  console.log(`cockpit activity 훅 설치 완료 → ${SETTINGS}\n  이벤트: ${Object.keys(EVENTS).join('·')} · 백업: settings.json.cockpit-bak\n  제거: node "${SELF}" uninstall`);
}

function uninstall() {
  const s = loadSettings();
  if (!s.hooks) { console.log('설치된 cockpit 훅 없음'); return; }
  for (const ev of Object.keys(EVENTS)) {
    if (!Array.isArray(s.hooks[ev])) continue;
    s.hooks[ev] = s.hooks[ev].filter((g) => !hasOurs(g));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  saveSettings(s);
  console.log(`cockpit activity 훅 제거 완료 → ${SETTINGS} (wmux 등 다른 훅은 보존)`);
}

// ── 훅 런타임 — 상태 파일 기록 ──
// 세션 모델 실측 — 훅 페이로드에 model이 없어(공식 common fields 밖) transcript_path 꼬리에서
// 최신 assistant의 message.model을 읽는다(§13 "트랜스크립트 파싱 제거"의 유일한 예외).
// 마지막 TAIL 바이트만 읽어 뒤에서부터 스캔 → 파일이 커도 비용 고정. 실패는 전부 null.
const TAIL = 256 * 1024;
function modelFromTranscript(path) {
  if (!path) return null;
  try {
    const size = statSync(path).size;
    if (!size) return null;
    const len = Math.min(size, TAIL);
    const buf = Buffer.alloc(len);
    const fd = openSync(path, 'r');
    try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"model"')) continue; // 값싼 프리필터
      try {
        const m = JSON.parse(lines[i])?.message?.model;
        if (m && m !== '<synthetic>') return m;
      } catch { /* 청크 경계에서 잘린 줄 — 다음 줄 계속 */ }
    }
  } catch { /* 트랜스크립트 없음/읽기 실패 — null */ }
  return null;
}

async function record(state) {
  let cwd = process.cwd(), effort = null, transcript = null;
  try {
    const raw = await readStdin();
    if (raw) {
      const j = JSON.parse(raw);
      if (j && j.cwd) cwd = j.cwd;
      if (j && j.effort && j.effort.level) effort = String(j.effort.level); // 공식 common field — 모델이 effort 미지원이면 부재
      if (j && j.transcript_path) transcript = String(j.transcript_path);
    }
  } catch { /* stdin 없음 — process.cwd() */ }
  // 세션 신원 env 우선(신뢰성 개편 ⑥) — 스폰 시 pane에 주입된 COCKPIT_PROJECT/ROLE.
  // cd로 다른 폴더에 가도 활동이 남의 세션 키로 오귀속되지 않는다. 없으면 cwd 역산(구 세션 호환).
  const envP = (process.env.COCKPIT_PROJECT || '').trim(), envR = (process.env.COCKPIT_ROLE || '').trim();
  const key = envP && envR ? { project: envP, role: envR } : deriveKey(cwd);
  if (!key) return; // cockpit 세션 아님 → 무동작
  mkdirSync(ACT_DIR, { recursive: true });
  const file = join(ACT_DIR, `${sanitize(key.project)}__${sanitize(key.role)}.json`);
  // 이번 관측이 null이면 직전 값 보존(첫 프롬프트엔 assistant 메시지가 아직 없는 등) — 칩 깜빡임 방지.
  let prev = {}; try { prev = JSON.parse(readFileSync(file, 'utf8')) || {}; } catch { /* 첫 기록 */ }
  const model = modelFromTranscript(transcript) || prev.model || null;
  writeFileSync(file, JSON.stringify({
    state, project: key.project, role: key.role, ts: Date.now(),
    model, effort: effort || prev.effort || null,
  }));
}

const arg = process.argv[2];
try {
  if (arg === 'install') install();
  else if (arg === 'uninstall') uninstall();
  else if (arg === 'working' || arg === 'waiting' || arg === 'attention') await record(arg);
  else console.error('사용법: activity-hook.mjs <working|waiting|attention|install|uninstall>');
} catch { /* 훅은 절대 세션을 막지 않는다 */ }
process.exit(0);
