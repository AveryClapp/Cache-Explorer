#include "cache-explorer-rt.h"
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static _Thread_local uint32_t cached_thread_id = 0;
static atomic_uint_fast32_t thread_counter = 1;

static uint32_t get_thread_id(void) {
  if (cached_thread_id == 0) {
    cached_thread_id = atomic_fetch_add(&thread_counter, 1);
  }
  return cached_thread_id;
}

#define BUFFER_SIZE (1 << 20)
#define BUFFER_MASK (BUFFER_SIZE - 1)

static struct {
  CacheEvent events[BUFFER_SIZE];
  atomic_uint_fast64_t head;
  atomic_uint_fast64_t tail;
  char padding[64];
} ring_buffer;

#define MAX_FILES 4096
#define MAX_FILENAME 256
static struct {
  char names[MAX_FILES][MAX_FILENAME];
  uint32_t count;
  pthread_mutex_t mutex;
} file_table = { .mutex = PTHREAD_MUTEX_INITIALIZER };
static int file_overflow_warned = 0;

static int output_fd = -1;
static int text_mode = 1;
static atomic_int initialized = 0;

// Sampling: only emit every Nth event (1 = no sampling, 100 = 1% of events)
static uint32_t sample_rate = 1;
static _Thread_local uint32_t sample_counter = 0;

// Event limit: stop after this many events (0 = no limit)
static uint64_t max_events = 0;
static atomic_uint_fast64_t total_events = 0;

static uint32_t intern_filename(const char *file) {
  pthread_mutex_lock(&file_table.mutex);

  // Search for existing entry
  for (uint32_t i = 0; i < file_table.count; i++) {
    if (strcmp(file_table.names[i], file) == 0) {
      pthread_mutex_unlock(&file_table.mutex);
      return i;
    }
  }

  // Add new entry if space available
  if (file_table.count < MAX_FILES) {
    uint32_t idx = file_table.count++;
    strncpy(file_table.names[idx], file, MAX_FILENAME - 1);
    file_table.names[idx][MAX_FILENAME - 1] = '\0';  // Ensure null termination
    pthread_mutex_unlock(&file_table.mutex);
    return idx;
  }

  // File table overflow - warn once and return 0
  if (!file_overflow_warned) {
    file_overflow_warned = 1;
    fprintf(stderr, "[cache-explorer] WARNING: File table overflow (>%d files). "
            "Additional files will be attributed to first file.\n", MAX_FILES);
  }
  pthread_mutex_unlock(&file_table.mutex);
  return 0;
}

static inline void emit_event_with_src(uint64_t addr_with_flag, uint64_t src_addr,
                                        uint32_t size, const char *file, uint32_t line) {
  // Sampling: skip events based on sample rate
  if (sample_rate > 1) {
    sample_counter++;
    if (sample_counter < sample_rate) {
      return;  // Skip this event
    }
    sample_counter = 0;  // Reset counter, emit this one
  }

  // Event limit: stop emitting after max_events
  if (max_events > 0) {
    uint64_t count = atomic_fetch_add(&total_events, 1);
    if (count >= max_events) {
      return;  // Hit limit, skip remaining events
    }
  }

  uint64_t head = atomic_load_explicit(&ring_buffer.head, memory_order_relaxed);
  uint64_t next = (head + 1) & BUFFER_MASK;

  uint64_t tail = atomic_load_explicit(&ring_buffer.tail, memory_order_acquire);
  if (next == tail) {
    __cache_explorer_flush();
    head = atomic_load_explicit(&ring_buffer.head, memory_order_relaxed);
    next = (head + 1) & BUFFER_MASK;
  }

  ring_buffer.events[head] = (CacheEvent){
      .address = addr_with_flag,
      .src_address = src_addr,
      .size = size,
      .line = (intern_filename(file) << 20) | (line & 0xFFFFF),
      .thread_id = get_thread_id(),
  };

  atomic_store_explicit(&ring_buffer.head, next, memory_order_release);
}

static inline void emit_event(uint64_t addr_with_flag, uint32_t size,
                               const char *file, uint32_t line) {
  emit_event_with_src(addr_with_flag, 0, size, file, line);
}

void __tag_mem_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr, size, file, line);
}

void __tag_mem_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_STORE_FLAG, size, file, line);
}

void __tag_bb_entry(uint64_t bb_id, uint32_t instr_count, const char *file, uint32_t line) {
  // Estimate instruction fetch size: instr_count * 4 bytes (average instruction size)
  // bb_id is a unique identifier for this basic block
  uint32_t fetch_size = instr_count * 4;
  emit_event(bb_id | EVENT_ICACHE_FLAG, fetch_size, file, line);
}

// Software prefetch hints (__builtin_prefetch)
void __tag_prefetch(void *addr, uint32_t size, uint8_t hint, const char *file, uint32_t line) {
  // Encode hint level in upper bits (P0, P1, P2, P3)
  uint64_t flags = EVENT_PREFETCH_FLAG | ((uint64_t)(hint & 0x3) << 54);
  emit_event((uint64_t)addr | flags, size, file, line);
}

// Vector/SIMD operations
void __tag_vector_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_VECTOR_FLAG, size, file, line);
}

void __tag_vector_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_VECTOR_FLAG | EVENT_STORE_FLAG, size, file, line);
}

// Atomic operations
void __tag_atomic_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_ATOMIC_FLAG, size, file, line);
}

void __tag_atomic_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_ATOMIC_FLAG | EVENT_STORE_FLAG, size, file, line);
}

void __tag_atomic_rmw(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_ATOMIC_FLAG | EVENT_ATOMIC_RMW | EVENT_STORE_FLAG, size, file, line);
}

void __tag_atomic_cmpxchg(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)addr | EVENT_ATOMIC_FLAG | EVENT_ATOMIC_CMPXCHG, size, file, line);
}

// Memory intrinsics
void __tag_memcpy(void *dest, void *src, uint32_t size, const char *file, uint32_t line) {
  emit_event_with_src((uint64_t)dest | EVENT_MEMINTR_FLAG, (uint64_t)src, size, file, line);
}

void __tag_memset(void *dest, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)dest | EVENT_MEMINTR_FLAG | EVENT_MEMSET_TYPE, size, file, line);
}

void __tag_memmove(void *dest, void *src, uint32_t size, const char *file, uint32_t line) {
  emit_event_with_src((uint64_t)dest | EVENT_MEMINTR_FLAG | EVENT_MEMMOVE_TYPE, (uint64_t)src, size, file, line);
}

void __cache_explorer_init(void) {
  if (atomic_exchange(&initialized, 1))
    return;

  atomic_store(&ring_buffer.head, 0);
  atomic_store(&ring_buffer.tail, 0);
  atomic_store(&total_events, 0);
  file_table.count = 0;

  const char *out = getenv("CACHE_EXPLORER_OUTPUT");
  if (out) {
    __cache_explorer_set_output(out);
  }

  // Sample rate: emit 1 in N events (1 = all, 100 = 1%, 1000 = 0.1%)
  const char *rate = getenv("CACHE_EXPLORER_SAMPLE_RATE");
  if (rate) {
    sample_rate = (uint32_t)atoi(rate);
    if (sample_rate < 1) sample_rate = 1;
  }

  // Max events: stop after this many (0 = no limit)
  const char *limit = getenv("CACHE_EXPLORER_MAX_EVENTS");
  if (limit) {
    max_events = (uint64_t)atoll(limit);
  }
}

void __cache_explorer_set_output(const char *path) {
  if (path == NULL) {
    output_fd = STDOUT_FILENO;
    text_mode = 1;
  } else if (strcmp(path, "-") == 0) {
    output_fd = STDOUT_FILENO;
    text_mode = 1;
  } else {
    output_fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    text_mode = 0; // binary mode for files
  }
}

void __cache_explorer_flush(void) {
  if (output_fd < 0)
    output_fd = STDOUT_FILENO;

  uint64_t tail = atomic_load_explicit(&ring_buffer.tail, memory_order_relaxed);
  uint64_t head = atomic_load_explicit(&ring_buffer.head, memory_order_acquire);

  if (text_mode) {
    while (tail != head) {
      CacheEvent *e = &ring_buffer.events[tail];
      uint64_t addr = e->address & EVENT_ADDR_MASK;
      uint32_t file_id = e->line >> 20;
      uint32_t line = e->line & 0xFFFFF;
      const char *file = (file_id < file_table.count) ? file_table.names[file_id] : "?";

      // Check event type flags from high bits
      int is_store = (e->address & EVENT_STORE_FLAG) != 0;
      int is_icache = (e->address & EVENT_ICACHE_FLAG) != 0;
      int is_prefetch = (e->address & EVENT_PREFETCH_FLAG) != 0;
      int is_vector = (e->address & EVENT_VECTOR_FLAG) != 0;
      int is_atomic = (e->address & EVENT_ATOMIC_FLAG) != 0;
      int is_memintr = (e->address & EVENT_MEMINTR_FLAG) != 0;

      if (is_memintr) {
        // Memory intrinsics: M (memcpy), Z (memset), O (memmove)
        uint64_t intrinsic_type = (e->address >> 54) & 0x3;
        if (intrinsic_type == 1) {
          // memset: Z <addr> <size> <file:line> T<n>
          dprintf(output_fd, "Z 0x%llx %u %s:%u T%u\n",
                  (unsigned long long)addr, e->size, file, line, e->thread_id);
        } else if (intrinsic_type == 2) {
          // memmove: O <dest> <src> <size> <file:line> T<n>
          dprintf(output_fd, "O 0x%llx 0x%llx %u %s:%u T%u\n",
                  (unsigned long long)addr, (unsigned long long)e->src_address,
                  e->size, file, line, e->thread_id);
        } else {
          // memcpy: M <dest> <src> <size> <file:line> T<n>
          dprintf(output_fd, "M 0x%llx 0x%llx %u %s:%u T%u\n",
                  (unsigned long long)addr, (unsigned long long)e->src_address,
                  e->size, file, line, e->thread_id);
        }
      } else if (is_atomic) {
        // Atomic operations: A (load), X (RMW), C (cmpxchg)
        uint64_t atomic_type = (e->address >> 57) & 0x3;
        char event_type;
        if (atomic_type == 3) {
          event_type = 'C';  // cmpxchg
        } else if (atomic_type == 2) {
          event_type = 'X';  // RMW
        } else if (is_store) {
          event_type = 'X';  // atomic store treated as RMW for simplicity
        } else {
          event_type = 'A';  // atomic load
        }
        dprintf(output_fd, "%c 0x%llx %u %s:%u T%u\n", event_type,
                (unsigned long long)addr, e->size, file, line, e->thread_id);
      } else if (is_vector) {
        // Vector/SIMD: V (load), U (store)
        char event_type = is_store ? 'U' : 'V';
        dprintf(output_fd, "%c 0x%llx %u %s:%u T%u\n", event_type,
                (unsigned long long)addr, e->size, file, line, e->thread_id);
      } else if (is_prefetch) {
        // Prefetch: P or P0/P1/P2/P3
        uint8_t hint = (e->address >> 54) & 0x3;
        if (hint == 0) {
          dprintf(output_fd, "P 0x%llx %u %s:%u T%u\n",
                  (unsigned long long)addr, e->size, file, line, e->thread_id);
        } else {
          dprintf(output_fd, "P%u 0x%llx %u %s:%u T%u\n", hint,
                  (unsigned long long)addr, e->size, file, line, e->thread_id);
        }
      } else if (is_icache) {
        dprintf(output_fd, "I 0x%llx %u %s:%u T%u\n",
                (unsigned long long)addr, e->size, file, line, e->thread_id);
      } else {
        // Regular load/store
        char event_type = is_store ? 'S' : 'L';
        dprintf(output_fd, "%c 0x%llx %u %s:%u T%u\n", event_type,
                (unsigned long long)addr, e->size, file, line, e->thread_id);
      }

      tail = (tail + 1) & BUFFER_MASK;
    }
  } else {
    while (tail != head) {
      write(output_fd, &ring_buffer.events[tail], sizeof(CacheEvent));
      tail = (tail + 1) & BUFFER_MASK;
    }
  }

  atomic_store_explicit(&ring_buffer.tail, tail, memory_order_release);
}

void __cache_explorer_shutdown(void) {
  __cache_explorer_flush();
  if (output_fd > 2) {
    close(output_fd);
    output_fd = -1;
  }
}

__attribute__((constructor)) static void auto_init(void) {
  __cache_explorer_init();
}

__attribute__((destructor)) static void auto_shutdown(void) {
  __cache_explorer_shutdown();
}
