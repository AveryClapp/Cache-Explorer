// Regression test for #90: event-kind and subtype bits (53-63) must never
// reach the serialized data address.
#include "cache-explorer-rt.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  FILE *capture = tmpfile();
  assert(capture != NULL);

  const int stdout_fd = fileno(stdout);
  const int saved_stdout = dup(stdout_fd);
  assert(saved_stdout >= 0);
  assert(dup2(fileno(capture), stdout_fd) >= 0);
  __cache_explorer_set_output("-");

  void *destination = (void *)(uintptr_t)0x12340;
  void *source = (void *)(uintptr_t)0x22340;
  __tag_prefetch(destination, 64, 1, "address_test.c", 10); // hint bits 54-55
  __tag_prefetch(destination, 64, 3, "address_test.c", 11);
  __tag_memset(destination, 128, "address_test.c", 12);     // subtype bit 54
  __tag_memmove(destination, source, 32, "address_test.c", 13); // subtype bit 55
  __tag_memcpy(destination, source, 16, "address_test.c", 14);
  __tag_mem_load(destination, 4, "address_test.c", 15);
  __tag_mem_store(source, 8, "address_test.c", 16);
  __cache_explorer_shutdown();
  fflush(stdout);

  assert(dup2(saved_stdout, stdout_fd) >= 0);
  close(saved_stdout);
  rewind(capture);

  char output[2048] = {0};
  const size_t length = fread(output, 1, sizeof(output) - 1, capture);
  output[length] = '\0';
  fclose(capture);

  const char *expected[] = {
      "P1 0x12340 64 address_test.c:10",
      "P3 0x12340 64 address_test.c:11",
      "Z 0x12340 128 address_test.c:12",
      "O 0x12340 0x22340 32 address_test.c:13",
      "M 0x12340 0x22340 16 address_test.c:14",
      "L 0x12340 4 address_test.c:15",
      "S 0x22340 8 address_test.c:16",
  };
  int failures = 0;
  for (size_t i = 0; i < sizeof(expected) / sizeof(expected[0]); i++) {
    if (strstr(output, expected[i]) == NULL) {
      fprintf(stderr, "missing: %s\n", expected[i]);
      failures++;
    }
  }
  if (failures) {
    fprintf(stderr, "runtime output:\n%s", output);
    return 1;
  }
  return 0;
}
