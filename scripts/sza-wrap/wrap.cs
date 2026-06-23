using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

class SzaWrap {
    // Strip the first token (this exe) from a Windows command line, honoring quotes.
    static string StripFirstToken(string cmd) {
        int i = 0;
        if (i < cmd.Length && cmd[i] == '"') {
            i++;
            while (i < cmd.Length && cmd[i] != '"') i++;
            if (i < cmd.Length) i++; // closing quote
        } else {
            while (i < cmd.Length && cmd[i] != ' ' && cmd[i] != '\t') i++;
        }
        return cmd.Substring(Math.Min(i, cmd.Length)).TrimStart();
    }

    static int Main() {
        string baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string real = Path.Combine(baseDir, "7za-real.exe");
        string args = StripFirstToken(Environment.CommandLine);
        // -snl- => extract symlink entries as regular files instead of creating
        // links, so extraction needs no symlink-creation privilege on Windows.
        string newArgs = (args.Length > 0 ? args + " " : "") + "-snl-";
        var psi = new ProcessStartInfo {
            FileName = real,
            Arguments = newArgs,
            UseShellExecute = false
        };
        var p = Process.Start(psi);
        p.WaitForExit();
        return p.ExitCode;
    }
}
