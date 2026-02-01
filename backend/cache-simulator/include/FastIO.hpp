#pragma once

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <string>

#include "TraceEvent.hpp"

// Bulk stdin reader - reads entire input in large chunks
// Eliminates per-character getc/mutex overhead from std::getline
class BulkReader {
public:
  // Read all of stdin into a single contiguous buffer
  static std::string read_all() {
    std::string buf;
    buf.reserve(64 * 1024 * 1024); // 64MB initial reserve

    char chunk[1024 * 1024]; // 1MB read chunks
    size_t n;
    while ((n = fread(chunk, 1, sizeof(chunk), stdin)) > 0) {
      buf.append(chunk, n);
    }
    return buf;
  }
};

// Fast trace event parser - avoids std::istringstream overhead
// Parses directly from char pointers with no intermediate allocations
inline std::optional<TraceEvent> parse_trace_event_fast(const char *begin,
                                                        const char *end) {
  if (begin >= end || *begin == '#' || *begin == '\n')
    return std::nullopt;

  const char *p = begin;

  // Skip leading whitespace
  while (p < end && *p == ' ')
    p++;
  if (p >= end)
    return std::nullopt;

  // Parse type character
  char type = *p++;

  // Handle type modifiers (P0, P1, etc.)
  uint8_t prefetch_hint = 0;
  if (type == 'P' && p < end && *p >= '0' && *p <= '3') {
    prefetch_hint = *p - '0';
    p++;
  }

  // Skip whitespace
  while (p < end && *p == ' ')
    p++;
  if (p >= end)
    return std::nullopt;

  // Parse hex address
  uint64_t addr = 0;
  if (p + 1 < end && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) {
    p += 2; // skip 0x
  }
  while (p < end && *p != ' ') {
    char c = *p;
    if (c >= '0' && c <= '9')
      addr = (addr << 4) | (c - '0');
    else if (c >= 'a' && c <= 'f')
      addr = (addr << 4) | (c - 'a' + 10);
    else if (c >= 'A' && c <= 'F')
      addr = (addr << 4) | (c - 'A' + 10);
    else
      break;
    p++;
  }

  // For memcpy/memmove: parse src address next
  uint64_t src_addr = 0;
  if (type == 'M' || type == 'O') {
    while (p < end && *p == ' ')
      p++;
    if (p + 1 < end && p[0] == '0' && (p[1] == 'x' || p[1] == 'X'))
      p += 2;
    while (p < end && *p != ' ') {
      char c = *p;
      if (c >= '0' && c <= '9')
        src_addr = (src_addr << 4) | (c - '0');
      else if (c >= 'a' && c <= 'f')
        src_addr = (src_addr << 4) | (c - 'a' + 10);
      else if (c >= 'A' && c <= 'F')
        src_addr = (src_addr << 4) | (c - 'A' + 10);
      else
        break;
      p++;
    }
  }

  // Skip whitespace
  while (p < end && *p == ' ')
    p++;
  if (p >= end)
    return std::nullopt;

  // Parse decimal size
  uint32_t size = 0;
  while (p < end && *p >= '0' && *p <= '9') {
    size = size * 10 + (*p - '0');
    p++;
  }
  if (size == 0)
    return std::nullopt;

  // Build event
  TraceEvent event;
  event.address = addr;
  event.size = size;
  event.thread_id = 1;

  switch (type) {
  case 'L':
  case 'l':
  case 'R':
  case 'r':
    break;
  case 'S':
  case 's':
    event.is_write = true;
    break;
  case 'I':
  case 'i':
    event.is_icache = true;
    break;
  case 'P':
    event.is_prefetch = true;
    event.prefetch_hint = prefetch_hint;
    break;
  case 'V':
    event.is_vector = true;
    break;
  case 'U':
    event.is_vector = true;
    event.is_write = true;
    break;
  case 'A':
    event.is_atomic = true;
    break;
  case 'X':
    event.is_atomic = true;
    event.is_write = true;
    event.is_rmw = true;
    break;
  case 'C':
    event.is_atomic = true;
    event.is_cmpxchg = true;
    break;
  case 'Z':
    event.is_memset = true;
    event.is_write = true;
    break;
  case 'M':
    event.is_memcpy = true;
    event.is_write = true;
    event.src_address = src_addr;
    break;
  case 'O':
    event.is_memmove = true;
    event.is_write = true;
    event.src_address = src_addr;
    break;
  default:
    return std::nullopt;
  }

  // Skip whitespace
  while (p < end && *p == ' ')
    p++;

  // Parse location (file:line)
  if (p < end && *p != '\n' && *p != '\r') {
    const char *loc_start = p;
    while (p < end && *p != ' ' && *p != '\n' && *p != '\r')
      p++;

    // Don't parse if it starts with 'T' (thread ID with no location)
    if (*loc_start != 'T') {
      // Find last colon for file:line split
      const char *colon = nullptr;
      for (const char *c = p - 1; c >= loc_start; c--) {
        if (*c == ':') {
          colon = c;
          break;
        }
      }

      if (colon && colon > loc_start) {
        event.file.assign(loc_start, colon - loc_start);
        // Parse line number
        const char *lp = colon + 1;
        uint32_t ln = 0;
        while (lp < p && *lp >= '0' && *lp <= '9') {
          ln = ln * 10 + (*lp - '0');
          lp++;
        }
        event.line = ln;
      } else {
        event.file.assign(loc_start, p - loc_start);
      }
    } else {
      // This was actually the thread field, parse it
      goto parse_thread_from_loc;
    }
  }

  // Skip whitespace
  while (p < end && *p == ' ')
    p++;

  // Parse thread ID (T<number>)
  if (p < end && *p == 'T') {
  parse_thread_from_loc:
    p++; // skip 'T'
    uint32_t tid = 0;
    while (p < end && *p >= '0' && *p <= '9') {
      tid = tid * 10 + (*p - '0');
      p++;
    }
    event.thread_id = tid;
  }

  return event;
}

// Iterate lines in a buffer, calling a callback for each line
// Avoids any string allocation - passes char pointers
template <typename Callback>
inline void for_each_line(const std::string &buf, Callback &&cb) {
  const char *data = buf.data();
  const char *end = data + buf.size();
  const char *line_start = data;

  while (line_start < end) {
    const char *line_end =
        static_cast<const char *>(memchr(line_start, '\n', end - line_start));
    if (!line_end)
      line_end = end;

    if (line_end > line_start) {
      cb(line_start, line_end);
    }

    line_start = line_end + 1;
  }
}
