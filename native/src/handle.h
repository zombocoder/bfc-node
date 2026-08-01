#pragma once

#include <memory>
#include <mutex>

#include <bfc.h>

namespace bfcnode {

// Owns a bfc_t and serialises access to it. bfc_t is not documented as
// thread-safe, so every async operation holds `mutex` for its whole duration.
// Always held through std::shared_ptr so in-flight workers keep it alive even
// if the JS wrapper is collected.
struct Handle {
  bfc_t* raw = nullptr;
  std::mutex mutex;
  bool closed = false;
};

using HandlePtr = std::shared_ptr<Handle>;

}  // namespace bfcnode
