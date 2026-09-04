cmake_minimum_required(VERSION 3.20)
project(CacheExplorerPass)

# Set C++ standard (LLVM 21 requires C++17)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find LLVM
find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")

# Add LLVM definitions and include directories
include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST NATIVE_COMMAND ${LLVM_DEFINITIONS})
add_definitions(${LLVM_DEFINITIONS_LIST})

# LLVM Pass - builds as a plugin (.so) that Clang can load
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/CacheExplorerPass.cpp)
    add_library(CacheProfiler MODULE
        CacheExplorerPass.cpp
    )

    target_include_directories(CacheProfiler PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${LLVM_INCLUDE_DIRS}
    )

    # LLVM passes need RTTI enabled
    target_compile_options(CacheProfiler PRIVATE
        -frtti -fexceptions
        -Wall -Wextra
    )

    # Output: CacheProfiler.so (no lib prefix)
    set_target_properties(CacheProfiler PROPERTIES
        PREFIX ""
        SUFFIX ".so"
    )

    # On macOS, use undefined dynamic lookup (symbols resolved at load time)
    if(APPLE)
        target_link_options(CacheProfiler PRIVATE "-undefined" "dynamic_lookup")
    endif()

    message(STATUS "Building LLVM pass: CacheProfiler.so")
else()
    message(STATUS "Skipping LLVM pass - no CacheProfilerPass.cpp yet")
endif()
