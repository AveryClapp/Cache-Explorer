#include "cache-explorer-rt.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#define cache_dup _dup
#define cache_dup2 _dup2
#define cache_close _close
#define cache_fileno _fileno
#else
#include <unistd.h>
#define cache_dup dup
#define cache_dup2 dup2
#define cache_close close
#define cache_fileno fileno
#endif

int main(void) {
  FILE *capture = tmpfile();
  assert(capture != NULL);

  const int stdout_fd = cache_fileno(stdout);
  const int saved_stdout = cache_dup(stdout_fd);
  assert(saved_stdout >= 0);
  assert(cache_dup2(cache_fileno(capture), stdout_fd) >= 0);
  __cache_explorer_set_output("-");

  void *destination = (void *)(uintptr_t)0x12340;
  void *source = (void *)(uintptr_t)0x22340;
  __tag_prefetch(destination, 64, 1, "address_test.c", 10);
  __tag_memset(destination, 128, "address_test.c", 11);
  __tag_memmove(destination, source, 32, "address_test.c", 12);
  __sanitizer_cov_load4(destination);
  __sanitizer_cov_store8(source);
  __cache_explorer_shutdown();
  fflush(stdout);

  assert(cache_dup2(saved_stdout, stdout_fd) >= 0);
  cache_close(saved_stdout);
  rewind(capture);

  char output[1024] = {0};
  const size_t length = fread(output, 1, sizeof(output) - 1, capture);
  output[length] = '\0';
  fclose(capture);

  assert(strstr(output, "P1 0x12340 64 address_test.c:10") != NULL);
  assert(strstr(output, "Z 0x12340 128 address_test.c:11") != NULL);
  assert(strstr(output, "O 0x12340 0x22340 32 address_test.c:12") != NULL);
  assert(strstr(output, "L 0x12340 4 unknown:0 T1 C0x") != NULL);
  assert(strstr(output, "S 0x22340 8 unknown:0 T1 C0x") != NULL);
#ifdef _WIN32
  assert(strstr(output, " B0x") != NULL);
  assert(strstr(output, " R0x") != NULL);
#endif
  return 0;
}
