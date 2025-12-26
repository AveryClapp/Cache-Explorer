# Cache Explorer Roadmap

Goal: Become the "Compiler Explorer for cache behavior" - the industry standard tool for understanding and optimizing CPU cache performance.

## Current Status

**Working:**
- LLVM instrumentation pass (loads/stores with source attribution)
- Cache simulator (L1d, L1i, L2, L3 with LRU)
- Web UI with Monaco editor
- Real-time cache statistics
- Hot line detection
- Shareable links
- Example presets
- Preprocessor defines (-D flags)

**Validated:**
- I-cache tracking working
- Educational cache configs
- Basic cachegrind comparison done (numbers differ due to libc tracking - expected)

---

## Tier 1: Core Product

Must-have features before public launch.

### 1.1 Accuracy Validation Suite
- [ ] Create 20+ test cases with known cache behavior
- [ ] Automated cachegrind comparison script
- [ ] Document expected differences (we track user code only, not libc)
- [ ] Publish accuracy benchmarks

### 1.2 C++ Support
- [ ] Enable C++ compilation in backend
- [ ] Test with templates, STL containers
- [ ] Add C++ examples (vector iteration, map lookups, RAII patterns)

### 1.3 Documentation
- [ ] "How to read results" guide
- [ ] "Cache optimization patterns" tutorial
- [ ] Inline help tooltips in UI
- [ ] README with screenshots

### 1.4 Error Handling Polish
- [ ] Inline error squiggles in Monaco editor
- [ ] Better timeout handling (show partial results)
- [ ] Common error suggestions ("did you mean...")

### 1.5 Responsive Design
- [ ] Stacked layout for mobile/tablet
- [ ] Touch-friendly controls
- [ ] Test on iOS Safari, Android Chrome

### 1.6 Keyboard Shortcuts
- [ ] Ctrl/Cmd+Enter to run
- [ ] Ctrl/Cmd+S to share
- [ ] Escape to close dropdowns

---

## Tier 2: Competitive Parity

Features needed to compete with existing tools.

### 2.1 Expanded Examples Library (20+)
- [ ] False sharing demonstration
- [ ] Prefetching patterns
- [ ] Cache-oblivious algorithms
- [ ] Hash table implementations
- [ ] Tree traversals (BFS vs DFS)
- [ ] Graph algorithms
- [ ] Before/after optimization pairs
- [ ] Real-world snippets (image processing, parsing)

### 2.2 Rust Support
- [ ] Rust compilation via rustc + LLVM
- [ ] Rust-specific examples
- [ ] Ownership patterns and cache behavior

### 2.3 Assembly View
- [ ] Side panel showing generated assembly
- [ ] Click source line to highlight corresponding asm
- [ ] Click asm to see cache impact
- [ ] Integration with existing Compiler Explorer API (optional)

### 2.4 Side-by-Side Comparison
- [ ] Run same code with two different cache configs
- [ ] Visual diff of hit rates
- [ ] "Which config is better for this code?"

### 2.5 Timeline Visualization
- [ ] Scrubber showing memory accesses over time
- [ ] Play/pause/step through execution
- [ ] Highlight cache state at each point

### 2.6 Vim/Emacs Keybindings
- [ ] Monaco vim mode toggle
- [ ] Persist preference in localStorage

---

## Tier 3: Industry Standard

Features that make this a professional tool.

### 3.1 CLI Tool
```bash
# Analyze local file
cache-explorer analyze mycode.c --config intel -O2

# Output formats
cache-explorer analyze mycode.c --format json
cache-explorer analyze mycode.c --format html --output report.html

# Custom cache config
cache-explorer analyze mycode.c --l1-size 32768 --l1-assoc 8
```

### 3.2 CI/CD Integration
- [ ] GitHub Action: `uses: cache-explorer/analyze@v1`
- [ ] Fail if L1 miss rate > threshold
- [ ] PR comments with cache impact
- [ ] Badge for README

### 3.3 VS Code Extension
- [ ] "Analyze with Cache Explorer" command
- [ ] Inline gutter icons for hot lines
- [ ] Hover to see cache stats per line
- [ ] Link to full web visualization

### 3.4 Hardware Validation
- [ ] Compare simulation to `perf stat` on real hardware
- [ ] Document accuracy across Intel, AMD, ARM
- [ ] Calibration mode using actual perf counters

### 3.5 Multi-File Projects
- [ ] Upload .zip or .tar.gz
- [ ] Point to GitHub repo URL
- [ ] Makefile/CMake project support
- [ ] Cross-file cache analysis

### 3.6 Threading Visualization
- [ ] Per-thread cache state
- [ ] MESI protocol state timeline
- [ ] False sharing heatmap
- [ ] Lock contention correlation

---

## Tier 4: Ecosystem & Growth

Features for long-term success.

### 4.1 Embed Mode
- [ ] `<iframe>` embeddable widget
- [ ] Customizable theme
- [ ] Read-only mode for tutorials
- [ ] oEmbed support for blog platforms

### 4.2 Public API
```
POST /api/v1/analyze
GET  /api/v1/examples
GET  /api/v1/configs
```
- [ ] API key authentication
- [ ] Rate limiting
- [ ] Usage dashboard

### 4.3 Self-Hosting
- [ ] Docker Compose one-liner
- [ ] Helm chart for Kubernetes
- [ ] Enterprise deployment guide
- [ ] Air-gapped installation

### 4.4 Open Source Release
- [ ] Clean up codebase for public
- [ ] Contribution guidelines
- [ ] Issue templates
- [ ] License selection (MIT/Apache)

### 4.5 Community Building
- [ ] Blog post: "How we built Cache Explorer"
- [ ] Blog post: "Understanding cache behavior"
- [ ] Conference talk proposal (CppCon, LLVM Dev)
- [ ] Academic paper on simulation accuracy
- [ ] Discord/Slack community

### 4.6 Education Platform
- [ ] Interactive tutorials
- [ ] Quiz mode ("which loop is faster?")
- [ ] Certification/badges
- [ ] University course integration

---

## Technical Debt

Ongoing maintenance tasks.

- [ ] Add unit tests for cache simulator
- [ ] Add integration tests for LLVM pass
- [ ] Set up CI pipeline (GitHub Actions)
- [ ] Performance profiling of simulator
- [ ] Memory usage optimization for large programs
- [ ] Security audit of sandbox execution
- [ ] Dependency updates and vulnerability scanning

---

## Metrics for Success

### Short-term (3 months)
- 100+ GitHub stars
- 10+ examples in library
- C++ support working
- Mobile-responsive

### Medium-term (6 months)
- 1,000+ GitHub stars
- CLI tool published
- Used in 1+ university course
- 95% uptime on hosted version

### Long-term (12 months)
- 5,000+ GitHub stars
- VS Code extension with 1,000+ installs
- Cited in 1+ research paper
- Enterprise customers

---

## Contributing

See CONTRIBUTING.md (to be created) for how to help with this roadmap.

Priority items are marked with high/medium/low in GitHub issues.
