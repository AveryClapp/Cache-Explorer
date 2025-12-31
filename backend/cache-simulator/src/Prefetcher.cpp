#include "../include/Prefetcher.hpp"
#include <algorithm>
#include <cstdlib>

std::vector<uint64_t> Prefetcher::on_miss(uint64_t addr, uint64_t pc) {
  std::vector<uint64_t> prefetch_addrs;

  switch (policy) {
  case PrefetchPolicy::NONE:
    break;
  case PrefetchPolicy::NEXT_LINE:
    prefetch_addrs = next_line_prefetch(addr);
    break;
  case PrefetchPolicy::STREAM:
    prefetch_addrs = stream_prefetch(addr, pc);
    break;
  case PrefetchPolicy::STRIDE:
    prefetch_addrs = stride_prefetch(addr, pc);
    break;
  case PrefetchPolicy::ADAPTIVE:
    prefetch_addrs = adaptive_prefetch(addr, pc);
    break;
  case PrefetchPolicy::INTEL:
    prefetch_addrs = intel_prefetch(addr, pc);
    break;
  }

  stats.prefetches_issued += prefetch_addrs.size();
  return prefetch_addrs;
}

std::vector<uint64_t> Prefetcher::next_line_prefetch(uint64_t addr) {
  std::vector<uint64_t> result;
  uint64_t line_addr = get_line_addr(addr);

  // Prefetch next N lines
  for (int i = 1; i <= prefetch_degree; i++) {
    result.push_back(line_addr + i * line_size);
  }
  return result;
}

std::vector<uint64_t> Prefetcher::stream_prefetch(uint64_t addr, uint64_t pc) {
  update_stream_table(addr);

  std::vector<uint64_t> result;
  uint64_t line_addr = get_line_addr(addr);
  uint64_t page = get_page(addr);

  // Find matching stream entry
  for (auto &entry : stream_table) {
    if (!entry.valid)
      continue;
    if (get_page(entry.last_addr) != page)
      continue;

    if (entry.confidence >= StreamEntry::CONFIDENCE_THRESHOLD) {
      // Issue prefetches in the detected direction
      for (int i = 1; i <= prefetch_degree; i++) {
        uint64_t pf_addr = line_addr + entry.direction * i * line_size;
        // Don't cross page boundaries
        if (get_page(pf_addr) == page) {
          result.push_back(pf_addr);
        }
      }
      break;
    }
  }

  return result;
}

void Prefetcher::update_stream_table(uint64_t addr) {
  uint64_t line_addr = get_line_addr(addr);
  uint64_t page = get_page(addr);

  // Check if this access extends an existing stream
  for (auto &entry : stream_table) {
    if (!entry.valid)
      continue;
    if (get_page(entry.last_addr) != page)
      continue;

    int64_t delta =
        static_cast<int64_t>(line_addr) - static_cast<int64_t>(entry.last_addr);

    // Check if it's sequential (within a few lines)
    if (delta == line_size && entry.direction >= 0) {
      // Ascending sequence
      entry.last_addr = line_addr;
      entry.direction = 1;
      entry.confidence =
          std::min(entry.confidence + 1, StreamEntry::MAX_CONFIDENCE);
      return;
    } else if (delta == -line_size && entry.direction <= 0) {
      // Descending sequence
      entry.last_addr = line_addr;
      entry.direction = -1;
      entry.confidence =
          std::min(entry.confidence + 1, StreamEntry::MAX_CONFIDENCE);
      return;
    } else if (std::abs(delta) <= 4 * line_size) {
      // Gap in sequence, reduce confidence
      entry.confidence--;
      if (entry.confidence <= 0) {
        entry.valid = false;
      }
      return;
    }
  }

  // Start new stream entry
  for (auto &entry : stream_table) {
    if (!entry.valid) {
      entry.start_addr = line_addr;
      entry.last_addr = line_addr;
      entry.direction = 0;
      entry.confidence = 1;
      entry.valid = true;
      return;
    }
  }

  // Table full, replace lowest confidence entry
  int min_idx = 0;
  int min_conf = stream_table[0].confidence;
  for (size_t i = 1; i < stream_table.size(); i++) {
    if (stream_table[i].confidence < min_conf) {
      min_conf = stream_table[i].confidence;
      min_idx = i;
    }
  }
  stream_table[min_idx] = {line_addr, line_addr, 0, 1, true};
}

std::vector<uint64_t> Prefetcher::stride_prefetch(uint64_t addr, uint64_t pc) {
  update_stride_table(addr, pc);

  std::vector<uint64_t> result;
  auto it = stride_table.find(pc);
  if (it == stride_table.end())
    return result;

  const StrideEntry &entry = it->second;
  if (!entry.valid || entry.confidence < StrideEntry::CONFIDENCE_THRESHOLD)
    return result;

  if (entry.stride == 0)
    return result;

  // Issue prefetches along the stride
  uint64_t line_addr = get_line_addr(addr);
  for (int i = 1; i <= prefetch_degree; i++) {
    uint64_t pf_addr = line_addr + i * entry.stride;
    result.push_back(pf_addr);
  }

  return result;
}

void Prefetcher::update_stride_table(uint64_t addr, uint64_t pc) {
  if (pc == 0)
    return; // No PC info

  uint64_t line_addr = get_line_addr(addr);
  auto it = stride_table.find(pc);

  if (it == stride_table.end()) {
    // New entry
    stride_table[pc] = {line_addr, 0, 1, true};
    return;
  }

  StrideEntry &entry = it->second;
  int64_t new_stride = static_cast<int64_t>(line_addr - entry.last_addr);

  if (entry.stride == 0) {
    // First stride measurement
    entry.stride = new_stride;
    entry.last_addr = line_addr;
    return;
  }

  if (new_stride == entry.stride) {
    // Stride confirmed
    entry.confidence =
        std::min(entry.confidence + 1, StrideEntry::MAX_CONFIDENCE);
  } else {
    // Stride changed
    entry.confidence--;
    if (entry.confidence <= 0) {
      entry.stride = new_stride;
      entry.confidence = 1;
    }
  }
  entry.last_addr = line_addr;
}

std::vector<uint64_t> Prefetcher::adaptive_prefetch(uint64_t addr, uint64_t pc) {
  // Try stride prefetching first (more specific)
  auto stride_result = stride_prefetch(addr, pc);
  if (!stride_result.empty()) {
    return stride_result;
  }

  // Fall back to stream prefetching
  return stream_prefetch(addr, pc);
}

std::vector<uint64_t> Prefetcher::intel_prefetch(uint64_t addr, uint64_t pc) {
  // Intel-like prefetching: adaptive (stride + stream)
  // Note: Adjacent line prefetcher is disabled as it reduced accuracy
  // Real Intel CPUs have complex prefetcher interactions we can't fully model
  return adaptive_prefetch(addr, pc);
}
