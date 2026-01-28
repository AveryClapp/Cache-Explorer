# Integration Tests

Comprehensive integration tests for Cache Explorer.

## Test Suites

### 1. Hardware Presets (`test-all-presets.sh`)
Tests all 12 hardware configuration presets:
- `educational` - Small caches for learning
- `intel`, `intel14`, `xeon` - Intel processors
- `amd`, `zen3`, `epyc` - AMD processors
- `apple`, `m2`, `m3` - Apple Silicon
- `graviton` - AWS Graviton
- `rpi4` - Raspberry Pi 4

**Validates:**
- Compilation succeeds
- JSON output is valid
- Required fields are present (config, events, levels, L1D stats)
- Hit rate is reasonable (0-100%)

### 2. Core Features (`test-features.sh`)
Tests key functionality:
- **Prefetching**: All 6 policies (none, next, stream, stride, adaptive, intel)
- **Fast mode**: --fast flag
- **JSON structure**: All required output fields
- **TLB simulation**: DTLB stats
- **Timing model**: Cycle counts

### 3. Master Runner (`run-all-tests.sh`)
Runs all test suites and provides overall pass/fail summary.

## Running Tests

### All Tests
```bash
cd tests/integration
./run-all-tests.sh
```

### Individual Suites
```bash
./test-all-presets.sh  # Hardware presets
./test-features.sh     # Core features
```

### From Project Root
```bash
./tests/integration/run-all-tests.sh
```

## CI Integration

Tests run automatically on:
- Every push to `main`
- Every pull request
- Multiple OS: Ubuntu, macOS
- Multiple LLVM versions: 18, 19, 20, 21

## Test Fixtures

- `simple-programs/matrix.c` - Simple matrix multiplication
  - Small enough to run quickly
  - Complex enough to exercise cache behavior
  - Deterministic results

## Adding New Tests

### Add a Hardware Preset Test
Edit `PRESETS` array in `test-all-presets.sh`:
```bash
PRESETS=(
    "educational"
    "intel"
    "your_new_preset"
)
```

### Add a Feature Test
Add to `test-features.sh`:
```bash
test_feature "Your feature" --config intel --your-flag
```

### Add a New Test Suite
1. Create `test-your-suite.sh`
2. Follow existing script structure (color output, JSON validation)
3. Add to `run-all-tests.sh`

## Troubleshooting

### macOS SDK Issues
If you see `no such sysroot directory: '/Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk'`:

```bash
# Fix Homebrew clang config
SDK_PATH=$(xcrun --show-sdk-path)
echo "-isysroot $SDK_PATH" > /opt/homebrew/etc/clang/arm64-apple-darwin25.cfg
```

### LLVM Version Mismatch
Ensure LLVM/clang version matches what cache-explore expects (17-21):
```bash
clang --version
```

### Missing Dependencies
```bash
# Ubuntu
sudo apt-get install ninja-build cmake jq bc

# macOS
brew install ninja cmake jq bc
```

## Expected Results

All tests should pass:
```
========================================
  Overall Summary
========================================
Test Suites Passed: 2
Test Suites Failed: 0

All tests passed!
```

Individual test counts:
- Hardware Presets: 12 tests
- Core Features: 10 tests
- **Total: 22 integration tests**
