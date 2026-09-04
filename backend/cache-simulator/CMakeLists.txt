cmake_minimum_required(VERSION 3.20)
project(CacheSimulator)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_library(CacheSimulator
  src/ArgParser.cpp
  src/BranchPredictor.cpp
  src/CacheLevel.cpp
  src/CacheSystem.cpp
  src/CodeHotspot.cpp
  src/CoherenceController.cpp
  src/JsonOutput.cpp
  src/MultiCoreCacheSystem.cpp
  src/MultiCoreTraceProcessor.cpp
  src/OptimizationSuggester.cpp
  src/PipelineModel.cpp
  src/Prefetcher.cpp
  src/SegmentCache.cpp
  src/TLB.cpp
  src/TraceParser.cpp
  src/TraceProcessor.cpp
)
target_include_directories(CacheSimulator PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# Link pthread for thread pool
find_package(Threads REQUIRED)
target_link_libraries(CacheSimulator PUBLIC Threads::Threads)

# CLI tool
add_executable(cache-sim src/main.cpp)
target_link_libraries(cache-sim CacheSimulator)

add_executable(hardware-explorer-normalize-pin src/PinNormalizer.cpp)
target_include_directories(hardware-explorer-normalize-pin PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})

# Offline PDB lookup stays out of the portable simulator and capture runtime.
if(WIN32)
  add_executable(hardware-explorer-symbolize-pdb src/PdbSymbolizer.cpp)
  target_link_libraries(hardware-explorer-symbolize-pdb CacheSimulator dbghelp)
  target_compile_definitions(hardware-explorer-symbolize-pdb PRIVATE NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

# Tests
add_executable(CacheLevelTest tests/CacheLevelTest.cpp)
target_link_libraries(CacheLevelTest CacheSimulator)

add_executable(CacheSystemTest tests/CacheSystemTest.cpp)
target_link_libraries(CacheSystemTest CacheSimulator)

add_executable(MESICoherenceTest tests/MESICoherenceTest.cpp)
target_link_libraries(MESICoherenceTest CacheSimulator)

add_executable(MultiCorePrefetchTest tests/MultiCorePrefetchTest.cpp)
target_link_libraries(MultiCorePrefetchTest CacheSimulator)

add_executable(AdvancedInstrumentationTest tests/AdvancedInstrumentationTest.cpp)
target_link_libraries(AdvancedInstrumentationTest CacheSimulator)

add_executable(MultiCoreTLBTest tests/MultiCoreTLBTest.cpp)
target_link_libraries(MultiCoreTLBTest CacheSimulator)

add_executable(MultiCoreTraceProcessorTest tests/MultiCoreTraceProcessorTest.cpp)
target_link_libraries(MultiCoreTraceProcessorTest CacheSimulator)

add_executable(ArgParserTest tests/ArgParserTest.cpp)
target_link_libraries(ArgParserTest CacheSimulator)

add_executable(TraceProcessorTest tests/TraceProcessorTest.cpp)
target_link_libraries(TraceProcessorTest CacheSimulator)

add_executable(TraceParserTest tests/TraceParserTest.cpp)
target_link_libraries(TraceParserTest CacheSimulator)

add_executable(JsonOutputTest tests/JsonOutputTest.cpp)
target_link_libraries(JsonOutputTest CacheSimulator)

add_executable(SegmentCacheTest tests/SegmentCacheTest.cpp)
target_link_libraries(SegmentCacheTest CacheSimulator)

add_executable(BranchPredictorTest tests/BranchPredictorTest.cpp)
target_link_libraries(BranchPredictorTest CacheSimulator)

add_executable(PipelineModelTest tests/PipelineModelTest.cpp)
target_link_libraries(PipelineModelTest CacheSimulator)
