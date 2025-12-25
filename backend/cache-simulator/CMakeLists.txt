cmake_minimum_required(VERSION 3.20)

add_library(CacheSimulator
  src/CacheLevel.cpp
)
target_include_directories(CacheSimulator PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# Tests
add_executable(CacheLevelTest tests/CacheLevelTest.cpp)
target_link_libraries(CacheLevelTest CacheSimulator)

