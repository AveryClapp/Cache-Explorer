// Branch prediction patterns
// Expected: predictable loop branches warm up; alternating data branches mispredict often

#include <stdio.h>

#define N 100000

int main() {
  volatile int predictable = 0;
  volatile int alternating = 0;

  for (int i = 0; i < N; i++) {
    if (i < N - 1) {
      predictable += i & 7;
    }
  }

  for (int i = 0; i < N; i++) {
    if (i & 1) {
      alternating += 3;
    } else {
      alternating -= 1;
    }
  }

  printf("%d %d\n", predictable, alternating);
  return 0;
}
