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
#include "rme-adi2.h"
#endif

#ifndef ALSA_RME_ADI2_VOLUME_CONTROL_H
#define ALSA_RME_ADI2_VOLUME_CONTROL_H

/* Program version */
#define PROGRAM_VERSION                             "1.0.0"
#define PROGRAM_BUILD_DATE                          "2026-11-05"

/* Boolean values */
#define BOOL_FALSE                                  0
#define BOOL_TRUE                                   1
#define BOOL_IS_TRUE(x)                             ((x) == BOOL_TRUE)
#define BOOL_IS_FALSE(x)                            (! BOOL_IS_TRUE(x))
#define BOOL_IS_VALID(x)                            (((x) == BOOL_TRUE) || ((x) == BOOL_FALSE))

/* Error codes: 0 is OK, anything else is an error */
#define ERR_OK                                      0
#define ERR_ERROR_GENERIC                           (-1)
#define ERR_ERROR_EVENT_POLL                        (-2)
#define ERR_ERROR_SOUND_CARD_DISCONNECTED           (-3)
#define ERR_CODE_IS_OK(x)                           ((x) == ERR_OK)
#define ERR_CODE_IS_ERROR(x)                        (! ERR_CODE_IS_OK(x))

/* ALSA error codes: 0 is OK, any negative value is an error */
#define ERR_ALSA_OK                                 0
#define ERR_ALSA_CODE_IS_OK(x)                      ((x) == ERR_ALSA_OK)
#define ERR_ALSA_CODE_IS_ERROR(x)                   ((x) < ERR_ALSA_OK)

/* Exit codes for the whole service (0 OK, >1 error) */
#define EXIT_OK                                     0
#define EXIT_ERROR_GENERIC                          1
#define EXIT_ERROR_USAGE_BAD_OPTION                 2
#define EXIT_ERROR_USAGE_BAD_VALUE                  3
#define EXIT_ERROR_CANNOT_FIND_CARD                 4
#define EXIT_ERROR_CANNOT_OPEN_CARD                 5
#define EXIT_ERROR_CANNOT_FIND_MIDI_DEVICE          6
#define EXIT_ERROR_CANNOT_OPEN_MIDI_DEVICE          7
#define EXIT_ERROR_CANNOT_ADD_CONTROL               8
#define EXIT_ERROR_GENERIC_IN_MONITOR_LOOP          9
#define EXIT_ERROR_EVENT_POLL                       10
#define EXIT_ERROR_SOUND_CARD_DISCONNECTED          11

/* ALSA User-defined control elements.
 *
 * The names must be
 * "prefix Playback Volume" and "prefix Playback Switch"
 * for ALSA to recognize them as
 * a single volume+mute switch combination named "prefix",
 * e.g. in how they appear in the alsamixer TUI.
 *
 * Note that "Playback" is necessary, otherwise the controls
 * will also act for capture (recording), not just playback.
 * */
#define UDCE_LINE12_VOLUME_NAME                     "Line Output 1/2 Playback Volume"
#define UDCE_LINE12_SWITCH_NAME                     "Line Output 1/2 Playback Switch"
#define UDCE_PHONES34_VOLUME_NAME                   "Phones Output 3/4 Playback Volume"
#define UDCE_PHONES34_SWITCH_NAME                   "Phones Output 3/4 Playback Switch"

/* Constants used in strn* functions and struct declarations */
#define CARD_HW_MAX_LENGTH                          32                          /* Max length, in bytes, of an ALSA hw string */
#define CARD_NAME_MAX_LENGTH                        1024                        /* Max length, in bytes, of an ALSA card name */
#define DEVICE_NAME_MAX_LENGTH                      128                         /* Max length, in bytes, of an RME device name */
#define MIDI_DEVICE_MAX_LENGTH                      32                          /* Max length, in bytes, of a MIDI device (hw:N,x,y) */
#define MIDI_DEVICE_PROBE_MIN_INDEX                 0                           /* Min index for MIDI device/subdevice to probe, included */
#define MIDI_DEVICE_PROBE_MAX_INDEX                 9                           /* Max index for MIDI device/subdevice to probe, included */
#define UDCE_NAME_MAX_LENGTH                        128                         /* Max length, in bytes, of an ALSA user-defined control element */

/* Volume ranges for the ALSA user-defined control elements */
#define VOL_MIN                                     0                           /* Min volume for the ALSA user-defined control elements */
#define VOL_MAX                                     100                         /* Max volume for the ALSA user-defined control elements */

/* Hardcoded/special values for CLI/service configuration */
#define CARD_HW_NOT_SET                             ""
#define CARD_NUMBER_NOT_SET                         (-1)
#define DEVICE_ID_NOT_SET                           (-1)
#define DEVICE_NAME_AUTODETECT                      "autodetect"
#define DEVICE_NAME_RME_ADI2_DAC                    "ADI-2 DAC"
#define DEVICE_NAME_RME_ADI2_PRO                    "ADI-2 Pro"
#define DEVICE_NAME_RME_ADI24_PRO                   "ADI-2/4 Pro"
#define INITIAL_VOLUME_VALUE_NOT_SET                (-1)
#define INITIAL_SWITCH_VALUE_NOT_SET                (-1)
#define MIDI_DEVICE_AUTODETECT                      "autodetect"

/* CLI/service configuration default values */
#define DEFAULT_CARD_HW                             CARD_HW_NOT_SET
#define DEFAULT_CARD_NUMBER                         CARD_NUMBER_NOT_SET
#define DEFAULT_DEVICE_ID                           DEVICE_ID_NOT_SET
#define DEFAULT_DEVICE_NAME                         DEVICE_NAME_AUTODETECT
#define DEFAULT_LIST_CARDS                          BOOL_FALSE
#define DEFAULT_LIST_DEVICE_IDS                     BOOL_FALSE
#define DEFAULT_LIST_DEVICE_NAMES                   BOOL_FALSE
#define DEFAULT_LIST_MIDI_DEVICES                   BOOL_FALSE
#define DEFAULT_MIDI_DEVICE                         MIDI_DEVICE_AUTODETECT
#define DEFAULT_PRINT_LICENSE                       BOOL_FALSE
#define DEFAULT_PRINT_USAGE                         BOOL_FALSE
#define DEFAULT_PRINT_VERSION                       BOOL_FALSE
#define DEFAULT_UNINSTALL                           BOOL_FALSE
#define DEFAULT_UNINSTALL_ON_EXIT                   BOOL_TRUE
#define DEFAULT_VERBOSE_LOG                         BOOL_FALSE

#define DEFAULT_LINE12_CONTROL                      BOOL_TRUE                   /* Default value of the line 1/2 output control: true (create) or false (do not create) */
#define DEFAULT_LINE12_STARTUP_VOLUME_VALUE         50                          /* Default statup volume for line 1/2 output (50 == 50% of [0, 100]); use -1 to read device state */
#define DEFAULT_LINE12_STARTUP_SWITCH_VALUE         BOOL_TRUE                   /* Default value of the line 1/2 output switch: true (mute off) or false (mute on); use -1 to read device state */
#define DEFAULT_LINE12_VOLUME_MAX_DB                (-10.0)                     /* Default max volume, in dB, for line 1/2 output */
#define DEFAULT_LINE12_VOLUME_MIN_DB                (-60.0)                     /* Default min volume, in dB, for line 1/2 output */

#define DEFAULT_PHONES34_CONTROL                    BOOL_TRUE                   /* Default value of the phones 3/4 output control: true (create) or false (do not create) */
#define DEFAULT_PHONES34_STARTUP_VOLUME_VALUE       50                          /* Default statup volume for phones 3/4 output (50 == 50% of [0, 100]); use -1 to read device state */
#define DEFAULT_PHONES34_STARTUP_SWITCH_VALUE       BOOL_TRUE                   /* Default value of the phones 3/4 output switch: true (mute off) or false (mute on); use -1 to read device state */
#define DEFAULT_PHONES34_VOLUME_MAX_DB              (-10.0)                     /* Default max volume, in dB, for phones 3/4 output */
#define DEFAULT_PHONES34_VOLUME_MIN_DB              (-60.0)                     /* Default min volume, in dB, for phones 3/4 output */


#endif /* ALSA_RME_ADI2_VOLUME_CONTROL_H guard */

