/*
 * Cache Explorer - Intel Pin Tool
 *
 * Dynamic binary instrumentation for cache profiling.
 * Works with any compiled binary (GCC, MSVC, etc.) without recompilation.
 *
 * Build:
 *   make PIN_ROOT=/path/to/pin obj-intel64/cache_profiler.so
 *
 * Run:
 *   pin -t obj-intel64/cache_profiler.so -- ./your_binary
 *   # Output goes to cache_trace.txt, then:
 *   cat cache_trace.txt | cache-sim --json
 *
 * Or with wrapper:
 *   cache-explore-pin ./your_binary
 */

#include "pin.H"
#include <fstream>
#include <iostream>
#include <unordered_map>
#include <string>
#include <cstring>

// Output file
static std::ofstream trace_file;

// Knobs (command line options)
KNOB<std::string> KnobOutputFile(KNOB_MODE_WRITEONCE, "pintool",
    "o", "cache_trace.txt", "Output file for cache trace");

KNOB<BOOL> KnobTraceLoads(KNOB_MODE_WRITEONCE, "pintool",
    "l", "1", "Trace load instructions");

KNOB<BOOL> KnobTraceStores(KNOB_MODE_WRITEONCE, "pintool",
    "s", "1", "Trace store instructions");

KNOB<UINT64> KnobMaxEvents(KNOB_MODE_WRITEONCE, "pintool",
    "max", "10000000", "Maximum events to trace");

KNOB<UINT64> KnobSampleRate(KNOB_MODE_WRITEONCE, "pintool",
    "sample", "1", "Sample rate (1 = all, 100 = 1%%)");

// Statistics
static UINT64 total_loads = 0;
static UINT64 total_stores = 0;
static UINT64 traced_events = 0;
static UINT64 sample_counter = 0;

// Thread ID tracking
static TLS_KEY tls_key = INVALID_TLS_KEY;

struct ThreadData {
    UINT32 thread_id;
    UINT64 event_count;
};

// Image and routine info for source attribution
struct SourceLocation {
    std::string file;
    UINT32 line;
    std::string routine;
};

static std::unordered_map<ADDRINT, SourceLocation> addr_to_source;
static PIN_LOCK output_lock;

// Get thread-local data
static ThreadData* GetThreadData(THREADID tid) {
    ThreadData* data = static_cast<ThreadData*>(PIN_GetThreadData(tls_key, tid));
    if (!data) {
        data = new ThreadData();
        data->thread_id = tid;
        data->event_count = 0;
        PIN_SetThreadData(tls_key, data, tid);
    }
    return data;
}

// Record a memory access
static VOID RecordMemAccess(THREADID tid, VOID* addr, UINT32 size, BOOL is_write, ADDRINT ip) {
    if (traced_events >= KnobMaxEvents.Value()) {
        return;
    }

    // Sampling
    if (KnobSampleRate.Value() > 1) {
        sample_counter++;
        if (sample_counter % KnobSampleRate.Value() != 0) {
            return;
        }
    }

    ThreadData* tdata = GetThreadData(tid);

    // Find source location
    std::string file = "";
    UINT32 line = 0;

    auto it = addr_to_source.find(ip);
    if (it != addr_to_source.end()) {
        file = it->second.file;
        line = it->second.line;
    }

    // Format: R/W address size thread_id file line
    // Example: R 0x7fff5fbff8e0 4 0 main.c 42
    PIN_GetLock(&output_lock, tid + 1);

    trace_file << (is_write ? "W" : "R") << " "
               << reinterpret_cast<UINT64>(addr) << " "
               << size << " "
               << tdata->thread_id;

    if (!file.empty()) {
        trace_file << " " << file << " " << line;
    }

    trace_file << "\n";

    traced_events++;
    tdata->event_count++;

    PIN_ReleaseLock(&output_lock);

    // Update statistics
    if (is_write) {
        total_stores++;
    } else {
        total_loads++;
    }
}

// Instruction instrumentation callback
static VOID InstrumentInstruction(INS ins, VOID* v) {
    // Get memory operand count
    UINT32 memOperands = INS_MemoryOperandCount(ins);

    // Skip if no memory operations
    if (memOperands == 0) {
        return;
    }

    // Cache source location for this instruction
    ADDRINT ip = INS_Address(ins);
    if (addr_to_source.find(ip) == addr_to_source.end()) {
        SourceLocation loc;
        loc.line = 0;

        // Try to get source info from debug info
        INT32 column;
        PIN_GetSourceLocation(ip, &column, reinterpret_cast<INT32*>(&loc.line),
                              const_cast<std::string*>(&loc.file));

        // Get routine name
        RTN rtn = INS_Rtn(ins);
        if (RTN_Valid(rtn)) {
            loc.routine = RTN_Name(rtn);
        }

        addr_to_source[ip] = loc;
    }

    // Instrument each memory operand
    for (UINT32 memOp = 0; memOp < memOperands; memOp++) {
        UINT32 size = INS_MemoryOperandSize(ins, memOp);

        if (INS_MemoryOperandIsRead(ins, memOp) && KnobTraceLoads.Value()) {
            INS_InsertPredicatedCall(
                ins, IPOINT_BEFORE, (AFUNPTR)RecordMemAccess,
                IARG_THREAD_ID,
                IARG_MEMORYOP_EA, memOp,
                IARG_UINT32, size,
                IARG_BOOL, FALSE,  // is_write = false
                IARG_INST_PTR,
                IARG_END);
        }

        if (INS_MemoryOperandIsWritten(ins, memOp) && KnobTraceStores.Value()) {
            INS_InsertPredicatedCall(
                ins, IPOINT_BEFORE, (AFUNPTR)RecordMemAccess,
                IARG_THREAD_ID,
                IARG_MEMORYOP_EA, memOp,
                IARG_UINT32, size,
                IARG_BOOL, TRUE,   // is_write = true
                IARG_INST_PTR,
                IARG_END);
        }
    }
}

// Thread start callback
static VOID ThreadStart(THREADID tid, CONTEXT* ctxt, INT32 flags, VOID* v) {
    GetThreadData(tid);
}

// Thread end callback
static VOID ThreadFini(THREADID tid, const CONTEXT* ctxt, INT32 code, VOID* v) {
    ThreadData* data = GetThreadData(tid);
    if (data) {
        delete data;
        PIN_SetThreadData(tls_key, nullptr, tid);
    }
}

// Finalization callback
static VOID Fini(INT32 code, VOID* v) {
    trace_file.close();

    std::cerr << "\n=== Cache Explorer Pin Tool ===" << std::endl;
    std::cerr << "Total loads:  " << total_loads << std::endl;
    std::cerr << "Total stores: " << total_stores << std::endl;
    std::cerr << "Traced events: " << traced_events << std::endl;
    std::cerr << "Output: " << KnobOutputFile.Value() << std::endl;
    std::cerr << "\nRun: cat " << KnobOutputFile.Value()
              << " | cache-sim --json" << std::endl;
}

// Usage message
static INT32 Usage() {
    std::cerr << "Cache Explorer Pin Tool" << std::endl;
    std::cerr << std::endl;
    std::cerr << "Traces memory accesses for cache simulation." << std::endl;
    std::cerr << KNOB_BASE::StringKnobSummary() << std::endl;
    return -1;
}

int main(int argc, char* argv[]) {
    // Initialize Pin
    if (PIN_Init(argc, argv)) {
        return Usage();
    }

    // Initialize lock
    PIN_InitLock(&output_lock);

    // Allocate TLS key
    tls_key = PIN_CreateThreadDataKey(nullptr);
    if (tls_key == INVALID_TLS_KEY) {
        std::cerr << "Failed to allocate TLS key" << std::endl;
        return 1;
    }

    // Open output file
    trace_file.open(KnobOutputFile.Value().c_str());
    if (!trace_file.is_open()) {
        std::cerr << "Failed to open output file: "
                  << KnobOutputFile.Value() << std::endl;
        return 1;
    }

    // Register callbacks
    INS_AddInstrumentFunction(InstrumentInstruction, nullptr);
    PIN_AddThreadStartFunction(ThreadStart, nullptr);
    PIN_AddThreadFiniFunction(ThreadFini, nullptr);
    PIN_AddFiniFunction(Fini, nullptr);

    std::cerr << "Cache Explorer Pin Tool started" << std::endl;
    std::cerr << "  Output: " << KnobOutputFile.Value() << std::endl;
    std::cerr << "  Max events: " << KnobMaxEvents.Value() << std::endl;
    if (KnobSampleRate.Value() > 1) {
        std::cerr << "  Sample rate: 1/" << KnobSampleRate.Value() << std::endl;
    }

    // Start the program
    PIN_StartProgram();

    return 0;
}
