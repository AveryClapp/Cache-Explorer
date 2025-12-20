cmake_minimum_required(VERSION 3.20)

# Only build executable if main.cpp exists
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/main.cpp)
    add_executable(cache-explorer-server main.cpp)
    
    target_link_libraries(cache-explorer-server PRIVATE
        CacheExplorerInstrumentation
        CacheSimulator
        LLVMInterpreterCopy
        ${llvm_libs}
    )
    
    message(STATUS "Building cache-explorer-server executable")
else()
    message(STATUS "No main.cpp found - skipping executable")
endif()

