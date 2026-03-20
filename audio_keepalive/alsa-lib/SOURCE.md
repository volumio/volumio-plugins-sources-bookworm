# ALSA keepalive plugin binaries

Pre-built shared objects per architecture.

## Layout

- **armhf/** - `libasound_module_pcm_keepalive.so` (32-bit ARM, Raspberry Pi)
- **amd64/** - `libasound_module_pcm_keepalive.so` (x86_64)

install.sh copies the appropriate .so into the system ALSA plugin directory.

## Source

Built from [alsa-pcm-keepalive](https://github.com/foonerd/alsa-pcm-keepalive).

License: GPL-2.0-or-later
