#include "writer.h"

#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "addon_data.h"
#include "async_worker.h"
#include "errors.h"
#include "sync_call.h"

namespace bfcnode {
namespace {

// Expose an in-memory buffer as a readable FILE*, which is what bfc_add_file
// takes. Returns nullptr on failure; the caller owns the stream.
FILE* OpenBufferAsStream(const std::vector<uint8_t>& buffer) {
#ifdef _WIN32
  // Windows has no fmemopen. tmpfile() is removed on close, so this stays
  // self-cleaning even when the operation fails midway.
  FILE* stream = tmpfile();
  if (!stream) return nullptr;
  if (!buffer.empty() && fwrite(buffer.data(), 1, buffer.size(), stream) != buffer.size()) {
    fclose(stream);
    return nullptr;
  }
  rewind(stream);
  return stream;
#else
  // fmemopen rejects a zero length (returns NULL on macOS), so an empty buffer
  // gets an empty temp stream instead — it reads as EOF immediately.
  if (buffer.empty()) return tmpfile();
  return fmemopen(const_cast<uint8_t*>(buffer.data()), buffer.size(), "rb");
#endif
}

class CreateWorker : public BfcAsyncWorker {
 public:
  CreateWorker(Napi::Env env, std::string path, uint32_t block_size)
      : BfcAsyncWorker(env), path_(std::move(path)), block_size_(block_size) {}

 protected:
  void Execute() override {
    bfc_t* raw = nullptr;
    // Features are derived by bfc_set_compression/bfc_set_encryption_*, so 0 here.
    int rc = bfc_create(path_.c_str(), block_size_, 0, &raw);
    if (rc != BFC_OK) {
      Fail(rc, "failed to create BFC archive", path_);
      return;
    }
    handle_ = std::make_shared<Handle>();
    handle_->raw = raw;
  }

  Napi::Value Result(Napi::Env env) override {
    auto* data = env.GetInstanceData<AddonData>();
    auto* holder = new HandlePtr(handle_);
    return data->writerCtor.New({Napi::External<HandlePtr>::New(
        env, holder, [](Napi::Env, HandlePtr* p) { delete p; })});
  }

 private:
  std::string path_;
  uint32_t block_size_;
  HandlePtr handle_;
};

class AddDirWorker : public BfcAsyncWorker {
 public:
  AddDirWorker(Napi::Env env, HandlePtr handle, std::string path,
               uint32_t mode, uint64_t mtime_ns)
      : BfcAsyncWorker(env), handle_(std::move(handle)), path_(std::move(path)),
        mode_(mode), mtime_ns_(mtime_ns) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "writer is closed");
      return;
    }
    int rc = bfc_add_dir(handle_->raw, path_.c_str(), mode_, mtime_ns_);
    if (rc != BFC_OK) {
      Fail(rc, "failed to add directory", path_);
    }
  }

 private:
  HandlePtr handle_;
  std::string path_;
  uint32_t mode_;
  uint64_t mtime_ns_;
};

class AddSymlinkWorker : public BfcAsyncWorker {
 public:
  AddSymlinkWorker(Napi::Env env, HandlePtr handle, std::string path,
                   std::string target, uint32_t mode, uint64_t mtime_ns)
      : BfcAsyncWorker(env), handle_(std::move(handle)), path_(std::move(path)),
        target_(std::move(target)), mode_(mode), mtime_ns_(mtime_ns) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "writer is closed");
      return;
    }
    int rc = bfc_add_symlink(handle_->raw, path_.c_str(), target_.c_str(),
                             mode_, mtime_ns_);
    if (rc != BFC_OK) {
      Fail(rc, "failed to add symlink", path_);
    }
  }

 private:
  HandlePtr handle_;
  std::string path_;
  std::string target_;
  uint32_t mode_;
  uint64_t mtime_ns_;
};

class AddFileWorker : public BfcAsyncWorker {
 public:
  // Either `source_path` (opened with fopen) or `buffer` (wrapped with fmemopen).
  AddFileWorker(Napi::Env env, HandlePtr handle, std::string container_path,
                std::string source_path, std::vector<uint8_t> buffer,
                bool from_buffer, uint32_t mode, uint64_t mtime_ns)
      : BfcAsyncWorker(env), handle_(std::move(handle)),
        container_path_(std::move(container_path)),
        source_path_(std::move(source_path)), buffer_(std::move(buffer)),
        from_buffer_(from_buffer), mode_(mode), mtime_ns_(mtime_ns) {}

 protected:
  void Execute() override {
    FILE* src;
    if (from_buffer_) {
      src = OpenBufferAsStream(buffer_);
    } else {
      src = fopen(source_path_.c_str(), "rb");
    }
    if (!src) {
      Fail(BFC_E_IO, "failed to open source file",
           from_buffer_ ? container_path_ : source_path_);
      return;
    }

    uint32_t crc = 0;
    int rc;
    {
      std::lock_guard<std::mutex> lock(handle_->mutex);
      if (handle_->closed) {
        fclose(src);
        Fail(kErrClosed, "writer is closed");
        return;
      }
      rc = bfc_add_file(handle_->raw, container_path_.c_str(), src, mode_,
                        mtime_ns_, &crc);
    }
    fclose(src);

    if (rc != BFC_OK) {
      Fail(rc, "failed to add file", container_path_);
    }
  }

 private:
  HandlePtr handle_;
  std::string container_path_;
  std::string source_path_;
  std::vector<uint8_t> buffer_;
  bool from_buffer_;
  uint32_t mode_;
  uint64_t mtime_ns_;
};

class FinishWorker : public BfcAsyncWorker {
 public:
  FinishWorker(Napi::Env env, HandlePtr handle)
      : BfcAsyncWorker(env), handle_(std::move(handle)) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "writer is closed");
      return;
    }
    int rc = bfc_finish(handle_->raw);
    if (rc != BFC_OK) {
      Fail(rc, "failed to finish BFC archive");
    }
  }

 private:
  HandlePtr handle_;
};

}  // namespace

Napi::Function Writer::Init(Napi::Env env) {
  return DefineClass(env, "Writer", {
      StaticMethod<&Writer::Create>("create"),
      InstanceMethod<&Writer::AddDir>("addDir"),
      InstanceMethod<&Writer::AddFile>("addFile"),
      InstanceMethod<&Writer::AddFileFromBuffer>("addFileFromBuffer"),
      InstanceMethod<&Writer::AddSymlink>("addSymlink"),
      InstanceMethod<&Writer::SetCompression>("setCompression"),
      InstanceMethod<&Writer::SetCompressionThreshold>("setCompressionThreshold"),
      InstanceMethod<&Writer::SetEncryptionPassword>("setEncryptionPassword"),
      InstanceMethod<&Writer::SetEncryptionKey>("setEncryptionKey"),
      InstanceMethod<&Writer::ClearEncryption>("clearEncryption"),
      InstanceMethod<&Writer::Finish>("finish"),
      InstanceMethod<&Writer::Close>("close"),
  });
}

Writer::Writer(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Writer>(info) {
  if (info.Length() < 1 || !info[0].IsExternal()) {
    throw Napi::Error::New(info.Env(), "Writer is not constructible from JavaScript");
  }
  handle_ = *info[0].As<Napi::External<HandlePtr>>().Data();
}

Writer::~Writer() {
  if (!handle_) return;
  std::lock_guard<std::mutex> lock(handle_->mutex);
  if (!handle_->closed) {
    bfc_close(handle_->raw);
    handle_->closed = true;
  }
}

Napi::Value Writer::Create(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::string path = info[0].As<Napi::String>().Utf8Value();
  uint32_t block_size = info[1].As<Napi::Number>().Uint32Value();

  auto* worker = new CreateWorker(env, std::move(path), block_size);
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::AddDir(const Napi::CallbackInfo& info) {
  bool lossless = false;
  auto* worker = new AddDirWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::Number>().Uint32Value(),
      info[2].As<Napi::BigInt>().Uint64Value(&lossless));
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::AddFile(const Napi::CallbackInfo& info) {
  bool lossless = false;
  auto* worker = new AddFileWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::String>().Utf8Value(),
      {}, false,
      info[2].As<Napi::Number>().Uint32Value(),
      info[3].As<Napi::BigInt>().Uint64Value(&lossless));
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::AddFileFromBuffer(const Napi::CallbackInfo& info) {
  bool lossless = false;
  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  // Copy deliberately: the JS buffer may be collected or mutated while the
  // worker runs on another thread.
  std::vector<uint8_t> copy(buf.Data(), buf.Data() + buf.Length());

  auto* worker = new AddFileWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      "", std::move(copy), true,
      info[2].As<Napi::Number>().Uint32Value(),
      info[3].As<Napi::BigInt>().Uint64Value(&lossless));
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::AddSymlink(const Napi::CallbackInfo& info) {
  bool lossless = false;
  auto* worker = new AddSymlinkWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::String>().Utf8Value(),
      info[2].As<Napi::Number>().Uint32Value(),
      info[3].As<Napi::BigInt>().Uint64Value(&lossless));
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::SetCompression(const Napi::CallbackInfo& info) {
  auto type = static_cast<uint8_t>(info[0].As<Napi::Number>().Uint32Value());
  int level = info[1].As<Napi::Number>().Int32Value();
  RunSync(info, handle_, "failed to set compression",
          [&](bfc_t* w) { return bfc_set_compression(w, type, level); });
  return info.Env().Undefined();
}

Napi::Value Writer::SetCompressionThreshold(const Napi::CallbackInfo& info) {
  auto min_bytes = static_cast<size_t>(info[0].As<Napi::Number>().Int64Value());
  RunSync(info, handle_, "failed to set compression threshold",
          [&](bfc_t* w) { return bfc_set_compression_threshold(w, min_bytes); });
  return info.Env().Undefined();
}

Napi::Value Writer::SetEncryptionPassword(const Napi::CallbackInfo& info) {
  std::string password = info[0].As<Napi::String>().Utf8Value();
  RunSync(info, handle_, "failed to set encryption password", [&](bfc_t* w) {
    return bfc_set_encryption_password(w, password.c_str(), password.size());
  });
  return info.Env().Undefined();
}

Napi::Value Writer::SetEncryptionKey(const Napi::CallbackInfo& info) {
  auto key = info[0].As<Napi::Buffer<uint8_t>>();
  if (key.Length() != 32) {
    throw MakeError(info.Env(), BFC_E_INVAL, "encryption key must be exactly 32 bytes");
  }
  RunSync(info, handle_, "failed to set encryption key",
          [&](bfc_t* w) { return bfc_set_encryption_key(w, key.Data()); });
  return info.Env().Undefined();
}

Napi::Value Writer::ClearEncryption(const Napi::CallbackInfo& info) {
  RunSync(info, handle_, "failed to clear encryption",
          [&](bfc_t* w) { return bfc_clear_encryption(w); });
  return info.Env().Undefined();
}

Napi::Value Writer::Finish(const Napi::CallbackInfo& info) {
  auto* worker = new FinishWorker(info.Env(), handle_);
  worker->Queue();
  return worker->Promise();
}

Napi::Value Writer::Close(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(handle_->mutex);
  if (!handle_->closed) {
    bfc_close(handle_->raw);
    handle_->closed = true;
  }
  return info.Env().Undefined();
}

}  // namespace bfcnode
