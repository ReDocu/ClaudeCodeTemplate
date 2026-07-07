#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""HTML 대시보드 생성기 — 디자인 C안 (사이드바 드릴다운).

사양: PRD_dashboard.md. 루트에서 실행:
    python 10_Dashboard/tools/generate_dashboard.py

출력:
    10_Dashboard/dashboard.html                     (관리자 — 전 팀)
    00_Team/ProjectTeam_{팀명}/10_Dashboard/dashboard.html  (팀별 — 자기 팀 데이터만)

원칙: md가 진실의 원천 — 이 스크립트는 md를 읽기만 하고 절대 수정하지 않는다.
표준 라이브러리만 사용, 외부 요청 0 (file:// 동작).
"""
import io
import json
import os
import re
import sys
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REQUIRED = {"00_Project", "10_Dashboard", "11_team_doc", "90_result_output"}
STALE_DAYS = 7
TODAY = datetime.now().date()
GENERATED = datetime.now().strftime("%Y-%m-%d %H:%M")


# ── md 파싱 유틸 ──────────────────────────────────────────────

def read(path):
    try:
        with io.open(path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception:
        return None


def sections(md):
    """'## 제목' 단위로 본문을 나눈다 → [(제목, 본문)]"""
    out, cur, buf = [], None, []
    for line in (md or "").splitlines():
        m = re.match(r"^##\s+(.+)$", line)
        if m:
            if cur is not None:
                out.append((cur, "\n".join(buf).strip()))
            cur, buf = m.group(1).strip(), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out.append((cur, "\n".join(buf).strip()))
    return out


def sec(md, prefix):
    for title, body in sections(md):
        if title.startswith(prefix):
            return body
    return None


def title_info(md):
    first = (md or "").splitlines()[0] if md else ""
    m = re.search(r"\(갱신:\s*(\d{4}-\d{2}-\d{2})", first)
    return {
        "date": m.group(1) if m else None,
        "closed": "[종료]" in first,
        "hold": "[보류]" in first,
    }


def table_map(body):
    """| 항목 | 값 | 표 → dict"""
    out = {}
    for line in (body or "").splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0] and not set(cells[0]) <= set("- :"):
            out[cells[0]] = cells[1]
    return out


def status_key(value):
    v = value or ""
    if "🟢" in v:
        return "good"
    if "🟡" in v:
        return "warn"
    if "🔴" in v:
        return "crit"
    return "idle"


def list_items(body, limit=3):
    items = []
    for line in (body or "").splitlines():
        m = re.match(r"^\s*(?:[-*]|\d+\.)\s+(.+)$", line)
        if m:
            text = m.group(1).strip()
            if text and not text.startswith("("):
                items.append(text)
    return items[:limit]


def first_para(body, limit=140):
    for line in (body or "").splitlines():
        t = line.strip()
        if t and not t.startswith(("(", "|", "<!--", "#")):
            return t[:limit]
    return None


def days_old(datestr):
    try:
        d = datetime.strptime(datestr, "%Y-%m-%d").date()
        return (TODAY - d).days
    except Exception:
        return None


def pct_num(value):
    m = re.search(r"(\d{1,3})\s*%", value or "")
    return min(int(m.group(1)), 100) if m else None


def recent_files(folder, limit=5):
    try:
        names = [n for n in os.listdir(folder)
                 if os.path.isfile(os.path.join(folder, n)) and not n.startswith(".")
                 and n.lower() not in ("readme.md",)]
        return sorted(names, reverse=True)[:limit]
    except Exception:
        return []


# ── 스캔: 프로젝트 / 역할 / 팀 ────────────────────────────────

def parse_project(pdir, name):
    md = read(os.path.join(pdir, "process.md"))
    if md is None:
        return {"name": name, "missing": True}
    info = title_info(md)
    status_tbl = table_map(sec(md, "상태 요약"))
    stage_body = sec(md, "현재 단계") or ""
    stage = None
    m = re.search(r"\*\*([^*]+)\*\*", stage_body)
    if m:
        stage = m.group(1).strip()
    blockers = [b for b in list_items(sec(md, "블로커"), 5)
                if b and "없음" not in b]
    age = days_old(info["date"]) if info["date"] else None
    return {
        "name": name,
        "missing": False,
        "closed": info["closed"],
        "hold": info["hold"],
        "date": info["date"],
        "stale": age is not None and age > STALE_DAYS,
        "stage": stage,
        "st": status_key(status_tbl.get("상태등")),
        "pct": pct_num(status_tbl.get("진행률")),
        "owner": first_para(status_tbl.get("담당", "")) if status_tbl.get("담당") else None,
        "due": status_tbl.get("목표일"),
        "recent": list_items(sec(md, "진행 기록"), 2),
        "next": list_items(sec(md, "다음 할 일"), 3),
        "blockers": blockers,
    }


def parse_role(rdir, folder):
    role = re.sub(r"^\d+_", "", folder)
    ho = None
    for n in sorted(os.listdir(rdir)):
        if n.startswith("handover_") and n.endswith(".md"):
            ho = os.path.join(rdir, n)
            break
    md = read(ho) if ho else None
    if md is None:
        return {"folder": folder, "role": role, "missing": True}
    info = title_info(md)
    age = days_old(info["date"]) if info["date"] else None
    return {
        "folder": folder,
        "role": role,
        "missing": False,
        "date": info["date"],
        "stale": age is not None and age > STALE_DAYS,
        "state": first_para(sec(md, "현재 상태")),
        "doing": list_items(sec(md, "진행 중인 것"), 3),
        "next": list_items(sec(md, "다음 할 일"), 3),
    }


def parse_team(tdir, folder):
    name = folder.replace("ProjectTeam_", "", 1)
    warnings = []

    # 팀 대시보드(md)의 상태 요약 — /report가 갱신한 값
    dash = read(os.path.join(tdir, "10_Dashboard", "DASHBOARD.md"))
    tbl = table_map(sec(dash, "상태 요약")) if dash else {}
    reported = bool(tbl) and "초기" not in (tbl.get("상태등") or "")

    # 프로젝트
    projects = []
    pdir = os.path.join(tdir, "00_Project")
    if os.path.isdir(pdir):
        for n in sorted(os.listdir(pdir)):
            sub = os.path.join(pdir, n)
            if os.path.isdir(sub) and re.match(r"^\d+_", n):
                p = parse_project(sub, n)
                if p.get("missing"):
                    warnings.append(f"{n}: process.md 없음")
                projects.append(p)
    else:
        warnings.append("00_Project 폴더 없음")

    # 역할
    roles = []
    for n in sorted(os.listdir(tdir)):
        sub = os.path.join(tdir, n)
        if os.path.isdir(sub) and n not in REQUIRED and not n.startswith("."):
            if n == "_pipeline":
                continue
            r = parse_role(sub, n)
            if r.get("missing"):
                warnings.append(f"{n}: handover 미작성")
            roles.append(r)

    # 최근 갱신일 = 역할/프로젝트 날짜의 최댓값
    dates = [x["date"] for x in projects + roles if x.get("date")]
    updated = max(dates) if dates else None
    age = days_old(updated) if updated else None

    active = [p for p in projects if not p.get("missing") and not p["closed"]]
    blockers = []
    for p in active:
        for b in p["blockers"]:
            blockers.append({"project": p["name"], "text": b})

    return {
        "name": name,
        "folder": folder,
        "st": status_key(tbl.get("상태등")) if reported else "idle",
        "pct": pct_num(tbl.get("전체 진행률")) if reported else None,
        "milestone": tbl.get("다음 마일스톤") if reported else None,
        "reported": reported,
        "updated": updated,
        "stale": age is not None and age > STALE_DAYS,
        "projects": projects,
        "roles": roles,
        "blockers": blockers,
        "warnings": warnings,
        "docs": recent_files(os.path.join(tdir, "11_team_doc")),
        "backups": recent_files(os.path.join(tdir, "90_result_output")),
    }


def scan():
    teams = []
    base = os.path.join(ROOT, "00_Team")
    if os.path.isdir(base):
        for n in sorted(os.listdir(base)):
            sub = os.path.join(base, n)
            if os.path.isdir(sub) and n.startswith("ProjectTeam_") and "양식" not in n:
                teams.append(parse_team(sub, n))
    return teams


# ── HTML 렌더 (디자인 C안 — 사이드바 드릴다운) ─────────────────

TEMPLATE = """<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  :root{
    --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
    --grid:#e1e0d9; --border:rgba(11,11,11,.10);
    --blue:#2a78d6; --blue-track:#cde2fb; --hover:rgba(42,120,214,.08);
    --good:#0ca30c; --warn:#fab219; --serious:#ec835a; --crit:#d03b3b; --idle:#898781;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --page:#0d0d0d; --surface:#1a1a19; --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
      --grid:#2c2c2a; --border:rgba(255,255,255,.10);
      --blue:#3987e5; --blue-track:#0d366b; --hover:rgba(57,135,229,.12);
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.5}
  .app{display:flex;min-height:100vh}
  aside{width:230px;flex:none;background:var(--surface);border-right:1px solid var(--grid);padding:20px 12px;display:flex;flex-direction:column;gap:2px}
  aside .brand{font-size:15px;font-weight:700;padding:0 10px 6px}
  aside .brand small{display:block;font-weight:400;font-size:11px;color:var(--muted)}
  aside .sect{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:14px 10px 4px}
  aside button,aside a.navlink{display:flex;align-items:center;gap:8px;width:100%;border:0;background:transparent;color:var(--ink-2);font:inherit;font-size:13px;text-align:left;padding:8px 10px;border-radius:8px;cursor:pointer;text-decoration:none}
  aside button:hover,aside a.navlink:hover{background:var(--hover)}
  aside button.on{background:var(--blue);color:#fff}
  aside button.on .sub{color:rgba(255,255,255,.75)}
  aside button .sub{margin-left:auto;font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
  .dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 0 2px var(--surface)}
  .dot.good{background:var(--good)} .dot.warn{background:var(--warn)} .dot.crit{background:var(--crit)} .dot.idle{background:var(--idle)}
  aside .foot{margin-top:auto;font-size:11px;color:var(--muted);padding:10px}
  main{flex:1;padding:28px 32px;max-width:900px;min-width:0}
  .crumb{font-size:12px;color:var(--muted);margin-bottom:4px}
  .crumb a{color:var(--blue);cursor:pointer;text-decoration:none}
  h1{font-size:20px;font-weight:650;display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap}
  .st{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--ink-2);white-space:nowrap}
  .chip{display:inline-block;font-size:11px;font-weight:600;border-radius:5px;padding:1px 7px;color:#7a2e12;background:color-mix(in srgb,var(--serious) 22%,var(--surface))}
  @media (prefers-color-scheme: dark){ .chip{color:#ffc9b3} }
  .chip.gray{color:var(--ink-2);background:var(--hover)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:22px}
  .kpi{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px}
  .kpi .label{font-size:11px;color:var(--muted)}
  .kpi .value{font-size:24px;font-weight:600}
  .kpi .value small{font-size:12px;font-weight:400;color:var(--muted)}
  .meter{height:7px;border-radius:4px;background:var(--blue-track);overflow:hidden;margin-top:8px}
  .meter i{display:block;height:100%;background:var(--blue);border-radius:4px 0 0 4px}
  h2{font-size:13px;font-weight:650;margin:22px 0 8px}
  .panel{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:2px 14px;margin-bottom:6px}
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--grid);font-size:13px}
  .row:last-child{border-bottom:0}
  .row .r{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap}
  .row.click{cursor:pointer;margin:0 -14px;padding-left:14px;padding-right:14px}
  .row.click:hover{background:var(--hover)}
  .empty{color:var(--muted);font-size:13px;padding:10px 0}
  details.acc{border:1px solid var(--border);border-radius:10px;background:var(--surface);margin-bottom:8px;overflow:hidden}
  details.acc summary{list-style:none;display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;flex-wrap:wrap}
  details.acc summary::-webkit-details-marker{display:none}
  details.acc summary:hover{background:var(--hover)}
  details.acc .rn{font-weight:650}
  details.acc .path{font-size:11px;color:var(--muted)}
  details.acc summary .right{margin-left:auto;display:flex;align-items:center;gap:12px;font-size:12px;color:var(--muted)}
  details.acc .body{border-top:1px solid var(--grid);padding:12px 16px;font-size:13px;color:var(--ink-2)}
  details.acc .body b{display:block;font-size:12px;color:var(--ink);margin-top:8px}
  details.acc .body ol,details.acc .body ul{margin:4px 0 0 18px}
  .hide{display:none}
  footer{margin-top:30px;font-size:11px;color:var(--muted)}
  @media (max-width:720px){ .app{flex-direction:column} aside{width:100%;flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--grid)} aside .foot,aside .sect{display:none} aside button{width:auto} }
</style>
</head>
<body>
<div class="app">
  <aside id="nav"></aside>
  <main>
    <div id="content"></div>
    <footer>md가 진실의 원천 — 이 페이지는 생성기(10_Dashboard/tools/generate_dashboard.py)가 만든 열람용 뷰입니다.
    반영할 내용은 handover/process/report에 쓰고 /dashboard 로 재생성하세요.</footer>
  </main>
</div>
<script>
const DATA = __DATA__;
const CFG = __CFG__;
const ST_TXT = {good:"정상", warn:"지연", crit:"블로킹", idle:"대기"};
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const dotTxt = (st, txt) => `<span class="st"><i class="dot ${st}"></i>${esc(txt ?? ST_TXT[st])}</span>`;

function nav(activeKey){
  const el = document.getElementById("nav");
  let html = `<div class="brand">${esc(CFG.brand)}<small>생성 ${esc(CFG.generated)}</small></div>`;
  if(CFG.isTeamPage){
    html += `<div class="sect">전체</div><a class="navlink" href="${esc(CFG.backHref)}">▤ 관리자 대시보드</a>`;
    html += `<div class="sect">팀</div>`;
  } else {
    html += `<div class="sect">전체</div><button id="nav-all" class="${activeKey==="all"?"on":""}" onclick="go('all')">▤ 관리자 대시보드</button>`;
    html += `<div class="sect">팀 (00_Team)</div>`;
  }
  if(!DATA.teams.length) html += `<div class="empty" style="padding:6px 10px">팀 없음</div>`;
  DATA.teams.forEach((t,i)=>{
    html += `<button id="nav-${i}" class="${activeKey===i?"on":""}" onclick="go(${i})">`+
      `<i class="dot ${t.st}"></i>${esc(t.name)}<span class="sub">${t.pct==null?"—":t.pct+"%"}</span></button>`;
  });
  html += `<div class="foot">md가 진실의 원천<br>/dashboard 로 재생성</div>`;
  el.innerHTML = html;
}

function kpi(label, valueHtml, meterPct){
  return `<div class="kpi"><div class="label">${esc(label)}</div><div class="value">${valueHtml}</div>`+
    (meterPct==null?"":`<div class="meter"><i style="width:${meterPct}%"></i></div>`)+`</div>`;
}

function adminView(){
  const T = DATA.teams;
  const cnt = k => T.filter(t=>t.st===k).length;
  const stale = T.filter(t=>t.stale).length;
  const blockers = T.reduce((a,t)=>a+t.blockers.length,0);
  let html = `<div class="crumb">전체</div><h1>관리자 대시보드 — 팀들의 현황</h1>`;
  html += `<div class="kpis">`+
    kpi("전체 팀", String(T.length))+
    kpi("상태 분포", `<span style="font-size:14px;display:grid;gap:2px;margin-top:4px">${dotTxt("good","정상 "+cnt("good"))}${dotTxt("warn","지연 "+cnt("warn"))}${dotTxt("crit","블로킹 "+cnt("crit"))}${dotTxt("idle","대기 "+cnt("idle"))}</span>`)+
    kpi("STALE (7일↑)", String(stale))+
    kpi("블로커", `${blockers} <small>건</small>`)+`</div>`;
  html += `<h2>팀 목록 — 행 클릭 시 팀 대시보드</h2><div class="panel">`;
  if(!T.length) html += `<div class="empty">아직 팀이 없습니다 — 루트에서 /new_team {팀명} 으로 시작하세요.</div>`;
  T.forEach((t,i)=>{
    const badges = (t.stale?` <span class="chip">⚠ STALE</span>`:"")+(t.reported?"":` <span class="chip gray">미보고</span>`);
    html += `<div class="row click" onclick="go(${i})"><span>${dotTxt(t.st)} <b>${esc(t.name)}</b> · ${t.pct==null?"—":t.pct+"%"} · ${esc(t.milestone||"마일스톤 미정")}${badges}</span><span class="r">갱신 ${esc(t.updated||"—")} →</span></div>`;
  });
  html += `</div>`;
  html += `<h2>크로스팀 이슈 / 블로커</h2><div class="panel">`;
  const allB = T.flatMap(t=>t.blockers.map(b=>({team:t.name, ...b})));
  html += allB.length ? allB.map(b=>`<div class="row"><span>${dotTxt("crit")} [${esc(b.team)}/${esc(b.project)}] ${esc(b.text)}</span></div>`).join("") : `<div class="empty">없음</div>`;
  html += `</div>`;
  html += `<h2>최근 결과물 (11_doc_result 최신 5건)</h2><div class="panel">`;
  html += DATA.rootDocs.length ? DATA.rootDocs.map(f=>`<div class="row"><span>${esc(f)}</span></div>`).join("") : `<div class="empty">없음</div>`;
  html += `</div>`;
  const warn = T.flatMap(t=>t.warnings.map(w=>`${t.name}: ${w}`));
  if(warn.length){
    html += `<h2>경고 (구조·파싱)</h2><div class="panel">`+warn.map(w=>`<div class="row"><span>⚠ ${esc(w)}</span></div>`).join("")+`</div>`;
  }
  return html;
}

function teamView(t){
  const home = CFG.isTeamPage
    ? `<a href="${esc(CFG.backHref)}">전체</a>`
    : `<a onclick="go('all')">전체</a>`;
  let html = `<div class="crumb">${home} / ${esc(t.name)}</div>`;
  html += `<h1>${esc(t.name)} ${dotTxt(t.st)}${t.stale?` <span class="chip">⚠ STALE</span>`:""}${t.reported?"":` <span class="chip gray">미보고 — /report 필요</span>`}</h1>`;
  html += `<div class="kpis">`+
    kpi("전체 진행률", t.pct==null?"—":`${t.pct}<small>%</small>`, t.pct)+
    kpi("다음 마일스톤", `<span style="font-size:16px">${esc(t.milestone||"미정")}</span>`)+
    kpi("블로커", `<span style="font-size:16px">${t.blockers.length? t.blockers.length+"건":"없음"}</span>`)+
    kpi("최근 갱신", `<span style="font-size:16px">${esc(t.updated||"—")}</span>`)+`</div>`;

  html += `<h2>진행 중 프로젝트 (00_Project — process.md 기반)</h2>`;
  const act = t.projects.filter(p=>!p.missing && !p.closed);
  if(!act.length) html += `<div class="panel"><div class="empty">진행 중 프로젝트 없음 — 팀 폴더에서 /new_project</div></div>`;
  act.forEach(p=>{
    const badge = (p.hold?` <span class="chip gray">보류</span>`:"")+(p.stale?` <span class="chip">⚠ STALE</span>`:"");
    html += `<details class="acc"><summary><i class="dot ${p.st}"></i><span class="rn">${esc(p.name)}</span>`+
      `<span class="path">${esc(p.stage||"단계 미지정")} 단계 · ${p.pct==null?"—":p.pct+"%"}</span>${badge}`+
      `<span class="right"><span>갱신 ${esc(p.date||"—")}</span><span>▾</span></span></summary><div class="body">`;
    if(p.recent.length) html += `<b>최근 진행</b><ul>${p.recent.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`;
    if(p.next.length) html += `<b>다음 할 일</b><ol>${p.next.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`;
    html += `<b>블로커</b>`+(p.blockers.length?`<ul>${p.blockers.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:` <span style="color:var(--muted)">없음</span>`);
    if(p.due||p.owner) html += `<b>담당/목표일</b> ${esc(p.owner||"—")} · ${esc(p.due||"미정")}`;
    html += `</div></details>`;
  });
  const done = t.projects.filter(p=>p.closed);
  if(done.length){
    html += `<div class="panel">`+done.map(p=>`<div class="row"><span>${dotTxt("idle")} ${esc(p.name)} <b style="color:var(--ink-2)">[종료]</b></span><span class="r">아카이브 후보</span></div>`).join("")+`</div>`;
  }

  html += `<h2>역할별 현황 — handover_{역할}.md 기반</h2>`;
  t.roles.forEach(r=>{
    if(r.missing){
      html += `<details class="acc"><summary><i class="dot idle"></i><span class="rn">${esc(r.role)}</span><span class="path">${esc(r.folder)}</span><span class="right"><span class="chip gray">handover 미작성</span></span></summary></details>`;
      return;
    }
    html += `<details class="acc"><summary><i class="dot ${r.stale?"warn":"good"}"></i><span class="rn">${esc(r.role)}</span><span class="path">${esc(r.folder)}</span>`+
      (r.stale?` <span class="chip">⚠ STALE</span>`:"")+
      `<span class="right"><span>handover ${esc(r.date||"—")}</span><span>▾</span></span></summary><div class="body">`+
      (r.state?`현재 상태: ${esc(r.state)}`:"")+
      (r.doing.length?`<b>진행 중</b><ul>${r.doing.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:"")+
      (r.next.length?`<b>다음 할 일</b><ol>${r.next.map(x=>`<li>${esc(x)}</li>`).join("")}</ol>`:"")+
      `</div></details>`;
  });

  html += `<h2>최근 문서 (11_team_doc)</h2><div class="panel">`+
    (t.docs.length?t.docs.map(f=>`<div class="row"><span>${esc(f)}</span></div>`).join(""):`<div class="empty">없음</div>`)+`</div>`;
  html += `<h2>완료 백업 (90_result_output)</h2><div class="panel">`+
    (t.backups.length?t.backups.map(f=>`<div class="row"><span>${esc(f)}</span></div>`).join(""):`<div class="empty">없음</div>`)+`</div>`;
  return html;
}

function go(key){
  const c = document.getElementById("content");
  c.innerHTML = (key==="all") ? adminView() : teamView(DATA.teams[key]);
  nav(key);
  window.scrollTo(0,0);
}
go(CFG.isTeamPage ? 0 : "all");
</script>
</body>
</html>
"""


def render(title, data, cfg):
    return (TEMPLATE
            .replace("__TITLE__", title)
            .replace("__DATA__", json.dumps(data, ensure_ascii=False))
            .replace("__CFG__", json.dumps(cfg, ensure_ascii=False)))


def write_out(path, html):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(html)


def main():
    teams = scan()
    root_docs = recent_files(os.path.join(ROOT, "11_doc_result"))
    root_docs = [f for f in root_docs if f.lower() != "index.md"]

    # 관리자 대시보드 (전 팀)
    write_out(
        os.path.join(ROOT, "10_Dashboard", "dashboard.html"),
        render("프로젝트 현황판 — 관리자 대시보드",
               {"teams": teams, "rootDocs": root_docs},
               {"brand": "ClaudeTemplate", "generated": GENERATED,
                "isTeamPage": False, "backHref": ""}))

    # 팀별 대시보드 (자기 팀 데이터만 — 격리)
    for t in teams:
        write_out(
            os.path.join(ROOT, "00_Team", t["folder"], "10_Dashboard", "dashboard.html"),
            render(f"팀 현황판 — {t['name']}",
                   {"teams": [t], "rootDocs": []},
                   {"brand": t["name"], "generated": GENERATED,
                    "isTeamPage": True,
                    "backHref": "../../../10_Dashboard/dashboard.html"}))

    # 요약 출력
    st_cnt = {}
    for t in teams:
        st_cnt[t["st"]] = st_cnt.get(t["st"], 0) + 1
    warns = [f"{t['name']}: {w}" for t in teams for w in t["warnings"]]
    print(f"[dashboard] 팀 {len(teams)}개 · 상태 {st_cnt or '—'} · "
          f"STALE {sum(1 for t in teams if t['stale'])} · 경고 {len(warns)}")
    for w in warns:
        print(f"  ⚠ {w}")
    print(f"[dashboard] 생성: 10_Dashboard/dashboard.html + 팀 페이지 {len(teams)}개 ({GENERATED})")


if __name__ == "__main__":
    sys.exit(main())
