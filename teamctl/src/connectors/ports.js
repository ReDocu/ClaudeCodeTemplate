// ports 커넥터 — 로컬 리스너 → {port, procId, proc, cmd}. (Tech.md §11)
// Get-NetTCPConnection(리스너) + 단일 Get-CimInstance(커맨드라인) 조인. PID별 반복 대신 1회 조회로 ~0.8s.
import { pwsh } from './run.js';

const PS = `
$l = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '0.0.0.0','127.0.0.1','::','::1' } | Select-Object LocalPort,OwningProcess
$m=@{}; foreach($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)){ $m[[int]$p.ProcessId]=$p }
$seen=@{}; $o = foreach($x in ($l | Sort-Object LocalPort)){ $k=""+$x.LocalPort; if($seen[$k]){continue}; $seen[$k]=$true; $q=$m[[int]$x.OwningProcess]; [pscustomobject]@{ port=[int]$x.LocalPort; procId=[int]$x.OwningProcess; proc=$q.Name; cmd=$q.CommandLine } }
@($o) | ConvertTo-Json -Depth 3 -Compress`;

export async function scanPorts() {
  let raw;
  try { raw = (await pwsh(PS)).trim(); } catch { return []; }
  if (!raw || raw === 'null') return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  return Array.isArray(parsed) ? parsed : [parsed]; // 단일 결과는 객체로 옴 → 배열화
}
