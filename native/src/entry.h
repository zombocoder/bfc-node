#pragma once

#include <napi.h>

#include <string>

#include <bfc.h>

namespace bfcnode {

// Owning copy of bfc_entry_t. The C struct's `path` points into reader-owned
// memory that is only valid during the bfc_list callback.
struct EntryData {
  std::string path;
  uint32_t mode = 0;
  uint64_t mtime_ns = 0;
  uint32_t comp = 0;
  uint32_t enc = 0;
  uint64_t size = 0;
  uint32_t crc32c = 0;
  uint64_t obj_offset = 0;
  uint64_t obj_size = 0;

  static EntryData From(const bfc_entry_t& e);
};

Napi::Object EntryToJs(Napi::Env env, const EntryData& entry);

}  // namespace bfcnode
