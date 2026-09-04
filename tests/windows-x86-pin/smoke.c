#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>

typedef uint32_t (*Mix)(volatile uint32_t *, uint32_t);
static volatile uint32_t values[4][256];
static Mix mix;

static DWORD WINAPI worker(void *argument) {
    const unsigned id = (unsigned)(uintptr_t)argument;
    for (unsigned n = 0; n < 8; ++n) {
        for (unsigned i = 0; i < 256; ++i) values[id][i] += n + i;
        mix(values[id], n + id);
    }
    return 0;
}

int wmain(int argc, wchar_t **argv) {
    if (argc > 1 && !wcscmp(argv[1], L"--args")) {
        if (argc != 7 || wcscmp(argv[2], L"space value") || wcscmp(argv[3], L"quote\"value") ||
            wcscmp(argv[4], L"caf\u00e9") || wcscmp(argv[5], L"--sample") || wcscmp(argv[6], L"999"))
            return 18;
    }
    wchar_t path[32768];
    if (!GetModuleFileNameW(NULL, path, 32768)) return 11;
    wchar_t *last = wcsrchr(path, L'\\');
    if (!last || (size_t)(last - path) + 32 >= 32768) return 12;
    wcscpy(last + 1, L"pin smoke plugin.dll");
    // Reload the same DLL; Pin gets a fresh image ID for the second lifetime.
    for (unsigned run = 0; run < 2; ++run) {
        HMODULE plugin = LoadLibraryW(path);
        if (!plugin) return 13;
        mix = (Mix)GetProcAddress(plugin, "plugin_mix");
        if (!mix) return 14;
        HANDLE threads[4];
        for (unsigned i = 0; i < 4; ++i) {
            threads[i] = CreateThread(NULL, 0, worker, (void *)(uintptr_t)i, 0, NULL);
            if (!threads[i]) return 15;
        }
        if (WaitForMultipleObjects(4, threads, TRUE, INFINITE) != WAIT_OBJECT_0) return 16;
        for (unsigned i = 0; i < 4; ++i) CloseHandle(threads[i]);
        FreeLibrary(plugin);
    }
    printf("Uninstrumented x86 fixture: %u\n", values[0][0]);
    if (argc > 1 && !wcscmp(argv[1], L"--hang")) Sleep(60000);
    return argc > 1 && !wcscmp(argv[1], L"--fail") ? 17 : 0;
}
