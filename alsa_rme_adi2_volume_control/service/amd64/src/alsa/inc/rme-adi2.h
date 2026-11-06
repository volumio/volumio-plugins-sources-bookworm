/*
 * alsa-rme-adi2-volume-control - Service exposing ALSA mute/volume controls on an RME ADI-2 device via MIDI
 *   Copyright (C) 2026  Alberto Pettarin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef RME_ADI2_H
#define RME_ADI2_H

/* From https://forum.rme-audio.de/viewtopic.php?pid=254806#p254806 :
 *
 * [After the introduction of the EX models in 2026]
 * The Device IDs are unchanged:
 *
 * 0x71    ADI-2 DAC FS
 * 0x72    ADI-2 Pro series (AE, EX, FS, FS BE)
 * 0x73    ADI-2/4 Pro series (EX, SE)
 *
 * The Pro is identical in functionality.
 * The 2/4 Pro EX has digital input gain and RIAA-off option, plus input impedance choice.
 * To know if SE or EX is connected the 'device revision' is used (status message byte 6).
 * Updated MIDI tables will be published as soon as the 2/4 Pro EX is available.
 *
 */

/* RME device IDs */
#define RME_DEVICE_FAMILY_ADI2_DAC      0x71
#define RME_DEVICE_ADI2_DAC_FS          0x71

#define RME_DEVICE_FAMILY_ADI2_PRO      0x72
#define RME_DEVICE_ADI2_PRO_AE          0x72
#define RME_DEVICE_ADI2_PRO_EX          0x72
#define RME_DEVICE_ADI2_PRO_FS          0x72
#define RME_DEVICE_ADI2_PRO_FS_BE       0x72

#define RME_DEVICE_FAMILY_ADI24_PRO     0x73
#define RME_DEVICE_ADI24_PRO_EX         0x73
#define RME_DEVICE_ADI24_PRO_SE         0x73

/* RME output parameters */
#define RME_PARAM_LINE                  0x1B
#define RME_PARAM_PHONES                0x4B

/* RME mute off/on values */
#define RME_PARAM_MUTE                  0x60
#define RME_VALUE_MUTE_OFF              0x00
#define RME_VALUE_MUTE_ON               0x01

/* RME SysEx constants */
#define RME_SYSEX_START                 0xF0
#define RME_SYSEX_MANUFACTURER_ID_0     0x00        /* RME manufacturer ID spans 3 bytes */
#define RME_SYSEX_MANUFACTURER_ID_1     0x20
#define RME_SYSEX_MANUFACTURER_ID_2     0x0D
#define RME_SYSEX_COMMAND_SET           0x02
#define RME_SYSEX_COMMAND_GET           0x03
#define RME_SYSEX_END                   0xF7

/* RME volume min/max values */
#define RME_VALUE_VOLUME_MIN_DB         (-93.8)
#define RME_VALUE_VOLUME_MIN            3158        /* 3158 == -93.8 * 10 + 4096 */
#define RME_VALUE_VOLUME_MAX_DB         (6.0)
#define RME_VALUE_VOLUME_MAX            4156        /* 4156 == 6.0 * 10 + 4096 */

#endif /* RME_ADI2_H guard */
