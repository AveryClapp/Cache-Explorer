// Local Windows IA-32 capture. This tool does not read symbols or source files.
#include "pin.H"
#include "vendor/picosha2/picosha2.h"

#include <atomic>
#include <fstream>
#include <iostream>
#include <map>
#include <string>

#if !defined(TARGET_WINDOWS) || !defined(TARGET_IA32)
#error This capture adapter requires Windows IA-32.
#endif

namespace {
KNOB<std::string> output(KNOB_MODE_WRITEONCE, "pintool", "o", "", "Raw capture output (required)");
KNOB<UINT32> max_events(KNOB_MODE_WRITEONCE, "pintool", "max", "2000000", "Maximum recorded operands (1..2000000)");
KNOB<UINT32> sample_rate(KNOB_MODE_WRITEONCE, "pintool", "sample", "1", "Record one in N operands (1..2147483647)");

PIN_LOCK output_lock;
std::ofstream trace;
std::atomic<bool> at_limit{false};
UINT32 events = 0, unresolved = 0, until_sample = 0, image_count = 0;
// Accessed only in instrumentation callbacks, which hold Pin's VM lock.
std::map<UINT32, bool> known_images;

void fatal(const char* message) {
    std::cerr << "Hardware Explorer Pin capture: " << message << std::endl;
    // Never call this while holding a tool lock: Fini may run during exit.
    PIN_ExitProcess(2);
}

std::string image_hash(const std::string& path) {
    std::ifstream file(path.c_str(), std::ios::binary | std::ios::ate);
    if (!file) return "-";
    const auto size = file.tellg();
    // Bound I/O and memory, even for unusual image files.
    if (size <= 0 || size > 512LL * 1024 * 1024) return "-";
    file.seekg(0);
    picosha2::hash256_one_by_one hasher;
    char bytes[16384];
    std::streamoff read = 0;
    while (file.read(bytes, sizeof(bytes)) || file.gcount()) {
        read += file.gcount();
        if (read > size) return "-";
        hasher.process(bytes, bytes + file.gcount());
    }
    if (!file.eof() || file.bad() || read != size) return "-";
    hasher.finish();
    return picosha2::get_hash_hex_string(hasher);
}

std::string basename_hex(const std::string& path) {
    const auto separator = path.find_last_of("/\\");
    const std::string name = path.substr(separator == std::string::npos ? 0 : separator + 1);
    if (name.empty() || name.size() > 4096) return "";
    const char* hex = "0123456789abcdef";
    std::string encoded;
    for (unsigned char c : name) {
        encoded += hex[c >> 4];
        encoded += hex[c & 15];
    }
    return encoded;
}

VOID image_load(IMG img, VOID*) {
    if (++image_count > 4096) fatal("image table exceeds 4096 entries");
    const UINT32 id = IMG_Id(img);
    const UINT64 base = IMG_LowAddress(img);
    const UINT64 end = static_cast<UINT64>(IMG_HighAddress(img)) + 1;
    const auto name = basename_hex(IMG_Name(img));
    if (id == 0 || name.empty() || base >= end || end > 0x100000000ULL)
        fatal("invalid image metadata");
    const auto hash = image_hash(IMG_Name(img));
    const bool main_image = IMG_IsMainExecutable(img);
    known_images[id] = hash != "-";
    PIN_GetLock(&output_lock, 1);
    trace << "# image " << id << ' ' << hash << ' ' << name << " 0x"
          << std::hex << base << " 0x" << end << std::dec << ' '
          << (main_image ? 1 : 0) << '\n';
    trace.flush();
    const bool failed = !trace;
    PIN_ReleaseLock(&output_lock);
    if (failed) fatal("cannot write image manifest");
}

VOID image_unload(IMG img, VOID*) { known_images.erase(IMG_Id(img)); }

VOID record(THREADID tid, ADDRINT data, UINT32 size, BOOL write, ADDRINT pc, UINT32 image) {
    if (at_limit.load(std::memory_order_relaxed)) return;
    PIN_GetLock(&output_lock, tid + 1);
    // Counters, sampling decisions and output share one serialization point.
    if (events >= max_events.Value()) {
        PIN_ReleaseLock(&output_lock);
        return;
    }
    if (until_sample != 0) {
        --until_sample;
        PIN_ReleaseLock(&output_lock);
        return;
    }
    until_sample = sample_rate.Value() - 1;
    const bool invalid = size == 0 || size > 1048576 ||
        static_cast<UINT64>(data) + size > 0x100000000ULL;
    if (!invalid) {
        trace << (write ? 'S' : 'L') << " 0x" << std::hex << data << std::dec
              << ' ' << size << " T" << tid << " C0x" << std::hex << pc
              << std::dec << " I" << image << '\n';
        ++events;
        if (image == 0) ++unresolved;
        if (events % 4096 == 0) trace.flush();
        if (events == max_events.Value()) at_limit.store(true, std::memory_order_relaxed);
    }
    const bool failed = !trace;
    PIN_ReleaseLock(&output_lock);
    if (invalid) fatal("unsupported or wrapping memory operand");
    if (failed) fatal("trace write failed (possibly full storage)");
}

VOID instruction(INS ins, VOID*) {
    if (at_limit.load(std::memory_order_relaxed)) return;
    const ADDRINT pc = INS_Address(ins);
    const IMG img = IMG_FindByAddress(pc);
    UINT32 image = 0;
    if (IMG_Valid(img)) {
        const auto found = known_images.find(IMG_Id(img));
        if (found != known_images.end() && found->second) image = found->first;
    }
    for (UINT32 operand = 0; operand < INS_MemoryOperandCount(ins); ++operand) {
        // Pin's ordinary memory-operand interface does not model gather/scatter
        // element addresses. Fail closed rather than fabricate one contiguous access.
        if (!INS_IsStandardMemop(ins)) {
            fatal("non-standard memory operands are not supported by this Preview");
        }
        const UINT32 size = INS_MemoryOperandSize(ins, operand);
        for (unsigned write = 0; write <= 1; ++write) {
            if (write ? !INS_MemoryOperandIsWritten(ins, operand) : !INS_MemoryOperandIsRead(ins, operand))
                continue;
            INS_InsertPredicatedCall(ins, IPOINT_BEFORE, AFUNPTR(record),
                IARG_THREAD_ID, IARG_MEMORYOP_EA, operand, IARG_UINT32, size,
                IARG_BOOL, BOOL(write), IARG_ADDRINT, pc, IARG_UINT32, image, IARG_END);
        }
    }
}

VOID fini(INT32 code, VOID*) {
    PIN_GetLock(&output_lock, 1);
    trace << "# end " << events << ' ' << unresolved << ' ' << code << '\n';
    trace.close();
    const bool failed = !trace;
    PIN_ReleaseLock(&output_lock);
    if (failed) std::cerr << "Hardware Explorer Pin capture: final trace write failed" << std::endl;
}
} // namespace

int main(int argc, char** argv) {
    if (PIN_Init(argc, argv)) return 2;
    if (output.Value().empty() || max_events.Value() == 0 || max_events.Value() > 2000000 ||
        sample_rate.Value() == 0 || sample_rate.Value() > 2147483647) {
        std::cerr << "Invalid capture output, event limit or sample rate" << std::endl;
        return 2;
    }
    PIN_InitLock(&output_lock);
    trace.open(output.Value().c_str(), std::ios::binary | std::ios::trunc);
    trace << "# hardware-explorer-pin-raw 1 32 " << sample_rate.Value() << ' '
          << max_events.Value() << '\n';
    trace.flush();
    if (!trace) return 2;
    IMG_AddInstrumentFunction(image_load, nullptr);
    IMG_AddUnloadFunction(image_unload, nullptr);
    INS_AddInstrumentFunction(instruction, nullptr);
    PIN_AddFiniFunction(fini, nullptr);
    PIN_StartProgram();
    return 0;
}
