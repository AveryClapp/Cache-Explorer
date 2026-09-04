#include "cache-explorer-rt.h"

#include <assert.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

enum { THREADS = 8, EVENTS_PER_THREAD = 20000 };

static void *produce_events(void *opaque) {
  const uintptr_t thread = (uintptr_t)opaque;
  char filename[256];
  memset(filename, 'a' + (int)(thread % 26), sizeof(filename) - 1);
  filename[sizeof(filename) - 1] = '\0';

  for (uint32_t i = 0; i < EVENTS_PER_THREAD; ++i) {
    __tag_mem_load((void *)(thread * 0x100000 + i * 64), 4, filename, i + 1);
  }
  return NULL;
}

int main(void) {
  char path[] = "/tmp/hardware-explorer-runtime-XXXXXX";
  const int fd = mkstemp(path);
  assert(fd >= 0);
  close(fd);
  FILE *output = freopen(path, "w+", stdout);
  assert(output != NULL);
  __cache_explorer_set_output("-");

  pthread_t threads[THREADS];
  for (uintptr_t i = 0; i < THREADS; ++i)
    assert(pthread_create(&threads[i], NULL, produce_events, (void *)i) == 0);
  for (int i = 0; i < THREADS; ++i)
    assert(pthread_join(threads[i], NULL) == 0);

  __cache_explorer_shutdown();

  fflush(output);
  rewind(output);
  size_t lines = 0;
  int ch;
  while ((ch = fgetc(output)) != EOF)
    lines += ch == '\n';
  assert(lines == (size_t)THREADS * EVENTS_PER_THREAD);
  fclose(output);
  unlink(path);
  return 0;
}
