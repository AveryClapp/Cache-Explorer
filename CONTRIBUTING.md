# Contributing to Cache Explorer

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- **LLVM 17-21** (18 recommended)
- **Node.js 18+**
- **CMake 3.20+**
- **Ninja** (recommended) or Make

### Building from Source

```bash
# Clone the repo
git clone https://github.com/yourusername/cache-explorer.git
cd cache-explorer

# Build the cache simulator
cd backend/cache-simulator
mkdir build && cd build
cmake .. -G Ninja && ninja

# Build the LLVM pass
cd ../../llvm-pass
mkdir build && cd build
cmake .. -G Ninja -DLLVM_DIR=$(llvm-config --cmakedir) && ninja

# Build the runtime library
cd ../../runtime
mkdir build && cd build
cmake .. -G Ninja && ninja

# Install backend dependencies
cd ../../server && npm install

# Install frontend dependencies
cd ../../frontend && npm install
```

### Running Locally

```bash
# Terminal 1: Start backend
cd backend/server && node server.js

# Terminal 2: Start frontend dev server
cd frontend && npm run dev
```

Open http://localhost:5173

### Running Tests

```bash
# C++ unit tests
cd backend/cache-simulator/build
./CacheLevelTest
./CacheSystemTest
./MESICoherenceTest
./MultiCorePrefetchTest
./MultiCoreTLBTest
./AdvancedInstrumentationTest

# Frontend build check
cd frontend && npm run build
```

## Project Structure

```
cache-explorer/
├── backend/
│   ├── llvm-pass/        # LLVM instrumentation pass
│   ├── runtime/          # Event capture library
│   ├── cache-simulator/  # Core simulation engine (C++)
│   └── server/           # Node.js WebSocket server
├── frontend/             # React + TypeScript web UI
├── docker/               # Docker configurations
└── tests/                # E2E tests
```

## How to Contribute

### Reporting Bugs

1. Check existing issues first
2. Use the bug report template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Your environment (OS, LLVM version, browser)

### Suggesting Features

1. Check existing issues/discussions first
2. Use the feature request template
3. Explain the use case and why it would be valuable

### Submitting Code

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the code style below
4. **Run tests** to ensure nothing is broken
5. **Commit** with a clear message:
   ```bash
   git commit -m "feat: add stride prefetcher visualization"
   ```
6. **Push** and open a Pull Request

### Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Examples:
```
feat: add ARM Cortex-A72 hardware preset
fix: correct L2 hit rate calculation for inclusive caches
docs: add prefetcher configuration examples
refactor: extract useAnalysis hook from App.tsx
```

## Code Style

### C++ (Backend)

- Use `clang-format` (config in repo)
- Follow existing naming conventions:
  - Classes: `PascalCase`
  - Functions/methods: `snake_case`
  - Member variables: `snake_case_` (trailing underscore)
- Prefer `const` correctness
- Add tests for new functionality

### TypeScript (Frontend)

- Run `npm run build` to check for type errors
- Use functional components with hooks
- Prefer named exports
- Keep components focused and small

### General

- No trailing whitespace
- End files with a newline
- Keep lines under 100 characters when reasonable

## Areas for Contribution

### Good First Issues

Look for issues labeled `good first issue`:
- Documentation improvements
- Adding new code examples
- UI polish and accessibility
- Test coverage improvements

### Intermediate

- New hardware presets
- Additional prefetch policies
- Frontend component refactoring
- Performance optimizations

### Advanced

- New eviction policies (e.g., Hawkeye, SHiP)
- NUMA simulation
- Branch prediction simulation
- Intel Pin integration for pre-compiled binaries

## Questions?

- Open a [Discussion](https://github.com/yourusername/cache-explorer/discussions)
- Check [CLAUDE.md](./CLAUDE.md) for detailed architecture docs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
