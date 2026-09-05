#pragma once

#include "TraceEvent.hpp"

#include <cstddef>
#include <cstdint>
#include <istream>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

struct TraceImage {
  uint32_t table_id = 0;
  std::string image_id;
  std::string name;
  uint64_t loaded_base = 0;
  uint64_t end_address = 0;
};

struct TraceCodeSite {
  uint32_t table_id = 0;
  uint32_t image_table_id = 0;
  uint64_t rva = 0;
};

struct TraceCapture {
  std::string kind;
  std::string target;
  uint32_t address_width = 0;
  uint32_t sample_rate = 1;
  uint64_t event_limit = 0;
  bool truncated = false;
};

struct TraceManifest {
  uint32_t version = 1;
  std::optional<TraceCapture> capture;
  std::vector<TraceImage> images;
  std::vector<TraceCodeSite> sites;
};

enum class TraceLineKind { Ignored, Event, Error };

struct TraceLineResult {
  TraceLineKind kind = TraceLineKind::Ignored;
  std::optional<TraceEvent> event;
  std::string error;
};

// Stateful parser for legacy event streams and versioned trace manifests.
// Callers need only parse each line and inspect the returned kind; image/site
// declaration ordering, bounds, and code-location resolution stay internal.
class TraceParser {
public:
  static constexpr size_t kMaxImages = 4096;
  static constexpr size_t kMaxCodeSites = 1'000'000;
  static constexpr size_t kMaxImageNameBytes = 4096;
  static constexpr size_t kMaxLineBytes = 16 * 1024;
  static constexpr uint32_t kMaxAccessBytes = 1024 * 1024;

  TraceLineResult parse_line(const std::string &line);
  // Bounded input reader; nullopt means EOF, Error means stop reading.
  std::optional<TraceLineResult> next(std::istream &input);
  const TraceManifest &manifest() const { return manifest_; }

private:
  TraceLineResult parse_metadata(const std::string &line);
  TraceLineResult fail(const std::string &message) const;
  std::optional<TraceCodeLocation> resolve(uint32_t site_id) const;

  TraceManifest manifest_;
  std::unordered_map<uint32_t, size_t> image_indexes_;
  std::unordered_map<uint32_t, size_t> site_indexes_;
  std::unordered_map<uint32_t, uint64_t> largest_site_rvas_;
  size_t line_number_ = 0;
  bool saw_header_ = false;
  bool saw_event_ = false;
};
