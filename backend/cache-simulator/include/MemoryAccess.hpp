#pragma once

#include <cstdint>
#include <vector>

struct MemoryAccess {
  uint64_t address;
  uint32_t size;
  bool is_write;

  uint64_t end_address() const { return address + size - 1; }
};

struct CacheLineAccess {
  uint64_t line_address;
  bool is_write;
};

inline std::vector<CacheLineAccess>
split_access_to_cache_lines(const MemoryAccess &access, int line_size) {
  std::vector<CacheLineAccess> lines;

  uint64_t line_mask = ~(static_cast<uint64_t>(line_size) - 1);
  uint64_t start_line = access.address & line_mask;
  uint64_t end_line = access.end_address() & line_mask;

  for (uint64_t line = start_line; line <= end_line; line += line_size) {
    lines.push_back({line, access.is_write});
  }

  return lines;
}
