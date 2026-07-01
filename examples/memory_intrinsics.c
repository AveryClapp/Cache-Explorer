// Memory intrinsic tracking: memset-only versus memset plus memcpy.
// Demonstrates: llvm.memset and llvm.memcpy instrumentation.
#include <stdio.h>
#include <string.h>

#ifndef RUN_COPY
#define RUN_COPY 0
#endif

#define N 8192

unsigned char src[N];
unsigned char dst[N];

__attribute__((noinline)) void init_src(unsigned char value) {
    memset(src, value, sizeof(src));
}

__attribute__((noinline)) void fill_dst(unsigned char value) {
    memset(dst, value, sizeof(dst));
}

__attribute__((noinline)) void copy_dst(void) {
    memcpy(dst, src, sizeof(dst));
}

int main(int argc, char** argv) {
    unsigned char seed = (unsigned char)(argc + (argv[0] != 0));
    init_src(seed);

#if RUN_COPY
    copy_dst();
#else
    fill_dst((unsigned char)(seed + 1));
#endif

    printf("%u\n", (unsigned)(dst[0] + dst[N - 1] + src[N / 2]));
    return 0;
}
