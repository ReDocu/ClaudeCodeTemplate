// Claude 사용량 집계 — ~/.claude/projects/*/*.jsonl 트랜스크립트에서 오늘·최근 5시간
// 토큰 사용량을 모델별 합산(ccusage 방식, 의존성 0). GET /api/usage 가 소비.
// 공식 한도(%)는 CLI가 비대화형으로 노출하지 않음 → 트랜스크립트 실측이 유일한 로컬 소스.
// ~/.claude/stats-cache.json 은 스테일(수동 /stats 때만 갱신)이라 부적합.
// 스캔 비용(오늘 파일 수십 MB)이 있어 TTL 60s 캐시 + single-flight.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PROJECTS = join(homedir(), '.claude', 'projects');
const TTL = 60_000;
let cache = null; // { at, data }
let inflight = null;

const emptyTotal = () => ({ in: 0, out: 0, cacheRead: 0, cacheCreate: 0, msgs: 0 });

function aggregate(entries, since) {
  const byModel = {}; const total = emptyTotal();
  for (const e of entries) {
    if (e.ts < since) continue;
    const m = (byModel[e.model] ||= emptyTotal());
    for (const b of [m, total]) {
      b.in += e.in; b.out += e.out; b.cacheRead += e.cacheRead; b.cacheCreate += e.cacheCreate; b.msgs++;
    }
  }
  return { byModel, total };
}

function scan() {
  const now = Date.now();
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const h5 = now - 5 * 3600_000;
  const cutoff = Math.min(dayStart.getTime(), h5); // 5h 창이 자정을 넘는 경우 포함

  // 스트리밍이 같은 message.id 를 여러 줄로 남길 수 있음 → 마지막 관측이 최종값(덮어쓰기)
  const dedup = new Map();
  let files = 0, lastTs = 0;
  let dirs;
  try { dirs = readdirSync(PROJECTS, { withFileTypes: true }); } catch { return null; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const dir = join(PROJECTS, d.name);
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      const p = join(dir, f);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.mtimeMs < cutoff) continue; // 오늘/5h 창에 안 걸린 파일은 통째로 스킵
      files++;
      let text; try { text = readFileSync(p, 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue; // 값싼 프리필터 — assistant 턴만 JSON.parse
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const u = obj?.message?.usage; if (!u) continue;
        const ts = Date.parse(obj.timestamp || '') || 0;
        if (ts < cutoff) continue;
        const model = obj.message.model || '?';
        if (model === '<synthetic>') continue;
        dedup.set(obj.message.id || obj.uuid || `${p}:${ts}`, {
          ts, model,
          in: u.input_tokens || 0, out: u.output_tokens || 0,
          cacheRead: u.cache_read_input_tokens || 0, cacheCreate: u.cache_creation_input_tokens || 0,
        });
        if (ts > lastTs) lastTs = ts;
      }
    }
  }
  const entries = [...dedup.values()];
  return {
    source: 'transcripts',
    today: aggregate(entries, dayStart.getTime()),
    last5h: aggregate(entries, h5),
    lastActivity: lastTs || null,
    scannedFiles: files,
    generatedAt: now,
  };
}

// ===== 5h 한도 추정 — "최대 토큰 vs 남은 토큰" 비교(요구 2) =====
// 공식 한도(플랜별 5h 윈도우)는 CLI/API가 로컬에 노출하지 않음 → 3단 소스:
//   ① config.json "usageMax5h"(수동 지정, 최우선 — 자기 플랜 한도를 알면 여기 적는다)
//   ② 과거 트랜스크립트 전체에서 "연속 5시간 최대 소비" 실측(최초 1회, usage-max.json에 저장)
//   ③ 이후 관측한 5h 사용량이 저장 최대를 넘으면 그 값으로 갱신(한도에 닿은 세션이 상한 근사)
// 셈법: in+out+cacheRead+cacheCreate 총량 — max와 used를 같은 자로 재야 비교가 성립(자기일관).
const CONFIG = fileURLToPath(new URL('../../workspace/config.json', import.meta.url));
const MAXFILE = fileURLToPath(new URL('../../workspace/usage-max.json', import.meta.url));
const tokOf = (t) => (t.in || 0) + (t.out || 0) + (t.cacheRead || 0) + (t.cacheCreate || 0);
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

let _histStarted = false;
function ensureHistoryMax() {
  if (_histStarted) return;
  _histStarted = true;
  if (readJson(MAXFILE)) return; // 이미 학습/관측된 값 있음
  historyMax5h().then((max) => {
    // 완료 표식으로 0이어도 기록(관측 학습 활성화 조건) — 단 더 큰 기존 값은 보존
    const cur = readJson(MAXFILE);
    if (!cur || max > (cur.max5h || 0)) {
      try { writeFileSync(MAXFILE, JSON.stringify({ max5h: max, source: 'history', at: Date.now() })); } catch {}
    }
    cache = null; // 다음 조회부터 한도 반영
  }).catch(() => {});
}

// 전 기간 usage 라인을 시간당 버킷으로 합산 → 연속 5버킷 합의 최대(≈역대 최대 5h 소비).
// 전체 이력이 수백 MB일 수 있어 디렉터리 단위로 이벤트 루프에 양보(폴링 응답 비차단).
async function historyMax5h() {
  const buckets = new Map(); // hourIdx -> tokens
  let dirs;
  try { dirs = readdirSync(PROJECTS, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return 0; }
  for (const d of dirs) {
    await new Promise((r) => setImmediate(r));
    const dir = join(PROJECTS, d.name);
    let names = []; try { names = readdirSync(dir); } catch { continue; }
    for (const f of names) {
      if (!f.endsWith('.jsonl')) continue;
      let text; try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      const dedup = new Map(); // 스트리밍 중복(같은 message.id)은 파일 내에서만 발생 — 파일 단위 dedup
      for (const line of text.split('\n')) {
        if (!line.includes('"usage"')) continue;
        let obj; try { obj = JSON.parse(line); } catch { continue; }
        const u = obj?.message?.usage; if (!u) continue;
        const ts = Date.parse(obj.timestamp || '') || 0; if (!ts) continue;
        if (obj.message.model === '<synthetic>') continue;
        dedup.set(obj.message.id || obj.uuid || String(ts), {
          ts,
          tok: (u.input_tokens || 0) + (u.output_tokens || 0)
            + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        });
      }
      for (const e of dedup.values()) {
        const h = Math.floor(e.ts / 3600_000);
        buckets.set(h, (buckets.get(h) || 0) + e.tok);
      }
    }
  }
  let max = 0;
  for (const h of buckets.keys()) {
    let s = 0;
    for (let i = 0; i < 5; i++) s += buckets.get(h + i) || 0;
    if (s > max) max = s;
  }
  return max;
}

function limitFor(used5h) {
  const cfg = readJson(CONFIG);
  let max = null, source = null;
  if (cfg && Number(cfg.usageMax5h) > 0) {
    max = Number(cfg.usageMax5h); source = 'config';
  } else {
    const mf = readJson(MAXFILE);
    // 이력 학습 완료 전(MAXFILE 없음)엔 한도 미정 — 현재 사용량을 max로 오인해
    // "100% 사용·남음 0"으로 시작하는 콜드 스타트 왜곡을 막는다.
    if (!mf) return { max: null, source: null, used: used5h, remaining: null, pct: null };
    if (mf.max5h > 0) { max = mf.max5h; source = mf.source || 'history'; }
    if (used5h > (mf.max5h || 0)) { // 관측이 저장 최대를 초과 — 상한 추정 상향 학습
      try { writeFileSync(MAXFILE, JSON.stringify({ max5h: used5h, source: 'observed', at: Date.now() })); } catch {}
      max = used5h; source = 'observed';
    }
  }
  if (!max) return { max: null, source: null, used: used5h, remaining: null, pct: null };
  return {
    max, source, used: used5h,
    remaining: Math.max(0, max - used5h),
    pct: Math.min(100, Math.round((used5h / max) * 100)),
  };
}

export async function getUsage({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  if (inflight) return inflight;
  inflight = (async () => {
    ensureHistoryMax(); // 최초 1회 — 백그라운드로 역대 최대 5h 소비 학습
    const data = scan() || {
      source: null, scannedFiles: 0, lastActivity: null,
      today: { byModel: {}, total: emptyTotal() }, last5h: { byModel: {}, total: emptyTotal() },
      generatedAt: Date.now(),
    };
    data.limit = limitFor(tokOf(data.last5h.total)); // 5h 사용 vs 최대 → 남은 토큰
    cache = { at: Date.now(), data };
    return data;
  })().finally(() => { inflight = null; });
  return inflight;
}
