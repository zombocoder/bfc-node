# node-addon-api's own `include_dir` export is relative to the package root,
# which CMake would resolve against the build directory. Resolve it ourselves.
execute_process(
    COMMAND node -p "require('node:path').dirname(require.resolve('node-addon-api/package.json'))"
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}
    OUTPUT_VARIABLE NODE_ADDON_API_DIR
    OUTPUT_STRIP_TRAILING_WHITESPACE
    COMMAND_ERROR_IS_FATAL ANY
)

if(NOT EXISTS ${NODE_ADDON_API_DIR}/napi.h)
    message(FATAL_ERROR "napi.h not found in '${NODE_ADDON_API_DIR}' — run npm install")
endif()

add_library(bfc_node SHARED
    src/addon.cc
    src/build_info.cc
    src/archive.cc
    src/entry.cc
    src/errors.cc
    src/writer.cc
    ${CMAKE_JS_SRC}
)

set_target_properties(bfc_node PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)

target_include_directories(bfc_node PRIVATE
    ${CMAKE_JS_INC}
    ${NODE_ADDON_API_DIR}
    ${BFC_NODE_ZSTD_INCLUDE_DIR}
    ${BFC_NODE_SODIUM_INCLUDE_DIR}
    ${BFC_NODE_GENERATED_DIR}
    ${CMAKE_SOURCE_DIR}/vendor/bfc/include
)

# bfc_static links libzstd_static and sodium::static as PUBLIC, so they arrive
# transitively. Naming them again here only produces duplicate-library warnings.
target_link_libraries(bfc_node PRIVATE
    ${CMAKE_JS_LIB}
    bfc_static
)

add_dependencies(bfc_node sodium_ext)

target_compile_definitions(bfc_node PRIVATE
    NAPI_VERSION=8
    NAPI_CPP_EXCEPTIONS
)

if(MSVC)
    # Without these the libsodium headers declare every symbol as
    # __declspec(dllimport) and linking against the static .lib fails.
    target_compile_definitions(bfc_node PRIVATE SODIUM_STATIC SODIUM_EXPORT=)
endif()

# Do not depend on the runner's libstdc++/libgcc version.
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_options(bfc_node PRIVATE -static-libstdc++ -static-libgcc)
endif()

if(MSVC)
    target_sources(bfc_node PRIVATE ${CMAKE_JS_NODELIB_DEF})
endif()
