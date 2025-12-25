#pragma once

enum class CoherenceState { Invalid, Shared, Exclusive, Modified };

inline bool can_read(CoherenceState state) {
  return state != CoherenceState::Invalid;
}

inline bool can_write_silently(CoherenceState state) {
  return state == CoherenceState::Modified || state == CoherenceState::Exclusive;
}

inline bool is_dirty_state(CoherenceState state) {
  return state == CoherenceState::Modified;
}
