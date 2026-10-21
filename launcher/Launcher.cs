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
[assembly: AssemblyFileVersion("1.0.7.0")]
[assembly: AssemblyVersion("1.0.7.0")]

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

    static string FindCore(string dir)
    {
        string[] names = { "BigFishPet-Core.exe", "BigFishPet.exe", "大肥鱼桌宠-Core.exe" };
        foreach (string name in names)
        {
            string candidate = Path.Combine(dir, name);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
    [STAThread]
    static void Main()
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string exe = FindCore(dir);
        Log("start dir=" + dir + " core=" + (exe ?? "null"));

        if (exe == null)
        {
            Log("missing core exe");
            MessageBox.Show(
                "找不到 BigFishPet.exe，请确认整个文件夹已完整解压。",
                "大肥鱼桌宠",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return;
        }

        string coreName = Path.GetFileNameWithoutExtension(exe);
        if (Process.GetProcessesByName(coreName).Length > 0)
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
