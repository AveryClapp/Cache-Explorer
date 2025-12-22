#include <stdint.h>
#include <stdio.h>

void __tag_mem_load(void *addr, uint32_t size, const char *file,
                    uint32_t line) {
  printf("LOAD: %p [%u bytes] at %s:%u\n", addr, size, file, line);
}

void __tag_mem_store(void *addr, uint32_t size, const char *file,
                     uint32_t line) {
  printf("STORE: %p [%u bytes] at %s:%u\n", addr, size, file, line);
}
