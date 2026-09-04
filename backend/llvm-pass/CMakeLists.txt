cmake_minimum_required(VERSION 3.20)
project(CacheExplorerPass)

# Set C++ standard (LLVM 21 requires C++17)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find LLVM
find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
message(STATUS "Using LLVMConfig.cmake in: ${LLVM_DIR}")
list(APPEND CMAKE_MODULE_PATH "${LLVM_CMAKE_DIR}")
include(AddLLVM)

# Add LLVM definitions and include directories
include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST NATIVE_COMMAND ${LLVM_DEFINITIONS})
add_definitions(${LLVM_DEFINITIONS_LIST})

# LLVM pass plugin. AddLLVM supplies the correct shared-library format and
# export behavior for ELF, Mach-O, and Windows DLLs.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/CacheExplorerPass.cpp)
    add_llvm_pass_plugin(CacheProfiler
        CacheExplorerPass.cpp
    )

    target_include_directories(CacheProfiler PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${LLVM_INCLUDE_DIRS}
    )

    # LLVM passes need RTTI and exception support. clang-cl uses the MSVC-style
    # spellings while regular Clang uses the GNU-style driver options.
    if(CMAKE_CXX_COMPILER_FRONTEND_VARIANT STREQUAL "MSVC")
        target_compile_options(CacheProfiler PRIVATE /GR /EHsc /W4)
    else()
        target_compile_options(CacheProfiler PRIVATE
            -frtti -fexceptions
            -Wall -Wextra
        )
    endif()

    if(WIN32)
        set(CACHE_EXPLORER_PLUGIN_SUFFIX ".dll")
    else()
        # Keep the existing artifact name consumed by release scripts and CLI
        # discovery on Linux and macOS.
        set(CACHE_EXPLORER_PLUGIN_SUFFIX ".so")
    endif()
    set_target_properties(CacheProfiler PROPERTIES
        PREFIX ""
        SUFFIX "${CACHE_EXPLORER_PLUGIN_SUFFIX}"
    )
    message(STATUS "Building LLVM pass plugin: CacheProfiler${CACHE_EXPLORER_PLUGIN_SUFFIX}")
else()
    message(STATUS "Skipping LLVM pass - no CacheProfilerPass.cpp yet")
endif()
