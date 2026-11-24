cmake_minimum_required(VERSION 3.20)
project(CacheExplorerRuntime C)

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

    enable_testing()
    add_executable(test_rt_address_encoding tests/test_rt_address_encoding.c)
    target_link_libraries(test_rt_address_encoding PRIVATE cache-explorer-rt)
    # Tests rely on assert(); keep it active in every build type.
    target_compile_options(test_rt_address_encoding PRIVATE -UNDEBUG)
    add_test(NAME cache-explorer-runtime-address-test COMMAND test_rt_address_encoding)
else()
    message(STATUS "Skipping runtime library - no cache-explorer-rt.c yet")
endif()
