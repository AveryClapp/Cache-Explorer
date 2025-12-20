cmake_minimum_required(VERSION 3.20)

# Add source files as you create them
# add_library(CacheExplorerInstrumentation your_file.cpp)

# Start with interface library (no .cpp files yet)
add_library(CacheExplorerInstrumentation INTERFACE)

target_include_directories(CacheExplorerInstrumentation INTERFACE
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_SOURCE_DIR}/third-party/llvm-interpreter
    ${CMAKE_SOURCE_DIR}/cache-simulator
)

target_link_libraries(CacheExplorerInstrumentation INTERFACE
    LLVMInterpreterCopy
    CacheSimulator
    ${llvm_libs}
)

