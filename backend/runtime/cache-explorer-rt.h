#ifndef CACHE_EXPLORER_RT_H
#define CACHE_EXPLORER_RT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint64_t address;
  uint32_t size;
  uint32_t line;
  uint32_t thread_id;
} CacheEvent;

// Event type flags in high bits of address
// Bit 63: 0=load, 1=store (for data cache)
// Bit 62: 1=instruction fetch (I-cache)
#define EVENT_STORE_FLAG (1ULL << 63)
#define EVENT_ICACHE_FLAG (1ULL << 62)
#define EVENT_ADDR_MASK (~(EVENT_STORE_FLAG | EVENT_ICACHE_FLAG))

void __tag_mem_load(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_mem_store(void *addr, uint32_t size, const char *file,
                     uint32_t line);
void __tag_bb_entry(void *bb_addr, uint32_t instr_count, const char *file,
                    uint32_t line);

void __cache_explorer_init(void);
void __cache_explorer_flush(void);
void __cache_explorer_shutdown(void);

void __cache_explorer_set_output(const char *path);

#ifdef __cplusplus
}
#endif

#endif
