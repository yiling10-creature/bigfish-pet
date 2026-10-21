using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("BigFish Desktop Pet Launcher")]
[assembly: AssemblyCompany("Yiling")]
[assembly: AssemblyProduct("BigFish Desktop Pet")]
[assembly: AssemblyCopyright("MIT - Yiling")]
[assembly: AssemblyFileVersion("1.0.6.0")]
[assembly: AssemblyVersion("1.0.6.0")]

static class Program
{
    static string logPath = Environment.GetEnvironmentVariable("BIGFISH_LAUNCHER_LOG");

    static void Log(string message)
    {
        if (String.IsNullOrEmpty(logPath)) return;
        try
        {
            File.AppendAllText(logPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine);
        }
        catch
        {
        }
    }

    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(dir, "BigFishPet-Core.exe");
        Log("start dir=" + dir);

        if (!File.Exists(exe))
        {
            Log("missing core exe");
            MessageBox.Show(
                "找不到 BigFishPet-Core.exe，请确认整个文件夹已完整解压。",
                "大肥鱼桌宠",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        if (Process.GetProcessesByName("BigFishPet-Core").Length > 0)
        {
            Log("core already running, exit");
            return;
        }

        try
        {
            Process first = Process.Start(new ProcessStartInfo(exe)
            {
                WorkingDirectory = dir,
                UseShellExecute = false,
            });
            Log("started normal pid=" + (first == null ? "null" : first.Id.ToString()));

            if (first != null && first.WaitForExit(1500))
            {
                Log("normal exited code=" + first.ExitCode + ", retry without sandbox");
                Thread.Sleep(400);
                Process retry = Process.Start(new ProcessStartInfo(exe, "--no-sandbox")
                {
                    WorkingDirectory = dir,
                    UseShellExecute = false,
                });
                Log("retry pid=" + (retry == null ? "null" : retry.Id.ToString()));
            }
            else
            {
                Log("normal launch still running, done");
            }
        }
        catch (Exception error)
        {
            Log("error " + error);
            MessageBox.Show(error.Message, "大肥鱼桌宠", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
