# CacheExplorerConfig.cmake
#
# Cache Explorer - CMake Integration Module
#
# This module enables cache profiling for CMake projects.
#
# Usage in your CMakeLists.txt:
#   find_package(CacheExplorer REQUIRED)
#   cache_explorer_enable_target(my_target)
#
# Or for a full project:
#   cache_explorer_enable_project()
#
# After building, run your binary normally - it will output cache trace
# that can be analyzed with cache-sim.
#
# Options:
#   CACHE_EXPLORER_ENABLED    - ON/OFF to enable/disable profiling (default: ON)
#   CACHE_EXPLORER_PATH       - Path to Cache Explorer installation
#   CACHE_EXPLORER_PASS       - Path to CacheProfiler.so or CacheProfiler.dll
#   CACHE_EXPLORER_RUNTIME    - Path to the runtime static library
#   CACHE_EXPLORER_INCLUDE_STL - Include STL in profiling (default: OFF)
#

cmake_minimum_required(VERSION 3.16)

# Find Cache Explorer installation
if(NOT CACHE_EXPLORER_PATH)
  # Try to find from environment or common locations
  if(DEFINED ENV{HARDWARE_EXPLORER_PATH})
    set(CACHE_EXPLORER_PATH "$ENV{HARDWARE_EXPLORER_PATH}")
  elseif(DEFINED ENV{CACHE_EXPLORER_PATH})
    set(CACHE_EXPLORER_PATH "$ENV{CACHE_EXPLORER_PATH}")
  elseif(EXISTS "${CMAKE_CURRENT_LIST_DIR}/../../../")
    # Assume we're in the installation directory
    get_filename_component(CACHE_EXPLORER_PATH "${CMAKE_CURRENT_LIST_DIR}/../../.." ABSOLUTE)
  else()
    message(FATAL_ERROR "CACHE_EXPLORER_PATH not set. Please set -DCACHE_EXPLORER_PATH=/path/to/cache-explorer")
  endif()
endif()

# Find the LLVM pass
if(NOT CACHE_EXPLORER_PASS)
  if(DEFINED ENV{HARDWARE_EXPLORER_PASS})
    set(CACHE_EXPLORER_PASS "$ENV{HARDWARE_EXPLORER_PASS}")
  elseif(DEFINED ENV{CACHE_EXPLORER_PASS})
    set(CACHE_EXPLORER_PASS "$ENV{CACHE_EXPLORER_PASS}")
  elseif(WIN32)
    set(CACHE_EXPLORER_PASS "${CACHE_EXPLORER_PATH}/llvm-pass/build/CacheProfiler.dll")
    if(EXISTS "${CACHE_EXPLORER_PATH}/llvm-pass/build/Release/CacheProfiler.dll")
      set(CACHE_EXPLORER_PASS "${CACHE_EXPLORER_PATH}/llvm-pass/build/Release/CacheProfiler.dll")
    endif()
  else()
    set(CACHE_EXPLORER_PASS "${CACHE_EXPLORER_PATH}/llvm-pass/build/CacheProfiler.so")
  endif()
endif()

if(NOT EXISTS "${CACHE_EXPLORER_PASS}")
  message(FATAL_ERROR "Cache Explorer LLVM pass not found: ${CACHE_EXPLORER_PASS}
    Please build Cache Explorer first: cd ${CACHE_EXPLORER_PATH}/llvm-pass && ./build.sh")
endif()

# Find the runtime library
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

if(NOT EXISTS "${CACHE_EXPLORER_RUNTIME}")
  message(FATAL_ERROR "Cache Explorer runtime not found: ${CACHE_EXPLORER_RUNTIME}
    Please build Cache Explorer first: cd ${CACHE_EXPLORER_PATH}/runtime && make")
endif()

# Find cache-sim
if(NOT CACHE_EXPLORER_SIM)
  set(CACHE_EXPLORER_SIM "${CACHE_EXPLORER_PATH}/cache-simulator/build/cache-sim")
endif()

# Option to enable/disable profiling
option(CACHE_EXPLORER_ENABLED "Enable cache profiling" ON)
option(CACHE_EXPLORER_INCLUDE_STL "Profile STL code (increases overhead)" OFF)

set(CACHE_EXPLORER_CLANG_CL OFF)
if((CMAKE_C_COMPILER_ID MATCHES "Clang" AND
    CMAKE_C_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC") OR
   (CMAKE_CXX_COMPILER_ID MATCHES "Clang" AND
    CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC"))
  set(CACHE_EXPLORER_CLANG_CL ON)
endif()

# Mark as found
set(CacheExplorer_FOUND TRUE)

message(STATUS "Cache Explorer found:")
message(STATUS "  Path: ${CACHE_EXPLORER_PATH}")
message(STATUS "  Pass: ${CACHE_EXPLORER_PASS}")
message(STATUS "  Runtime: ${CACHE_EXPLORER_RUNTIME}")
message(STATUS "  Enabled: ${CACHE_EXPLORER_ENABLED}")

# Function to enable cache profiling for a specific target
function(cache_explorer_enable_target target)
  if(NOT CACHE_EXPLORER_ENABLED)
    message(STATUS "Cache profiling disabled for ${target}")
    return()
  endif()

  # Ensure target exists
  if(NOT TARGET ${target})
    message(FATAL_ERROR "Target ${target} does not exist")
  endif()

  message(STATUS "Enabling cache profiling for target: ${target}")

  # Add compiler flags for the LLVM pass and retain line information. The
  # /clang: escape passes native Clang options through clang-cl's MSVC driver.
  if(CACHE_EXPLORER_CLANG_CL)
    target_compile_options(${target} PRIVATE
      "/clang:-fpass-plugin=${CACHE_EXPLORER_PASS}"
      /Z7
      /clang:-Xclang
      /clang:-disable-O0-optnone
    )
  else()
    target_compile_options(${target} PRIVATE
      "-fpass-plugin=${CACHE_EXPLORER_PASS}"
      -g
      -Xclang
      -disable-O0-optnone
    )
  endif()

  # Include STL if requested
  if(CACHE_EXPLORER_INCLUDE_STL)
    target_compile_definitions(${target} PRIVATE CACHE_EXPLORER_INCLUDE_STL=1)
  endif()

  # Link runtime library
  target_link_libraries(${target} PRIVATE ${CACHE_EXPLORER_RUNTIME})

  # Add include path for runtime header
  target_include_directories(${target} PRIVATE "${CACHE_EXPLORER_PATH}/runtime")

  # Set output property for easy identification
  set_target_properties(${target} PROPERTIES CACHE_EXPLORER_PROFILED TRUE)
endfunction()

# Function to enable cache profiling for all targets in current directory
function(cache_explorer_enable_project)
  if(NOT CACHE_EXPLORER_ENABLED)
    message(STATUS "Cache profiling disabled for project")
    return()
  endif()

  # Set global compile/link flags
  if(CACHE_EXPLORER_CLANG_CL)
    add_compile_options(
      "/clang:-fpass-plugin=${CACHE_EXPLORER_PASS}"
      /Z7
      /clang:-Xclang
      /clang:-disable-O0-optnone
    )
  else()
    add_compile_options(
      "-fpass-plugin=${CACHE_EXPLORER_PASS}"
      -g
      -Xclang
      -disable-O0-optnone
    )
  endif()
  add_link_options(${CACHE_EXPLORER_RUNTIME})

  if(CACHE_EXPLORER_INCLUDE_STL)
    add_compile_definitions(CACHE_EXPLORER_INCLUDE_STL=1)
  endif()

  message(STATUS "Cache profiling enabled for entire project")
endfunction()

# Helper function to run cache analysis on a profiled binary
function(cache_explorer_add_analysis target)
  if(NOT CACHE_EXPLORER_ENABLED)
    return()
  endif()

  set(options JSON VERBOSE)
  set(oneValueArgs CONFIG OUTPUT)
  set(multiValueArgs)
  cmake_parse_arguments(CE "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

  if(NOT CE_CONFIG)
    set(CE_CONFIG "intel")
  endif()

  set(SIM_ARGS --config ${CE_CONFIG})
  if(CE_VERBOSE)
    list(APPEND SIM_ARGS --verbose)
  endif()
  if(CE_JSON)
    list(APPEND SIM_ARGS --json)
  endif()

  # Create a custom target to run analysis
  add_custom_target(analyze-${target}
    COMMAND $<TARGET_FILE:${target}> 2>&1 | ${CACHE_EXPLORER_SIM} ${SIM_ARGS}
    DEPENDS ${target}
    WORKING_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}
    COMMENT "Analyzing cache behavior of ${target}"
    VERBATIM
  )
endfunction()

# Convenience macro for typical usage
macro(cache_explorer_profile target)
  cache_explorer_enable_target(${target})
  cache_explorer_add_analysis(${target} ${ARGN})
endmacro()
