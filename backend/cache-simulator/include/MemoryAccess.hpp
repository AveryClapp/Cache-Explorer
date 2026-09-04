#pragma once

#include <cstdint>
#include <limits>
#include <stdexcept>
#include <vector>

struct MemoryAccess {
  uint64_t address;
  uint32_t size;
  bool is_write;

  [[nodiscard]] uint64_t end_address() const {
    if (size == 0)
      return address;
    const uint64_t extent = static_cast<uint64_t>(size) - 1;
    if (extent > std::numeric_limits<uint64_t>::max() - address)
      return std::numeric_limits<uint64_t>::max();
    return address + extent;
  }
};

struct CacheLineAccess {
  uint64_t line_address;
  uint64_t access_address;
  bool is_write;
};

inline std::vector<CacheLineAccess>
split_access_to_cache_lines(const MemoryAccess &access, int line_size) {
  constexpr uint64_t max_lines_per_access = 262144;
  std::vector<CacheLineAccess> lines;

  if (access.size == 0 || line_size <= 0 ||
      (line_size & (line_size - 1)) != 0)
    return lines;

  uint64_t line_mask = ~(static_cast<uint64_t>(line_size) - 1);
  uint64_t start_line = access.address & line_mask;
  uint64_t end_line = access.end_address() & line_mask;
  const uint64_t line_count =
      ((end_line - start_line) / static_cast<uint64_t>(line_size)) + 1;
  if (line_count > max_lines_per_access)
    throw std::length_error("Memory access spans too many cache lines");
  lines.reserve(static_cast<size_t>(line_count));

  for (uint64_t line = start_line;;) {
    uint64_t access_address = access.address > line ? access.address : line;
    lines.push_back({line, access_address, access.is_write});
    if (line == end_line ||
        line > std::numeric_limits<uint64_t>::max() -
                   static_cast<uint64_t>(line_size))
      break;
    line += static_cast<uint64_t>(line_size);
  }

  return lines;
}
