cmake_minimum_required(VERSION 3.20)
project(CacheSimulator)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(CacheSimulator
  src/CacheLevel.cpp
  src/CacheSystem.cpp
)
target_include_directories(CacheSimulator PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# CLI tool
add_executable(cache-sim src/main.cpp)
target_link_libraries(cache-sim CacheSimulator)

# Tests
add_executable(CacheLevelTest tests/CacheLevelTest.cpp)
target_link_libraries(CacheLevelTest CacheSimulator)

add_executable(CacheSystemTest tests/CacheSystemTest.cpp)
target_link_libraries(CacheSystemTest CacheSimulator)
