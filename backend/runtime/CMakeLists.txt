cmake_minimum_required(VERSION 3.20)

# Runtime library - lightweight C library for event tracking
# Only builds if you create cache-profiler-rt.c

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/cache-explorer-rt.c)
    add_library(cache-explorer-rt STATIC
        cache-explorer-rt.c
    )

    target_include_directories(cache-explorer-rt PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
    )

    # Optimize for size and speed
    target_compile_options(cache-explorer-rt PRIVATE
        -Os -fno-exceptions
        -Wall -Wextra
    )

    message(STATUS "Building runtime library: libcache-explorer-rt.a")
else()
    message(STATUS "Skipping runtime library - no cache-explorer-rt.c yet")
endif()
