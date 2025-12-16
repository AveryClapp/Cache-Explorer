cmake_minimum_required(VERSION 3.15)
project(CacheExplorer)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(LLVM REQUIRED CONFIG)
find_package(Clang REQUIRED CONFIG)

include_directories(${LLVM_INCLUDE_DIRS})
include_directories(${CLANG_INCLUDE_DIRS})
add_definitions(${LLVM_DEFINITIONS})

set(SOURCES
    main.cpp
    server.cpp
    compiler.cpp
    analyzer.cpp
)

set(HEADERS
    server.h
    compiler.h
    analyzer.h
)

add_executable(cache-explorer ${SOURCES} ${HEADERS})

llvm_map_components_to_libnames(llvm_libs core support irreader analysis transformutils)

target_link_libraries(cache-explorer
    ${llvm_libs}
    clangFrontend
    clangSerialization
    clangDriver
    clangParse
    clangSema
    clangAnalysis
    clangAST
    clangBasic
    clangEdit
    clangLex
    clangCodeGen
)
