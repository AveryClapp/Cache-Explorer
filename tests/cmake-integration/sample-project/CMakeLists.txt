cmake_minimum_required(VERSION 3.16)
project(CacheMatrixSample C)

set(CMAKE_C_STANDARD 11)
enable_testing()

# Library
add_library(matrix STATIC src/matrix.c)
target_include_directories(matrix PUBLIC src)

# Executable
add_executable(cache-matrix src/main.c)
target_link_libraries(cache-matrix PRIVATE matrix m)

# Optional: find_package integration (for Test 4)
option(USE_FIND_PACKAGE "Use find_package(CacheExplorer) instead of toolchain" OFF)
if(USE_FIND_PACKAGE)
  find_package(CacheExplorer REQUIRED
    PATHS "${CACHE_EXPLORER_PATH}/integration/cmake"
          "$ENV{CACHE_EXPLORER_PATH}/integration/cmake"
  )
  if(CacheExplorer_FOUND)
    cache_explorer_enable_target(matrix)
    cache_explorer_enable_target(cache-matrix)
  endif()
endif()

add_subdirectory(tests)
