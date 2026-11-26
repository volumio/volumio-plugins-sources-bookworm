/* Vinyltron build helper (MIT, see repo LICENSE).
 * Minimal Imaging.h stub for rpi-rgb-led-matrix's (GPL-2.0) Pillow shim.
 * Defines only the ImagingMemoryInstance fields needed by pillow.c.
 * Layout matches Pillow 5.x-9.x on 32-bit ARM (Pi 3B). */
#ifndef IMAGING_H
#define IMAGING_H

#define IMAGING_MODE_LENGTH (6+1)

typedef unsigned char UINT8;
typedef int INT32;

typedef void *ImagingPalette;

struct ImagingMemoryInstance {
    char mode[IMAGING_MODE_LENGTH]; /* e.g. "RGB" */
    int type;
    int depth;
    int bands;
    int xsize;
    int ysize;
    ImagingPalette palette;
    UINT8 **image;
    INT32 **image32;
};

#endif
