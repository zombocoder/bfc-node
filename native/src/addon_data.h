#pragma once

#include <napi.h>

namespace bfcnode {

// Per-environment constructors, needed to build wrapper objects from
// AsyncWorker::OnOK. Registered with env.SetInstanceData in addon.cc.
struct AddonData {
  Napi::FunctionReference writerCtor;
  Napi::FunctionReference archiveCtor;
};

}  // namespace bfcnode
