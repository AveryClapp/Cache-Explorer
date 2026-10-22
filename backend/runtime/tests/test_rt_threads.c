#include "cache-explorer-rt.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <io.h>
#define cache_dup _dup
#define cache_dup2 _dup2
#define cache_close _close
#define cache_fileno _fileno
typedef HANDLE cache_thread_t;
#else
#include <pthread.h>
#include <unistd.h>
#define cache_dup dup
#define cache_dup2 dup2
#define cache_close close
#define cache_fileno fileno
typedef pthread_t cache_thread_t;
#endif

enum { THREADS = 8, EVENTS_PER_THREAD = 20000 };

#ifdef _WIN32
static DWORD WINAPI produce_events(LPVOID opaque) {
#else
static void *produce_events(void *opaque) {
#endif
  const uintptr_t thread = (uintptr_t)opaque;
  char filename[256];
  memset(filename, 'a' + (int)(thread % 26), sizeof(filename) - 1);
  filename[sizeof(filename) - 1] = '\0';

  for (uint32_t i = 0; i < EVENTS_PER_THREAD; ++i) {
    __tag_mem_load((void *)(thread * 0x100000 + i * 64), 4, filename, i + 1);
  }
#ifdef _WIN32
  return 0;
#else
  return NULL;
#endif
}

int main(void) {
  FILE *output = tmpfile();
  assert(output != NULL);
  const int stdout_fd = cache_fileno(stdout);
  const int saved_stdout = cache_dup(stdout_fd);
  assert(saved_stdout >= 0);
  assert(cache_dup2(cache_fileno(output), stdout_fd) >= 0);
  __cache_explorer_set_output("-");

  cache_thread_t threads[THREADS];
#ifdef _WIN32
  for (uintptr_t i = 0; i < THREADS; ++i) {
    threads[i] = CreateThread(NULL, 0, produce_events, (void *)i, 0, NULL);
    assert(threads[i] != NULL);
  }
  assert(WaitForMultipleObjects(THREADS, threads, TRUE, INFINITE) == WAIT_OBJECT_0);
  for (int i = 0; i < THREADS; ++i)
    CloseHandle(threads[i]);
#else
  for (uintptr_t i = 0; i < THREADS; ++i)
    assert(pthread_create(&threads[i], NULL, produce_events, (void *)i) == 0);
  for (int i = 0; i < THREADS; ++i)
    assert(pthread_join(threads[i], NULL) == 0);
#endif

  __cache_explorer_shutdown();

  fflush(stdout);
  assert(cache_dup2(saved_stdout, stdout_fd) >= 0);
  cache_close(saved_stdout);
  rewind(output);
  size_t lines = 0;
  int ch;
  while ((ch = fgetc(output)) != EOF)
    lines += ch == '\n';
  assert(lines == (size_t)THREADS * EVENTS_PER_THREAD);
  fclose(output);
  return 0;
}
