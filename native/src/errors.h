#pragma once

#include <napi.h>

#include <string>

namespace bfcnode {

// Sentinel codes that have no bfc_err_t counterpart.
constexpr int kErrClosed = -100;

const char* ErrorCode(int rc);

Napi::Error MakeError(Napi::Env env, int rc, const std::string& message,
                      const std::string& path = "");

}  // namespace bfcnode
