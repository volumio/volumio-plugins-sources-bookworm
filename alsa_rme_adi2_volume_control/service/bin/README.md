# `alsa-rme-adi2-volume-control` Service Executable

This directory contains the service executable files (binaries)
`alsa-rme-adi2-volume-control`
for the architectures supported by Volumio 4:

- `amd64` (aka `x86_64`): AMD/Intel 64-bit processors
- `armhf` (aka `arm`, `armv7l`, `armv8l`, `aarch64`, `arm64`): 32-bit user-land for 32-bit or 64-bit ARM processors

```bash
tree .
.
├── amd64
│   └── alsa-rme-adi2-volume-control
├── armhf
│   └── alsa-rme-adi2-volume-control
└── README.md

sha256sum amd64/alsa-rme-adi2-volume-control
d0647a572dd6b236fdad092f4d8e3132bbe2740b3aa0f818d2a5668f9f51b568  amd64/alsa-rme-adi2-volume-control

file amd64/alsa-rme-adi2-volume-control
amd64/alsa-rme-adi2-volume-control: ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, BuildID[sha1]=375558154773b328a9b811f5220f148e74295f26, for GNU/Linux 3.2.0, not stripped

sha256sum armhf/alsa-rme-adi2-volume-control
ba819aec56619d7ad040400deccdcef60b30a10baca87e9273206472ac7433cc  armhf/alsa-rme-adi2-volume-control

file armhf/alsa-rme-adi2-volume-control
armhf/alsa-rme-adi2-volume-control: ELF 32-bit LSB executable, ARM, EABI5 version 1 (SYSV), dynamically linked, interpreter /lib/ld-linux-armhf.so.3, BuildID[sha1]=8c11271c3527041f365c48144de8017f330d9ad7, for GNU/Linux 3.2.0, not stripped
```

The binary files have been compiled by the author on suitable machines,
corresponding to the above architectures,
using the source code from the
[alsa-rme-adi2-volume-control GitHub repository](https://github.com/pettarin/alsa-rme-adi2-volume-control),
from the following release:

```bash
alsa-rme-adi2-volume-control --version
alsa-rme-adi2-volume-control 1.0.0 (build 2026-11-05)
```
