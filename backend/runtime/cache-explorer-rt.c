#include "cache-explorer-rt.h"
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <intrin.h>
#include <io.h>
#include <sys/stat.h>

#pragma intrinsic(_ReturnAddress)
#define CACHE_EXPLORER_RETURN_ADDRESS() ((uint64_t)(uintptr_t)_ReturnAddress())

typedef SRWLOCK cache_mutex_t;
#define CACHE_MUTEX_INITIALIZER SRWLOCK_INIT

static void cache_mutex_lock(cache_mutex_t *mutex) {
  AcquireSRWLockExclusive(mutex);
}

static void cache_mutex_unlock(cache_mutex_t *mutex) {
  ReleaseSRWLockExclusive(mutex);
}

static int cache_stdout_fileno(void) { return _fileno(stdout); }
static int cache_stderr_fileno(void) { return _fileno(stderr); }

static int cache_open_output(const char *path) {
  return _open(path, _O_WRONLY | _O_CREAT | _O_TRUNC | _O_BINARY,
               _S_IREAD | _S_IWRITE);
}

static int cache_write_bytes(int fd, const void *buffer, size_t size) {
  return _write(fd, buffer, (unsigned int)size);
}

static int cache_close_output(int fd) { return _close(fd); }
#else
#include <fcntl.h>
#include <pthread.h>
#include <unistd.h>

#if defined(__GNUC__) || defined(__clang__)
#define CACHE_EXPLORER_RETURN_ADDRESS()                                      \
  ((uint64_t)(uintptr_t)__builtin_extract_return_addr(                       \
      __builtin_return_address(0)))
#else
#define CACHE_EXPLORER_RETURN_ADDRESS() 0
#endif

typedef pthread_mutex_t cache_mutex_t;
#define CACHE_MUTEX_INITIALIZER PTHREAD_MUTEX_INITIALIZER

static void cache_mutex_lock(cache_mutex_t *mutex) {
  pthread_mutex_lock(mutex);
}

static void cache_mutex_unlock(cache_mutex_t *mutex) {
  pthread_mutex_unlock(mutex);
}

static int cache_stdout_fileno(void) { return STDOUT_FILENO; }
static int cache_stderr_fileno(void) { return STDERR_FILENO; }

static int cache_open_output(const char *path) {
  return open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
}

static ssize_t cache_write_bytes(int fd, const void *buffer, size_t size) {
  return write(fd, buffer, size);
}

static int cache_close_output(int fd) { return close(fd); }
#endif

static uint64_t cache_explorer_image_base(uint64_t code_address) {
#ifdef _WIN32
  MEMORY_BASIC_INFORMATION memory = {0};
  if (code_address != 0 &&
      VirtualQuery((const void *)(uintptr_t)code_address, &memory,
                   sizeof(memory)) == sizeof(memory) &&
      memory.Type == MEM_IMAGE &&
      memory.AllocationBase == (void *)GetModuleHandleW(NULL)) {
    // The current normalizer identifies only the launched executable. Leave
    // DLL/JIT sites unresolved instead of binding them to the wrong image.
    return (uint64_t)(uintptr_t)memory.AllocationBase;
  }
#else
  (void)code_address;
#endif
  return 0;
}

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

typedef struct {
  CacheEvent event;
  // Kept outside CacheEvent so the legacy raw-binary record layout remains
  // byte-for-byte compatible.
  uint64_t code_address;
  uint64_t code_image_base;
} BufferedCacheEvent;

static struct {
  BufferedCacheEvent events[BUFFER_SIZE];
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
  cache_mutex_t mutex;
} file_table = { .mutex = CACHE_MUTEX_INITIALIZER };
static int file_overflow_warned = 0;

static int output_fd = -1;
static int text_mode = 1;
static int output_failed = 0;
static atomic_int initialized = 0;
#ifdef _WIN32
static INIT_ONCE init_once = INIT_ONCE_STATIC_INIT;
#else
static pthread_once_t init_once = PTHREAD_ONCE_INIT;
#endif
static cache_mutex_t event_mutex = CACHE_MUTEX_INITIALIZER;

static void flush_locked(void);
static void set_output(const char *path, int use_text_mode);

// Sampling: only emit every Nth event (1 = no sampling, 100 = 1% of events)
static uint32_t sample_rate = 1;
static _Thread_local uint32_t sample_counter = 0;

// Event limit: stop after this many events (0 = no limit)
static uint64_t max_events = 0;
static atomic_uint_fast64_t total_events = 0;

// Progress reporting to stderr (for server/UI progress bar)
static uint64_t progress_interval = 0;
static atomic_uint_fast64_t progress_next = 0;

static uint32_t intern_filename(const char *file) {
  cache_mutex_lock(&file_table.mutex);

  // Search for existing entry
  for (uint32_t i = 0; i < file_table.count; i++) {
    if (strcmp(file_table.names[i], file) == 0) {
      cache_mutex_unlock(&file_table.mutex);
      return i;
    }
  }

  // Add new entry if space available
  if (file_table.count < MAX_FILES) {
    uint32_t idx = file_table.count++;
    strncpy(file_table.names[idx], file, MAX_FILENAME - 1);
    file_table.names[idx][MAX_FILENAME - 1] = '\0';  // Ensure null termination
    cache_mutex_unlock(&file_table.mutex);
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
  cache_mutex_unlock(&file_table.mutex);
  return 0;  // Attribute to first file when overflow
}

static void emit_runtime_progress(uint64_t count) {
  char buf[128];
  int len = snprintf(buf, sizeof(buf),
    "{\"type\":\"progress\",\"phase\":\"trace\",\"eventsProcessed\":%llu,\"eventsTotal\":%llu}\n",
    (unsigned long long)count, (unsigned long long)max_events);
  if (len > 0) cache_write_bytes(cache_stderr_fileno(), buf, (size_t)len);
}

static inline void emit_event_with_src_and_code(uint64_t addr_with_flag,
                                                uint64_t src_addr,
                                                uint64_t code_address,
                                                uint64_t code_image_base,
                                                uint32_t size,
                                                const char *file,
                                                uint32_t line) {
  // Lazy initialization: handles runtimes where .init_array constructors
  // are not processed (e.g., Zig's _start on Linux skips __libc_start_main)
  if (__builtin_expect(!atomic_load_explicit(&initialized, memory_order_acquire), 0)) {
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

  // Always count events for progress reporting
  uint64_t count = atomic_fetch_add(&total_events, 1);

  // Event limit: stop emitting after max_events
  if (max_events > 0 && count >= max_events) {
    return;  // Hit limit, skip remaining events
  }

  // Progress reporting (~1% intervals)
  if (__builtin_expect(progress_interval > 0 &&
      count >= atomic_load_explicit(&progress_next, memory_order_relaxed), 0)) {
    uint64_t expected = atomic_load(&progress_next);
    if (count >= expected &&
        atomic_compare_exchange_strong(&progress_next, &expected, expected + progress_interval)) {
      emit_runtime_progress(count);
    }
  }

  cache_mutex_lock(&event_mutex);
  uint64_t head = atomic_load_explicit(&ring_buffer.head, memory_order_relaxed);
  uint64_t next = (head + 1) & BUFFER_MASK;

  uint64_t tail = atomic_load_explicit(&ring_buffer.tail, memory_order_acquire);
  if (next == tail) {
    // Buffer full - must flush
    flush_locked();
    head = atomic_load_explicit(&ring_buffer.head, memory_order_relaxed);
    next = (head + 1) & BUFFER_MASK;
  } else if ((head & 0xFFF) == 0 && head != tail) {
    // Periodic flush every 4096 events - ensures output even when
    // destructors don't fire (e.g., Zig's _start calls _exit directly)
    flush_locked();
  }

  ring_buffer.events[head] = (BufferedCacheEvent){
    .event = (CacheEvent){
        .address = addr_with_flag,
        .src_address = src_addr,
        .size = size,
        .line = (intern_filename(file) << 20) | (line & 0xFFFFF),
        .thread_id = get_thread_id(),
    },
    .code_address = code_address,
    .code_image_base = code_image_base,
  };

  atomic_store_explicit(&ring_buffer.head, next, memory_order_release);
  cache_mutex_unlock(&event_mutex);
}

static inline void emit_event(uint64_t addr_with_flag, uint32_t size,
                               const char *file, uint32_t line) {
  emit_event_with_src_and_code(addr_with_flag, 0, 0, 0, size, file, line);
}

static inline void emit_event_with_code(uint64_t addr_with_flag, uint32_t size,
                                        uint64_t code_address) {
  emit_event_with_src_and_code(addr_with_flag, 0, code_address,
                               cache_explorer_image_base(code_address), size,
                               "unknown", 0);
}

void __tag_mem_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr, size, file, line);
}

void __tag_mem_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_STORE_FLAG, size, file, line);
}

void __tag_bb_entry(uint64_t bb_id, uint32_t instr_count, const char *file, uint32_t line) {
  // Estimate instruction fetch size: instr_count * 4 bytes (average instruction size)
  // bb_id is a unique identifier for this basic block
  uint32_t fetch_size = instr_count * 4;
  emit_event(bb_id | EVENT_ICACHE_FLAG, fetch_size, file, line);
}

// Conditional branch direction: branch_id identifies the static branch site,
// taken (0|1) is the runtime direction. Carried in the size field.
void __tag_branch(uint64_t branch_id, uint32_t taken, const char *file, uint32_t line) {
  emit_event(branch_id | EVENT_BRANCH_FLAG, taken ? 1u : 0u, file, line);
}

// Software prefetch hints (__builtin_prefetch)
void __tag_prefetch(void *addr, uint32_t size, uint8_t hint, const char *file, uint32_t line) {
  // Encode hint level in upper bits (P0, P1, P2, P3)
  uint64_t flags = EVENT_PREFETCH_FLAG | ((uint64_t)(hint & 0x3) << 54);
  emit_event((uint64_t)(uintptr_t)addr | flags, size, file, line);
}

// Vector/SIMD operations
void __tag_vector_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_VECTOR_FLAG, size, file, line);
}

void __tag_vector_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_VECTOR_FLAG | EVENT_STORE_FLAG, size, file, line);
}

// Atomic operations
void __tag_atomic_load(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_ATOMIC_FLAG, size, file, line);
}

void __tag_atomic_store(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_ATOMIC_FLAG | EVENT_STORE_FLAG, size, file, line);
}

void __tag_atomic_rmw(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_ATOMIC_FLAG | EVENT_ATOMIC_RMW | EVENT_STORE_FLAG, size, file, line);
}

void __tag_atomic_cmpxchg(void *addr, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)addr | EVENT_ATOMIC_FLAG | EVENT_ATOMIC_CMPXCHG, size, file, line);
}

// Memory intrinsics
void __tag_memcpy(void *dest, void *src, uint32_t size, const char *file, uint32_t line) {
  emit_event_with_src_and_code((uint64_t)(uintptr_t)dest | EVENT_MEMINTR_FLAG,
                               (uint64_t)(uintptr_t)src, 0, 0, size, file, line);
}

void __tag_memset(void *dest, uint32_t size, const char *file, uint32_t line) {
  emit_event((uint64_t)(uintptr_t)dest | EVENT_MEMINTR_FLAG | EVENT_MEMSET_TYPE, size, file, line);
}

void __tag_memmove(void *dest, void *src, uint32_t size, const char *file, uint32_t line) {
  emit_event_with_src_and_code(
      (uint64_t)(uintptr_t)dest | EVENT_MEMINTR_FLAG | EVENT_MEMMOVE_TYPE,
      (uint64_t)(uintptr_t)src, 0, 0, size, file, line);
}

// Stock Windows LLVM builds do not support loadable pass plugins. clang-cl's
// built-in SanitizerCoverage pass can still instrument loads and stores and
// call these hooks without requiring a custom compiler distribution. The
// return PC is process-local capture provenance. Trace ingestion later
// normalizes it to image identity + RVA and performs PDB symbolization; until
// then these records remain source-unattributed rather than being assigned to
// a misleading source line.
void __sanitizer_cov_trace_pc(void) {}

#define DEFINE_SANITIZER_COV_ACCESS(kind, flag, width)                        \
  void __sanitizer_cov_##kind##width(void *addr) {                            \
    const uint64_t code_address = CACHE_EXPLORER_RETURN_ADDRESS();            \
    emit_event_with_code((uint64_t)(uintptr_t)addr | flag, width,             \
                         code_address);                                        \
  }

DEFINE_SANITIZER_COV_ACCESS(load, 0, 1)
DEFINE_SANITIZER_COV_ACCESS(load, 0, 2)
DEFINE_SANITIZER_COV_ACCESS(load, 0, 4)
DEFINE_SANITIZER_COV_ACCESS(load, 0, 8)
DEFINE_SANITIZER_COV_ACCESS(load, 0, 16)
DEFINE_SANITIZER_COV_ACCESS(store, EVENT_STORE_FLAG, 1)
DEFINE_SANITIZER_COV_ACCESS(store, EVENT_STORE_FLAG, 2)
DEFINE_SANITIZER_COV_ACCESS(store, EVENT_STORE_FLAG, 4)
DEFINE_SANITIZER_COV_ACCESS(store, EVENT_STORE_FLAG, 8)
DEFINE_SANITIZER_COV_ACCESS(store, EVENT_STORE_FLAG, 16)

#undef DEFINE_SANITIZER_COV_ACCESS

static void initialize_runtime(void) {
  atomic_store(&ring_buffer.head, 0);
  atomic_store(&ring_buffer.tail, 0);
  atomic_store(&total_events, 0);
  file_table.count = 0;

  const char *trace = getenv("HARDWARE_EXPLORER_TRACE");
  if (!trace) trace = getenv("CACHE_EXPLORER_TRACE");
  if (trace) {
    set_output(trace, 1);
  } else {
    const char *out = getenv("HARDWARE_EXPLORER_OUTPUT");
    if (!out) out = getenv("CACHE_EXPLORER_OUTPUT");
    if (out) __cache_explorer_set_output(out);
  }

  // Sample rate: emit 1 in N events (1 = all, 100 = 1%, 1000 = 0.1%)
  const char *rate = getenv("HARDWARE_EXPLORER_SAMPLE_RATE");
  if (!rate) rate = getenv("CACHE_EXPLORER_SAMPLE_RATE");
  if (rate) {
    sample_rate = (uint32_t)atoi(rate);
    if (sample_rate < 1) sample_rate = 1;
  }

  // Max events: stop after this many (0 = no limit)
  const char *limit = getenv("HARDWARE_EXPLORER_MAX_EVENTS");
  if (!limit) limit = getenv("CACHE_EXPLORER_MAX_EVENTS");
  if (limit) {
    max_events = (uint64_t)atoll(limit);
  }

  // Set up progress reporting interval
  if (max_events >= 100) {
    progress_interval = max_events / 100;
  } else {
    progress_interval = 100000;  // Every 100K events when no limit
  }
  atomic_store(&progress_next, progress_interval);
  atexit(__cache_explorer_shutdown);
  // Emit initial progress
  emit_runtime_progress(0);
  atomic_store_explicit(&initialized, 1, memory_order_release);
}

#ifdef _WIN32
static BOOL CALLBACK initialize_runtime_once(PINIT_ONCE once, PVOID parameter,
                                             PVOID *context) {
  (void)once;
  (void)parameter;
  (void)context;
  initialize_runtime();
  return TRUE;
}
#endif

void __cache_explorer_init(void) {
#ifdef _WIN32
  InitOnceExecuteOnce(&init_once, initialize_runtime_once, NULL, NULL);
#else
  pthread_once(&init_once, initialize_runtime);
#endif
}

static void set_output(const char *path, int use_text_mode) {
  if (path == NULL) {
    output_fd = cache_stdout_fileno();
    text_mode = 1;
    output_failed = 0;
  } else if (strcmp(path, "-") == 0) {
    output_fd = cache_stdout_fileno();
    text_mode = 1;
    output_failed = 0;
  } else {
    output_fd = cache_open_output(path);
    text_mode = use_text_mode;
    output_failed = output_fd < 0;
    if (output_failed) {
      fprintf(stderr, "[cache-explorer] ERROR: could not open trace output '%s'.\n",
              path);
    }
  }
}

void __cache_explorer_set_output(const char *path) { set_output(path, 0); }

// Write buffer for batching output (eliminates per-event syscalls)
#define WRITE_BUF_SIZE (256 * 1024)  // 256KB write buffer
#define MAX_FORMATTED_EVENT_SIZE (MAX_FILENAME + 128)
static char write_buf[WRITE_BUF_SIZE];
static int write_buf_pos = 0;

static inline void wb_flush(void) {
  if (write_buf_pos > 0) {
    const char *p = write_buf;
    int remaining = write_buf_pos;
    while (remaining > 0) {
      int n = (int)cache_write_bytes(output_fd, p, (size_t)remaining);
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
                             const char *file, uint32_t line, uint32_t tid,
                             uint64_t code_address,
                             uint64_t code_image_base) {
  if (write_buf_pos + MAX_FORMATTED_EVENT_SIZE > WRITE_BUF_SIZE)
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
  if (code_address != 0) {
    *p++ = ' ';
    *p++ = 'C';
    p += fmt_hex(p, code_address);
  }
  if (code_image_base != 0 && code_address >= code_image_base) {
    *p++ = ' ';
    *p++ = 'B';
    p += fmt_hex(p, code_image_base);
    *p++ = ' ';
    *p++ = 'R';
    p += fmt_hex(p, code_address - code_image_base);
  }
  *p++ = '\n';
  write_buf_pos = (int)(p - write_buf);
}

// Format event with two addresses (memcpy/memmove)
static inline void fmt_event_src(char type, uint64_t addr, uint64_t src_addr,
                                 uint32_t size, const char *file, uint32_t line,
                                 uint32_t tid) {
  if (write_buf_pos + MAX_FORMATTED_EVENT_SIZE > WRITE_BUF_SIZE)
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
  if (write_buf_pos + MAX_FORMATTED_EVENT_SIZE > WRITE_BUF_SIZE)
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

static void flush_locked(void) {
  if (output_failed) {
    const uint64_t head =
        atomic_load_explicit(&ring_buffer.head, memory_order_acquire);
    atomic_store_explicit(&ring_buffer.tail, head, memory_order_release);
    return;
  }
  if (output_fd < 0)
    output_fd = cache_stdout_fileno();

  uint64_t tail = atomic_load_explicit(&ring_buffer.tail, memory_order_relaxed);
  uint64_t head = atomic_load_explicit(&ring_buffer.head, memory_order_acquire);

  if (text_mode) {
    while (tail != head) {
      BufferedCacheEvent *buffered = &ring_buffer.events[tail];
      CacheEvent *e = &buffered->event;
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
      int is_branch = (e->address & EVENT_BRANCH_FLAG) != 0;

      if (is_branch) {
        // addr holds the branch-site id (flag bit cleared); size holds taken.
        fmt_event('B', addr & ~EVENT_BRANCH_FLAG, e->size, file, line,
                  e->thread_id, buffered->code_address,
                  buffered->code_image_base);
      } else if (is_memintr) {
        uint64_t intrinsic_type = (e->address >> 54) & 0x3;
        if (intrinsic_type == 1) {
          fmt_event('Z', addr, e->size, file, line, e->thread_id,
                    buffered->code_address, buffered->code_image_base);
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
        fmt_event(event_type, addr, e->size, file, line, e->thread_id,
                  buffered->code_address, buffered->code_image_base);
      } else if (is_vector) {
        fmt_event(is_store ? 'U' : 'V', addr, e->size, file, line,
                  e->thread_id, buffered->code_address,
                  buffered->code_image_base);
      } else if (is_prefetch) {
        uint8_t hint = (e->address >> 54) & 0x3;
        fmt_prefetch(hint, addr, e->size, file, line, e->thread_id);
      } else if (is_icache) {
        fmt_event('I', addr, e->size, file, line, e->thread_id,
                  buffered->code_address, buffered->code_image_base);
      } else {
        fmt_event(is_store ? 'S' : 'L', addr, e->size, file, line,
                  e->thread_id, buffered->code_address,
                  buffered->code_image_base);
      }

      tail = (tail + 1) & BUFFER_MASK;
    }
    // Flush remaining buffered output
    wb_flush();
  } else {
    while (tail != head) {
      cache_write_bytes(output_fd, &ring_buffer.events[tail].event,
                        sizeof(CacheEvent));
      tail = (tail + 1) & BUFFER_MASK;
    }
  }

  atomic_store_explicit(&ring_buffer.tail, tail, memory_order_release);
}

void __cache_explorer_flush(void) {
  cache_mutex_lock(&event_mutex);
  flush_locked();
  cache_mutex_unlock(&event_mutex);
}

static atomic_int shutdown_done = 0;

void __cache_explorer_shutdown(void) {
  // Guard against double shutdown (atexit + destructor)
  if (atomic_exchange(&shutdown_done, 1))
    return;

  // Emit final progress (total events collected)
  uint64_t final_count = atomic_load(&total_events);
  if (progress_interval > 0) {
    emit_runtime_progress(max_events > 0 ? (final_count < max_events ? final_count : max_events) : final_count);
  }

  __cache_explorer_flush();
  if (output_fd > 2) {
    cache_close_output(output_fd);
    output_fd = -1;
  }
}

#ifndef _WIN32
__attribute__((constructor)) static void auto_init(void) {
  __cache_explorer_init();
}

__attribute__((destructor)) static void auto_shutdown(void) {
  __cache_explorer_shutdown();
}
#endif
