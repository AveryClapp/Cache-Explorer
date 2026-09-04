#pragma once

#include <cstdint>
#include <limits>
#include <string>
#include <optional>
#include <sstream>

struct TraceEvent {
  // Basic event properties
  bool is_write = false;
  bool is_icache = false;  // true for instruction fetch events
  uint64_t address = 0;
  uint32_t size = 0;
  std::string file;
  uint32_t line = 0;
  uint32_t thread_id = 1;

  // Software prefetch hints (__builtin_prefetch)
  bool is_prefetch = false;
  uint8_t prefetch_hint = 0;  // 0=T0 (all), 1=T1 (L2+), 2=T2 (L3), 3=NTA

  // Vector/SIMD operations (AVX, SSE)
  bool is_vector = false;

  // Atomic operations (std::atomic, atomicrmw, cmpxchg)
  bool is_atomic = false;
  bool is_rmw = false;      // Read-modify-write (fetch_add, etc.)
  bool is_cmpxchg = false;  // Compare-and-swap

  // Memory intrinsics (memcpy, memset, memmove)
  bool is_memcpy = false;
  bool is_memset = false;
  bool is_memmove = false;
  uint64_t src_address = 0;  // Source address for memcpy/memmove

  // Control flow: conditional branch direction (for branch prediction)
  // For branch events, `branch_id` is the static branch-site id and
  // `branch_taken` is the runtime direction. `address` is also populated from
  // the trace for backwards compatibility, but branch events are not memory
  // accesses.
  bool is_branch = false;
  uint64_t branch_id = 0;
  bool branch_taken = false;
};

struct EventResult {
  bool l1_hit;
  bool l2_hit;
  bool l3_hit;
  uint64_t address;
  uint32_t size;
  std::string file;
  uint32_t line;
};

inline std::optional<uint32_t> parse_trace_u32(const std::string &value) {
  try {
    size_t consumed = 0;
    const unsigned long long parsed = std::stoull(value, &consumed, 10);
    if (consumed != value.size() || parsed > std::numeric_limits<uint32_t>::max()) {
      return std::nullopt;
    }
    return static_cast<uint32_t>(parsed);
  } catch (...) {
    return std::nullopt;
  }
}

inline std::optional<TraceEvent> parse_trace_event(const std::string &line) {
  if (line.empty() || line[0] == '#')
    return std::nullopt;

  std::istringstream iss(line);
  std::string type_str;
  uint64_t addr;
  uint32_t size;
  std::string location;
  std::string thread_str;

  // First, read type and address
  if (!(iss >> type_str >> std::hex >> addr))
    return std::nullopt;

  TraceEvent event;
  event.address = addr;
  event.thread_id = 1;

  char type = type_str[0];

  // For memcpy/memmove, parse src address before size
  // Format: M/O <dest> <src> <size> <location> <thread>
  if (type == 'M' || type == 'O') {
    uint64_t src_addr;
    if (!(iss >> std::hex >> src_addr >> std::dec >> size))
      return std::nullopt;
    event.src_address = src_addr;
    event.size = size;
    if (type == 'M') {
      event.is_memcpy = true;
    } else {
      event.is_memmove = true;
    }
    event.is_write = true;
    // Parse remaining location and thread
    if (iss >> location) {
      // Use the final colon so Windows paths such as C:\\games\\main.cpp:42
      // retain their drive prefix.
      auto colon = location.rfind(':');
      if (colon != std::string::npos) {
        event.file = location.substr(0, colon);
        auto parsed_line = parse_trace_u32(location.substr(colon + 1));
        if (!parsed_line) return std::nullopt;
        event.line = *parsed_line;
      } else {
        event.file = location;
        event.line = 0;
      }
    }
    if (iss >> thread_str) {
      if (!thread_str.empty() && thread_str[0] == 'T') {
        auto parsed_thread = parse_trace_u32(thread_str.substr(1));
        if (!parsed_thread) return std::nullopt;
        event.thread_id = *parsed_thread;
      }
    }
    return event;
  }

  // Standard format: type addr size location thread
  if (!(iss >> std::dec >> size))
    return std::nullopt;
  event.size = size;

  // Parse event type
  switch (type) {
    case 'L': case 'l': case 'R': case 'r':
      // Load/Read - default is_write = false
      break;

    case 'S': case 's':
      // Store
      event.is_write = true;
      break;

    case 'I': case 'i':
      // Instruction fetch
      event.is_icache = true;
      break;

    case 'P':
      // Software prefetch hint
      event.is_prefetch = true;
      // Check for prefetch level (P0, P1, P2, P3)
      if (type_str.length() > 1 && type_str[1] >= '0' && type_str[1] <= '3') {
        event.prefetch_hint = type_str[1] - '0';
      }
      break;

    case 'V':
      // Vector load (SIMD)
      event.is_vector = true;
      break;

    case 'U':
      // Vector store (SIMD)
      event.is_vector = true;
      event.is_write = true;
      break;

    case 'A':
      // Atomic load
      event.is_atomic = true;
      break;

    case 'X':
      // Atomic read-modify-write
      event.is_atomic = true;
      event.is_write = true;
      event.is_rmw = true;
      break;

    case 'C':
      // Compare-and-swap
      event.is_atomic = true;
      event.is_cmpxchg = true;
      break;

    case 'Z':
      // memset
      event.is_memset = true;
      event.is_write = true;
      break;

    case 'B':
      // Conditional branch: addr = branch-site id, size = taken (0|1)
      event.is_branch = true;
      event.branch_id = event.address;
      event.branch_taken = (event.size != 0);
      break;

    default:
      return std::nullopt;
  }

  // Parse location (file:line)
  if (iss >> location) {
    // Use the final colon so Windows paths such as C:\\games\\main.cpp:42
    // retain their drive prefix.
    auto colon = location.rfind(':');
    if (colon != std::string::npos) {
      event.file = location.substr(0, colon);
      auto parsed_line = parse_trace_u32(location.substr(colon + 1));
      if (!parsed_line) return std::nullopt;
      event.line = *parsed_line;
    } else {
      event.file = location;
      event.line = 0;
    }
  }

  // Parse thread ID (format: T<number>)
  if (iss >> thread_str) {
    if (!thread_str.empty() && thread_str[0] == 'T') {
      auto parsed_thread = parse_trace_u32(thread_str.substr(1));
      if (!parsed_thread) return std::nullopt;
      event.thread_id = *parsed_thread;
    }
  }

  return event;
}
