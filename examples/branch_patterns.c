// Branch prediction patterns
// Set RUN_ALTERNATING=1 to isolate alternating data branches
#include <stdio.h>

#ifndef RUN_ALTERNATING
#define RUN_ALTERNATING 0
#endif

#define N 100000

#if defined(_MSC_VER)
#define NOINLINE __declspec(noinline)
#else
#define NOINLINE __attribute__((noinline))
#endif

static volatile int always_taken = 1;

static NOINLINE int add_predictable(int total, int i) {
  return total + (i & 7);
}

static NOINLINE int add_three(int total) {
  return total + 3;
}

static NOINLINE int sub_one(int total) {
  return total - 1;
}

int main() {
  volatile int total = 0;

#if RUN_ALTERNATING
  for (int i = 0; i < N; i++) {
    if (i & 1) {
      total = add_three(total);
    } else {
      total = sub_one(total);
    }
  }
#else
  for (int i = 0; i < N; i++) {
    if (always_taken) {
      total = add_predictable(total, i);
    } else {
      total = sub_one(total);
    }
  }
#endif

  printf("%d\n", total);
  return 0;
}
