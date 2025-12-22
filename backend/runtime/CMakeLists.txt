cmake_minimum_required(VERSION 3.20)

# Runtime library - lightweight C library for event tracking
# Only builds if you create cache-profiler-rt.c

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/cache-profiler-rt.c)
    add_library(cache-profiler-rt STATIC
        cache-profiler-rt.c
    )

    target_include_directories(cache-profiler-rt PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
    )

    # Optimize for size and speed
    target_compile_options(cache-profiler-rt PRIVATE
        -Os -fno-exceptions
        -Wall -Wextra
    )

    message(STATUS "Building runtime library: libcache-profiler-rt.a")
else()
    message(STATUS "Skipping runtime library - no cache-profiler-rt.c yet")
endif()
