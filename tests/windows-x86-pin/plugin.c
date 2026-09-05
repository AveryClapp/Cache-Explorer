#include <stdint.h>
__declspec(dllexport) __declspec(noinline)
uint32_t plugin_mix(volatile uint32_t *values, uint32_t seed) {
    for (unsigned i = 0; i < 256; ++i) {
        values[i * 1024] = (values[i * 1024] + seed) ^ (i * 17u);
        seed += values[i * 1024];
    }
    return seed;
}
