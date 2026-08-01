#pragma once

#include <napi.h>

#include "handle.h"

namespace bfcnode {

class Writer : public Napi::ObjectWrap<Writer> {
 public:
  static Napi::Function Init(Napi::Env env);

  // Constructed only from native code with an External<HandlePtr>.
  explicit Writer(const Napi::CallbackInfo& info);
  ~Writer();

  static Napi::Value Create(const Napi::CallbackInfo& info);

  HandlePtr handle() const { return handle_; }

 private:
  Napi::Value AddDir(const Napi::CallbackInfo& info);
  Napi::Value AddFile(const Napi::CallbackInfo& info);
  Napi::Value AddFileFromBuffer(const Napi::CallbackInfo& info);
  Napi::Value AddSymlink(const Napi::CallbackInfo& info);
  Napi::Value SetCompression(const Napi::CallbackInfo& info);
  Napi::Value SetCompressionThreshold(const Napi::CallbackInfo& info);
  Napi::Value SetEncryptionPassword(const Napi::CallbackInfo& info);
  Napi::Value SetEncryptionKey(const Napi::CallbackInfo& info);
  Napi::Value ClearEncryption(const Napi::CallbackInfo& info);
  Napi::Value Finish(const Napi::CallbackInfo& info);
  Napi::Value Close(const Napi::CallbackInfo& info);

  HandlePtr handle_;
};

}  // namespace bfcnode
