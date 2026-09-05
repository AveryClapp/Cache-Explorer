cmake_minimum_required(VERSION 3.20)
project(HardwareExplorerWindowsX86Smoke C)

if(NOT WIN32)
  message(FATAL_ERROR "This smoke project is for Windows clang-cl")
endif()
if(NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "Expected a 32-bit target, got ${CMAKE_SIZEOF_VOID_P}-byte pointers")
endif()

add_executable(hardware-explorer-x86-smoke smoke.c)

include("${CACHE_EXPLORER_PATH}/integration/cmake/CacheExplorerConfig.cmake")
cache_explorer_enable_target(hardware-explorer-x86-smoke)

# Deliberately different executable/PDB pair for identity rejection tests.
add_executable(hardware-explorer-pdb-mismatch smoke.c)
target_compile_options(hardware-explorer-pdb-mismatch PRIVATE /Z7)
target_link_options(hardware-explorer-pdb-mismatch PRIVATE /DEBUG /INCREMENTAL:NO)
