#include <stdint.h>
#include <stdio.h>
#include <string.h>

static uint32_t mix_values(uint32_t *values, uint32_t count) {
  uint32_t checksum = 0;
  for (uint32_t i = 0; i < count; ++i) {
    values[i] = (i * 2654435761u) ^ (i >> 3);
    checksum ^= values[(i * 17u) % count];
  }
  return checksum;
}

int main(int argc, char **argv) {
  uint32_t values[1024] = {0};
  uint32_t checksum = mix_values(values, 1024);
  printf("checksum=%u\n", checksum);
  return argc == 2 && strcmp(argv[1], "--fail") == 0 ? 17 : 0;
}
