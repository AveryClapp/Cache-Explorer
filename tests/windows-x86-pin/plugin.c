#include <stdint.h>
__declspec(dllexport) __declspec(noinline)
uint32_t plugin_mix(volatile uint32_t *values, uint32_t seed) {
    for (unsigned i = 0; i < 256; ++i) {
        values[i] = (values[i] + seed) ^ (i * 17u);
        seed += values[i];
    }
    return seed;
}
