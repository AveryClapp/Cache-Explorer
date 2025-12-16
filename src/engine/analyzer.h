#pragma once

#include <string>
#include <vector>
#include <memory>

namespace llvm {
class Module;
} // namespace llvm

namespace CacheExplorer {

/**
 * Represents a cache behavior annotation on a source line
 */
struct CacheAnnotation {
    int line_number;
    enum class Severity {
        Good,      // Cache-friendly (green)
        Moderate,  // Some cache pressure (yellow)
        Bad        // Likely cache misses (red)
    } severity;
    std::string message;
    std::string suggestion;
};

/**
 * Overall analysis results
 */
struct AnalysisResult {
    std::vector<CacheAnnotation> annotations;

    // Metrics
    double estimated_miss_ratio;
    std::vector<std::string> hot_functions;

    // Convert to JSON for API response
    std::string to_json() const;
};

/**
 * Cache behavior analyzer
 * Performs static analysis on LLVM IR to detect cache access patterns
 */
class Analyzer {
public:
    Analyzer();
    ~Analyzer();

    /**
     * Analyze LLVM IR for cache behavior
     * @param module LLVM IR module from Clang
     * @return Analysis results with annotations and metrics
     */
    AnalysisResult analyze(const llvm::Module& module);

    /**
     * Configure cache architecture parameters
     */
    void set_cache_config(
        size_t l1_size_kb = 32,
        size_t l2_size_kb = 256,
        size_t l3_size_kb = 8192,
        size_t line_size_bytes = 64
    );

private:
    class Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace CacheExplorer
