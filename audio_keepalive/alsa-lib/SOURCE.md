# Audio Keepalive binaries

Pre-built per architecture: the thin ALSA PCM client and the mix daemon.

## Layout

ALSA client (`libasound_module_pcm_keepalive.so`):

- **alsa-lib/armhf/** — 32-bit ARM (Raspberry Pi)
- **alsa-lib/aarch64/** — 64-bit ARM
- **alsa-lib/amd64/** — x86_64

Daemon (`audio-keepalive-daemon`):

- **bin/armhf/**
- **bin/aarch64/**
- **bin/amd64/**

install.sh copies the matching `.so` into the system ALSA plugin directory
and the daemon to `/usr/bin/audio-keepalive-daemon`.

## Source

Built from [alsa-pcm-keepalive](https://github.com/foonerd/alsa-pcm-keepalive).

License: GPL-2.0-or-later

## Audible test sentinel

Create `/data/keepalive` while the daemon is running to make the mix
hiss audible (-30 dB, or the dB value written in the file). Remove the
file to return to the normal -100 dB idle level.
