#include "include/TraceParser.hpp"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <limits>
#include <sstream>
#include <utility>

namespace {

std::string trim(const std::string &value) {
  const auto first = std::find_if_not(value.begin(), value.end(), [](unsigned char c) {
    return std::isspace(c);
  });
  if (first == value.end()) return {};
  const auto last = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char c) {
    return std::isspace(c);
  }).base();
  return std::string(first, last);
}

bool is_sha256_identity(const std::string &value) {
  constexpr char prefix[] = "sha256:";
  if (value.size() != 7 + 64 || value.compare(0, 7, prefix) != 0)
    return false;
  return std::all_of(value.begin() + 7, value.end(), [](unsigned char c) {
    return std::isxdigit(c);
  });
}

bool is_directive(const std::string &line, const char *prefix,
                  size_t prefix_size) {
  return line.compare(0, prefix_size, prefix) == 0 &&
         (line.size() == prefix_size ||
          std::isspace(static_cast<unsigned char>(line[prefix_size])));
}

TraceLineResult ignored() { return {}; }

TraceLineResult parsed_event(TraceEvent event) {
  TraceLineResult result;
  result.kind = TraceLineKind::Event;
  result.event = std::move(event);
  return result;
}

bool valid_v2_event(const std::string &line, uint32_t address_width) {
  std::istringstream input(line);
  std::string type, address, source, size, location, thread, token;
  if (!(input >> type >> address)) return false;
  const bool memory_copy = type == "M" || type == "O";
  if (type != "P0" && type != "P1" && type != "P2" && type != "P3" &&
      (type.size() != 1 || std::string("LlRrSsIiPVUAXCZBMO").find(type[0]) == std::string::npos))
    return false;
  if (memory_copy && !(input >> source)) return false;
  if (!(input >> size >> location >> thread)) return false;
  const auto count = parse_trace_u32(size);
  if (!count || (type == "B" ? *count > 1 : (*count == 0 || *count > TraceParser::kMaxAccessBytes)))
    return false;
  const auto valid_address = [&](const std::string &value) {
    const size_t start = value.size() > 2 && value[0] == '0' &&
                                (value[1] == 'x' || value[1] == 'X') ? 2 : 0;
    if (value.size() == start || value.find_first_not_of("0123456789abcdefABCDEF", start) != std::string::npos)
      return false;
    const auto parsed = parse_trace_u64(value, 16);
    const uint64_t max_address = address_width == 32
        ? std::numeric_limits<uint32_t>::max() : std::numeric_limits<uint64_t>::max();
    return parsed && *parsed <= max_address &&
           (type == "B" || static_cast<uint64_t>(*count - 1) <= max_address - *parsed);
  };
  if (!valid_address(address) || (memory_copy && !valid_address(source))) return false;
  const size_t colon = location.rfind(':');
  if (colon == std::string::npos || colon == 0 || !parse_trace_u32(location.substr(colon + 1)))
    return false;
  if (thread.size() < 2 || thread[0] != 'T' || !parse_trace_u32(thread.substr(1))) return false;
  bool saw_site = false;
  while (input >> token) {
    // Portable v2 records carry site references, never raw capture PCs.
    if (token.size() < 2 || token[0] != 'K' || saw_site) return false;
    const auto site = parse_trace_u32(token.substr(1));
    if (!site || *site == 0) return false;
    saw_site = true;
  }
  return true;
}

} // namespace

TraceLineResult TraceParser::fail(const std::string &message) const {
  TraceLineResult result;
  result.kind = TraceLineKind::Error;
  result.error = "trace line " + std::to_string(line_number_) + ": " + message;
  return result;
}

std::optional<TraceCodeLocation> TraceParser::resolve(uint32_t site_id) const {
  const auto site_index = site_indexes_.find(site_id);
  if (site_index == site_indexes_.end()) return std::nullopt;

  const TraceCodeSite &site = manifest_.sites[site_index->second];
  const auto image_index = image_indexes_.find(site.image_table_id);
  if (image_index == image_indexes_.end()) return std::nullopt;

  return TraceCodeLocation{site.image_table_id, site.rva};
}

TraceLineResult TraceParser::parse_metadata(const std::string &line) {
  constexpr char header_prefix[] = "# hardware-explorer-trace";
  constexpr char capture_prefix[] = "# capture";
  constexpr char image_prefix[] = "# image";
  constexpr char site_prefix[] = "# site";

  if (is_directive(line, header_prefix, sizeof(header_prefix) - 1)) {
    if (saw_header_) return fail("duplicate trace version header");
    if (saw_event_ || !manifest_.images.empty() || !manifest_.sites.empty())
      return fail("trace version header must precede metadata and events");

    std::istringstream input(line.substr(sizeof(header_prefix) - 1));
    std::string version_token;
    std::string trailing;
    if (!(input >> version_token) || (input >> trailing))
      return fail("malformed trace version header");
    const auto version = parse_trace_u32(version_token);
    if (!version || (*version != 1 && *version != 2))
      return fail("unsupported trace format version '" + version_token + "'");
    manifest_.version = *version;
    saw_header_ = true;
    return ignored();
  }

  const bool is_image =
      is_directive(line, image_prefix, sizeof(image_prefix) - 1);
  const bool is_site =
      is_directive(line, site_prefix, sizeof(site_prefix) - 1);
  const bool is_capture =
      is_directive(line, capture_prefix, sizeof(capture_prefix) - 1);
  if (!is_capture && !is_image && !is_site) return ignored();
  if (!saw_header_ || manifest_.version != 2)
    return fail("v2 metadata requires a preceding '# hardware-explorer-trace 2' header");
  if (saw_event_) return fail("metadata must precede trace events");

  if (is_capture) {
    if (manifest_.capture) return fail("duplicate capture declaration");

    std::istringstream input(line.substr(sizeof(capture_prefix) - 1));
    std::string kind;
    std::string target;
    std::string address_width_token;
    std::string sample_rate_token;
    std::string event_limit_token;
    std::string truncated_token;
    std::string trailing;
    if (!(input >> kind >> target >> address_width_token >> sample_rate_token >>
          event_limit_token >> truncated_token) ||
        (input >> trailing)) {
      return fail("malformed capture declaration");
    }

    const auto address_width = parse_trace_u32(address_width_token);
    const auto sample_rate = parse_trace_u32(sample_rate_token);
    const auto event_limit = parse_trace_u64(event_limit_token, 10);
    if (kind.size() > 128 || target.size() > 128 ||
        !address_width || (*address_width != 32 && *address_width != 64) ||
        !sample_rate || *sample_rate == 0 || !event_limit ||
        (truncated_token != "true" && truncated_token != "false")) {
      return fail("invalid capture declaration");
    }
    if (*address_width == 32) {
      for (const auto &image : manifest_.images) {
        if (image.end_address > (uint64_t{1} << 32))
          return fail("image exceeds the capture address width");
      }
    }
    manifest_.capture = TraceCapture{std::move(kind), std::move(target),
                                     *address_width, *sample_rate, *event_limit,
                                     truncated_token == "true"};
    return ignored();
  }

  if (is_image) {
    if (manifest_.images.size() >= kMaxImages)
      return fail("image table exceeds its safety limit");

    std::istringstream input(line.substr(sizeof(image_prefix) - 1));
    std::string table_id_token;
    std::string image_id;
    std::string name;
    std::string loaded_base_token;
    std::string end_address_token;
    std::string trailing;
    if (!(input >> table_id_token >> image_id >> std::quoted(name) >>
          loaded_base_token >> end_address_token) ||
        (input >> trailing)) {
      return fail("malformed image declaration");
    }

    const auto table_id = parse_trace_u32(table_id_token);
    const auto loaded_base = parse_trace_u64(loaded_base_token, 0);
    const auto end_address = parse_trace_u64(end_address_token, 0);
    if (!table_id || *table_id == 0 || !loaded_base || !end_address ||
        *loaded_base >= *end_address ||
        (manifest_.capture && manifest_.capture->address_width == 32 &&
         *end_address > (uint64_t{1} << 32))) {
      return fail("invalid image id or address range");
    }
    if (!is_sha256_identity(image_id))
      return fail("image identity must be 'sha256:' followed by 64 hex digits");
    std::transform(image_id.begin(), image_id.end(), image_id.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (name.empty() || name.size() > kMaxImageNameBytes)
      return fail("image name is empty or exceeds its safety limit");
    if (image_indexes_.count(*table_id) != 0)
      return fail("duplicate image table id " + std::to_string(*table_id));

    const uint64_t image_size = *end_address - *loaded_base;
    const auto largest = largest_site_rvas_.find(*table_id);
    if (largest != largest_site_rvas_.end() && largest->second >= image_size)
      return fail("existing code-site RVA falls outside the declared image");

    image_indexes_[*table_id] = manifest_.images.size();
    manifest_.images.push_back(
        TraceImage{*table_id, std::move(image_id), std::move(name),
                   *loaded_base, *end_address});
    return ignored();
  }

  if (manifest_.sites.size() >= kMaxCodeSites)
    return fail("code-site table exceeds its safety limit");

  std::istringstream input(line.substr(sizeof(site_prefix) - 1));
  std::string table_id_token;
  std::string image_table_id_token;
  std::string rva_token;
  std::string trailing;
  if (!(input >> table_id_token >> image_table_id_token >> rva_token) ||
      (input >> trailing)) {
    return fail("malformed code-site declaration");
  }

  const auto table_id = parse_trace_u32(table_id_token);
  const auto image_table_id = parse_trace_u32(image_table_id_token);
  const auto rva = parse_trace_u64(rva_token, 0);
  if (!table_id || *table_id == 0 || !image_table_id ||
      *image_table_id == 0 || !rva) {
    return fail("invalid code-site id, image id, or RVA");
  }
  if (site_indexes_.count(*table_id) != 0)
    return fail("duplicate code-site table id " + std::to_string(*table_id));

  const auto image_index = image_indexes_.find(*image_table_id);
  if (image_index != image_indexes_.end()) {
    const TraceImage &image = manifest_.images[image_index->second];
    if (*rva >= image.end_address - image.loaded_base)
      return fail("code-site RVA falls outside its image");
  }

  site_indexes_[*table_id] = manifest_.sites.size();
  auto &largest_rva = largest_site_rvas_[*image_table_id];
  largest_rva = std::max(largest_rva, *rva);
  manifest_.sites.push_back(TraceCodeSite{*table_id, *image_table_id, *rva});
  return ignored();
}

TraceLineResult TraceParser::parse_line(const std::string &raw_line) {
  ++line_number_;
  if (raw_line.size() > kMaxLineBytes) return fail("record exceeds the 16384-byte safety limit");
  if (raw_line.find('\0') != std::string::npos) return fail("record contains a NUL byte");
  const std::string line = trim(raw_line);
  if (line.empty()) return ignored();
  if (line[0] == '#') return parse_metadata(line);

  if (manifest_.version == 2 &&
      !valid_v2_event(line, manifest_.capture ? manifest_.capture->address_width : 64)) {
    return fail("invalid v2 event fields or address/access range");
  }

  auto event = parse_trace_event(line);
  if (!event) {
    if (manifest_.version == 2)
      return fail("malformed event record");
    return ignored();
  }

  saw_event_ = true;
  if (manifest_.version == 2 && event->code_site_id) {
    event->code_location = resolve(*event->code_site_id);
  }
  return parsed_event(std::move(*event));
}

std::optional<TraceLineResult> TraceParser::next(std::istream &input) {
  char buffer[kMaxLineBytes + 2];
  input.getline(buffer, sizeof(buffer));
  if (input.bad() || (input.fail() && !input.eof())) {
    ++line_number_;
    return fail("input failed or record exceeds the 16384-byte safety limit");
  }
  if (input.gcount() == 0 && input.eof()) return std::nullopt;
  const size_t count = static_cast<size_t>(input.gcount());
  return parse_line(std::string(buffer, count - (input.eof() ? 0 : 1)));
}
