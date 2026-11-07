# `alsa-rme-adi2-volume-control` Service Executable

This directory contains the service executable (binaries)
for the architectures supported by Volumio:

- `amd64` (aka `x86_64`): AMD/Intel 64-bit processors
- `armhf` (aka `arm`, `armv7l`, `armv8l`, `aarch64`, `arm64`): 32-bit user-land for 32-bit or 64-bit ARM processors

```
service/bin
├── amd64
│   └── alsa-rme-adi2-volume-control
├── armhf
│   └── alsa-rme-adi2-volume-control
└── README.md
```

The binary files have been compiled by the authort on suitable machines,
corresponding to the above architectures,
using the source code from the
[alsa-rme-adi2-volume-control GitHub repository](https://github.com/pettarin/alsa-rme-adi2-volume-control),
specifically:

```bash
alsa-rme-adi2-volume-control --version
alsa-rme-adi2-volume-control 1.0.0 (build 2026-11-05)
```
