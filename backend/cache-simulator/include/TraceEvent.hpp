#pragma once

#include <cstdint>
#include <limits>
#include <string>
#include <optional>
#include <sstream>

// Compact reference into a trace's image table. Portable output expands the
// table id to the image's SHA-256 identity.
struct TraceCodeLocation {
  uint32_t image_table_id = 0;
  uint64_t rva = 0;

  bool operator==(const TraceCodeLocation &other) const {
    return image_table_id == other.image_table_id && rva == other.rva;
  }
};

struct TraceEvent {
  // Basic event properties
  bool is_write = false;
  bool is_icache = false;  // true for instruction fetch events
  uint64_t address = 0;
  uint32_t size = 0;
  std::string file;
  uint32_t line = 0;
  uint32_t thread_id = 1;

  // Binary-attribution extensions. code_address is a process-local capture PC
  // and must be normalized before export. code_site_id refers to a v2 trace
  // site table entry, whose stable identity is image + RVA.
  std::optional<uint64_t> code_address;
  std::optional<uint64_t> code_image_base;
  std::optional<uint64_t> code_rva;
  std::optional<uint32_t> code_site_id;
  std::optional<TraceCodeLocation> code_location;

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
  if (value.empty() || value.find_first_not_of("0123456789") != std::string::npos)
    return std::nullopt;
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

inline std::optional<uint64_t> parse_trace_u64(const std::string &value,
                                               int base) {
  if (value.empty() || value[0] == '-' || value[0] == '+') return std::nullopt;
  try {
    size_t consumed = 0;
    const unsigned long long parsed = std::stoull(value, &consumed, base);
    if (consumed != value.size()) return std::nullopt;
    return static_cast<uint64_t>(parsed);
  } catch (...) {
    return std::nullopt;
  }
}

inline bool parse_trace_extension(const std::string &token,
                                  TraceEvent &event) {
  if (token.size() > 1 && token[0] == 'T') {
    auto parsed_thread = parse_trace_u32(token.substr(1));
    if (!parsed_thread) return false;
    event.thread_id = *parsed_thread;
  } else if (token.size() > 1 && token[0] == 'C') {
    const std::string value = token.substr(1);
    if (value.size() < 3 || value[0] != '0' ||
        (value[1] != 'x' && value[1] != 'X')) {
      return false;
    }
    auto parsed_address = parse_trace_u64(value, 0);
    if (!parsed_address || event.code_address) return false;
    event.code_address = *parsed_address;
  } else if (token.size() > 1 && token[0] == 'K') {
    auto parsed_site = parse_trace_u32(token.substr(1));
    if (!parsed_site || event.code_site_id) return false;
    event.code_site_id = *parsed_site;
  } else if (token.size() > 1 &&
             (token[0] == 'B' || token[0] == 'R')) {
    const std::string value = token.substr(1);
    if (value.size() < 3 || value[0] != '0' ||
        (value[1] != 'x' && value[1] != 'X')) {
      return false;
    }
    auto parsed_address = parse_trace_u64(value, 0);
    if (!parsed_address) return false;
    std::optional<uint64_t> &destination =
        token[0] == 'B' ? event.code_image_base : event.code_rva;
    if (destination) return false;
    destination = *parsed_address;
  }
  // Unknown trailing extensions remain forward-compatible.
  return true;
}

inline bool parse_trace_extensions(std::istringstream &iss,
                                   TraceEvent &event) {
  std::string token;
  while (iss >> token) {
    if (!parse_trace_extension(token, event)) return false;
  }
  return true;
}

inline std::optional<TraceEvent> parse_trace_event(const std::string &line) {
  if (line.empty() || line[0] == '#')
    return std::nullopt;

  std::istringstream iss(line);
  std::string type_str;
  uint64_t addr;
  uint32_t size;
  std::string location;

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
    if (!parse_trace_extensions(iss, event)) return std::nullopt;
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

  // Parse thread ID and optional binary-attribution extensions.
  if (!parse_trace_extensions(iss, event)) return std::nullopt;

  return event;
}
