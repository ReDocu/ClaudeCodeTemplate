// Claude Cockpit 런처(F12) — 더블클릭 진입점(.exe). 로직은 cockpit boot(JS)에 있고,
// 이 스텁은 전제조건 검사 + 위임 + 실패 시 창 유지만 담당한다. 빌드: launcher/build.cmd
// (Windows 동봉 .NET Framework csc.exe 사용 — C# 5 문법 제한: 문자열 보간 금지)
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

class CockpitLauncher
{
    static int Main(string[] args)
    {
        try { Console.OutputEncoding = Encoding.UTF8; } catch { } // 한국어 콘솔 출력(자식 node 포함)
        Console.Title = "Claude Cockpit";
        string baseDir = AppDomain.CurrentDomain.BaseDirectory; // exe 위치 = 템플릿 루트 가정
        string bootJs = Path.Combine(baseDir, "cockpit", "bin", "cockpit.js");

        if (!File.Exists(bootJs))
        {
            Console.WriteLine("[launcher] cockpit\\bin\\cockpit.js 를 찾을 수 없습니다. 이 실행 파일은 템플릿 폴더 루트에 있어야 합니다.");
            return Pause(1);
        }
        if (!CommandExists("node"))
        {
            Console.WriteLine("[launcher] Node.js를 찾을 수 없습니다. https://nodejs.org 에서 LTS를 설치한 뒤 다시 실행하세요.");
            return Pause(1);
        }

        var psi = new ProcessStartInfo("node", Quote(bootJs) + " boot");
        psi.UseShellExecute = false;      // 콘솔 상속 — 서버가 되면 이 창이 서버 콘솔
        psi.WorkingDirectory = baseDir;
        try
        {
            using (var p = Process.Start(psi))
            {
                p.WaitForExit();          // 서버 모드면 여기서 상주(창 닫기 = 서버 종료, wmux 세션은 유지)
                if (p.ExitCode != 0)
                {
                    Console.WriteLine();
                    Console.WriteLine("[launcher] 부트 실패 — 위 안내를 확인한 뒤 다시 실행하세요.");
                    return Pause(p.ExitCode);
                }
            }
        }
        catch (Exception e)
        {
            Console.WriteLine("[launcher] node 실행 실패: " + e.Message);
            return Pause(1);
        }
        return 0; // 정상 종료(대시보드 ⏻ 전체 종료·기존 서버 재사용) — 창을 바로 닫는다. 실패만 Pause로 잡아둔다.
    }

    static bool CommandExists(string name)
    {
        try
        {
            var psi = new ProcessStartInfo("where", name);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode == 0; }
        }
        catch { return false; }
    }

    static string Quote(string s) { return "\"" + s + "\""; }

    static int Pause(int code)
    {
        Console.WriteLine();
        Console.Write("아무 키나 누르면 창을 닫습니다...");
        try { Console.ReadKey(true); } catch { } // 콘솔 없는 환경(리다이렉트)에선 그냥 통과
        return code;
    }
}
