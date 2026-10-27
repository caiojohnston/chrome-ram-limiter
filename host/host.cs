// Native messaging host: mede a RAM usada pelos processos chrome.exe.
// Compilado como aplicativo de janela (winexe) para nao abrir console.
//
// Protocolo do Chrome: cada mensagem = 4 bytes (tamanho, little-endian) + JSON UTF-8.
//   {"cmd":"mem"}  -> soma da memoria dos processos do Chrome
//   {"cmd":"ping"} -> {"ok":true,"pong":true}
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class Host
{
    [StructLayout(LayoutKind.Sequential)]
    struct PMC // PROCESS_MEMORY_COUNTERS_EX2
    {
        public uint cb, PageFaultCount;
        public UIntPtr PeakWorkingSetSize, WorkingSetSize,
            QuotaPeakPagedPoolUsage, QuotaPagedPoolUsage,
            QuotaPeakNonPagedPoolUsage, QuotaNonPagedPoolUsage,
            PagefileUsage, PeakPagefileUsage, PrivateUsage, PrivateWorkingSetSize;
        public ulong SharedCommitUsage;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool K32GetProcessMemoryInfo(IntPtr process, ref PMC counters, uint size);

    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr handle);

    const uint QueryLimited = 0x1000, VmRead = 0x0010;
    const double MB = 1024.0 * 1024.0;

    static bool TryRead(uint pid, out PMC pmc)
    {
        pmc = new PMC();
        pmc.cb = (uint)Marshal.SizeOf(typeof(PMC));
        foreach (uint access in new uint[] { QueryLimited | VmRead, QueryLimited })
        {
            IntPtr h = OpenProcess(access, false, pid);
            if (h == IntPtr.Zero) continue;
            try { if (K32GetProcessMemoryInfo(h, ref pmc, pmc.cb)) return true; }
            finally { CloseHandle(h); }
        }
        return false;
    }

    static string Measure()
    {
        ulong privateWs = 0, workingSet = 0, priv = 0;
        int procs = 0, denied = 0;
        foreach (Process p in Process.GetProcessesByName("chrome"))
        {
            using (p)
            {
                PMC pmc;
                if (!TryRead((uint)p.Id, out pmc)) { denied++; continue; }
                procs++;
                privateWs += pmc.PrivateWorkingSetSize.ToUInt64();
                workingSet += pmc.WorkingSetSize.ToUInt64();
                priv += pmc.PrivateUsage.ToUInt64();
            }
        }
        return "{\"ok\":true,\"privateWsMB\":" + Math.Round(privateWs / MB) +
               ",\"workingSetMB\":" + Math.Round(workingSet / MB) +
               ",\"privateMB\":" + Math.Round(priv / MB) +
               ",\"procs\":" + procs + ",\"denied\":" + denied + "}";
    }

    static bool ReadFull(Stream s, byte[] buf, int count)
    {
        int got = 0;
        while (got < count)
        {
            int n = s.Read(buf, got, count - got);
            if (n <= 0) return false;
            got += n;
        }
        return true;
    }

    static int Main()
    {
        Stream input = Console.OpenStandardInput();
        Stream output = Console.OpenStandardOutput();
        byte[] head = new byte[4];
        while (true)
        {
            if (!ReadFull(input, head, 4)) return 0;
            int size = BitConverter.ToInt32(head, 0);
            if (size < 0 || size > (1 << 20)) return 1;
            byte[] body = new byte[size];
            if (!ReadFull(input, body, size)) return 0;
            string msg = Encoding.UTF8.GetString(body);

            string reply =
                msg.Contains("\"mem\"") ? Measure() :
                msg.Contains("\"ping\"") ? "{\"ok\":true,\"pong\":true}" :
                "{\"ok\":false,\"error\":\"comando desconhecido\"}";

            byte[] data = Encoding.UTF8.GetBytes(reply);
            output.Write(BitConverter.GetBytes(data.Length), 0, 4);
            output.Write(data, 0, data.Length);
            output.Flush();
        }
    }
}
