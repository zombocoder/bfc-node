#include <napi.h>
#include <sodium.h>
#include <zstd.h>

#include "addon_data.h"
#include "archive.h"
#include "writer.h"

namespace bfcnode {
Napi::Value NativeBuildInfo(const Napi::CallbackInfo& info);
}

namespace {

Napi::Value ZstdVersion(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), ZSTD_versionString());
}

Napi::Value SodiumVersion(const Napi::CallbackInfo& info) {
  return Napi::String::New(info.Env(), sodium_version_string());
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  auto* data = new bfcnode::AddonData();
  env.SetInstanceData(data);

  Napi::Function writerCtor = bfcnode::Writer::Init(env);
  data->writerCtor = Napi::Persistent(writerCtor);
  exports.Set("Writer", writerCtor);

  Napi::Function archiveCtor = bfcnode::Archive::Init(env);
  data->archiveCtor = Napi::Persistent(archiveCtor);
  exports.Set("Archive", archiveCtor);

  exports.Set("COMP_NONE", Napi::Number::New(env, BFC_COMP_NONE));
  exports.Set("COMP_ZSTD", Napi::Number::New(env, BFC_COMP_ZSTD));

  exports.Set("zstdVersion", Napi::Function::New(env, ZstdVersion));
  exports.Set("sodiumVersion", Napi::Function::New(env, SodiumVersion));
  exports.Set("nativeBuildInfo", Napi::Function::New(env, bfcnode::NativeBuildInfo));
  return exports;
}

}  // namespace

NODE_API_MODULE(bfc_node, Init)
