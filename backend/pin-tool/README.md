# Cache Explorer - Intel Pin Tool

Dynamic binary instrumentation for cache profiling. Profile **any binary** without recompilation - works with GCC, MSVC, or any compiler.

## Prerequisites

1. **Download Intel Pin** from [Intel's website](https://www.intel.com/content/www/us/en/developer/articles/tool/pin-a-binary-instrumentation-tool-downloads.html)

2. **Set PIN_ROOT**:
   ```bash
   export PIN_ROOT=/path/to/pin
   ```

3. **Build the Pin tool**:
   ```bash
   cd backend/pin-tool
   make PIN_ROOT=$PIN_ROOT
   ```

## Usage

### Quick Start
```bash
# Profile any binary
cache-explore-pin ./my_gcc_binary

# With options
cache-explore-pin --config amd --json ./my_binary > results.json
```

### Direct Pin Usage
```bash
# Run Pin manually
$PIN_ROOT/pin -t obj-intel64/cache_profiler.so -- ./your_binary

# Analyze the trace
cat cache_trace.txt | cache-sim --json
```

### Options

| Option | Description |
|--------|-------------|
| `--config <name>` | Cache config: intel, amd, apple, educational |
| `--json` | Output JSON format |
| `--max <n>` | Maximum events to trace (default: 10M) |
| `--sample <n>` | Sample rate: 1=all, 100=1% |
| `--output <file>` | Trace output file |
| `--keep-trace` | Keep trace file after analysis |

## Pin Tool Options

When using Pin directly:

```bash
$PIN_ROOT/pin -t cache_profiler.so [options] -- ./binary

Options:
  -o <file>     Output trace file (default: cache_trace.txt)
  -l <0|1>      Trace loads (default: 1)
  -s <0|1>      Trace stores (default: 1)
  -max <n>      Max events (default: 10000000)
  -sample <n>   Sample rate (default: 1)
```

## How It Works

1. **Instrumentation**: Pin intercepts every memory access instruction
2. **Recording**: Each load/store is logged with address, size, and source location
3. **Analysis**: The trace is piped to `cache-sim` for simulation

## Performance

- **Overhead**: 10-50x slowdown (typical for dynamic instrumentation)
- **Sampling**: Use `-sample 100` to reduce overhead to ~2x
- **Max events**: Use `-max 1000000` to limit trace size

## Limitations

- **Platform**: Linux x86-64 only (Pin limitation)
- **macOS**: Limited support, may require older Pin versions
- **Windows**: Requires separate build configuration
- **Debug info**: Source attribution requires `-g` compiled binaries

## Comparison with LLVM Pass

| Feature | LLVM Pass | Pin Tool |
|---------|-----------|----------|
| Requires source | Yes | No |
| Compiler | Clang only | Any |
| Overhead | 2-5x | 10-50x |
| Accuracy | Full | Full |
| Source attribution | Excellent | Limited |

## Troubleshooting

### "Pin not found"
```bash
export PIN_ROOT=/path/to/pin
```

### "Pin tool not built"
```bash
cd backend/pin-tool
make PIN_ROOT=$PIN_ROOT
```

### High overhead
Use sampling:
```bash
cache-explore-pin --sample 100 ./my_binary
```

### No source info
Compile your binary with debug info:
```bash
gcc -g -o my_binary my_source.c
```
