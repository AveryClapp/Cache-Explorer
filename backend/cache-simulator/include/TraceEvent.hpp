#pragma once

#include <cstdint>
#include <string>
#include <optional>
#include <sstream>

struct TraceEvent {
  bool is_write;
  uint64_t address;
  uint32_t size;
  std::string file;
  uint32_t line;
  uint32_t thread_id = 1;
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

inline std::optional<TraceEvent> parse_trace_event(const std::string &line) {
  if (line.empty() || line[0] == '#')
    return std::nullopt;

  std::istringstream iss(line);
  char type;
  uint64_t addr;
  uint32_t size;
  std::string location;
  std::string thread_str;

  if (!(iss >> type >> std::hex >> addr >> std::dec >> size))
    return std::nullopt;

  TraceEvent event;
  event.is_write = (type == 'S' || type == 's');
  event.address = addr;
  event.size = size;
  event.thread_id = 1;

  if (iss >> location) {
    auto colon = location.find(':');
    if (colon != std::string::npos) {
      event.file = location.substr(0, colon);
      event.line = std::stoul(location.substr(colon + 1));
    } else {
      event.file = location;
      event.line = 0;
    }
  }

  // Parse thread ID (format: T<number>)
  if (iss >> thread_str) {
    if (!thread_str.empty() && thread_str[0] == 'T') {
      event.thread_id = std::stoul(thread_str.substr(1));
    }
  }

  return event;
}
