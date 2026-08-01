# Static libsodium from vendor/libsodium. Produces target `sodium::static`.
#
# libsodium has no CMake build. On Unix it is autotools; on Windows it ships
# Visual Studio solutions instead, so the two platforms take different paths.
include(ExternalProject)
include(ProcessorCount)

set(SODIUM_SOURCE_DIR ${CMAKE_SOURCE_DIR}/vendor/libsodium)

if(MSVC)
    # MSBuild honours an explicit /p:OutDir, which pins the output path — the
    # default one embeds the platform toolset (v143, v145, ...) and would
    # change with the Visual Studio version on the runner.
    set(SODIUM_MSVC_OUTDIR ${CMAKE_BINARY_DIR}/sodium-msvc)
    set(SODIUM_LIBRARY     ${SODIUM_MSVC_OUTDIR}/libsodium.lib)
    set(SODIUM_VCXPROJ
        ${SODIUM_SOURCE_DIR}/builds/msvc/vs2022/libsodium/libsodium.vcxproj)

    if(CMAKE_SIZEOF_VOID_P EQUAL 8)
        set(SODIUM_MSVC_PLATFORM x64)
    else()
        set(SODIUM_MSVC_PLATFORM Win32)
    endif()

    find_program(MSBUILD_EXECUTABLE msbuild)
    if(NOT MSBUILD_EXECUTABLE)
        message(FATAL_ERROR
            "msbuild was not found on PATH, and libsodium has no CMake build on Windows.\n"
            "  Locally: run this from a 'Developer Command Prompt for VS 2022'.\n"
            "  In CI: add the microsoft/setup-msbuild action before building.")
    endif()

    # sodium.h includes "sodium/version.h", which configure generates from
    # version.h.in on Unix. A git checkout has neither, and the Visual Studio
    # project only lists the header without producing it — release tarballs ship
    # it pre-generated. Copy the version that libsodium maintains for MSVC.
    set(SODIUM_VERSION_H ${SODIUM_SOURCE_DIR}/src/libsodium/include/sodium/version.h)

    ExternalProject_Add(sodium_ext
        SOURCE_DIR        ${SODIUM_SOURCE_DIR}
        CONFIGURE_COMMAND ${CMAKE_COMMAND} -E copy_if_different
                              ${SODIUM_SOURCE_DIR}/builds/msvc/version.h
                              ${SODIUM_VERSION_H}
        BUILD_COMMAND     ${MSBUILD_EXECUTABLE} ${SODIUM_VCXPROJ}
                              /p:Configuration=ReleaseLIB
                              /p:Platform=${SODIUM_MSVC_PLATFORM}
                              /p:OutDir=${SODIUM_MSVC_OUTDIR}\\
                              /v:minimal
        INSTALL_COMMAND   ""
        BUILD_IN_SOURCE   1
        BUILD_BYPRODUCTS  ${SODIUM_LIBRARY}
        LOG_BUILD         ON
        LOG_OUTPUT_ON_FAILURE ON
    )

    set(SODIUM_INCLUDE_DIR ${SODIUM_SOURCE_DIR}/src/libsodium/include)
else()
    ProcessorCount(SODIUM_BUILD_JOBS)
    if(SODIUM_BUILD_JOBS EQUAL 0)
        set(SODIUM_BUILD_JOBS 2)
    endif()

    set(SODIUM_PREFIX  ${CMAKE_BINARY_DIR}/sodium)
    set(SODIUM_LIBRARY ${SODIUM_PREFIX}/lib/libsodium.a)

    # A git checkout ships no ./configure — autogen.sh generates it, which is by
    # far the slowest step (autoreconf). It writes into the source tree and
    # survives `rm -rf build`, so skip it once it exists.
    # `-s` skips fetching third-party scripts, keeping the build offline.
    message(STATUS
        "libsodium is built from source; the first build takes a few minutes")

    ExternalProject_Add(sodium_ext
        SOURCE_DIR        ${SODIUM_SOURCE_DIR}
        BINARY_DIR        ${CMAKE_BINARY_DIR}/sodium-build
        CONFIGURE_COMMAND sh -c
                              "test -x '${SODIUM_SOURCE_DIR}/configure' \
                               || '${SODIUM_SOURCE_DIR}/autogen.sh' -s"
                  COMMAND ${SODIUM_SOURCE_DIR}/configure
                              --prefix=${SODIUM_PREFIX}
                              --enable-static
                              --disable-shared
                              --with-pic
                              --disable-dependency-tracking
        BUILD_COMMAND     make -j${SODIUM_BUILD_JOBS}
        INSTALL_COMMAND   make install
        BUILD_BYPRODUCTS  ${SODIUM_LIBRARY}
        # Deliberately unlogged: a silent multi-minute step looks like a hang.
        USES_TERMINAL_CONFIGURE ON
        USES_TERMINAL_BUILD     ON
    )

    set(SODIUM_INCLUDE_DIR ${SODIUM_PREFIX}/include)
endif()

add_library(sodium::static STATIC IMPORTED GLOBAL)
set_target_properties(sodium::static PROPERTIES
    IMPORTED_LOCATION ${SODIUM_LIBRARY}
)
add_dependencies(sodium::static sodium_ext)

# On Unix the include dir only exists after install, so create it up front for
# CMake's existence checks.
file(MAKE_DIRECTORY ${SODIUM_INCLUDE_DIR})
set(BFC_NODE_SODIUM_INCLUDE_DIR ${SODIUM_INCLUDE_DIR} CACHE INTERNAL "")
