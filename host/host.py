"""Native messaging host: mede a RAM usada pelos processos chrome.exe.

Protocolo do Chrome: cada mensagem = 4 bytes (tamanho, little-endian) + JSON UTF-8.
Responde a {"cmd": "mem"} com a soma da memoria dos processos do Chrome.
"""
import ctypes
import ctypes.wintypes as wt
import json
import msvcrt
import os
import struct
import sys

TH32CS_SNAPPROCESS = 0x2
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_VM_READ = 0x0010
INVALID_HANDLE_VALUE = wt.HANDLE(-1).value
MB = 1024 * 1024


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wt.DWORD),
        ("cntUsage", wt.DWORD),
        ("th32ProcessID", wt.DWORD),
        ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wt.DWORD),
        ("cntThreads", wt.DWORD),
        ("th32ParentProcessID", wt.DWORD),
        ("pcPriClassBase", ctypes.c_long),
        ("dwFlags", wt.DWORD),
        ("szExeFile", ctypes.c_wchar * 260),
    ]


class PROCESS_MEMORY_COUNTERS_EX2(ctypes.Structure):
    _fields_ = [
        ("cb", wt.DWORD),
        ("PageFaultCount", wt.DWORD),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
        ("PrivateUsage", ctypes.c_size_t),
        ("PrivateWorkingSetSize", ctypes.c_size_t),
        ("SharedCommitUsage", ctypes.c_ulonglong),
    ]


kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
kernel32.Process32FirstW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32FirstW.restype = wt.BOOL
kernel32.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PROCESSENTRY32W)]
kernel32.Process32NextW.restype = wt.BOOL
kernel32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
kernel32.OpenProcess.restype = wt.HANDLE
kernel32.K32GetProcessMemoryInfo.argtypes = [
    wt.HANDLE, ctypes.POINTER(PROCESS_MEMORY_COUNTERS_EX2), wt.DWORD]
kernel32.K32GetProcessMemoryInfo.restype = wt.BOOL
kernel32.CloseHandle.argtypes = [wt.HANDLE]
kernel32.CloseHandle.restype = wt.BOOL


def chrome_pids():
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if snap == INVALID_HANDLE_VALUE:
        return []
    pids = []
    entry = PROCESSENTRY32W()
    entry.dwSize = ctypes.sizeof(PROCESSENTRY32W)
    try:
        ok = kernel32.Process32FirstW(snap, ctypes.byref(entry))
        while ok:
            if entry.szExeFile.lower() == "chrome.exe":
                pids.append(entry.th32ProcessID)
            ok = kernel32.Process32NextW(snap, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snap)
    return pids


def process_memory(pid):
    for access in (PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
                   PROCESS_QUERY_LIMITED_INFORMATION):
        handle = kernel32.OpenProcess(access, False, pid)
        if not handle:
            continue
        try:
            pmc = PROCESS_MEMORY_COUNTERS_EX2()
            pmc.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX2)
            if kernel32.K32GetProcessMemoryInfo(handle, ctypes.byref(pmc), pmc.cb):
                return pmc
        finally:
            kernel32.CloseHandle(handle)
    return None


def measure():
    private_ws = working_set = private = 0
    procs = denied = 0
    for pid in chrome_pids():
        pmc = process_memory(pid)
        if pmc is None:
            denied += 1
            continue
        procs += 1
        private_ws += pmc.PrivateWorkingSetSize
        working_set += pmc.WorkingSetSize
        private += pmc.PrivateUsage
    return {
        "ok": True,
        "privateWsMB": round(private_ws / MB),  # = coluna "Memoria" do Gerenciador de Tarefas
        "workingSetMB": round(working_set / MB),
        "privateMB": round(private / MB),  # memoria comprometida (inclui o que foi para o pagefile)
        "procs": procs,
        "denied": denied,
    }


def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    size = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(size).decode("utf-8"))


def send_message(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)))
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()


def main():
    msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
    msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
    while True:
        msg = read_message()
        if msg is None:
            return
        cmd = msg.get("cmd") if isinstance(msg, dict) else None
        if cmd == "mem":
            send_message(measure())
        elif cmd == "ping":
            send_message({"ok": True, "pong": True})
        else:
            send_message({"ok": False, "error": "comando desconhecido"})


if __name__ == "__main__":
    main()
