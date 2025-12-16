# Cache Explorer

## Project Vision

A web-based tool (sister project to Compiler Explorer) that visualizes how code interacts with CPU cache hierarchies. Users write C/C++ code in a browser editor, and the tool performs static analysis to show cache behavior patterns, potential performance issues, and optimization suggestions.

## How It Works

1. **User writes code** in web-based Monaco editor (same editor as VS Code/Compiler Explorer)
2. **Frontend sends code** to backend via REST API
3. **Backend compiles to LLVM IR** using Clang
4. **Analysis engine** performs proprietary static analysis on the IR to detect cache behavior
5. **Results visualized** in the browser alongside the source code

## Architecture

### Frontend (Web UI)
- **Editor**: Monaco Editor for code input
- **Layout**: Split-pane view (code left, visualization right)
- **Features**: Real-time updates (debounced), configuration panel for optimization levels and target architecture
- **Tech**: TypeScript + React + Monaco Editor

### Backend Service (C++)
- **API**: REST endpoints accepting code snippets
- **Compilation**: Invokes Clang to generate LLVM IR
- **Analysis**: Passes IR to proprietary analysis engine
- **Response**: Returns JSON with analysis results
- **Tech**: C++ (existing CMake setup in `src/engine/`)

### Analysis Engine (C++ - Core Innovation)
- **Input**: LLVM IR from Clang
- **Process**: Static analysis of memory access patterns
- **Detection**:
  - Sequential vs strided vs random access patterns
  - Cache miss probability based on data structure sizes and access patterns
  - Loop traversal order issues (row-major vs column-major)
  - Pointer chasing and indirect accesses
  - Data structure sizes relative to cache hierarchy (L1/L2/L3)
- **Output**: Structured data (line numbers, severity scores, suggestions)

## Core Features (MVP)

### Input Support
- C/C++ code snippets (single file initially)
- Configurable optimization levels (-O0, -O1, -O2, -O3)
- Target architecture selection (x86-64 initially: 64-byte cache lines, 3-level hierarchy)

### Analysis Capabilities
- **Memory access pattern detection** from LLVM IR load/store instructions
- **Cache-friendliness scoring** based on:
  - Access stride (sequential = good, random = bad)
  - Data structure sizes vs cache capacity
  - Loop access patterns
  - Temporal and spatial locality
- **Performance predictions**: estimated cache miss ratios

### Visualization
- **Code annotations**: Color-coded hints on source lines
  - Green: cache-friendly access
  - Yellow: moderate cache pressure
  - Red: likely cache misses
- **Sidebar metrics**:
  - Estimated cache miss ratio
  - Hot functions/loops
  - Memory access summary
- **Suggestions**: Actionable recommendations (e.g., "Transpose loop order for better locality")

## Future Expansion Possibilities

Once MVP is working, the tool can expand to:
- **Multithreading analysis**: False sharing detection, cache line contention
- **Struct layout optimization**: Padding/alignment suggestions
- **Advanced loop transformations**: Cache blocking, tiling recommendations
- **Multiple file support**: Whole-program analysis
- **Architecture variants**: ARM, RISC-V cache hierarchies
- **Compiler comparison**: Show cache behavior across different optimization levels side-by-side

## Technical Approach

### Static Analysis Strategy
- Parse LLVM IR to build control flow graph (CFG)
- Track memory access instructions (load/store) with their addresses
- Infer access patterns:
  - Constant offsets = sequential access
  - Loop induction variables = strided access
  - Complex pointer arithmetic = random access
- Model cache behavior:
  - Assume typical x86-64 cache: L1=32KB, L2=256KB, L3=8MB
  - 64-byte cache lines
  - LRU eviction policy
- Score based on:
  - Reuse distance (temporal locality)
  - Access stride (spatial locality)
  - Working set size vs cache capacity

### Why LLVM IR?
- **Language agnostic**: Works for any language that compiles to LLVM (C, C++, Rust, etc.)
- **Optimization aware**: See cache behavior at different -O levels
- **Rich information**: Type information, loop structure, memory access patterns
- **Industry standard**: Robust, well-documented, widely used

## Deployment Model

Similar to Compiler Explorer:
- Docker container for easy deployment
- Stateless backend (no user accounts, sessions are ephemeral)
- Can be self-hosted or run as public service
- Backend handles compilation in sandboxed environment

## Key Differentiators from Existing Tools

- **Compiler Explorer**: Shows assembly, but doesn't analyze cache behavior
- **Cachegrind/Valgrind**: Dynamic analysis (requires running code), not static
- **Intel VTune**: Heavyweight profiler, not interactive or web-based
- **Cache Explorer**: Static analysis + interactive visualization + educational focus

## Development Setup

- **Backend**: C++20, CMake build system (see `src/engine/CMakeLists.txt`)
- **Frontend**: Will need separate repo/directory for web UI
- **Communication**: REST API with JSON payloads
- **Dependencies**:
  - LLVM/Clang libraries for IR generation and parsing
  - Web server framework (consider crow, served, or similar lightweight C++ HTTP library)

## Success Criteria

The tool is successful if developers can:
1. Paste code and immediately see cache behavior patterns
2. Understand WHY certain code is cache-inefficient
3. Get actionable suggestions to improve performance
4. Learn about cache-friendly programming through experimentation

## Notes for Future Development

- Start with simple analysis (sequential vs random access detection)
- Iterate on visualization - make it intuitive and educational
- Consider adding example snippets (good vs bad patterns) for learning
- Benchmark analysis speed - should be near-instant for small snippets
- Eventually support sharing results (unique URLs like Compiler Explorer)
