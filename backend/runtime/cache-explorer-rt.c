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
} file_table;

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
  for (uint32_t i = 0; i < file_table.count; i++) {
    if (strcmp(file_table.names[i], file) == 0)
      return i;
  }
  if (file_table.count < MAX_FILES) {
    strncpy(file_table.names[file_table.count], file, MAX_FILENAME - 1);
    return file_table.count++;
  }
  return 0;
}

static inline void emit_event(uint64_t addr_with_flag, uint32_t size,
                               const char *file, uint32_t line) {
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
      .size = size,
      .line = (intern_filename(file) << 20) | (line & 0xFFFFF),
      .thread_id = get_thread_id(),
  };

  atomic_store_explicit(&ring_buffer.head, next, memory_order_release);
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
      int is_store = (e->address & EVENT_STORE_FLAG) != 0;
      int is_icache = (e->address & EVENT_ICACHE_FLAG) != 0;
      uint32_t file_id = e->line >> 20;
      uint32_t line = e->line & 0xFFFFF;

      const char *file = (file_id < file_table.count) ? file_table.names[file_id] : "?";
      char event_type = is_icache ? 'I' : (is_store ? 'S' : 'L');
      dprintf(output_fd, "%c 0x%llx %u %s:%u T%u\n", event_type,
              (unsigned long long)addr, e->size, file, line, e->thread_id);

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
