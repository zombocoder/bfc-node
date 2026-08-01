#include "errors.h"

#include <bfc.h>

namespace bfcnode {

const char* ErrorCode(int rc) {
  switch (rc) {
    case BFC_E_BADMAGIC: return "BAD_MAGIC";
    case BFC_E_IO:       return "IO";
    case BFC_E_CRC:      return "CRC";
    case BFC_E_INVAL:    return "INVAL";
    case BFC_E_EXISTS:   return "EXISTS";
    case BFC_E_NOTFOUND: return "NOT_FOUND";
    case BFC_E_PERM:     return "PERM";
    case kErrClosed:     return "CLOSED";
    default:             return "IO";
  }
}

Napi::Error MakeError(Napi::Env env, int rc, const std::string& message,
                      const std::string& path) {
  Napi::Error err = Napi::Error::New(env, message);
  err.Set("name", Napi::String::New(env, "BfcError"));
  err.Set("code", Napi::String::New(env, ErrorCode(rc)));
  if (!path.empty()) {
    err.Set("path", Napi::String::New(env, path));
  }
  return err;
}

}  // namespace bfcnode
