#include <stdio.h>
static volatile int data[16384];
int main(void) {
    int sum = 0;
    for (int repeat = 0; repeat < 4; ++repeat)
        for (int i = 0; i < 16384; i += 16) {
            data[i] = i;
            sum += data[i];
        }
    printf("%d\n", sum);
    return 0;
}
