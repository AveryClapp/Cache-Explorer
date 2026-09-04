cmake_minimum_required(VERSION 3.20)
project(CacheExplorerRuntime C)
include(CTest)

# Runtime library - lightweight C library for event tracking
# Only builds if you create cache-profiler-rt.c

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/cache-explorer-rt.c)
    add_library(cache-explorer-rt STATIC
        cache-explorer-rt.c
    )

    target_include_directories(cache-explorer-rt PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
    )
    find_package(Threads REQUIRED)
    target_link_libraries(cache-explorer-rt PUBLIC Threads::Threads)

    # Optimize for size and speed
    target_compile_options(cache-explorer-rt PRIVATE
        -Os -fno-exceptions
        -Wall -Wextra
    )

    message(STATUS "Building runtime library: libcache-explorer-rt.a")

    if(BUILD_TESTING)
        add_executable(cache-explorer-runtime-test tests/test_rt.c)
        target_link_libraries(cache-explorer-runtime-test PRIVATE cache-explorer-rt)
        add_test(NAME cache-explorer-runtime-test COMMAND cache-explorer-runtime-test)

        add_executable(cache-explorer-runtime-thread-test tests/test_rt_threads.c)
        target_link_libraries(cache-explorer-runtime-thread-test PRIVATE cache-explorer-rt)
        add_test(NAME cache-explorer-runtime-thread-test COMMAND cache-explorer-runtime-thread-test)
    endif()
else()
    message(STATUS "Skipping runtime library - no cache-explorer-rt.c yet")
endif()
