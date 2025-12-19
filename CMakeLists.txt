cmake_minimum_required(VERSION 3.24)
project(CacheExplorer CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# HFT-inspired compiler flags
if(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(CMAKE_CXX_FLAGS_RELEASE "-O3 -DNDEBUG -march=native -flto")
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION ON)
endif()

# Development flags
set(CMAKE_CXX_FLAGS_DEBUG "-O0 -g -fsanitize=address,undefined")

# Find Conan-generated dependencies
find_package(Boost REQUIRED COMPONENTS system)
find_package(simdjson REQUIRED)

# Find system LLVM (installed via brew/apt)
find_package(LLVM REQUIRED CONFIG)
message(STATUS "Found LLVM ${LLVM_PACKAGE_VERSION}")
include_directories(${LLVM_INCLUDE_DIRS})
separate_arguments(LLVM_DEFINITIONS_LIST NATIVE_COMMAND ${LLVM_DEFINITIONS})
add_definitions(${LLVM_DEFINITIONS_LIST})

# Include directories
include_directories(${CMAKE_SOURCE_DIR}/src/include)

# Backend executable
add_executable(cache_explorer_backend
    src/engine/main.cpp
    src/engine/analyzer.cpp
    src/engine/model.cpp
)

# Link libraries
target_link_libraries(cache_explorer_backend
    PRIVATE
    Boost::system
    simdjson::simdjson
    LLVM
)

# Compiler warnings (catch bugs early)
target_compile_options(cache_explorer_backend PRIVATE
    -Wall
    -Wextra
    -Wpedantic
    -Werror
)

# Install target
install(TARGETS cache_explorer_backend
    RUNTIME DESTINATION bin
)
