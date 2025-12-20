cmake_minimum_required(VERSION 3.20)

# Add source files as you create them
# add_library(CacheSimulator your_file.cpp)

# Start with interface library (no .cpp files yet)
add_library(CacheSimulator INTERFACE)
target_include_directories(CacheSimulator INTERFACE ${CMAKE_CURRENT_SOURCE_DIR})

