# CacheExplorerToolchain.cmake
#
# Use this as a CMake toolchain file to enable cache profiling
# for an entire project without modifying CMakeLists.txt.
#
# Usage:
#   cmake -DCMAKE_TOOLCHAIN_FILE=/path/to/CacheExplorerToolchain.cmake \
#         -DCACHE_EXPLORER_PATH=/path/to/cache-explorer ..
#
# Or via cache-explore CLI:
#   cache-explore cmake /path/to/your/project
#

cmake_minimum_required(VERSION 3.16)

# Get Cache Explorer path
if(NOT CACHE_EXPLORER_PATH)
  if(DEFINED ENV{CACHE_EXPLORER_PATH})
    set(CACHE_EXPLORER_PATH $ENV{CACHE_EXPLORER_PATH})
  else()
    # Default to parent of integration directory
    get_filename_component(CACHE_EXPLORER_PATH "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
  endif()
endif()

# Set paths
set(CACHE_EXPLORER_PASS "${CACHE_EXPLORER_PATH}/llvm-pass/build/CacheProfiler.so")
set(CACHE_EXPLORER_RUNTIME "${CACHE_EXPLORER_PATH}/runtime/build/libcache-explorer-rt.a")
set(CACHE_EXPLORER_INCLUDE "${CACHE_EXPLORER_PATH}/runtime")

# Verify dependencies exist
if(NOT EXISTS "${CACHE_EXPLORER_PASS}")
  message(FATAL_ERROR "CacheProfiler.so not found at ${CACHE_EXPLORER_PASS}")
endif()

if(NOT EXISTS "${CACHE_EXPLORER_RUNTIME}")
  message(FATAL_ERROR "libcache-explorer-rt.a not found at ${CACHE_EXPLORER_RUNTIME}")
endif()

# Use Clang for C/C++ (required for -fpass-plugin)
find_program(CLANG_PATH clang)
find_program(CLANGXX_PATH clang++)

if(NOT CLANG_PATH OR NOT CLANGXX_PATH)
  # Try Homebrew LLVM on macOS
  if(EXISTS "/opt/homebrew/opt/llvm/bin/clang")
    set(CLANG_PATH "/opt/homebrew/opt/llvm/bin/clang")
    set(CLANGXX_PATH "/opt/homebrew/opt/llvm/bin/clang++")
  elseif(EXISTS "/usr/local/opt/llvm/bin/clang")
    set(CLANG_PATH "/usr/local/opt/llvm/bin/clang")
    set(CLANGXX_PATH "/usr/local/opt/llvm/bin/clang++")
  else()
    message(FATAL_ERROR "Clang not found. Cache Explorer requires Clang with pass-plugin support.")
  endif()
endif()

set(CMAKE_C_COMPILER "${CLANG_PATH}" CACHE STRING "C compiler")
set(CMAKE_CXX_COMPILER "${CLANGXX_PATH}" CACHE STRING "C++ compiler")

# Add instrumentation flags
set(CACHE_EXPLORER_FLAGS "-fpass-plugin=${CACHE_EXPLORER_PASS} -g")

# Append to CMAKE_C_FLAGS and CMAKE_CXX_FLAGS
set(CMAKE_C_FLAGS_INIT "${CACHE_EXPLORER_FLAGS}")
set(CMAKE_CXX_FLAGS_INIT "${CACHE_EXPLORER_FLAGS}")

# Link runtime library
set(CMAKE_EXE_LINKER_FLAGS_INIT "${CACHE_EXPLORER_RUNTIME}")
set(CMAKE_SHARED_LINKER_FLAGS_INIT "${CACHE_EXPLORER_RUNTIME}")

# Include runtime header path
include_directories(SYSTEM "${CACHE_EXPLORER_INCLUDE}")

message(STATUS "Cache Explorer Toolchain:")
message(STATUS "  C Compiler: ${CMAKE_C_COMPILER}")
message(STATUS "  C++ Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "  Pass: ${CACHE_EXPLORER_PASS}")
message(STATUS "  Runtime: ${CACHE_EXPLORER_RUNTIME}")
