cmake_minimum_required(VERSION 3.20)
project(CacheExplorer VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Find LLVM
find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")

include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST NATIVE_COMMAND ${LLVM_DEFINITIONS})
add_definitions(${LLVM_DEFINITIONS_LIST})

llvm_map_components_to_libnames(llvm_libs
    Core Support ExecutionEngine Interpreter IRReader BitReader AsmParser
)

# Subdirectories
add_subdirectory(third-party/llvm-interpreter)
add_subdirectory(cache-simulator)
add_subdirectory(instrumentation)
add_subdirectory(server)

