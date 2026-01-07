#include "include/TLB.hpp"

#include <climits>

TLB::TLB(const TLBConfig& cfg)
    : config(cfg)
    , sets(cfg.num_sets(), std::vector<TLBEntry>(cfg.associativity))
    , access_counter(0) {}

bool TLB::access(uint64_t address) {
    uint64_t page = address_to_page(address);
    size_t set_idx = get_set_index(page);
    auto& set = sets[set_idx];
    access_counter++;

    // Check for hit
    for (auto& entry : set) {
        if (entry.valid && entry.page_number == page) {
            entry.last_access = access_counter;
            stats.hits++;
            return true;
        }
    }

    // Miss - need to insert
    stats.misses++;

    // Find LRU entry to replace
    size_t lru_way = 0;
    uint64_t oldest = UINT64_MAX;
    for (size_t i = 0; i < set.size(); i++) {
        if (!set[i].valid) {
            lru_way = i;
            break;
        }
        if (set[i].last_access < oldest) {
            oldest = set[i].last_access;
            lru_way = i;
        }
    }

    // Insert new entry
    set[lru_way].page_number = page;
    set[lru_way].valid = true;
    set[lru_way].last_access = access_counter;

    return false;
}

void TLB::invalidate(uint64_t address) {
    uint64_t page = address_to_page(address);
    size_t set_idx = get_set_index(page);

    for (auto& entry : sets[set_idx]) {
        if (entry.valid && entry.page_number == page) {
            entry.valid = false;
            break;
        }
    }
}

void TLB::flush() {
    for (auto& set : sets) {
        for (auto& entry : set) {
            entry.valid = false;
        }
    }
}

void TLB::reset_stats() {
    stats.reset();
    seen_pages.clear();
}
