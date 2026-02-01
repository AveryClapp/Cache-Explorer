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
  uint32_t overflow_count;  // Track how many files couldn't be registered
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

  // File table overflow - track and warn
  file_table.overflow_count++;
  if (!file_overflow_warned) {
    file_overflow_warned = 1;
    fprintf(stderr, "[cache-explorer] WARNING: File table overflow (>%d unique files). "
            "Additional files will be attributed to first file. "
            "Consider using fewer source files or merging headers.\n", MAX_FILES);
  }
  pthread_mutex_unlock(&file_table.mutex);
  return 0;  // Attribute to first file when overflow
}

static inline void emit_event_with_src(uint64_t addr_with_flag, uint64_t src_addr,
                                        uint32_t size, const char *file, uint32_t line) {
  // Lazy initialization: handles runtimes where .init_array constructors
  // are not processed (e.g., Zig's _start on Linux skips __libc_start_main)
  if (__builtin_expect(!atomic_load_explicit(&initialized, memory_order_relaxed), 0)) {
    __cache_explorer_init();
  }

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
    // Buffer full - must flush
    __cache_explorer_flush();
    head = atomic_load_explicit(&ring_buffer.head, memory_order_relaxed);
    next = (head + 1) & BUFFER_MASK;
  } else if ((head & 0xFFF) == 0 && head != tail) {
    // Periodic flush every 4096 events - ensures output even when
    // destructors don't fire (e.g., Zig's _start calls _exit directly)
    __cache_explorer_flush();
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

// Write buffer for batching output (eliminates per-event syscalls)
#define WRITE_BUF_SIZE (256 * 1024)  // 256KB write buffer
static char write_buf[WRITE_BUF_SIZE];
static int write_buf_pos = 0;

static inline void wb_flush(void) {
  if (write_buf_pos > 0) {
    const char *p = write_buf;
    int remaining = write_buf_pos;
    while (remaining > 0) {
      ssize_t n = write(output_fd, p, remaining);
      if (n <= 0) break;
      p += n;
      remaining -= n;
    }
    write_buf_pos = 0;
  }
}

// Fast hex formatting: write "0x" + hex digits for a 64-bit value
static inline int fmt_hex(char *buf, uint64_t val) {
  static const char hex_digits[] = "0123456789abcdef";
  buf[0] = '0';
  buf[1] = 'x';
  if (val == 0) {
    buf[2] = '0';
    return 3;
  }
  // Find highest nibble
  int bits = 63 - __builtin_clzll(val);
  int nibbles = (bits >> 2) + 1;
  for (int i = nibbles - 1; i >= 0; i--) {
    buf[2 + i] = hex_digits[val & 0xf];
    val >>= 4;
  }
  return 2 + nibbles;
}

// Fast decimal formatting for uint32_t
static inline int fmt_dec(char *buf, uint32_t val) {
  if (val == 0) {
    buf[0] = '0';
    return 1;
  }
  char tmp[10];
  int len = 0;
  while (val > 0) {
    tmp[len++] = '0' + (val % 10);
    val /= 10;
  }
  for (int i = 0; i < len; i++) {
    buf[i] = tmp[len - 1 - i];
  }
  return len;
}

// Format one event into write buffer, flushing if needed
static inline void fmt_event(char type, uint64_t addr, uint32_t size,
                             const char *file, uint32_t line, uint32_t tid) {
  // Max line: "X 0x1234567890abcdef 12345 somefile.c:99999 T99\n" ~80 chars
  if (write_buf_pos + 128 > WRITE_BUF_SIZE)
    wb_flush();
  char *p = write_buf + write_buf_pos;
  *p++ = type;
  *p++ = ' ';
  p += fmt_hex(p, addr);
  *p++ = ' ';
  p += fmt_dec(p, size);
  *p++ = ' ';
  while (*file) *p++ = *file++;
  *p++ = ':';
  p += fmt_dec(p, line);
  *p++ = ' ';
  *p++ = 'T';
  p += fmt_dec(p, tid);
  *p++ = '\n';
  write_buf_pos = (int)(p - write_buf);
}

// Format event with two addresses (memcpy/memmove)
static inline void fmt_event_src(char type, uint64_t addr, uint64_t src_addr,
                                 uint32_t size, const char *file, uint32_t line,
                                 uint32_t tid) {
  if (write_buf_pos + 160 > WRITE_BUF_SIZE)
    wb_flush();
  char *p = write_buf + write_buf_pos;
  *p++ = type;
  *p++ = ' ';
  p += fmt_hex(p, addr);
  *p++ = ' ';
  p += fmt_hex(p, src_addr);
  *p++ = ' ';
  p += fmt_dec(p, size);
  *p++ = ' ';
  while (*file) *p++ = *file++;
  *p++ = ':';
  p += fmt_dec(p, line);
  *p++ = ' ';
  *p++ = 'T';
  p += fmt_dec(p, tid);
  *p++ = '\n';
  write_buf_pos = (int)(p - write_buf);
}

// Format prefetch with hint level
static inline void fmt_prefetch(uint8_t hint, uint64_t addr, uint32_t size,
                                const char *file, uint32_t line, uint32_t tid) {
  if (write_buf_pos + 128 > WRITE_BUF_SIZE)
    wb_flush();
  char *p = write_buf + write_buf_pos;
  *p++ = 'P';
  if (hint > 0) *p++ = '0' + hint;
  *p++ = ' ';
  p += fmt_hex(p, addr);
  *p++ = ' ';
  p += fmt_dec(p, size);
  *p++ = ' ';
  while (*file) *p++ = *file++;
  *p++ = ':';
  p += fmt_dec(p, line);
  *p++ = ' ';
  *p++ = 'T';
  p += fmt_dec(p, tid);
  *p++ = '\n';
  write_buf_pos = (int)(p - write_buf);
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
        uint64_t intrinsic_type = (e->address >> 54) & 0x3;
        if (intrinsic_type == 1) {
          fmt_event('Z', addr, e->size, file, line, e->thread_id);
        } else if (intrinsic_type == 2) {
          fmt_event_src('O', addr, e->src_address, e->size, file, line, e->thread_id);
        } else {
          fmt_event_src('M', addr, e->src_address, e->size, file, line, e->thread_id);
        }
      } else if (is_atomic) {
        uint64_t atomic_type = (e->address >> 57) & 0x3;
        char event_type;
        if (atomic_type == 3) event_type = 'C';
        else if (atomic_type == 2) event_type = 'X';
        else if (is_store) event_type = 'X';
        else event_type = 'A';
        fmt_event(event_type, addr, e->size, file, line, e->thread_id);
      } else if (is_vector) {
        fmt_event(is_store ? 'U' : 'V', addr, e->size, file, line, e->thread_id);
      } else if (is_prefetch) {
        uint8_t hint = (e->address >> 54) & 0x3;
        fmt_prefetch(hint, addr, e->size, file, line, e->thread_id);
      } else if (is_icache) {
        fmt_event('I', addr, e->size, file, line, e->thread_id);
      } else {
        fmt_event(is_store ? 'S' : 'L', addr, e->size, file, line, e->thread_id);
      }

      tail = (tail + 1) & BUFFER_MASK;
    }
    // Flush remaining buffered output
    wb_flush();
  } else {
    while (tail != head) {
      write(output_fd, &ring_buffer.events[tail], sizeof(CacheEvent));
      tail = (tail + 1) & BUFFER_MASK;
    }
  }

  atomic_store_explicit(&ring_buffer.tail, tail, memory_order_release);
}

static atomic_int shutdown_done = 0;

void __cache_explorer_shutdown(void) {
  // Guard against double shutdown (atexit + destructor)
  if (atomic_exchange(&shutdown_done, 1))
    return;

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