#pragma once

#include <napi.h>

#include <mutex>

#include "errors.h"
#include "handle.h"

namespace bfcnode {

// Run a synchronous bfc_* setter under the handle lock, converting failures
// into a thrown BfcError.
template <typename Fn>
void RunSync(const Napi::CallbackInfo& info, const HandlePtr& handle,
             const char* message, Fn fn) {
  std::lock_guard<std::mutex> lock(handle->mutex);
  if (handle->closed) {
    throw MakeError(info.Env(), kErrClosed, "handle is closed");
  }
  int rc = fn(handle->raw);
  if (rc != BFC_OK) {
    throw MakeError(info.Env(), rc, message);
  }
}

}  // namespace bfcnode
