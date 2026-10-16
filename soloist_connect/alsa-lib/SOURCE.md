# Pulse shim 0.2.9 (Soloist → ALSA)

Purpose-driven `libpulse.so.0`. Soloist dlopens this name. The library
implements the 47 `pa_*` symbols that binary looks up (see `shim/ABI.txt`)
and writes FLOAT32 into `plug:volumio`. The outer plug converts to the
slave. It is not apulse and not a Pulse server.

Library version is **0.2.9** (`shim/CMakeLists.txt`). There is no tag pin:
the source is `shim/` in this repository.

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

## Build

```
./build-matrix.sh
```

Single arch:

```
./docker/run-docker-shim.sh amd64
```

The container is Debian Bookworm. Runtime link is `libasound` and libc only.
`SOURCE_REVISION` is the git HEAD of this repository that produced the `.so`.
Rebuild the matrix after committing shim sources so that file names the
commit, not an earlier HEAD.
