#include <napi.h>

#include <string>

#include "bfc_node_build_info.h"

namespace bfcnode {

Napi::Value NativeBuildInfo(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);

  out.Set("napiVersion", Napi::Number::New(env, NAPI_VERSION));
  out.Set("bfcVersion", Napi::String::New(env, BFC_NODE_BFC_VERSION));
  out.Set("bfcCommit", Napi::String::New(env, BFC_NODE_BFC_COMMIT));
  out.Set("platform", Napi::String::New(env, BFC_NODE_PLATFORM));
  out.Set("architecture", Napi::String::New(env, BFC_NODE_ARCH));

  const std::string libc = BFC_NODE_LIBC;
  if (libc.empty()) {
    out.Set("libc", env.Null());
  } else {
    out.Set("libc", Napi::String::New(env, libc));
  }

  out.Set("compression", Napi::Boolean::New(env, BFC_NODE_COMPRESSION));
  out.Set("encryption", Napi::Boolean::New(env, BFC_NODE_ENCRYPTION));
  return out;
}

}  // namespace bfcnode
