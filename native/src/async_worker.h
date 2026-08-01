#pragma once

#include <napi.h>

#include <string>
#include <utility>

#include <bfc.h>

#include "errors.h"

namespace bfcnode {

// AsyncWorker that resolves a Promise and rejects with a BfcError carrying
// `.code` and `.path`. Subclasses implement Execute() and optionally Result().
class BfcAsyncWorker : public Napi::AsyncWorker {
 public:
  explicit BfcAsyncWorker(Napi::Env env)
      : Napi::AsyncWorker(env), deferred_(Napi::Promise::Deferred::New(env)) {}

  Napi::Promise Promise() { return deferred_.Promise(); }

 protected:
  // Call from Execute() when a bfc_* call fails.
  void Fail(int rc, std::string message, std::string path = "") {
    rc_ = rc;
    message_ = std::move(message);
    path_ = std::move(path);
    SetError(message_);
  }

  virtual Napi::Value Result(Napi::Env env) { return env.Undefined(); }

  void OnOK() override { deferred_.Resolve(Result(Env())); }

  void OnError(const Napi::Error&) override {
    deferred_.Reject(MakeError(Env(), rc_, message_, path_).Value());
  }

 private:
  Napi::Promise::Deferred deferred_;
  int rc_ = BFC_E_IO;
  std::string message_ = "unknown BFC error";
  std::string path_;
};

}  // namespace bfcnode
