#include "archive.h"

#include <fcntl.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif

#include <algorithm>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <utility>
#include <vector>

#include "addon_data.h"
#include "async_worker.h"
#include "entry.h"
#include "errors.h"
#include "sync_call.h"

namespace bfcnode {
namespace {

class OpenWorker : public BfcAsyncWorker {
 public:
  OpenWorker(Napi::Env env, std::string path)
      : BfcAsyncWorker(env), path_(std::move(path)) {}

 protected:
  void Execute() override {
    bfc_t* raw = nullptr;
    int rc = bfc_open(path_.c_str(), &raw);
    if (rc != BFC_OK) {
      Fail(rc, "failed to open BFC archive", path_);
      return;
    }
    handle_ = std::make_shared<Handle>();
    handle_->raw = raw;
  }

  Napi::Value Result(Napi::Env env) override {
    auto* data = env.GetInstanceData<AddonData>();
    auto* holder = new HandlePtr(handle_);
    return data->archiveCtor.New({Napi::External<HandlePtr>::New(
        env, holder, [](Napi::Env, HandlePtr* p) { delete p; })});
  }

 private:
  std::string path_;
  HandlePtr handle_;
};

int CollectEntry(const bfc_entry_t* ent, void* user) {
  static_cast<std::vector<EntryData>*>(user)->push_back(EntryData::From(*ent));
  return 0;  // continue iteration
}

class ListWorker : public BfcAsyncWorker {
 public:
  ListWorker(Napi::Env env, HandlePtr handle, std::string prefix)
      : BfcAsyncWorker(env), handle_(std::move(handle)), prefix_(std::move(prefix)) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "archive is closed");
      return;
    }
    int rc = bfc_list(handle_->raw, prefix_.c_str(), CollectEntry, &entries_);
    if (rc != BFC_OK) {
      Fail(rc, "failed to list archive entries", prefix_);
    }
  }

  Napi::Value Result(Napi::Env env) override {
    Napi::Array out = Napi::Array::New(env, entries_.size());
    for (size_t i = 0; i < entries_.size(); ++i) {
      out.Set(i, EntryToJs(env, entries_[i]));
    }
    return out;
  }

 private:
  HandlePtr handle_;
  std::string prefix_;
  std::vector<EntryData> entries_;
};

class StatWorker : public BfcAsyncWorker {
 public:
  StatWorker(Napi::Env env, HandlePtr handle, std::string path)
      : BfcAsyncWorker(env), handle_(std::move(handle)), path_(std::move(path)) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "archive is closed");
      return;
    }
    bfc_entry_t raw{};
    int rc = bfc_stat(handle_->raw, path_.c_str(), &raw);
    if (rc != BFC_OK) {
      Fail(rc, "failed to stat entry", path_);
      return;
    }
    entry_ = EntryData::From(raw);
    // bfc_stat does not guarantee `path` outlives the call; use the request path.
    if (entry_.path.empty()) entry_.path = path_;
  }

  Napi::Value Result(Napi::Env env) override { return EntryToJs(env, entry_); }

 private:
  HandlePtr handle_;
  std::string path_;
  EntryData entry_;
};

class ReadWorker : public BfcAsyncWorker {
 public:
  ReadWorker(Napi::Env env, HandlePtr handle, std::string path,
             uint64_t offset, int64_t length)
      : BfcAsyncWorker(env), handle_(std::move(handle)), path_(std::move(path)),
        offset_(offset), length_(length) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "archive is closed");
      return;
    }

    // bfc_read returns 0 for every failure mode, so resolve existence and size
    // through bfc_stat first — that is the only way to produce a useful error.
    bfc_entry_t entry{};
    int rc = bfc_stat(handle_->raw, path_.c_str(), &entry);
    if (rc != BFC_OK) {
      Fail(rc, "failed to stat entry before reading", path_);
      return;
    }

    if (offset_ >= entry.size) {
      return;  // empty result, not an error
    }

    uint64_t available = entry.size - offset_;
    uint64_t want = length_ < 0
        ? available
        : std::min<uint64_t>(available, static_cast<uint64_t>(length_));
    if (want == 0) return;

    data_.resize(static_cast<size_t>(want));
    size_t got = bfc_read(handle_->raw, path_.c_str(), offset_, data_.data(),
                          data_.size());
    if (got == 0) {
      Fail(BFC_E_IO, "failed to read entry content", path_);
      return;
    }
    data_.resize(got);
  }

  Napi::Value Result(Napi::Env env) override {
    return Napi::Buffer<uint8_t>::Copy(env, data_.data(), data_.size());
  }

 private:
  HandlePtr handle_;
  std::string path_;
  uint64_t offset_;
  int64_t length_;
  std::vector<uint8_t> data_;
};

// Open the destination here rather than accepting a descriptor from JavaScript.
// On Windows the addon links the static CRT, which keeps its own file
// descriptor table, so a descriptor created by Node is meaningless to us and
// every write fails with EBADF (surfacing as BFC_E_IO).
int OpenForWrite(const char* path) {
#ifdef _WIN32
  return _open(path, _O_WRONLY | _O_CREAT | _O_TRUNC | _O_BINARY,
               _S_IREAD | _S_IWRITE);
#else
  return open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
#endif
}

void CloseFd(int fd) {
#ifdef _WIN32
  _close(fd);
#else
  close(fd);
#endif
}

class ExtractToFileWorker : public BfcAsyncWorker {
 public:
  ExtractToFileWorker(Napi::Env env, HandlePtr handle, std::string path,
                      std::string dest_path)
      : BfcAsyncWorker(env), handle_(std::move(handle)), path_(std::move(path)),
        dest_path_(std::move(dest_path)) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "archive is closed");
      return;
    }

    int fd = OpenForWrite(dest_path_.c_str());
    if (fd < 0) {
      Fail(BFC_E_IO, "failed to open destination file", dest_path_);
      return;
    }

    int rc = bfc_extract_to_fd(handle_->raw, path_.c_str(), fd);
    CloseFd(fd);

    if (rc != BFC_OK) {
      Fail(rc, "failed to extract entry", path_);
    }
  }

 private:
  HandlePtr handle_;
  std::string path_;
  std::string dest_path_;
};

class VerifyWorker : public BfcAsyncWorker {
 public:
  VerifyWorker(Napi::Env env, HandlePtr handle, bool deep)
      : BfcAsyncWorker(env), handle_(std::move(handle)), deep_(deep) {}

 protected:
  void Execute() override {
    std::lock_guard<std::mutex> lock(handle_->mutex);
    if (handle_->closed) {
      Fail(kErrClosed, "archive is closed");
      return;
    }
    int rc = bfc_verify(handle_->raw, deep_ ? 1 : 0);
    if (rc != BFC_OK) {
      Fail(rc, deep_ ? "deep archive verification failed"
                     : "archive verification failed");
    }
  }

 private:
  HandlePtr handle_;
  bool deep_;
};

}  // namespace

Napi::Function Archive::Init(Napi::Env env) {
  return DefineClass(env, "Archive", {
      StaticMethod<&Archive::Open>("open"),
      InstanceMethod<&Archive::List>("list"),
      InstanceMethod<&Archive::Stat>("stat"),
      InstanceMethod<&Archive::Read>("read"),
      InstanceMethod<&Archive::ExtractToFile>("extractToFile"),
      InstanceMethod<&Archive::Verify>("verify"),
      InstanceMethod<&Archive::SetEncryptionPassword>("setEncryptionPassword"),
      InstanceMethod<&Archive::SetEncryptionKey>("setEncryptionKey"),
      InstanceMethod<&Archive::HasEncryption>("hasEncryption"),
      InstanceMethod<&Archive::Close>("close"),
  });
}

Archive::Archive(const Napi::CallbackInfo& info) : Napi::ObjectWrap<Archive>(info) {
  if (info.Length() < 1 || !info[0].IsExternal()) {
    throw Napi::Error::New(info.Env(), "Archive is not constructible from JavaScript");
  }
  handle_ = *info[0].As<Napi::External<HandlePtr>>().Data();
}

Archive::~Archive() {
  if (!handle_) return;
  std::lock_guard<std::mutex> lock(handle_->mutex);
  if (!handle_->closed) {
    bfc_close_read(handle_->raw);
    handle_->closed = true;
  }
}

Napi::Value Archive::Open(const Napi::CallbackInfo& info) {
  auto* worker = new OpenWorker(info.Env(), info[0].As<Napi::String>().Utf8Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::List(const Napi::CallbackInfo& info) {
  auto* worker = new ListWorker(info.Env(), handle_,
                                info[0].As<Napi::String>().Utf8Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::Stat(const Napi::CallbackInfo& info) {
  auto* worker = new StatWorker(info.Env(), handle_,
                                info[0].As<Napi::String>().Utf8Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::Read(const Napi::CallbackInfo& info) {
  auto* worker = new ReadWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      static_cast<uint64_t>(info[1].As<Napi::Number>().Int64Value()),
      info[2].As<Napi::Number>().Int64Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::ExtractToFile(const Napi::CallbackInfo& info) {
  auto* worker = new ExtractToFileWorker(
      info.Env(), handle_,
      info[0].As<Napi::String>().Utf8Value(),
      info[1].As<Napi::String>().Utf8Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::Verify(const Napi::CallbackInfo& info) {
  auto* worker = new VerifyWorker(info.Env(), handle_,
                                  info[0].As<Napi::Boolean>().Value());
  worker->Queue();
  return worker->Promise();
}

Napi::Value Archive::SetEncryptionPassword(const Napi::CallbackInfo& info) {
  std::string password = info[0].As<Napi::String>().Utf8Value();
  RunSync(info, handle_, "failed to set reader encryption password", [&](bfc_t* r) {
    return bfc_reader_set_encryption_password(r, password.c_str(), password.size());
  });
  return info.Env().Undefined();
}

Napi::Value Archive::SetEncryptionKey(const Napi::CallbackInfo& info) {
  auto key = info[0].As<Napi::Buffer<uint8_t>>();
  if (key.Length() != 32) {
    throw MakeError(info.Env(), BFC_E_INVAL, "encryption key must be exactly 32 bytes");
  }
  RunSync(info, handle_, "failed to set reader encryption key",
          [&](bfc_t* r) { return bfc_reader_set_encryption_key(r, key.Data()); });
  return info.Env().Undefined();
}

Napi::Value Archive::HasEncryption(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(handle_->mutex);
  if (handle_->closed) {
    throw MakeError(info.Env(), kErrClosed, "archive is closed");
  }
  return Napi::Boolean::New(info.Env(), bfc_has_encryption(handle_->raw) != 0);
}

Napi::Value Archive::Close(const Napi::CallbackInfo& info) {
  std::lock_guard<std::mutex> lock(handle_->mutex);
  if (!handle_->closed) {
    bfc_close_read(handle_->raw);
    handle_->closed = true;
  }
  return info.Env().Undefined();
}

}  // namespace bfcnode
