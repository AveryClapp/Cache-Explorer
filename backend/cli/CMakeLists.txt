cmake_minimum_required(VERSION 3.20)

# CLI tool - command-line profiler
# Only builds if you create main.cpp

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/main.cpp)
    add_executable(cache-explorer
        main.cpp
    )

    target_link_libraries(cache-explorer PRIVATE
        ${llvm_libs}
    )

    # Link with pass and runtime when they exist
    if(TARGET CacheProfiler)
        target_link_libraries(cache-explorer PRIVATE CacheProfiler)
    endif()

    if(TARGET cache-profiler-rt)
        target_link_libraries(cache-explorer PRIVATE cache-profiler-rt)
    endif()

    if(TARGET CacheSimulator)
        target_link_libraries(cache-explorer PRIVATE CacheSimulator)
    endif()

    target_compile_options(cache-explorer PRIVATE
        -Wall -Wextra
    )

    message(STATUS "Building CLI tool: cache-explorer")
else()
    message(STATUS "Skipping CLI tool - no main.cpp yet")
endif()
