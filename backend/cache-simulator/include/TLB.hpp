#pragma once

#include <cstddef>
#include <cstdint>
#include <vector>
#include <unordered_set>

/**
 * TLB (Translation Lookaside Buffer) Simulator
 *
 * Simulates page table lookups. TLB misses are expensive (100-1000 cycles)
 * because they require walking the page table in memory.
 *
 * Typical configurations:
 * - L1 DTLB: 64 entries, 4-way, 4KB pages
 * - L1 ITLB: 64 entries, 4-way, 4KB pages
 * - L2 TLB:  512-2048 entries, 4-8 way, unified
 * - Huge page TLB: 32 entries for 2MB pages
 */

struct TLBConfig {
    size_t entries = 64;        // Number of TLB entries
    size_t associativity = 4;   // Set associativity
    size_t page_size = 4096;    // Page size in bytes (4KB default)

    [[nodiscard]] constexpr size_t num_sets() const noexcept {
        return entries / associativity;
    }
};

struct TLBStats {
    uint64_t hits = 0;
    uint64_t misses = 0;

    [[nodiscard]] constexpr uint64_t total_accesses() const noexcept { return hits + misses; }

    [[nodiscard]] constexpr double hit_rate() const noexcept {
        if (total_accesses() == 0) return 0.0;
        return static_cast<double>(hits) / total_accesses();
    }

    [[nodiscard]] constexpr double miss_rate() const noexcept {
        if (total_accesses() == 0) return 0.0;
        return static_cast<double>(misses) / total_accesses();
    }

    void reset() {
        hits = 0;
        misses = 0;
    }

    TLBStats& operator+=(const TLBStats& other) {
        hits += other.hits;
        misses += other.misses;
        return *this;
    }
};

struct TLBEntry {
    uint64_t page_number = 0;   // Virtual page number
    bool valid = false;
    uint64_t last_access = 0;   // For LRU replacement
};

class TLB {
private:
    TLBConfig config;
    std::vector<std::vector<TLBEntry>> sets;  // sets[set_index][way]
    TLBStats stats;
    uint64_t access_counter = 0;
    std::unordered_set<uint64_t> seen_pages;  // Track unique pages for compulsory detection

    size_t get_set_index(uint64_t page_number) const {
        return page_number % config.num_sets();
    }

    uint64_t address_to_page(uint64_t address) const {
        return address / config.page_size;
    }

public:
    explicit TLB(const TLBConfig& cfg = TLBConfig{});

    /**
     * Look up an address in the TLB
     * Returns true if TLB hit, false if TLB miss (page table walk required)
     */
    bool access(uint64_t address);

    /**
     * Invalidate a specific page (e.g., on munmap or context switch)
     */
    void invalidate(uint64_t address);

    /**
     * Flush entire TLB (e.g., on context switch)
     */
    void flush();

    [[nodiscard]] const TLBStats& get_stats() const { return stats; }

    void reset_stats();

    [[nodiscard]] const TLBConfig& get_config() const { return config; }

    /**
     * Get number of unique pages accessed (working set in pages)
     */
    [[nodiscard]] size_t get_unique_pages() const { return seen_pages.size(); }
};

/**
 * Combined Data and Instruction TLB stats
 */
struct TLBHierarchyStats {
    TLBStats dtlb;   // Data TLB
    TLBStats itlb;   // Instruction TLB
    TLBStats stlb;   // Shared/Second-level TLB (optional)

    void reset() {
        dtlb.reset();
        itlb.reset();
        stlb.reset();
    }
};
