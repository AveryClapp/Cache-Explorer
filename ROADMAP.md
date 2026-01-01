# Cache Explorer Roadmap

Goal: Become the "Compiler Explorer for cache behavior" - the industry standard tool for understanding and optimizing CPU cache performance.

## Current Status (v1.0 Beta)

**Core Features (Complete):**

- LLVM instrumentation pass (loads/stores with source attribution)
- Cache simulator (L1d, L1i, L2, L3) with multiple eviction policies
- Web UI with Monaco editor and real-time results
- CLI tool with JSON/streaming output
- Hot line detection with source annotations
- Shareable links
- Example presets library
- Preprocessor defines (-D flags)
- C and C++ support
- Rust support (experimental)

**Visualization (Complete):**

- Interactive cache grid with timeline scrubber
- Cache hierarchy diagram with hit rates
- Monaco source annotations (inline miss counts)
- Access timeline with hit/miss coloring

**Performance (Complete):**

- Sampling support (--sample N)
- Event limits (--limit N)
- 5M event default (~30s max runtime)

**Hardware Support (14+ Presets):**

- Intel: 12th Gen, 14th Gen, Xeon, **Xeon 8488C (validated)**
- AMD: Zen 3, Zen 4, EPYC
- Apple: M1, M2, M3
- ARM: AWS Graviton 3, Raspberry Pi 4, Embedded (Cortex-A53)
- Educational (tiny caches for learning)
- Custom configuration

**Eviction Policies:**

- LRU (Least Recently Used)
- PLRU (Pseudo-LRU)
- Random
- SRRIP (Static Re-Reference Interval Prediction)
- BRRIP (Bimodal RRIP)

**Prefetching (Vendor-Specific):**

- Intel: Stream + stride + adjacent line prefetch
- AMD: L1+L2 only (L3 is victim cache)
- Apple: DMP (data memory-dependent prefetch)
- Presets auto-apply vendor-accurate prefetch behavior

**Hardware Validation (Complete):**

- ±4.6% L1 accuracy (target: ±5%)
- ±9.3% L2 accuracy (target: ±10%)
- 8 validation benchmarks (sequential, strided, random, matrix, linked list, working set)
- Validated on Intel Xeon Platinum 8488C using Linux `perf`
- CI-compatible baseline comparison script

---

## Tier 1: Polish for 1.0 Release

### 1.1 Documentation

- [x] Quick Start guide
- [ ] "How to read results" tutorial
- [ ] "Cache optimization patterns" guide
- [ ] README with screenshots

### 1.2 Testing

- [x] Cache simulator unit tests (25 tests)
- [x] Correctness verification tests
- [x] Hardware validation benchmarks (8 patterns)
- [x] Validation against real hardware (perf counters)
- [ ] E2E test automation
- [ ] CI pipeline (GitHub Actions)

### 1.3 Error Handling

- [x] Structured compile errors with suggestions
- [x] Long-running warning
- [ ] Inline error squiggles in Monaco

---

## Tier 2: Competitive Parity

### 2.1 Expanded Examples (20+)

- [ ] False sharing demonstration
- [ ] Cache-oblivious algorithms
- [ ] Hash table implementations
- [ ] Tree traversals (BFS vs DFS)
- [ ] Before/after optimization pairs

### 2.2 Assembly View

- [ ] Side panel showing generated assembly
- [ ] Source-to-asm correlation

### 2.3 Side-by-Side Comparison

- [x] Diff mode for comparing code changes
- [x] Compare two cache configs simultaneously (`cache-explore compare`)

### 2.4 Vim/Emacs Keybindings

- [x] Monaco vim mode toggle

---

## Tier 3: Industry Standard

### 3.1 CLI Enhancements

- [x] HTML report output (`cache-explore report`)
- [x] Build system integration (CMake, Make, cc/c++ wrappers)

### 3.2 CI/CD Integration

- [ ] GitHub Action
- [ ] PR comments with cache impact

### 3.3 VS Code Extension

- [ ] "Analyze with Cache Explorer" command
- [ ] Inline gutter icons

### 3.4 Multi-File Projects

- [ ] Upload .zip or repo URL
- [ ] Cross-file analysis

### 3.5 Threading Visualization

- [x] Multi-core support in simulator
- [x] MESI coherence protocol
- [x] Per-thread cache state visualization
- [x] False sharing heatmap

---

## Tier 4: Ecosystem & Growth

### 4.1 Embed Mode

- [ ] iframe embeddable widget
- [ ] oEmbed for blog platforms

### 4.2 Public API

- [ ] REST API with authentication
- [ ] Rate limiting

### 4.3 Self-Hosting

- [ ] Docker Compose deployment
- [ ] Helm chart

### 4.4 Community

- [ ] Blog post: "How we built Cache Explorer"
- [ ] Conference talk (CppCon, LLVM Dev)

---
