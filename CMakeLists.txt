cmake_minimum_required(VERSION 3.20)
project(CacheExplorer VERSION 0.1.0 LANGUAGES C CXX)

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
    Core Support ExecutionEngine IRReader BitReader AsmParser
)

# Add subdirectories (only those that exist)
if(EXISTS ${CMAKE_SOURCE_DIR}/backend/llvm-pass/CMakeLists.txt)
    add_subdirectory(backend/llvm-pass)
endif()

if(EXISTS ${CMAKE_SOURCE_DIR}/backend/runtime/CMakeLists.txt)
    add_subdirectory(backend/runtime)
endif()

if(EXISTS ${CMAKE_SOURCE_DIR}/backend/cache-simulator/CMakeLists.txt)
    add_subdirectory(backend/cache-simulator)
endif()

if(EXISTS ${CMAKE_SOURCE_DIR}/backend/server/CMakeLists.txt)
    add_subdirectory(backend/server)
endif()

if(EXISTS ${CMAKE_SOURCE_DIR}/backend/cli/CMakeLists.txt)
    add_subdirectory(backend/cli)
endif()
