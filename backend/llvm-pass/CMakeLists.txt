cmake_minimum_required(VERSION 3.20)

# LLVM Pass - builds as a plugin (.so) that Clang can load
# Only builds if you create CacheProfilerPass.cpp

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/CacheProfilerPass.cpp)
    add_library(CacheProfiler MODULE
        CacheProfilerPass.cpp
    )

    target_include_directories(CacheProfiler PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${LLVM_INCLUDE_DIRS}
    )

    target_link_libraries(CacheProfiler PUBLIC ${llvm_libs})

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

    message(STATUS "Building LLVM pass: CacheProfiler.so")
else()
    message(STATUS "Skipping LLVM pass - no CacheProfilerPass.cpp yet")
endif()
