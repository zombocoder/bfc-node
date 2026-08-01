# Static libbfc built from vendor/bfc/src/lib. We deliberately do NOT use the
# upstream top-level CMakeLists: it hard-requires system libzstd/libsodium via
# pkg-config, unconditionally builds the CLI, and sets a global -Werror.
# scripts/check-drift.mjs guards the source list below against upstream changes.

execute_process(
    COMMAND node ${CMAKE_SOURCE_DIR}/scripts/check-drift.mjs
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    RESULT_VARIABLE BFC_DRIFT_RESULT
    OUTPUT_VARIABLE BFC_DRIFT_OUTPUT
    ERROR_VARIABLE  BFC_DRIFT_OUTPUT
)
if(NOT BFC_DRIFT_RESULT EQUAL 0)
    message(FATAL_ERROR "BFC source drift check failed:\n${BFC_DRIFT_OUTPUT}")
endif()

file(READ ${CMAKE_SOURCE_DIR}/cmake/bfc-sources.json BFC_SOURCES_JSON)
string(JSON BFC_SOURCES_COUNT LENGTH ${BFC_SOURCES_JSON} sources)
math(EXPR BFC_SOURCES_LAST "${BFC_SOURCES_COUNT} - 1")

set(BFC_SOURCES "")
foreach(i RANGE ${BFC_SOURCES_LAST})
    string(JSON BFC_SOURCE_NAME GET ${BFC_SOURCES_JSON} sources ${i})
    list(APPEND BFC_SOURCES ${CMAKE_SOURCE_DIR}/vendor/bfc/src/lib/${BFC_SOURCE_NAME})
endforeach()

add_library(bfc_static STATIC ${BFC_SOURCES})
add_dependencies(bfc_static sodium_ext)

target_include_directories(bfc_static
    PUBLIC  ${CMAKE_SOURCE_DIR}/vendor/bfc/include
    PRIVATE ${CMAKE_SOURCE_DIR}/vendor/bfc/src/lib
            ${BFC_NODE_ZSTD_INCLUDE_DIR}
            ${BFC_NODE_SODIUM_INCLUDE_DIR}
)

target_compile_definitions(bfc_static PRIVATE BFC_WITH_ZSTD BFC_WITH_SODIUM)

if(MSVC)
    # Same reason as in native/CMakeLists.txt: libsodium is linked statically.
    # _CRT_SECURE_NO_WARNINGS matches what upstream BFC sets for MSVC.
    target_compile_definitions(bfc_static
        PRIVATE SODIUM_STATIC SODIUM_EXPORT= _CRT_SECURE_NO_WARNINGS)
endif()

target_link_libraries(bfc_static PUBLIC libzstd_static sodium::static)

if(NOT WIN32)
    target_link_libraries(bfc_static PUBLIC m)
else()
    target_link_libraries(bfc_static PUBLIC bcrypt)
endif()

# Match upstream: hardware CRC32C on x86_64.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64|amd64" AND NOT MSVC)
    target_compile_options(bfc_static PRIVATE -msse4.2 -mcrc32)
endif()

# On aarch64, bfc_crc32c.c calls the ARM CRC intrinsics from <arm_acle.h>.
# GCC refuses to inline those always_inline builtins unless the crc target
# feature is enabled ("target specific option mismatch"), which is why a Linux
# arm64 build with GCC fails while macOS arm64 succeeds: Apple's clang has crc
# in its default baseline. The flag goes on that one file rather than the whole
# target, so the rest of libbfc keeps the plain armv8-a baseline.
#
# This does not make CRC hardware mandatory: bfc_crc32c.c detects support at
# runtime and falls back to the table-driven implementation.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64" AND NOT MSVC)
    set_source_files_properties(
        ${CMAKE_SOURCE_DIR}/vendor/bfc/src/lib/bfc_crc32c.c
        PROPERTIES COMPILE_OPTIONS "-march=armv8-a+crc"
    )
endif()

# ---- build info ----------------------------------------------------------

execute_process(
    COMMAND git -C ${CMAKE_SOURCE_DIR}/vendor/bfc describe --tags --always --dirty
    OUTPUT_VARIABLE BFC_NODE_BFC_VERSION
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)
execute_process(
    COMMAND git -C ${CMAKE_SOURCE_DIR}/vendor/bfc rev-parse --short HEAD
    OUTPUT_VARIABLE BFC_NODE_BFC_COMMIT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
)
if(NOT BFC_NODE_BFC_VERSION)
    message(FATAL_ERROR "Cannot determine BFC version — is vendor/bfc checked out?")
endif()

if(APPLE)
    set(BFC_NODE_PLATFORM "darwin")
elseif(WIN32)
    set(BFC_NODE_PLATFORM "win32")
else()
    string(TOLOWER "${CMAKE_SYSTEM_NAME}" BFC_NODE_PLATFORM)
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|AMD64|amd64")
    set(BFC_NODE_ARCH "x64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64")
    set(BFC_NODE_ARCH "arm64")
else()
    set(BFC_NODE_ARCH "${CMAKE_SYSTEM_PROCESSOR}")
endif()

set(BFC_NODE_LIBC "")
if(BFC_NODE_PLATFORM STREQUAL "linux")
    execute_process(COMMAND ldd --version
                    OUTPUT_VARIABLE LDD_OUT ERROR_VARIABLE LDD_OUT)
    if(LDD_OUT MATCHES "musl")
        set(BFC_NODE_LIBC "musl")
    else()
        set(BFC_NODE_LIBC "glibc")
    endif()
endif()

set(BFC_NODE_COMPRESSION 1)
set(BFC_NODE_ENCRYPTION 1)

configure_file(
    ${CMAKE_SOURCE_DIR}/cmake/build_info.h.in
    ${CMAKE_BINARY_DIR}/generated/bfc_node_build_info.h
    @ONLY
)
set(BFC_NODE_GENERATED_DIR ${CMAKE_BINARY_DIR}/generated CACHE INTERNAL "")
