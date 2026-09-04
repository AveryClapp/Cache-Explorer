#include "../include/TraceParser.hpp"

#include <cassert>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>

namespace {

const std::string kImageIdentity = "sha256:" + std::string(64, 'a');

void parse_v2_header(TraceParser &parser) {
  const auto result = parser.parse_line("# hardware-explorer-trace 2");
  assert(result.kind == TraceLineKind::Ignored);
}

void test_legacy_trace_compatibility() {
  TraceParser parser;
  auto event = parser.parse_line("L 0x1000 4 old.c:9 T2");
  assert(event.kind == TraceLineKind::Event);
  assert(event.event.has_value());
  assert(event.event->file == "old.c");
  assert(event.event->line == 9);
  assert(parser.manifest().version == 1);

  // Legacy readers historically ignored unrelated application stdout.
  auto noise = parser.parse_line("game output mixed into stdout");
  assert(noise.kind == TraceLineKind::Ignored);
  std::cout << "[PASS] test_legacy_trace_compatibility\n";
}

void test_v2_manifest_and_site_resolution() {
  TraceParser parser;
  parse_v2_header(parser);
  assert(parser.parse_line(
             "# capture clang-cl i686-pc-windows-msvc 32 4 10000000 false")
             .kind == TraceLineKind::Ignored);
  assert(parser.parse_line("# image 1 " + kImageIdentity +
                           " \"C:\\\\Old Games\\\\game.exe\" 0x400000 0x420000")
             .kind == TraceLineKind::Ignored);
  assert(parser.parse_line("# site 7 1 0x12f40").kind ==
         TraceLineKind::Ignored);

  auto parsed = parser.parse_line("S 0x2000 8 unknown:0 T4 K7");
  assert(parsed.kind == TraceLineKind::Event);
  assert(parsed.event->code_location.has_value());
  assert(parsed.event->code_location->image_table_id == 1);
  assert(parsed.event->code_location->rva == 0x12f40ULL);
  assert(parser.manifest().images[0].name ==
         "C:\\Old Games\\game.exe");
  assert(parser.manifest().capture.has_value());
  assert(parser.manifest().capture->kind == "clang-cl");
  assert(parser.manifest().capture->address_width == 32);
  assert(parser.manifest().capture->sample_rate == 4);
  assert(!parser.manifest().capture->truncated);
  std::cout << "[PASS] test_v2_manifest_and_site_resolution\n";
}

std::pair<std::string, uint64_t> parse_location_with_base(uint64_t base) {
  TraceParser parser;
  parse_v2_header(parser);
  const uint64_t end = base + 0x20000;
  assert(parser.parse_line("# image 1 " + kImageIdentity + " game.exe 0x" +
                           [&] {
                             std::ostringstream out;
                             out << std::hex << base << " 0x" << end;
                             return out.str();
                           }())
             .kind == TraceLineKind::Ignored);
  assert(parser.parse_line("# site 1 1 0x1234").kind ==
         TraceLineKind::Ignored);
  auto parsed = parser.parse_line("L 0x5000 4 unknown:0 T1 K1");
  assert(parsed.kind == TraceLineKind::Event);
  assert(parsed.event->code_location.has_value());
  return {parser.manifest().images[0].image_id,
          parsed.event->code_location->rva};
}

void test_code_location_is_aslr_stable() {
  const auto first = parse_location_with_base(0x400000);
  const auto second = parse_location_with_base(0x710000);
  assert(first == second);
  std::cout << "[PASS] test_code_location_is_aslr_stable\n";
}

void test_unknown_site_and_image_stay_unattributed() {
  TraceParser missing_site;
  parse_v2_header(missing_site);
  auto unknown_site =
      missing_site.parse_line("L 0x1000 4 unknown:0 T1 K99");
  assert(unknown_site.kind == TraceLineKind::Event);
  assert(!unknown_site.event->code_location.has_value());

  TraceParser missing_image;
  parse_v2_header(missing_image);
  assert(missing_image.parse_line("# site 4 12 0x50").kind ==
         TraceLineKind::Ignored);
  auto unknown_image =
      missing_image.parse_line("L 0x1000 4 unknown:0 T1 K4");
  assert(unknown_image.kind == TraceLineKind::Event);
  assert(!unknown_image.event->code_location.has_value());
  std::cout << "[PASS] test_unknown_site_and_image_stay_unattributed\n";
}

void test_invalid_v2_input_is_explicit() {
  TraceParser unsupported;
  auto bad_version =
      unsupported.parse_line("# hardware-explorer-trace 99");
  assert(bad_version.kind == TraceLineKind::Error);
  assert(bad_version.error.find("unsupported") != std::string::npos);

  TraceParser malformed_event;
  parse_v2_header(malformed_event);
  auto bad_event = malformed_event.parse_line("not a trace event");
  assert(bad_event.kind == TraceLineKind::Error);

  TraceParser malformed_capture;
  parse_v2_header(malformed_capture);
  auto bad_capture = malformed_capture.parse_line(
      "# capture clang-cl i686-pc-windows-msvc 16 0 unlimited maybe");
  assert(bad_capture.kind == TraceLineKind::Error);

  TraceParser out_of_range;
  parse_v2_header(out_of_range);
  assert(out_of_range.parse_line("# image 1 " + kImageIdentity +
                                 " game.exe 0x400000 0x401000")
             .kind == TraceLineKind::Ignored);
  auto bad_site = out_of_range.parse_line("# site 1 1 0x1000");
  assert(bad_site.kind == TraceLineKind::Error);

  TraceParser late_out_of_range_image;
  parse_v2_header(late_out_of_range_image);
  assert(late_out_of_range_image.parse_line("# site 1 7 0x1000").kind ==
         TraceLineKind::Ignored);
  auto bad_late_image = late_out_of_range_image.parse_line(
      "# image 7 " + kImageIdentity + " game.exe 0x400000 0x401000");
  assert(bad_late_image.kind == TraceLineKind::Error);

  TraceParser long_name;
  parse_v2_header(long_name);
  auto bad_name = long_name.parse_line("# image 1 " + kImageIdentity + " \"" +
                                       std::string(TraceParser::kMaxImageNameBytes + 1, 'x') +
                                       "\" 0x400000 0x401000");
  assert(bad_name.kind == TraceLineKind::Error);
  std::cout << "[PASS] test_invalid_v2_input_is_explicit\n";
}

} // namespace

int main() {
  test_legacy_trace_compatibility();
  test_v2_manifest_and_site_resolution();
  test_code_location_is_aslr_stable();
  test_unknown_site_and_image_stay_unattributed();
  test_invalid_v2_input_is_explicit();
  std::cout << "All 5 TraceParser tests passed.\n";
  return 0;
}
