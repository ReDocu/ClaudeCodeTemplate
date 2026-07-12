// Claude 사용량 집계 (FS-16) — 구 live/usage.js 참고 재작성. 트랜스크립트의 usage 필드만 합산
// (활동 분류 아님 — §13 "트랜스크립트 파싱 제거"의 명시적 예외). 경로 인코딩은 계승 규칙 ④ 영역이나
// 여기선 전 디렉터리를 스캔하므로 인코딩 역변환이 불필요하다.
// 한도 윈도 3개(Claude 플랜 구조 동형): 5h(전 모델) · week(7일 전 모델) · week-opus(7일 Opus만).
// 최대치: config.usageMax5h/usageMaxWeek/usageMaxWeekOpus(수동 최우선) → 윈도별 관측 학습
// (최초 1회 역대 이력 학습 → 이후 관측 상향). TTL 60s 캐시 + single-flight(§9-⑥).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { readConfig } from './registry.js';

const PROJECTS = join(homedir(), '.claude', 'projects');
const MAXFILE = fileURLToPath(new URL('../workspace/usage-max.json', import.meta.url));
const TTL = 60_000;
const H = 3600_000, WEEK = 7 * 24 * H;
const isOpus = (model) => /opus|fable|mythos/i.test(model || ''); // 최상위 티어 계열 — 주간 Opus 윈도
const tokOf = (u) => (u.input_tokens || 0) + (u.output_tokens || 0)
  + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

let cache = null, inflight = null;

// 최근 7일 창 스캔 — mtime 필터로 오래된 파일 통째 스킵. 스트리밍 중복(같은 message.id)은
// 마지막 관측이 최종값(덮어쓰기 — 구 구현 계승).
function scan() {
  const now = Date.now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const cutoff = now - WEEK;
  const dedup = new Map();
  let lastTs = 0;
  let dirs;
  try { dirs = readdirSync(PROJECTS, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = join(PROJECTS, d.name);
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(dir, f);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs < cutoff) continue;
      let text; try { text = readFileSync(p, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue; // 값싼 프리필터
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const u = obj?.message?.usage; if (!u) continue;
        const ts = Date.parse(obj.timestamp || '') || 0;
        if (ts < cutoff) continue;
        const model = obj.message.model || '?';
        if (model === '<synthetic>') continue;
        dedup.set(obj.message.id || obj.uuid || `${p}:${ts}`, {
          ts, model, tok: tokOf(u), in: u.input_tokens || 0, out: u.output_tokens || 0,
        });
        if (ts > lastTs) lastTs = ts;
      }
    }
  }
  const entries = [...dedup.values()];
  const h5 = now - 5 * H;
  const used = { '5h': 0, week: 0, 'week-opus': 0 };
  const today = { in: 0, out: 0 };
  for (const e of entries) {
    used.week += e.tok;
    if (isOpus(e.model)) used['week-opus'] += e.tok;
    if (e.ts >= h5) used['5h'] += e.tok;
    if (e.ts >= dayStart.getTime()) { today.in += e.in; today.out += e.out; }
  }
  return { used, today, lastActivity: lastTs || null };
}

// ── 최대치 학습 — 역대 이력을 시간 버킷으로 1회 합산 → 5h/168h 슬라이딩 최대(전체·Opus별) ──
let _histStarted = false;
function ensureHistoryMax() {
  if (_histStarted) return;
  _histStarted = true;
  if (readJson(MAXFILE)) return;
  historyMax().then((m) => {
    const cur = readJson(MAXFILE);
    if (!cur) { try { writeFileSync(MAXFILE, JSON.stringify({ ...m, source: 'history', at: Date.now() })); } catch { /* 학습 저장 실패 — 다음 기동에 재시도 */ } }
    cache = null; // 다음 조회부터 반영
  }).catch(() => {});
}

async function historyMax() {
  const all = new Map(), opus = new Map(); // hourIdx → tokens
  let dirs;
  try { dirs = readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return { max5h: 0, maxWeek: 0, maxWeekOpus: 0 }; }
  for (const d of dirs) {
    await new Promise((r) => setImmediate(r)); // 디렉터리 단위 양보 — 폴링 응답 비차단
    const dir = join(PROJECTS, d.name);
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      let text; try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      const dedup = new Map();
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const u = obj?.message?.usage; if (!u) continue;
        const ts = Date.parse(obj.timestamp || '') || 0; if (!ts) continue;
        if (obj.message.model === '<synthetic>') continue;
        dedup.set(obj.message.id || obj.uuid || String(ts), { ts, tok: tokOf(u), opus: isOpus(obj.message.model) });
      }
      for (const e of dedup.values()) {
        const h = Math.floor(e.ts / H);
        all.set(h, (all.get(h) || 0) + e.tok);
        if (e.opus) opus.set(h, (opus.get(h) || 0) + e.tok);
      }
    }
  }
  const slideMax = (buckets, span) => {
    let max = 0;
    for (const h of buckets.keys()) {
      let s = 0;
      for (let i = 0; i < span; i++) s += buckets.get(h + i) || 0;
      if (s > max) max = s;
    }
    return max;
  };
  return { max5h: slideMax(all, 5), maxWeek: slideMax(all, 168), maxWeekOpus: slideMax(opus, 168) };
}

const WIN_DEFS = [
  { id: '5h', label: '5시간', cfgKey: 'usageMax5h', maxKey: 'max5h' },
  { id: 'week', label: '주간·전체', cfgKey: 'usageMaxWeek', maxKey: 'maxWeek' },
  { id: 'week-opus', label: '주간·Opus', cfgKey: 'usageMaxWeekOpus', maxKey: 'maxWeekOpus' },
];

function buildWindows(used) {
  const cfg = readConfig();
  const mf = readJson(MAXFILE);
  let mfDirty = false;
  const windows = WIN_DEFS.map((w) => {
    const u = used[w.id] || 0;
    let max = null, source = null;
    if (Number(cfg[w.cfgKey]) > 0) { max = Number(cfg[w.cfgKey]); source = 'config'; }
    else if (mf) { // 이력 학습 완료 전(MAXFILE 없음)엔 미정 — 콜드 스타트 "100% 만재" 왜곡 방지(계승)
      if (mf[w.maxKey] > 0) { max = mf[w.maxKey]; source = mf.source === 'observed' ? 'observed' : 'history'; }
      if (u > (mf[w.maxKey] || 0)) { mf[w.maxKey] = u; mfDirty = true; max = u; source = 'observed'; } // 관측 상향 학습
    }
    if (!max) return { id: w.id, label: w.label, used: u, max: null, remaining: null, pct: null, source: null };
    return {
      id: w.id, label: w.label, used: u, max, source,
      remaining: Math.max(0, max - u),
      pct: Math.min(100, Math.round((u / max) * 100)),
    };
  });
  if (mfDirty) { try { writeFileSync(MAXFILE, JSON.stringify({ ...mf, source: 'observed', at: Date.now() })); } catch { /* 상향 저장 실패 — 다음 조회 재시도 */ } }
  return windows;
}

export async function getUsage({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    ensureHistoryMax(); // 최초 1회 — 백그라운드 이력 학습
    const s = scan() || { used: { '5h': 0, week: 0, 'week-opus': 0 }, today: { in: 0, out: 0 }, lastActivity: null };
    const data = {
      windows: buildWindows(s.used),
      today: s.today,
      lastActivity: s.lastActivity,
      generatedAt: Date.now(),
    };
    cache = { at: Date.now(), data };
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}
