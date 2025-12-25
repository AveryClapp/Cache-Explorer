#include "cache-explorer-rt.h"
#include <stdio.h>

int main() {
  int arr[100];

  // Simulate what instrumented code would do
  for (int i = 0; i < 100; i++) {
    __tag_mem_store(&arr[i], sizeof(int), "test_rt.c", 10);
    arr[i] = i;
  }

  for (int i = 0; i < 100; i++) {
    __tag_mem_load(&arr[i], sizeof(int), "test_rt.c", 15);
    int x = arr[i];
    (void)x;
  }

  return 0;
}
