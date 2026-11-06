# Pulse shim 0.2.13 (Soloist → ALSA)

Purpose-driven `libpulse.so.0`. Soloist dlopens this name. The library
implements the 48 `pa_*` symbols that binary looks up (see `shim/ABI.txt`)
and writes FLOAT32 into `plug:volumio`. The outer plug converts to the
slave. It is not apulse and not a Pulse server.

Library version is **0.2.13** (`shim/CMakeLists.txt`). The source is `shim/`
in this repository; the payload here is one of its published releases,
named in `RELEASE` next to this file.

## Layout

- **amd64/** — x86_64
- **arm64/** — aarch64 (64-bit Pi)
- **armhf/** — armv7l (32-bit Pi)

Each directory contains:

- `libpulse.so.0`
- `SOURCE_REVISION`

That list is the payload manifest in `docker/run-docker-shim.sh`.
`libpulse-simple.so.0` and `libpulse-mainloop-glib.so.0` are not shipped:
Soloist does not load them.

`RELEASE` is the pin: the release tag on its first line, then the digest of
each of that release's archives and of each file listed above.

## Build

```
./build-matrix.sh
```

Single arch:

```
./docker/run-docker-shim.sh amd64
```

The container is Debian Bookworm. Runtime link is `libasound` and libc only.
`SOURCE_REVISION` is the git commit of this repository that produced the
`.so`. The committed payload is a published release, placed here by
`scripts/shim-release.sh pin <tag>`, which also writes `RELEASE`; a
workstation build that installs here is for development, and the tree is
pinned to a release again before it is committed.
