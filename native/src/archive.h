#pragma once

#include <napi.h>

#include "handle.h"

namespace bfcnode {

class Archive : public Napi::ObjectWrap<Archive> {
 public:
  static Napi::Function Init(Napi::Env env);

  explicit Archive(const Napi::CallbackInfo& info);
  ~Archive();

  static Napi::Value Open(const Napi::CallbackInfo& info);

 private:
  Napi::Value List(const Napi::CallbackInfo& info);
  Napi::Value Stat(const Napi::CallbackInfo& info);
  Napi::Value Read(const Napi::CallbackInfo& info);
  Napi::Value ExtractToFd(const Napi::CallbackInfo& info);
  Napi::Value Verify(const Napi::CallbackInfo& info);
  Napi::Value SetEncryptionPassword(const Napi::CallbackInfo& info);
  Napi::Value SetEncryptionKey(const Napi::CallbackInfo& info);
  Napi::Value HasEncryption(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);

  HandlePtr handle_;
};

}  // namespace bfcnode
