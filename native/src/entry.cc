#include "entry.h"

#include <sys/stat.h>

// MSVC's <sys/stat.h> has S_IFMT and S_IFDIR but no S_IFLNK; BFC stores the
// POSIX bit pattern regardless of the platform that wrote the archive.
#ifndef S_IFLNK
#define S_IFLNK 0120000
#endif

namespace bfcnode {

EntryData EntryData::From(const bfc_entry_t& e) {
  EntryData d;
  d.path = e.path ? e.path : "";
  d.mode = e.mode;
  d.mtime_ns = e.mtime_ns;
  d.comp = e.comp;
  d.enc = e.enc;
  d.size = e.size;
  d.crc32c = e.crc32c;
  d.obj_offset = e.obj_offset;
  d.obj_size = e.obj_size;
  return d;
}

namespace {

const char* EntryType(uint32_t mode) {
  switch (mode & S_IFMT) {
    case S_IFDIR: return "dir";
    case S_IFLNK: return "symlink";
    default:      return "file";
  }
}

const char* CompressionName(uint32_t comp) {
  return comp == BFC_COMP_ZSTD ? "zstd" : "none";
}

const char* EncryptionName(uint32_t enc) {
  return enc == BFC_ENC_CHACHA20_POLY1305 ? "chacha20-poly1305" : "none";
}

}  // namespace

Napi::Object EntryToJs(Napi::Env env, const EntryData& entry) {
  Napi::Object out = Napi::Object::New(env);
  out.Set("path", Napi::String::New(env, entry.path));
  out.Set("type", Napi::String::New(env, EntryType(entry.mode)));
  out.Set("mode", Napi::Number::New(env, entry.mode));
  out.Set("mtimeNs", Napi::BigInt::New(env, entry.mtime_ns));
  out.Set("size", Napi::Number::New(env, static_cast<double>(entry.size)));
  out.Set("compression", Napi::String::New(env, CompressionName(entry.comp)));
  out.Set("encryption", Napi::String::New(env, EncryptionName(entry.enc)));
  out.Set("crc32c", Napi::Number::New(env, entry.crc32c));
  out.Set("objOffset", Napi::BigInt::New(env, entry.obj_offset));
  out.Set("objSize", Napi::BigInt::New(env, entry.obj_size));
  return out;
}

}  // namespace bfcnode
