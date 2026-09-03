#!/usr/bin/env python3
import fcntl
import os
import sys

def hid_iocsfeature(length):
    IOC_NRBITS = 8; IOC_TYPEBITS = 8; IOC_SIZEBITS = 14; IOC_NRSHIFT = 0
    IOC_TYPESHIFT = IOC_NRSHIFT + IOC_NRBITS
    IOC_SIZESHIFT = IOC_TYPESHIFT + IOC_TYPEBITS
    IOC_DIRSHIFT = IOC_SIZESHIFT + IOC_SIZEBITS
    IOC_WRITE = 1; IOC_READ = 2
    return ((IOC_READ | IOC_WRITE) << IOC_DIRSHIFT) | (ord('H') << IOC_TYPESHIFT) | (0x06 << IOC_NRSHIFT) | (length << IOC_SIZESHIFT)

def main():
    if len(sys.argv) != 4:
        print('usage: set-dial-feature.py /dev/hidrawX STEPS HAPTICS', file=sys.stderr); return 2
    device = sys.argv[1]
    steps = max(1, min(0xFFFF, int(sys.argv[2])))
    haptics = sys.argv[3].lower() in ('1', 'true', 'yes', 'on')
    report = bytearray([0x01, steps & 0xFF, (steps >> 8) & 0xFF, 0x00, 0x03 if haptics else 0x02, 0x00, 0x00, 0x00])
    fd = os.open(device, os.O_RDWR | os.O_NONBLOCK)
    try: fcntl.ioctl(fd, hid_iocsfeature(len(report)), report, True)
    finally: os.close(fd)
    return 0

if __name__ == '__main__': raise SystemExit(main())
