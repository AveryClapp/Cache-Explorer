cmake_minimum_required(VERSION 3.20)

# Web server - orchestrates compilation, execution, and visualization
# Only builds if you create main.cpp

if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/main.cpp)
    add_executable(cache-explorer-server main.cpp)

    target_link_libraries(cache-explorer-server PRIVATE
        ${llvm_libs}
    )

    # Link with pass, runtime, and simulator when they exist
    if(TARGET CacheProfiler)
        target_link_libraries(cache-explorer-server PRIVATE CacheProfiler)
    endif()

    if(TARGET cache-profiler-rt)
        target_link_libraries(cache-explorer-server PRIVATE cache-profiler-rt)
    endif()

    if(TARGET CacheSimulator)
        target_link_libraries(cache-explorer-server PRIVATE CacheSimulator)
    endif()

    target_compile_options(cache-explorer-server PRIVATE
        -Wall -Wextra
    )

    message(STATUS "Building web server: cache-explorer-server")
else()
    message(STATUS "Skipping web server - no main.cpp yet")
endif()

