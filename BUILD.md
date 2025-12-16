# Build Instructions

## Prerequisites

### Backend (C++)
- CMake 3.15+
- C++20 compatible compiler (GCC 10+, Clang 12+, or MSVC 2019+)
- LLVM 14+ development libraries
- Clang development libraries

**Install LLVM/Clang on macOS:**
```bash
brew install llvm
export LLVM_DIR=$(brew --prefix llvm)/lib/cmake/llvm
export Clang_DIR=$(brew --prefix llvm)/lib/cmake/clang
```

**Install LLVM/Clang on Ubuntu:**
```bash
sudo apt install llvm-14-dev clang-14 libclang-14-dev
```

### Frontend (React/TypeScript)
- Node.js 18+
- npm or yarn

## Building

### Backend
```bash
cd src/engine
mkdir -p build
cd build
cmake ..
make
```

Run the backend:
```bash
./cache-explorer
```

The server will start on port 8080.

### Frontend
```bash
cd frontend
npm install
npm run dev
```

The frontend will start on http://localhost:3000 and proxy API requests to the backend.

## Development Workflow

1. Start the backend server: `cd src/engine/build && ./cache-explorer`
2. Start the frontend dev server: `cd frontend && npm run dev`
3. Open http://localhost:3000 in your browser

## Next Steps

1. Implement HTTP server in `server.cpp` (consider using crow or httplib)
2. Implement Clang compilation logic in `compiler.cpp`
3. Implement cache analysis in `analyzer.cpp`
