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
  if(DEFINED ENV{HARDWARE_EXPLORER_PATH})
    set(CACHE_EXPLORER_PATH "$ENV{HARDWARE_EXPLORER_PATH}")
  elseif(DEFINED ENV{CACHE_EXPLORER_PATH})
    set(CACHE_EXPLORER_PATH "$ENV{CACHE_EXPLORER_PATH}")
  else()
    # Default to parent of integration directory
    get_filename_component(CACHE_EXPLORER_PATH "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
  endif()
endif()

# Set paths. Explicit CMake values take priority, followed by values exported
# by the wrapper, then the legacy per-component build layout. Stock Windows
# LLVM uses built-in SanitizerCoverage and does not need a loadable pass.
if(NOT WIN32)
  if(NOT CACHE_EXPLORER_PASS)
    if(DEFINED ENV{HARDWARE_EXPLORER_PASS})
      set(CACHE_EXPLORER_PASS "$ENV{HARDWARE_EXPLORER_PASS}")
    elseif(DEFINED ENV{CACHE_EXPLORER_PASS})
      set(CACHE_EXPLORER_PASS "$ENV{CACHE_EXPLORER_PASS}")
    else()
      set(CACHE_EXPLORER_PASS "${CACHE_EXPLORER_PATH}/llvm-pass/build/CacheProfiler.so")
    endif()
  endif()
endif()

if(NOT CACHE_EXPLORER_RUNTIME)
  if(DEFINED ENV{HARDWARE_EXPLORER_RUNTIME})
    set(CACHE_EXPLORER_RUNTIME "$ENV{HARDWARE_EXPLORER_RUNTIME}")
  elseif(DEFINED ENV{CACHE_EXPLORER_RUNTIME})
    set(CACHE_EXPLORER_RUNTIME "$ENV{CACHE_EXPLORER_RUNTIME}")
  elseif(WIN32)
    set(CACHE_EXPLORER_RUNTIME "${CACHE_EXPLORER_PATH}/runtime/build/cache-explorer-rt.lib")
    if(EXISTS "${CACHE_EXPLORER_PATH}/runtime/build/Release/cache-explorer-rt.lib")
      set(CACHE_EXPLORER_RUNTIME "${CACHE_EXPLORER_PATH}/runtime/build/Release/cache-explorer-rt.lib")
    endif()
  else()
    set(CACHE_EXPLORER_RUNTIME "${CACHE_EXPLORER_PATH}/runtime/build/libcache-explorer-rt.a")
  endif()
endif()
set(CACHE_EXPLORER_INCLUDE "${CACHE_EXPLORER_PATH}/runtime")

# Verify dependencies exist
if(NOT WIN32 AND NOT EXISTS "${CACHE_EXPLORER_PASS}")
  message(FATAL_ERROR "CacheProfiler.so not found at ${CACHE_EXPLORER_PASS}")
endif()

if(NOT EXISTS "${CACHE_EXPLORER_RUNTIME}")
  message(FATAL_ERROR "libcache-explorer-rt.a not found at ${CACHE_EXPLORER_RUNTIME}")
endif()

# Use Clang for C/C++ (required for -fpass-plugin).
# Priority: Hardware Explorer env vars > compatibility env vars > PATH >
# Homebrew fallbacks. Windows selects clang-cl for both C and C++.
if(DEFINED ENV{HARDWARE_EXPLORER_CC})
  set(CLANG_PATH "$ENV{HARDWARE_EXPLORER_CC}")
  if(DEFINED ENV{HARDWARE_EXPLORER_CXX})
    set(CLANGXX_PATH "$ENV{HARDWARE_EXPLORER_CXX}")
  else()
    set(CLANGXX_PATH "$ENV{HARDWARE_EXPLORER_CC}")
  endif()
elseif(DEFINED ENV{CACHE_EXPLORER_CC})
  set(CLANG_PATH "$ENV{CACHE_EXPLORER_CC}")
  if(DEFINED ENV{CACHE_EXPLORER_CXX})
    set(CLANGXX_PATH "$ENV{CACHE_EXPLORER_CXX}")
  else()
    set(CLANGXX_PATH "$ENV{CACHE_EXPLORER_CC}")
  endif()
elseif(WIN32)
  find_program(CLANG_PATH clang-cl REQUIRED)
  set(CLANGXX_PATH "${CLANG_PATH}")
else()
  find_program(CLANG_PATH clang)
  find_program(CLANGXX_PATH clang++)

  if(NOT CLANG_PATH OR NOT CLANGXX_PATH)
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
endif()

set(CMAKE_C_COMPILER "${CLANG_PATH}" CACHE STRING "C compiler")
set(CMAKE_CXX_COMPILER "${CLANGXX_PATH}" CACHE STRING "C++ compiler")

# Add instrumentation flags
if(WIN32)
  set(CACHE_EXPLORER_FLAGS
    "/clang:-fsanitize-coverage=trace-pc,trace-loads,trace-stores,no-prune /clang:-fno-sanitize-link-runtime /Z7")
else()
  set(CACHE_EXPLORER_FLAGS
    "-fpass-plugin=${CACHE_EXPLORER_PASS} -g -Xclang -disable-O0-optnone")
endif()

# Append to CMAKE_C_FLAGS and CMAKE_CXX_FLAGS
set(CMAKE_C_FLAGS_INIT "${CACHE_EXPLORER_FLAGS}")
set(CMAKE_CXX_FLAGS_INIT "${CACHE_EXPLORER_FLAGS}")

# Link runtime library.
# Use CMAKE_*_STANDARD_LIBRARIES so the archive is appended after object files —
# Linux's ld requires static libs to come after the objects that reference them.
set(CMAKE_C_STANDARD_LIBRARIES "${CMAKE_C_STANDARD_LIBRARIES} ${CACHE_EXPLORER_RUNTIME}")
set(CMAKE_CXX_STANDARD_LIBRARIES "${CMAKE_CXX_STANDARD_LIBRARIES} ${CACHE_EXPLORER_RUNTIME}")

# Include runtime header path
include_directories(SYSTEM "${CACHE_EXPLORER_INCLUDE}")

message(STATUS "Cache Explorer Toolchain:")
message(STATUS "  C Compiler: ${CMAKE_C_COMPILER}")
message(STATUS "  C++ Compiler: ${CMAKE_CXX_COMPILER}")
if(WIN32)
  message(STATUS "  Instrumentation: clang-cl SanitizerCoverage")
else()
  message(STATUS "  Pass: ${CACHE_EXPLORER_PASS}")
endif()
message(STATUS "  Runtime: ${CACHE_EXPLORER_RUNTIME}")
