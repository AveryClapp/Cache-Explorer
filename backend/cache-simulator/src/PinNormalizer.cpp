// A bounded, offline translation from Pin's load-time records to trace v2.
// No target binary is opened or executed here. Image hashes came from capture.
#include "include/TraceEvent.hpp"

#include <algorithm>
#include <array>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <stdexcept>
#include <vector>

namespace {
struct Image {
    uint32_t canonical = 0;
    uint64_t base = 0, end = 0;
    std::string hash, name;
};
struct Event { char kind; uint32_t address, size, thread, site; };
struct Site { uint32_t image; uint64_t rva; };

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}
uint32_t decimal(const std::string& token) {
    const auto value = parse_trace_u32(token);
    require(value.has_value(), "invalid unsigned decimal field");
    return *value;
}
uint64_t hex(const std::string& token) {
    require(token.size() > 2 && token.compare(0, 2, "0x") == 0 &&
        token.find_first_not_of("0123456789abcdefABCDEF", 2) == std::string::npos,
        "invalid hexadecimal field");
    const auto value = parse_trace_u64(token, 16);
    require(value.has_value(), "overflowing hexadecimal field");
    return *value;
}
bool hash_valid(const std::string& hash) {
    return hash.size() == 64 && hash.find_first_not_of("0123456789abcdef") == std::string::npos;
}
std::vector<std::string> fields(const std::string& line) {
    std::istringstream input(line);
    std::vector<std::string> result;
    for (std::string token; input >> token;) result.push_back(std::move(token));
    return result;
}
std::string decode_name(const std::string& value) {
    require(!value.empty() && value.size() <= 8192 && value.size() % 2 == 0 &&
        value.find_first_not_of("0123456789abcdef") == std::string::npos, "invalid image name encoding");
    std::string result;
    for (size_t i = 0; i < value.size(); i += 2) {
        const auto byte = static_cast<unsigned char>(std::stoul(value.substr(i, 2), nullptr, 16));
        require(byte >= 32 && byte != 127 && byte != '/' && byte != '\\' && byte != ':',
            "image name must be a basename without control characters");
        result += static_cast<char>(byte);
    }
    // Reject malformed UTF-8 rather than emitting invalid portable JSON later.
    for (size_t i = 0; i < result.size();) {
        const auto first = static_cast<unsigned char>(result[i++]);
        if (first < 128) continue;
        const unsigned count = first >= 0xc2 && first <= 0xdf ? 1 :
            first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : 0;
        require(count != 0 && i + count <= result.size(), "invalid UTF-8 image name");
        uint32_t point = first & (0x7f >> (count + 1));
        for (unsigned j = 0; j < count; ++j) {
            const auto next = static_cast<unsigned char>(result[i++]);
            require((next & 0xc0) == 0x80, "invalid UTF-8 image name");
            point = (point << 6) | (next & 0x3f);
        }
        require(point >= (count == 1 ? 0x80u : count == 2 ? 0x800u : 0x10000u) &&
            point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff), "invalid UTF-8 image name");
    }
    return result;
}

void normalize(const std::filesystem::path& raw, const std::filesystem::path& destination,
               const std::string& expected_hash) {
    require(hash_valid(expected_hash), "expected main-image SHA256 must be lowercase hexadecimal");
    require(std::filesystem::weakly_canonical(raw) != std::filesystem::weakly_canonical(destination) &&
        !(std::filesystem::exists(destination) && std::filesystem::equivalent(raw, destination)),
        "raw input and output must be different files");
    require(std::filesystem::file_size(raw) <= 256ULL * 1024 * 1024, "raw capture exceeds 256 MiB");
    std::ifstream input(raw, std::ios::binary);
    require(bool(input), "cannot open raw capture");
    std::map<uint32_t, Image> images;
    std::map<std::string, uint32_t> identities;
    std::vector<Image> portable_images;
    std::map<std::pair<uint32_t, uint64_t>, uint32_t> site_ids;
    std::vector<Site> sites;
    std::vector<Event> events;
    uint32_t sample = 0, limit = 0, main_images = 0, unresolved = 0;
    bool ended = false;
    size_t line_number = 0;
    std::array<char, 16385> buffer{};
    while (input.getline(buffer.data(), buffer.size()) || input.gcount()) {
        ++line_number;
        require(!input.fail() || input.eof(), "raw capture record exceeds 16 KiB");
        const auto length = std::char_traits<char>::length(buffer.data());
        // getline's gcount includes the delimiter unless EOF terminated the line.
        const auto expected_length = static_cast<size_t>(input.gcount()) - (input.eof() ? 0 : 1);
        require(length == expected_length, "raw capture contains NUL bytes");
        require(line_number <= 2004098, "raw capture has too many records");
        const auto f = fields(std::string(buffer.data(), length));
        require(!ended, "record after capture completion marker");
        if (line_number == 1) {
            require(f.size() == 6 && f[0] == "#" && f[1] == "hardware-explorer-pin-raw" &&
                f[2] == "1" && f[3] == "32", "unsupported Pin capture header");
            sample = decimal(f[4]); limit = decimal(f[5]);
            require(sample > 0 && sample <= 2147483647 && limit > 0 && limit <= 2000000,
                "invalid capture sampling or event limit");
        } else if (f.size() == 8 && f[0] == "#" && f[1] == "image") {
            require(images.size() < 4096, "image table exceeds 4096 entries");
            const auto id = decimal(f[2]);
            require(id > 0 && images.count(id) == 0, "duplicate or zero image ID");
            Image image;
            image.hash = f[3]; image.name = decode_name(f[4]);
            image.base = hex(f[5]); image.end = hex(f[6]);
            require(image.base < image.end && image.end <= 0x100000000ULL, "invalid 32-bit image range");
            require(image.hash == "-" || hash_valid(image.hash), "invalid image SHA256");
            require(f[7] == "0" || f[7] == "1", "invalid main-image flag");
            if (f[7] == "1") {
                require(++main_images == 1 && image.hash == expected_hash, "main-image SHA256 mismatch or duplicate main image");
            }
            if (image.hash != "-") {
                const auto previous = identities.find(image.hash);
                if (previous != identities.end()) {
                    image.canonical = previous->second;
                    const auto& first = portable_images[image.canonical - 1];
                    require(first.end - first.base == image.end - image.base, "same image hash has inconsistent mapped size");
                } else {
                    image.canonical = static_cast<uint32_t>(portable_images.size() + 1);
                    identities[image.hash] = image.canonical;
                    portable_images.push_back(image);
                }
            }
            images.emplace(id, std::move(image));
        } else if (f.size() == 5 && f[0] == "#" && f[1] == "end") {
            require(f[4] == "0", "target did not exit successfully; raw capture is partial");
            require(decimal(f[2]) == events.size() && decimal(f[3]) == unresolved, "capture completion counts do not match records");
            ended = true;
        } else {
            require(f.size() == 6 && (f[0] == "L" || f[0] == "S") &&
                f[3].size() > 1 && f[3][0] == 'T' && f[4].size() > 1 && f[4][0] == 'C' &&
                f[5].size() > 1 && f[5][0] == 'I', "malformed Pin memory event");
            require(events.size() < limit, "capture exceeds declared event limit");
            const uint64_t address = hex(f[1]), pc = hex(f[4].substr(1));
            const uint32_t size = decimal(f[2]), thread = decimal(f[3].substr(1)), id = decimal(f[5].substr(1));
            require(address <= 0xffffffff && pc <= 0xffffffff && size > 0 && size <= 1048576 &&
                address + size <= 0x100000000ULL, "invalid 32-bit memory or code address");
            uint32_t site = 0;
            if (id != 0) {
                const auto found = images.find(id);
                require(found != images.end(), "event references an undeclared image");
                const auto& image = found->second;
                require(pc >= image.base && pc < image.end, "instruction PC lies outside its image");
                require(image.canonical != 0, "event attributes an image without a verified hash");
                const auto key = std::make_pair(image.canonical, pc - image.base);
                auto entry = site_ids.find(key);
                if (entry == site_ids.end()) {
                    require(sites.size() < 1000000, "code-site table exceeds 1000000 entries");
                    site = static_cast<uint32_t>(sites.size() + 1);
                    sites.push_back({key.first, key.second});
                    site_ids.emplace(key, site);
                } else site = entry->second;
            } else ++unresolved;
            events.push_back({f[0][0], static_cast<uint32_t>(address), size, thread, site});
        }
    }
    require(!input.bad() && input.eof(), "raw capture read failed");
    require(ended && main_images == 1 && !events.empty(), "incomplete capture: missing completion marker, main image or events");

    // Do not open the destination until the entire capture has been validated.
    std::ofstream output(destination, std::ios::binary | std::ios::trunc);
    require(bool(output), "cannot open normalized output");
    output << "# hardware-explorer-trace 2\n# capture intel-pin i686-pc-windows-msvc 32 "
           << sample << ' ' << limit << ' ' << (events.size() == limit ? "true" : "false") << '\n';
    for (const auto& image : portable_images)
        output << "# image " << image.canonical << " sha256:" << image.hash << ' ' << std::quoted(image.name)
               << " 0x" << std::hex << image.base << " 0x" << image.end << std::dec << '\n';
    for (size_t i = 0; i < sites.size(); ++i)
        output << "# site " << i + 1 << ' ' << sites[i].image << " 0x" << std::hex << sites[i].rva << std::dec << '\n';
    for (const auto& event : events) {
        output << event.kind << " 0x" << std::hex << event.address << std::dec << ' ' << event.size << " unknown:0 T" << event.thread;
        if (event.site) output << " K" << event.site;
        output << '\n';
    }
    output.close();
    require(bool(output), "normalized trace write failed");
    std::cerr << "Normalized " << events.size() << " operands, " << portable_images.size()
              << " images and " << sites.size() << " code sites.\n";
    if (unresolved) std::cerr << "Warning: " << unresolved << " operands have unattributed code (JIT or unhashable image).\n";
}
} // namespace

#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
#else
int main(int argc, char** argv) {
#endif
    try {
        require(argc == 4, "usage: hardware-explorer-normalize-pin RAW OUTPUT EXPECTED_MAIN_SHA256");
        normalize(std::filesystem::path(argv[1]), std::filesystem::path(argv[2]), std::filesystem::path(argv[3]).string());
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "Pin normalization failed: " << error.what() << '\n';
        return 2;
    }
}
