// Windows-only, offline helper. It reads files; it never loads/runs the target
// executable. stdin contains PE32 return-PC RVAs, one per line. stdout is NDJSON.
#include "../include/JsonOutput.hpp"
#include <windows.h>
#include <dbghelp.h>

#include <array>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
constexpr DWORD64 kLookupBase = 0x10000000;
constexpr size_t kMaxSites = 10000;
constexpr size_t kMaxName = 4096;

std::string utf8(const std::wstring &value) {
  if (value.size() > kMaxName) throw std::runtime_error("PDB string exceeds its safety limit");
  if (value.empty()) return {};
  const int count = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS,
      value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (count == 0) throw std::runtime_error("PDB contains invalid Unicode");
  std::string result(count, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(),
      static_cast<int>(value.size()), result.data(), count, nullptr, nullptr);
  return result;
}

std::string hex(uint64_t value) {
  std::ostringstream out;
  out << "0x" << std::hex << value;
  return out.str();
}

std::string guid_text(const GUID &guid) {
  std::ostringstream out;
  out << std::hex << std::setfill('0') << std::setw(8) << guid.Data1 << '-'
      << std::setw(4) << guid.Data2 << '-' << std::setw(4) << guid.Data3 << '-';
  for (size_t i = 0; i < 8; ++i) {
    if (i == 2) out << '-';
    out << std::setw(2) << static_cast<unsigned>(guid.Data4[i]);
  }
  return out.str();
}

DWORD image_size(const std::filesystem::path &path) {
  std::ifstream file(path, std::ios::binary | std::ios::ate);
  if (!file) throw std::runtime_error("Cannot open the PE image");
  const auto length = static_cast<std::streamoff>(file.tellg());
  const auto read = [&](std::streamoff offset, auto &value) {
    if (offset < 0 || offset > length ||
        static_cast<std::streamoff>(sizeof(value)) > length - offset)
      throw std::runtime_error("Truncated PE header");
    file.seekg(offset);
    file.read(reinterpret_cast<char *>(&value), sizeof(value));
    if (!file) throw std::runtime_error("Cannot read PE header");
  };
  IMAGE_DOS_HEADER dos{};
  read(0, dos);
  if (dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < sizeof(dos))
    throw std::runtime_error("Invalid DOS/PE header");
  DWORD signature = 0;
  read(dos.e_lfanew, signature);
  IMAGE_FILE_HEADER coff{};
  read(static_cast<std::streamoff>(dos.e_lfanew) + 4, coff);
  if (signature != IMAGE_NT_SIGNATURE || coff.Machine != IMAGE_FILE_MACHINE_I386 ||
      coff.SizeOfOptionalHeader < sizeof(IMAGE_OPTIONAL_HEADER32) ||
      !(coff.Characteristics & IMAGE_FILE_EXECUTABLE_IMAGE) ||
      (coff.Characteristics & IMAGE_FILE_DLL))
    throw std::runtime_error("Expected an x86 PE32 executable");
  IMAGE_OPTIONAL_HEADER32 optional{};
  read(static_cast<std::streamoff>(dos.e_lfanew) + 4 + sizeof(coff), optional);
  if (optional.Magic != IMAGE_NT_OPTIONAL_HDR32_MAGIC || optional.SizeOfImage == 0)
    throw std::runtime_error("Invalid PE32 optional header");
  return optional.SizeOfImage;
}

SYMSRV_INDEX_INFOW identity(const std::wstring &path) {
  SYMSRV_INDEX_INFOW info{};
  info.sizeofstruct = sizeof(info);
  if (!SymSrvGetFileIndexInfoW(path.c_str(), &info, 0))
    throw std::runtime_error("Cannot read CodeView/PDB identity (Windows error " +
                             std::to_string(GetLastError()) + ")");
  const GUID empty{};
  if (std::memcmp(&info.guid, &empty, sizeof(GUID)) == 0)
    throw std::runtime_error("A modern GUID-bearing PDB is required");
  return info;
}

class PdbSession {
public:
  PdbSession(const std::wstring &pdb, DWORD size, const SYMSRV_INDEX_INFOW &expected) {
    SymSetOptions(SYMOPT_UNDNAME | SYMOPT_LOAD_LINES | SYMOPT_EXACT_SYMBOLS |
                  SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_NO_PROMPTS |
                  SYMOPT_IGNORE_NT_SYMPATH | SYMOPT_DISABLE_SYMSRV_AUTODETECT);
    const auto directory = std::filesystem::path(pdb).parent_path().wstring();
    if (!SymInitializeW(process_, directory.c_str(), FALSE))
      throw std::runtime_error("Cannot initialize local PDB lookup");
    // Load only the explicitly selected PDB, never the path embedded in the PE
    // or a symbol server. The private base is unrelated to the captured ASLR base.
    const auto base = SymLoadModuleExW(process_, nullptr, pdb.c_str(), nullptr,
                                      kLookupBase, size, nullptr, 0);
    const DWORD load_error = base == 0 ? GetLastError() : 0;
    IMAGEHLP_MODULEW64 module{};
    module.SizeOfStruct = sizeof(module);
    const bool loaded = base != 0 && SymGetModuleInfoW64(process_, base, &module);
    const DWORD info_error = loaded ? 0 : GetLastError();
    // Standalone PDB loads have no PE CodeView record attached to the DbgHelp
    // module and may set PdbUnmatched. Enforce the actual GUID/age instead:
    // those must equal both files checked above, even for an explicit PDB load.
    if (base != kLookupBase || !loaded ||
        module.SymType != SymPdb ||
        module.PdbAge != expected.age ||
        std::memcmp(&module.PdbSig70, &expected.guid, sizeof(GUID)) != 0) {
      SymCleanup(process_);
      throw std::runtime_error("The selected PDB could not be loaded with matching identity "
          "(load error " + std::to_string(load_error) + ", info error " +
          std::to_string(info_error) + ", type " + std::to_string(module.SymType) +
          ", GUID " + guid_text(module.PdbSig70) + ", age " +
          std::to_string(module.PdbAge) + ", expected GUID " + guid_text(expected.guid) +
          ", expected age " + std::to_string(expected.age) + ", base " + hex(base) + ")");
    }
  }
  ~PdbSession() { SymCleanup(process_); }
  PdbSession(const PdbSession &) = delete;
  PdbSession &operator=(const PdbSession &) = delete;

  void write_site(uint32_t rva) const {
    // A return PC can be on the next source line or even past the function.
    // Query inside its preceding call, but keep the original portable identity.
    const uint32_t lookup_rva = rva - 1;
    const DWORD64 address = kLookupBase + lookup_rva;
    alignas(SYMBOL_INFOW) std::array<unsigned char,
        sizeof(SYMBOL_INFOW) + kMaxName * sizeof(wchar_t)> storage{};
    auto *symbol = reinterpret_cast<SYMBOL_INFOW *>(storage.data());
    symbol->SizeOfStruct = sizeof(SYMBOL_INFOW);
    symbol->MaxNameLen = kMaxName;
    DWORD64 displacement = 0;
    const bool function = SymFromAddrW(process_, address, &displacement, symbol) &&
        (symbol->Flags & SYMFLAG_FUNCTION) && symbol->Size > 0 &&
        symbol->Address >= kLookupBase && symbol->Address <= address &&
        address - symbol->Address < symbol->Size && symbol->NameLen < kMaxName;
    std::string function_name;
    if (function) function_name = utf8(std::wstring(symbol->Name, symbol->NameLen));
    IMAGEHLP_LINEW64 line{};
    line.SizeOfStruct = sizeof(line);
    DWORD line_displacement = 0;
    const bool source = function && SymGetLineFromAddrW64(process_, address,
        &line_displacement, &line) && line.LineNumber > 0 && line.FileName &&
        line.Address >= symbol->Address && line.Address <= address;
    const std::string file = source ? utf8(line.FileName) : "";
    const char *confidence = !file.empty() ? "source-nearest" :
                             function ? "function-exact" : "unresolved";
    std::cout << "{\"type\":\"site\",\"rva\":\"" << hex(rva)
              << "\",\"lookupRva\":\"" << hex(lookup_rva)
              << "\",\"navigationConfidence\":\"" << confidence << "\"";
    if (function) {
      std::cout << ",\"symbol\":{\"function\":\"" << JsonOutput::escape(function_name)
                << "\",\"functionRva\":\"" << hex(symbol->Address - kLookupBase) << "\"}";
    }
    if (!file.empty()) {
      std::cout << ",\"source\":{\"file\":\"" << JsonOutput::escape(file)
                << "\",\"line\":" << line.LineNumber << "}";
    }
    std::cout << "}\n";
  }

private:
  HANDLE process_ = GetCurrentProcess();
};
} // namespace

int wmain(int argc, wchar_t **argv) {
  try {
    if (argc != 3)
      throw std::runtime_error("Usage: hardware-explorer-symbolize-pdb.exe image.exe symbols.pdb < rvas.txt");
    const auto image = std::filesystem::absolute(argv[1]);
    const auto pdb = std::filesystem::absolute(argv[2]);
    const DWORD size = image_size(image);
    const auto image_id = identity(image.wstring());
    const auto pdb_id = identity(pdb.wstring());
    if (image_id.age != pdb_id.age ||
        std::memcmp(&image_id.guid, &pdb_id.guid, sizeof(GUID)) != 0)
      throw std::runtime_error("PDB GUID/age does not match the executable");

    std::vector<uint32_t> rvas;
    char buffer[64];
    while (std::cin.getline(buffer, sizeof(buffer))) {
      const auto count = static_cast<size_t>(std::cin.gcount()) - (std::cin.eof() ? 0 : 1);
      const std::string record(buffer, count);
      if (record.find('\0') != std::string::npos)
        throw std::runtime_error("RVA input contains a NUL byte");
      std::istringstream input(record);
      std::string token, extra;
      if (!(input >> token) || (input >> extra) || token.size() < 3 ||
          token.size() > 10 || token.compare(0, 2, "0x") != 0 ||
          token.find_first_not_of("0123456789abcdefABCDEF", 2) != std::string::npos)
        throw std::runtime_error("Malformed PE32 code RVA");
      const auto rva = std::stoull(token.substr(2), nullptr, 16);
      if (rva == 0 || rva >= size || rvas.size() >= kMaxSites)
        throw std::runtime_error("RVA or code-site count exceeds its bounds");
      rvas.push_back(static_cast<uint32_t>(rva));
    }
    if (!std::cin.eof()) throw std::runtime_error("RVA input failed or exceeded its line limit");
    if (rvas.empty()) throw std::runtime_error("No code sites supplied");
    PdbSession session(pdb.wstring(), size, image_id);
    std::cout << "{\"type\":\"symbols\",\"format\":1,\"provider\":\"dbghelp\","
              << "\"lookupMethod\":\"return-pc-minus-one\",\"guid\":\""
              << guid_text(image_id.guid) << "\",\"age\":" << image_id.age
              << ",\"imageSize\":" << size << "}\n";
    for (const auto rva : rvas) session.write_site(rva);
    if (!std::cout) throw std::runtime_error("Cannot write symbol results");
    return 0;
  } catch (const std::exception &error) {
    std::cerr << "PDB symbolization failed: " << error.what() << '\n';
    return 2;
  }
}
