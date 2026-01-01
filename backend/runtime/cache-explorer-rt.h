#ifndef CACHE_EXPLORER_RT_H
#define CACHE_EXPLORER_RT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint64_t address;
  uint64_t src_address;  // For memcpy/memmove: source address (0 if not used)
  uint32_t size;
  uint32_t line;
  uint32_t thread_id;
} CacheEvent;

// Event type flags in high bits of address
// Bit 63: 0=load, 1=store (for data cache)
// Bit 62: 1=instruction fetch (I-cache)
// Bit 61: 1=prefetch hint
// Bit 60: 1=vector/SIMD operation
// Bit 59: 1=atomic operation
// Bit 58-57: atomic subtype (00=load, 01=store, 10=RMW, 11=cmpxchg)
// Bit 56: 1=memory intrinsic
// Bit 55-54: intrinsic type (00=memcpy, 01=memset, 10=memmove)
#define EVENT_STORE_FLAG    (1ULL << 63)
#define EVENT_ICACHE_FLAG   (1ULL << 62)
#define EVENT_PREFETCH_FLAG (1ULL << 61)
#define EVENT_VECTOR_FLAG   (1ULL << 60)
#define EVENT_ATOMIC_FLAG   (1ULL << 59)
#define EVENT_ATOMIC_RMW    (2ULL << 57)    // Bit 58-57 = 10
#define EVENT_ATOMIC_CMPXCHG (3ULL << 57)   // Bit 58-57 = 11
#define EVENT_MEMINTR_FLAG  (1ULL << 56)
#define EVENT_MEMSET_TYPE   (1ULL << 54)    // Bit 55-54 = 01
#define EVENT_MEMMOVE_TYPE  (2ULL << 54)    // Bit 55-54 = 10
#define EVENT_ADDR_MASK     0x00FFFFFFFFFFFFFFULL  // Lower 56 bits for address

void __tag_mem_load(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_mem_store(void *addr, uint32_t size, const char *file,
                     uint32_t line);
// bb_id is a unique identifier for the basic block (not an address)
void __tag_bb_entry(uint64_t bb_id, uint32_t instr_count, const char *file,
                    uint32_t line);

// Software prefetch hints (__builtin_prefetch)
// hint: 0=T0 (all caches), 1=T1 (L2+), 2=T2 (L3), 3=NTA
void __tag_prefetch(void *addr, uint32_t size, uint8_t hint, const char *file, uint32_t line);

// Vector/SIMD operations (SSE, AVX, AVX-512)
void __tag_vector_load(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_vector_store(void *addr, uint32_t size, const char *file, uint32_t line);

// Atomic operations
void __tag_atomic_load(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_atomic_store(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_atomic_rmw(void *addr, uint32_t size, const char *file, uint32_t line);
void __tag_atomic_cmpxchg(void *addr, uint32_t size, const char *file, uint32_t line);

// Memory intrinsics (llvm.memcpy, llvm.memset, llvm.memmove)
void __tag_memcpy(void *dest, void *src, uint32_t size, const char *file, uint32_t line);
void __tag_memset(void *dest, uint32_t size, const char *file, uint32_t line);
void __tag_memmove(void *dest, void *src, uint32_t size, const char *file, uint32_t line);

void __cache_explorer_init(void);
void __cache_explorer_flush(void);
void __cache_explorer_shutdown(void);

void __cache_explorer_set_output(const char *path);

#ifdef __cplusplus
}
#endif

#endif
