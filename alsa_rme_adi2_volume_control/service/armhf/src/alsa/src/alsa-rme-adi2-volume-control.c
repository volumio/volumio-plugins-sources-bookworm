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

#include <stdio.h>                          /* for stderr, stdout, etc. */
#include <stdlib.h>                         /* for atof, atoi, etc. */
#include <string.h>                         /* for str* */
#include <signal.h>                         /* for sig* */
#include <unistd.h>                         /* for optarg */
#include <getopt.h>                         /* for getopt_long() */
#include <poll.h>                           /* for poll() */
#include <errno.h>                          /* for errno, EINTR */
#include <alsa/asoundlib.h>                 /* for snd* */

#include "rme-adi2.h"                       /* RME ADI-2 specific constants */
#include "alsa-rme-adi2-volume-control.h"   /* service constants and macros */


/* *************************************************************************
 * Local type declarations
 * ************************************************************************* */

typedef struct {
    char szDeviceName[64];
    unsigned char chDeviceID;
} DeviceIDWithName;

typedef struct {
    snd_ctl_elem_id_t *pVolumeID;
    snd_ctl_elem_id_t *pSwitchID;
    char szUDCEVolumeName[UDCE_NAME_MAX_LENGTH];
    char szUDCESwitchName[UDCE_NAME_MAX_LENGTH];
    double dVolumeMaxDB;
    double dVolumeMinDB;
    int bInitialized;
    int bSwitch;
    int bSwitchLast;
    int iVolume;
    int iVolumeLast;
    unsigned char chRMEDeviceID;
    unsigned char chRMEOutput;
} OutputControl;

typedef struct {
    char szUDCEVolumeName[UDCE_NAME_MAX_LENGTH];
    char szUDCESwitchName[UDCE_NAME_MAX_LENGTH];
    double dMinDB;
    double dMaxDB;
    int bControl;
    int iStartupVolume;
    int bStartupSwitch;
    unsigned char chRMEOutput;
} OutputParameters;

typedef struct {
    OutputParameters stLine12;
    OutputParameters stPhones34;
    char szCardHw[CARD_HW_MAX_LENGTH];
    char szMIDIDevice[MIDI_DEVICE_MAX_LENGTH];
    char szDeviceName[DEVICE_NAME_MAX_LENGTH];
    int iCardNumber;
    int iDeviceID;
    int bListCards;
    int bListDeviceIDs;
    int bListDeviceNames;
    int bListMIDIDevices;
    int bPrintLicense;
    int bPrintUsage;
    int bPrintVersion;
    int bUninstall;
    int bUninstallOnExit;
    int bVerboseLog;
} ServiceConfiguration;

typedef struct {
    char szOptionName[64];
    double dValue;
} StringDoublePair;

typedef struct {
    char szOptionName[64];
    double iValue;
} StringIntegerPair;


/* *************************************************************************
 * Global state variables
 * ************************************************************************* */

/* Flag tracking whether the service is running or not */
static volatile sig_atomic_t gbServiceIsRunning = (sig_atomic_t)BOOL_TRUE;

/* Service configuration */
static ServiceConfiguration gpConfiguration = {
    .stLine12 = {
        .szUDCEVolumeName = UDCE_LINE12_VOLUME_NAME,
        .szUDCESwitchName = UDCE_LINE12_SWITCH_NAME,
        .dMinDB = DEFAULT_LINE12_VOLUME_MIN_DB,
        .dMaxDB = DEFAULT_LINE12_VOLUME_MAX_DB,
        .bControl = DEFAULT_LINE12_CONTROL,
        .iStartupVolume = DEFAULT_LINE12_STARTUP_VOLUME_VALUE,
        .bStartupSwitch = DEFAULT_LINE12_STARTUP_SWITCH_VALUE,
        .chRMEOutput = RME_PARAM_LINE
    },
    .stPhones34 = {
        .szUDCEVolumeName = UDCE_PHONES34_VOLUME_NAME,
        .szUDCESwitchName = UDCE_PHONES34_SWITCH_NAME,
        .dMinDB = DEFAULT_PHONES34_VOLUME_MIN_DB,
        .dMaxDB = DEFAULT_PHONES34_VOLUME_MAX_DB,
        .bControl = DEFAULT_PHONES34_CONTROL,
        .iStartupVolume = DEFAULT_PHONES34_STARTUP_VOLUME_VALUE,
        .bStartupSwitch = DEFAULT_PHONES34_STARTUP_SWITCH_VALUE,
        .chRMEOutput = RME_PARAM_PHONES
    },
    .szCardHw = DEFAULT_CARD_HW,
    .szMIDIDevice = DEFAULT_MIDI_DEVICE,
    .szDeviceName = DEFAULT_DEVICE_NAME,
    .iCardNumber = DEFAULT_CARD_NUMBER,
    .iDeviceID = DEFAULT_DEVICE_ID,
    .bListCards = DEFAULT_LIST_CARDS,
    .bListDeviceIDs = DEFAULT_LIST_DEVICE_IDS,
    .bListDeviceNames = DEFAULT_LIST_DEVICE_NAMES,
    .bListMIDIDevices = DEFAULT_LIST_MIDI_DEVICES,
    .bPrintLicense = DEFAULT_PRINT_LICENSE,
    .bPrintUsage = DEFAULT_PRINT_USAGE,
    .bPrintVersion = DEFAULT_PRINT_VERSION,
    .bUninstall = DEFAULT_UNINSTALL,
    .bUninstallOnExit = DEFAULT_UNINSTALL_ON_EXIT,
    .bVerboseLog = DEFAULT_VERBOSE_LOG
};


/* *************************************************************************
 * Log helpers
 * ************************************************************************* */

static void log_info(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "[INFO] ");
    vfprintf(stdout, fmt, ap);
    fprintf(stdout, "\n");
    fflush(stdout);
    va_end(ap);
}

static void log_error(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "[ERRO] ");
    vfprintf(stderr, fmt, ap);
    fprintf(stderr, "\n");
    fflush(stderr);
    va_end(ap);
}

static void log_verbose(const char *fmt, ...) {
    if (BOOL_IS_FALSE(gpConfiguration.bVerboseLog)) {
        return;
    }
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "[DEBU] ");
    vfprintf(stdout, fmt, ap);
    fprintf(stdout, "\n");
    fflush(stdout);
    va_end(ap);
}


/* *************************************************************************
 * String helpers
 * ************************************************************************* */

/* strnstr is not part of the GNU stdlib, but from the BSD stdlib:
 * define it here instead of depending on the latter */
static char *strnstr(const char *haystack, const char *needle, size_t len) {
    size_t needle_len = strnlen(needle, len);
    if (needle_len == 0) {
        return (char *)haystack;
    }
    while (len >= needle_len && *haystack) {
        if (memcmp(haystack, needle, needle_len) == 0) {
            return (char *)haystack;
        }
        haystack++;
        len--;
    }
    return NULL;
}


/* *************************************************************************
 * ALSA card helpers
 * ************************************************************************* */

/* Print the list of cards as a table with colums (Index, ID, Name). */
static void print_cards() {
    int iCard = -1;
    char *szCardName;

    printf("Index\tID\tName\n");
    while ((snd_card_next(&iCard) >= 0) && (iCard >= 0)) {
        if (ERR_ALSA_CODE_IS_ERROR(snd_card_get_name(iCard, &szCardName))) {
            /* ignore error and continue looping over the available cards */
            continue;
        }
        if (szCardName == NULL) {
            continue;
        }
        printf("%d\thw:%d\t%s\n", iCard, iCard, szCardName);
        free(szCardName);
    }
}

/* Find the card number of a card whose name contains the given query string,
 * returning it.
 *
 * The first (lowest card number) non-negative match is returned.
 *
 * If no match is found, return -1. */
static int find_card_by_name(const char *szQuery) {
    int iCard = -1;
    char *szCardName;

    log_verbose("Find ALSA card by name matching query '%s'", szQuery);

    while ((snd_card_next(&iCard) >= 0) && (iCard >= 0)) {
        if (snd_card_get_name(iCard, &szCardName) < 0) {
            continue;
        }
        if (szCardName == NULL) {
            continue;
        }

        log_verbose(
            "Discovered ALSA card number '%d' with name '%s'",
            iCard,
            szCardName
        );

        /* NOTE: matching szQuery as substring of szCardName */
        if (strnstr(szCardName, szQuery, CARD_NAME_MAX_LENGTH) != NULL) {
            log_verbose(
                "ALSA card number '%d' with name '%s' "
                "matches the query '%s': returning it",
                iCard,
                szCardName,
                szQuery
            );
            free(szCardName);
            return iCard;
        }

        /* no match: free szCardName and continue looping */
        free(szCardName);
    }

    /* no match found: log and return -1 to signal failure */
    log_verbose(
        "No ALSA card found whose name matches the query '%s'",
        szQuery
    );
    return -1;
}

/* Find the first card corresponding to the given device name and ID:
 * return true if found, otherwise return false. */
static int find_card_and_set_configuration(
    const char *szDeviceName,
    int iDeviceID
) {
    int iCardNumber = find_card_by_name(szDeviceName);
    if (iCardNumber < 0) {
        /* card not found */
        return BOOL_FALSE;
    }

    /* card found */
    gpConfiguration.iDeviceID = iDeviceID;
    gpConfiguration.iCardNumber = iCardNumber;
    strncpy(
        gpConfiguration.szDeviceName,
        szDeviceName,
        DEVICE_NAME_MAX_LENGTH - 1
    );
    log_verbose(
        "Found ALSA card number '%d' for device ID '0x%02X' (%s)",
        iCardNumber,
        iDeviceID,
        szDeviceName
    );
    return BOOL_TRUE;
}

/* Partials for the various ADI-2 product families. */
static int find_card_and_set_configuration_rme_adi24_pro() {
    return find_card_and_set_configuration(
        DEVICE_NAME_RME_ADI24_PRO,
        RME_DEVICE_FAMILY_ADI24_PRO
    );
}

static int find_card_and_set_configuration_rme_adi2_pro() {
    return find_card_and_set_configuration(
        DEVICE_NAME_RME_ADI2_PRO,
        RME_DEVICE_FAMILY_ADI2_PRO
    );
}

static int find_card_and_set_configuration_rme_adi2_dac() {
    return find_card_and_set_configuration(
        DEVICE_NAME_RME_ADI2_DAC,
        RME_DEVICE_FAMILY_ADI2_DAC
    );
}

static int device_name_is_autodetect_or_rme_adi24_pro() {
    return (
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_AUTODETECT,
            DEVICE_NAME_MAX_LENGTH
        ) == 0) ||
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_RME_ADI24_PRO,
            DEVICE_NAME_MAX_LENGTH
        ) == 0)
    );
}

static int device_name_is_autodetect_or_rme_adi2_pro() {
    return (
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_AUTODETECT,
            DEVICE_NAME_MAX_LENGTH
        ) == 0) ||
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_RME_ADI2_PRO,
            DEVICE_NAME_MAX_LENGTH
        ) == 0)
    );
}

static int device_name_is_autodetect_or_rme_adi2_dac() {
    return (
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_AUTODETECT,
            DEVICE_NAME_MAX_LENGTH
        ) == 0) ||
        (strncmp(
            gpConfiguration.szDeviceName,
            DEVICE_NAME_RME_ADI2_DAC,
            DEVICE_NAME_MAX_LENGTH
        ) == 0)
    );
}

/* Determine the device ID if the user did not specify it explicitly,
 * searching for a matching card using the device name.
 *
 * If the device name is "autodetect",
 * try all supported ADI-2 product families, in the appropriate order.
 *
 * The first matching card found (lowest card number) is set and used.
 *
 * Return true if a matching card is found; otherwise return false. */
static int ensure_device_id_is_set() {
    if (gpConfiguration.iDeviceID >= 0) {
        log_verbose(
            "Device ID '0x%02X' explicitly specified by the user",
            gpConfiguration.iDeviceID
        );
        return BOOL_TRUE;
    }

    log_verbose(
        "Find ALSA card number and device ID from device name '%s'",
        gpConfiguration.szDeviceName
    );

    if (
        BOOL_IS_TRUE(device_name_is_autodetect_or_rme_adi24_pro()) &&
        BOOL_IS_TRUE((find_card_and_set_configuration_rme_adi24_pro()))
    ) {
        return BOOL_TRUE;
    }

    if (
        BOOL_IS_TRUE(device_name_is_autodetect_or_rme_adi2_pro()) &&
        BOOL_IS_TRUE((find_card_and_set_configuration_rme_adi2_pro()))
    ) {
        return BOOL_TRUE;
    }

    if (
        BOOL_IS_TRUE(device_name_is_autodetect_or_rme_adi2_dac()) &&
        BOOL_IS_TRUE((find_card_and_set_configuration_rme_adi2_dac()))
    ) {
        return BOOL_TRUE;
    }

    return BOOL_FALSE;
}

/* Determine the card number if the user did not specify it explicitly,
 * searching for a card whose name matches the device ID.
 *
 * Return true if a matching card is found; otherwise return false. */
static int ensure_card_number_is_set() {
    int bCardFound = BOOL_FALSE;

    if (gpConfiguration.iCardNumber >= 0) {
        log_verbose(
            "ALSA card number '%d' explicitly specified by the user "
            "or already determined",
            gpConfiguration.iCardNumber
        );
        return BOOL_TRUE;
    }

    switch (gpConfiguration.iDeviceID) {
        case RME_DEVICE_FAMILY_ADI24_PRO:
            bCardFound = find_card_and_set_configuration_rme_adi24_pro();
            break;
        case RME_DEVICE_FAMILY_ADI2_PRO:
            bCardFound = find_card_and_set_configuration_rme_adi2_pro();
            break;
        case RME_DEVICE_FAMILY_ADI2_DAC:
            bCardFound = find_card_and_set_configuration_rme_adi2_pro();
            break;
        default:
            log_verbose(
                "gpConfiguration.iDeviceID has unsupported value '%d'",
                gpConfiguration.iDeviceID
            );
            break;
    }

    return bCardFound;
}

/* Determine the device ID and card number
 * if the user did not specify them.
 *
 * See the two helper functions:
 *
 * - ensure_device_id_is_set()
 * - ensure_card_number_is_set()
 *
 * for the details of the probing.
 *
 * Return ERR_OK if both the device ID and the card number
 * could be determined, otherwise return an error. */
static int ensure_device_id_and_card_number() {
    int bCardFound = BOOL_FALSE;

    bCardFound = ensure_device_id_is_set();
    if (BOOL_IS_FALSE(bCardFound)) {
        log_error(
            "Cannot find an ALSA card matching device name '%s'",
            gpConfiguration.szDeviceName
        );
        return ERR_ERROR_GENERIC;
    }

    bCardFound = ensure_card_number_is_set();
    if (BOOL_IS_FALSE(bCardFound)) {
        log_error(
            "Cannot find an ALSA card matching device id '0x%02X'",
            gpConfiguration.iDeviceID
        );
        return ERR_ERROR_GENERIC;
    }

    return ERR_OK;
}

/* Set the card hw string from the card number */
static void set_card_hw_string() {
    snprintf(
        gpConfiguration.szCardHw,
        CARD_HW_MAX_LENGTH,
        "hw:%d",
        gpConfiguration.iCardNumber
    );
}

/* *************************************************************************
 * ALSA user-defined control elements helpers
 * ************************************************************************* */

/* Uninstall an ALSA user-defined control element (UDCE)
 * specified by name from the given card ctl. */
static int uninstall_alsa_udce_by_name(
    snd_ctl_t *ctl,
    const char *szName
) {
    snd_ctl_elem_id_t *id;
    snd_ctl_elem_id_alloca(&id);
    snd_ctl_elem_id_set_interface(id, SND_CTL_ELEM_IFACE_MIXER);
    snd_ctl_elem_id_set_name(id, szName);
    int iRet = ERR_OK;

    iRet = snd_ctl_elem_remove(ctl, id);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_verbose("Unable to remove control with name '%s'", szName);
        return ERR_ERROR_GENERIC;
    }

    log_verbose("Removed control with name '%s'", szName);
    return ERR_OK;
}

/* Uninstall all ALSA user-defined control elements (UDCEs)
 * from the given card ctl. */
static void uninstall_all_alsa_udce_s(snd_ctl_t *ctl) {
    const char *gszUDCENames[] = {
        gpConfiguration.stLine12.szUDCEVolumeName,
        gpConfiguration.stLine12.szUDCESwitchName,
        gpConfiguration.stPhones34.szUDCEVolumeName,
        gpConfiguration.stPhones34.szUDCESwitchName
    };
    int iRemovedCount = 0;
    int iRet = ERR_OK;

    if (ctl == NULL) {
        return;
    }

    size_t cCount = sizeof(gszUDCENames) / sizeof(gszUDCENames[0]);
    for (size_t i = 0; i < cCount; i++) {
        iRet = uninstall_alsa_udce_by_name(ctl, gszUDCENames[i]);
        if (ERR_CODE_IS_OK(iRet)) {
            iRemovedCount += 1;
        }
    }
    log_verbose(
        "Removed %d out of %d user-defined control element(s)",
        iRemovedCount,
        cCount
    );
}

/* Install a new control (identified by id and szName) on the card ctl.
 * The control is a boolean switch (mute) if bElementIsSwitch is true,
 * otherwise it is an integer value (volume). */
static int install_control_element(
    snd_ctl_t *ctl,
    snd_ctl_elem_id_t *id,
    const char *szName,
    int iInitialValue,
    int bElementIsSwitch
) {
    snd_ctl_elem_info_t *info = NULL;
    snd_ctl_elem_value_t *value = NULL;
    int iRet = ERR_OK;

    /* Set up element ID */
    snd_ctl_elem_info_alloca(&info);
    snd_ctl_elem_id_set_interface(id, SND_CTL_ELEM_IFACE_MIXER);
    snd_ctl_elem_id_set_name(id, szName);
    snd_ctl_elem_info_set_id(info, id);

    /* Create new control */
    snd_ctl_elem_info_set_id(info, id);
    if (BOOL_IS_TRUE(bElementIsSwitch)) {
        iRet = snd_ctl_add_boolean_elem_set(
            ctl,
            info,
            1,      /* element_count */
            1       /* member_count */
        );
    } else {
        iRet = snd_ctl_add_integer_elem_set(
            ctl,
            info,
            1,          /* element_count */
            1,          /* member_count */
            VOL_MIN,    /* min */
            VOL_MAX,    /* max */
            1           /* step */
        );
    }
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Failed to create control '%s': %s",
            szName,
            snd_strerror(iRet)
        );
        goto cleanup;
    }
    snd_ctl_elem_id_set_numid(id, 0);
    snd_ctl_elem_info_set_id(info, id);
    iRet = snd_ctl_elem_info(ctl, info);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot find the created control '%s': %s",
            szName,
            snd_strerror(iRet)
        );
        goto cleanup;
    }
    snd_ctl_elem_info_get_id(info, id);
    log_verbose(
        "Created the control element '%s' with numid '%u'",
        szName,
        snd_ctl_elem_id_get_numid(id)
    );

    /* Set the initial value */
    snd_ctl_elem_value_alloca(&value);
    snd_ctl_elem_value_set_id(value, id);
    if (BOOL_IS_TRUE(bElementIsSwitch)) {
        snd_ctl_elem_value_set_boolean(value, 0, iInitialValue);
    } else {
        snd_ctl_elem_value_set_integer(value, 0, iInitialValue);
    }
    iRet = snd_ctl_elem_write(ctl, value);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Failed to set initial value of '%s': %s",
            szName,
            snd_strerror(iRet)
        );
        goto cleanup;
    }

    /* Unlock the control so other processes can write to it */
    iRet = snd_ctl_elem_unlock(ctl, id);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Unlock of '%s' failed: %s",
            szName,
            snd_strerror(iRet)
        );
        goto cleanup;
    }

    iRet = ERR_OK;

cleanup:
    if (ERR_CODE_IS_ERROR(iRet)) {
        /* NOTE: call the snd_ctl_elem_*_free() only in case of errors,
         *       otherwise the removal of the control elements
         *       during the cleanup of the main()
         *       will produce a double-free! */
        if (value) {
            snd_ctl_elem_value_free(value);
        }
        if (info) {
            snd_ctl_elem_info_free(info);
        }
    }
    return iRet;
}

/* read the value of an ALSA user-defined control element */
static int read_alsa_udce_value(
    snd_ctl_t *ctl,
    snd_ctl_elem_id_t *id,
    snd_ctl_elem_value_t **pValue
) {
    int iRet = ERR_OK;
    if (pValue == NULL) {
        return ERR_ERROR_GENERIC;
    }
    if (*pValue == NULL) {
        return ERR_ERROR_GENERIC;
    }
    snd_ctl_elem_value_set_id(*pValue, id);
    iRet = snd_ctl_elem_read(ctl, *pValue);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        return ERR_ERROR_GENERIC;
    }
    return ERR_OK;
}

/* read the integer value of an ALSA user-defined control element */
static int read_alsa_udce_integer_value(
    snd_ctl_t *ctl,
    snd_ctl_elem_id_t *id,
    int *piValue
) {
    int iRet = ERR_OK;

    snd_ctl_elem_value_t *value = NULL;
    snd_ctl_elem_value_alloca(&value);
    iRet = read_alsa_udce_value(ctl, id, &value);
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error(
            "Unable to read ALSA user-defined control element integer value"
        );
        return iRet;
    }

    /* idx=0 is the index of the value in the control element */
    *piValue = snd_ctl_elem_value_get_integer(value, 0);

    log_verbose("Read integer value %d", *piValue);
    return iRet;
}

/* read the boolean value of an ALSA user-defined control element */
static int read_alsa_udce_boolean_value(
    snd_ctl_t *ctl,
    snd_ctl_elem_id_t *id,
    int *pbValue
) {
    int iRet = ERR_OK;

    snd_ctl_elem_value_t *value = NULL;
    snd_ctl_elem_value_alloca(&value);
    iRet = read_alsa_udce_value(ctl, id, &value);
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error(
            "Unable to read ALSA user-defined control element boolean value"
        );
        return iRet;
    }

    /* idx=0 is the index of the value in the control element */
    *pbValue = (
        (snd_ctl_elem_value_get_boolean(value, 0) ? BOOL_TRUE : BOOL_FALSE)
    );

    log_verbose("Read boolean value %d", *pbValue);
    return iRet;
}

/* Check if an event is generated by the given control element */
static int is_event_from_udce(snd_ctl_event_t *event, snd_ctl_elem_id_t *id) {
    unsigned int uNumID = snd_ctl_elem_id_get_numid(id);

    if (uNumID != 0) {
        return (
            (snd_ctl_event_elem_get_numid(event) == uNumID) ? BOOL_TRUE : BOOL_FALSE
        );
    }

    return (
        (snd_ctl_event_elem_get_interface(event) == snd_ctl_elem_id_get_interface(id)) &&
        (strcmp(snd_ctl_event_elem_get_name(event), snd_ctl_elem_id_get_name(id)) == 0)
    ) ? BOOL_TRUE : BOOL_FALSE;
}

/* Check if an event is generated by the given output control */
static int is_event_from_output_control(
    snd_ctl_event_t *event,
    OutputControl *pOutputControl
) {
    if (
        (pOutputControl == NULL) ||
        (BOOL_IS_FALSE(pOutputControl->bInitialized))
    ) {
        /* output control is not initialized, exit immediately with false */
        return BOOL_FALSE;
    }
    return (
        BOOL_IS_TRUE(is_event_from_udce(event, pOutputControl->pVolumeID)) ||
        BOOL_IS_TRUE(is_event_from_udce(event, pOutputControl->pSwitchID))
    ) ? BOOL_TRUE : BOOL_FALSE;
}


/* *************************************************************************
 * MIDI helpers
 * ************************************************************************* */

/* Check if the given szMIDIDevice can be opened:
 * if so, return true; otherwise return false. */
static int is_valid_midi_device(const char *szMIDIDevice) {
    int iRet = ERR_OK;
    snd_rawmidi_t *midi = NULL;

    log_verbose("Check if MIDI device '%s' is valid", szMIDIDevice);
    /* NOTE: the flag SND_RAWMIDI_NONBLOCK prevents interfering
     *       with other processes that might be using the MIDI device
     *       being probed. */
    iRet = snd_rawmidi_open(NULL, &midi, szMIDIDevice, SND_RAWMIDI_NONBLOCK);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_verbose("MIDI device '%s' is NOT valid", szMIDIDevice);
        return BOOL_FALSE;
    }

    snd_rawmidi_close(midi);
    log_verbose("MIDI device '%s' is valid", szMIDIDevice);
    return BOOL_TRUE;
}

/* Probe the MIDI devices of the given iCardNumber X, in this order:
 * hw:X,i,j , hw:X,i , hw:X .
 *
 * Return true if a MIDI device is found, and false otherwise.
 *
 * If bFirstOnly is true, return as soon as the first MIDI device is found;
 * if false, loop over all MIDI devices, printing (MIDI Device, Card Name)
 * for all the MIDI devices found. */
static int probe_midi_devices_for_card(
    int iCardNumber,
    const char *szCardName,
    int bFirstOnly
) {
    /* first, try with hw:X,i,j */
    for (int i = MIDI_DEVICE_PROBE_MIN_INDEX; i <= MIDI_DEVICE_PROBE_MAX_INDEX; i++) {
        for (int j = MIDI_DEVICE_PROBE_MIN_INDEX; j <= MIDI_DEVICE_PROBE_MAX_INDEX; j++) {
            snprintf(
                gpConfiguration.szMIDIDevice,
                MIDI_DEVICE_MAX_LENGTH,
                "hw:%d,%d,%d",
                iCardNumber,
                i,
                j
            );
            if (BOOL_IS_TRUE(is_valid_midi_device(gpConfiguration.szMIDIDevice))) {
                if (BOOL_IS_TRUE(bFirstOnly)) {
                    return BOOL_TRUE;
                } else {
                    printf("%s\t%s\n", gpConfiguration.szMIDIDevice, szCardName);
                }
            }
        }
    }

    /* second, try with just hw:X,i */
    for (int i = MIDI_DEVICE_PROBE_MIN_INDEX; i <= MIDI_DEVICE_PROBE_MAX_INDEX; i++) {
        snprintf(
            gpConfiguration.szMIDIDevice,
            MIDI_DEVICE_MAX_LENGTH,
            "hw:%d,%d",
            iCardNumber,
            i
        );
        if (BOOL_IS_TRUE(is_valid_midi_device(gpConfiguration.szMIDIDevice))) {
            if (BOOL_IS_TRUE(bFirstOnly)) {
                return BOOL_TRUE;
            } else {
                printf("%s\t%s\n", gpConfiguration.szMIDIDevice, szCardName);
            }
        }
    }

    /* third, try with just hw:X */
    snprintf(
        gpConfiguration.szMIDIDevice,
        MIDI_DEVICE_MAX_LENGTH,
        "hw:%d",
        iCardNumber
    );
    if (BOOL_IS_TRUE(is_valid_midi_device(gpConfiguration.szMIDIDevice))) {
        if (BOOL_IS_TRUE(bFirstOnly)) {
            return BOOL_TRUE;
        } else {
            printf("%s\t%s\n", gpConfiguration.szMIDIDevice, szCardName);
        }
    }

    return BOOL_FALSE;
}

/* Ensure that gpConfiguration.szMIDIDevice holds valid a MIDI device
 * (e.g., hw:0,0,0), possibly autodetecting it if not explicitly specified.
 *
 * Return ERR_OK if a valid MIDI device is found, or an error otherwise. */
static int ensure_midi_device() {
    if (
        strncmp(
            gpConfiguration.szMIDIDevice,
            MIDI_DEVICE_AUTODETECT,
            MIDI_DEVICE_MAX_LENGTH
        ) != 0
    ) {
        log_verbose(
            "Check if MIDI device '%s' for card number '%d' is valid",
            gpConfiguration.szMIDIDevice,
            gpConfiguration.iCardNumber
        );

        if (BOOL_IS_TRUE(is_valid_midi_device(gpConfiguration.szMIDIDevice))) {
            return ERR_OK;
        }

        return ERR_ERROR_GENERIC;
    }

    log_verbose(
        "Autodetect MIDI device for card number '%d'",
        gpConfiguration.iCardNumber
    );
    if (BOOL_IS_TRUE(probe_midi_devices_for_card(
        gpConfiguration.iCardNumber,
        NULL,
        BOOL_TRUE
    ))) {
        return ERR_OK;
    }

    return ERR_ERROR_GENERIC;
}

/* Print the list of MIDI devices as a table
 * with colums (MIDI Device, Card Name). */
static void print_midi_devices() {
    int iCard = -1;
    char *szCardName;

    printf("MIDI Device\tCard Name\n");
    while ((snd_card_next(&iCard) >= 0) && (iCard >= 0)) {
        if (ERR_ALSA_CODE_IS_ERROR(snd_card_get_name(iCard, &szCardName))) {
            /* ignore error and continue looping over the available cards */
            continue;
        }
        if (szCardName == NULL) {
            continue;
        }
        probe_midi_devices_for_card(iCard, szCardName, BOOL_FALSE);
        free(szCardName);
    }
}

/* Convert the given volume value (in [VOL_MIN, VOL_MAX])
 * to a dB value (in [dVolumeMinDB, dVolumeMaxDB]), with a linear mapping. */
static double convert_volume_control_value_to_db(
    int iVolume,
    double dVolumeMinDB,
    double dVolumeMaxDB
) {
    return dVolumeMinDB + ((dVolumeMaxDB - dVolumeMinDB) * iVolume) / VOL_MAX;
}

/* Convert the given volume value in dB to the corresponding two bytes
 * that can be sent to the RME ADI-2 device via MIDI SysEx
 * to set that volume. */
static void convert_db_value_to_sysex_bytes(
    double dValueDB,
    unsigned char *pchHigh,
    unsigned char *pchLow
) {
    int raw = (int)(dValueDB * 10) + 4096;

    /* Ensure the raw value is in the allowed range */
    if (raw < RME_VALUE_VOLUME_MIN) {
        raw = RME_VALUE_VOLUME_MIN;
    }
    if (raw > RME_VALUE_VOLUME_MAX) {
        raw = RME_VALUE_VOLUME_MAX;
    }

    /* assign to the two byte output arguments */
    *pchHigh = (raw >> 7) & 0x1F;
    *pchLow = raw & 0x7F;
}

/* Send an absolute dB level to ADI-2 via MIDI SysEx */
static int send_db(
    snd_rawmidi_t *midi,
    unsigned char chRMEDeviceID,
    unsigned char chRMEOutput,
    double dValueDB
) {
    unsigned char chHighByte = 0;
    unsigned char chLowByte = 0;
    convert_db_value_to_sysex_bytes(dValueDB, &chHighByte, &chLowByte);

    /* Example: set -10.0 dB on line 1/2 on RME ADI 2/4 PRO SE

       F0 00 20 0D 73 02 1B 1F 1C F7
       -- -------- -- -- -- ----- --
       ^  ^        ^  ^  ^  ^     ^
       |  |        |  |  |  |     |
       |  |        |  |  |  |     +- SysEx end (0xF7)
       |  |        |  |  |  +- -10 db
       |  |        |  |  +- line 1/2 (0x1B)
       |  |        |  +- set (0x02)
       |  |        +- ADI 2/4 PRO SE (0x73)
       |  +- RME ID (0x00 0x20 0x0D)
       +- SysEx start (0xF0)

    */
    unsigned char pchSysEx[] = {
        RME_SYSEX_START,                /* SysEx start */
        RME_SYSEX_MANUFACTURER_ID_0,    /* RME manufacturer ID */
        RME_SYSEX_MANUFACTURER_ID_1,
        RME_SYSEX_MANUFACTURER_ID_2,
        chRMEDeviceID,                  /* Device ID */
        RME_SYSEX_COMMAND_SET,          /* Command: set value */
        chRMEOutput,                    /* Parameter: output (line12 or phones34) */
        chHighByte,                     /* Value: volume bytes */
        chLowByte,
        RME_SYSEX_END                   /* SysEx end */
    };

    log_verbose(
        "WRITE MIDI SysEx: "
        "%02X %02X %02X %02X %02X %02X %02X %02X %02X %02X"
        " (volume: %.1f dB, output: %s)",
        pchSysEx[0], pchSysEx[1], pchSysEx[2], pchSysEx[3], pchSysEx[4],
        pchSysEx[5], pchSysEx[6], pchSysEx[7], pchSysEx[8], pchSysEx[9],
        dValueDB,
        (chRMEOutput == RME_PARAM_LINE) ? "line12" : "phones34"
    );

    ssize_t cbWritten = snd_rawmidi_write(midi, pchSysEx, sizeof(pchSysEx));
    if (cbWritten < 0) {
        log_error("WRITE MIDI SysEx failed: %s", snd_strerror(cbWritten));
        return ERR_ERROR_GENERIC;
    }
    return ERR_OK;
}

/* Send control value as volume to ADI-2 */
static int send_volume(
    snd_rawmidi_t *midi,
    unsigned char chRMEDeviceID,
    unsigned char chRMEOutput,
    int iValue,
    double dVolumeMinDB,
    double dVolumeMaxDB
) {
    double dValueDB = 0;
    int iRet = ERR_OK;

    dValueDB = convert_volume_control_value_to_db(
        iValue,
        dVolumeMinDB,
        dVolumeMaxDB
    );
    iRet = send_db(midi, chRMEDeviceID, chRMEOutput, dValueDB);
    if (ERR_CODE_IS_OK(iRet)) {
        log_info(
            "SET volume %d == %.1f dB on %s",
            iValue,
            dValueDB,
            (chRMEOutput == RME_PARAM_LINE) ? "line12" : "phones34"
        );
    } else {
        log_error(
            "SET volume %d == %0.1f dB on %s failed: error %d",
            iValue,
            dValueDB,
            (chRMEOutput == RME_PARAM_LINE) ? "line12" : "phones34",
            iRet
        );
    }
    return iRet;
}

/* Send mute on/off command to ADI-2 via MIDI SysEx */
static int send_mute(
    snd_rawmidi_t *midi,
    unsigned char chRMEDeviceID,
    unsigned char chRMEOutput,
    unsigned char chRMEValueMute
) {
    /* Example: mute line 1/2 on RME ADI 2/4 PRO SE

       F0 00 20 0D 73 02 1B 60 01 F7
       -- -------- -- -- -- -- -- --
       ^  ^        ^  ^  ^  ^  ^  ^
       |  |        |  |  |  |  |  |
       |  |        |  |  |  |  |  +- SysEx end (0xF7)
       |  |        |  |  |  |  +- mute on (0x01)
       |  |        |  |  |  +- mute parameter (0x60)
       |  |        |  |  +- line 1/2 (0x1B)
       |  |        |  +- set (0x02)
       |  |        +- ADI 2/4 PRO SE (0x73)
       |  +- RME ID (0x00 0x20 0x0D)
       +- SysEx start (0xF0)

    */
    unsigned char pchSysEx[] = {
        RME_SYSEX_START,                /* SysEx start */
        RME_SYSEX_MANUFACTURER_ID_0,    /* RME manufacturer ID */
        RME_SYSEX_MANUFACTURER_ID_1,
        RME_SYSEX_MANUFACTURER_ID_2,
        chRMEDeviceID,                  /* Device ID */
        RME_SYSEX_COMMAND_SET,          /* Command: set value */
        chRMEOutput,                    /* Parameter: output (line12 or phones34) */
        RME_PARAM_MUTE,                 /* Parameter: mute */
        chRMEValueMute,                 /* Value: RME_VALUE_MUTE_OFF or RME_VALUE_MUTE_ON */
        RME_SYSEX_END                   /* SysEx end */
    };

    log_verbose(
        "WRITE MIDI SysEx: "
        "%02X %02X %02X %02X %02X %02X %02X %02X %02X %02X"
        " (mute: %s, output: %s)",
        pchSysEx[0], pchSysEx[1], pchSysEx[2], pchSysEx[3], pchSysEx[4],
        pchSysEx[5], pchSysEx[6], pchSysEx[7], pchSysEx[8], pchSysEx[9],
        (chRMEValueMute == RME_VALUE_MUTE_ON ? "on" : "off"),
        (chRMEOutput == RME_PARAM_LINE) ? "line12" : "phones34"
    );

    ssize_t cbWritten = snd_rawmidi_write(midi, pchSysEx, sizeof(pchSysEx));
    if (cbWritten < 0) {
        log_error("WRITE MIDI SysEx failed: %s", snd_strerror(cbWritten));
        return ERR_ERROR_GENERIC;
    } else {
        log_info(
            "SET mute %s on %s",
            (chRMEValueMute == RME_VALUE_MUTE_ON ? "on" : "off"),
            (chRMEOutput == RME_PARAM_LINE) ? "line12" : "phones34"
        );
    }
    return ERR_OK;
}


/* *************************************************************************
 * Output Controls
 * ************************************************************************* */

static void free_output_control(OutputControl *pOutputControl) {
    if (!((pOutputControl) && (BOOL_IS_TRUE(pOutputControl->bInitialized)))) {
        return;
    }

    if (pOutputControl->pVolumeID) {
        snd_ctl_elem_id_free(pOutputControl->pVolumeID);
        pOutputControl->pVolumeID = NULL;
    }
    if (pOutputControl->pSwitchID) {
        snd_ctl_elem_id_free(pOutputControl->pSwitchID);
        pOutputControl->pSwitchID = NULL;
    }
    pOutputControl->bInitialized = BOOL_FALSE;
}

static void save_volume_switch_values(OutputControl *pOutputControl) {
    pOutputControl->iVolumeLast = pOutputControl->iVolume;
    pOutputControl->bSwitchLast = pOutputControl->bSwitch;
}

static int control_has_new_state(OutputControl *pOutputControl) {
    return (
        (pOutputControl->iVolume != pOutputControl->iVolumeLast) ||
        (pOutputControl->bSwitch != pOutputControl->bSwitchLast)
    ) ? BOOL_TRUE : BOOL_FALSE;
}

static int init_output_control(
    snd_ctl_t *ctl,
    unsigned char chRMEDeviceID,
    OutputParameters *pOutputParameters,
    OutputControl *pOutputControl
) {
    int iRet = ERR_OK;

    if (BOOL_IS_FALSE(pOutputParameters->bControl)) {
        /* do not add controls for this output, exit immediately */
        goto cleanup;
    }

    pOutputControl->chRMEDeviceID = chRMEDeviceID;
    pOutputControl->chRMEOutput = pOutputParameters->chRMEOutput;

    /* set the initial values for bSwitch, iVolume, bSwitchLast, iVolumeLast */
    pOutputControl->iVolume = pOutputParameters->iStartupVolume;
    pOutputControl->bSwitch = pOutputParameters->bStartupSwitch;
    save_volume_switch_values(pOutputControl);

    /* set the min and max volume DB */
    pOutputControl->dVolumeMinDB = pOutputParameters->dMinDB;
    pOutputControl->dVolumeMaxDB = pOutputParameters->dMaxDB;

    /* copy the UDCE names, they will be used for logging and querying */
    strncpy(
        pOutputControl->szUDCEVolumeName,
        pOutputParameters->szUDCEVolumeName,
        UDCE_NAME_MAX_LENGTH - 1
    );
    strncpy(
        pOutputControl->szUDCESwitchName,
        pOutputParameters->szUDCESwitchName,
        UDCE_NAME_MAX_LENGTH - 1
    );

    /* Allocate and create volume UDCE */
    iRet = snd_ctl_elem_id_malloc(&(pOutputControl->pVolumeID));
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot allocate volume UDCE '%s'",
            pOutputControl->szUDCEVolumeName
        );
        iRet = ERR_ERROR_GENERIC;
        goto cleanup;
    }
    iRet = install_control_element(
        ctl,
        pOutputControl->pVolumeID,
        pOutputControl->szUDCEVolumeName,
        pOutputControl->iVolume,
        BOOL_FALSE
    );
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot add volume UDCE '%s'",
            pOutputControl->szUDCEVolumeName
        );
        goto cleanup;
    }

    /* Allocate and create switch UDCE */
    iRet = snd_ctl_elem_id_malloc(&(pOutputControl->pSwitchID));
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot allocate switch UDCE '%s'",
            pOutputControl->szUDCESwitchName
        );
        iRet = ERR_ERROR_GENERIC;
        goto cleanup;
    }
    iRet = install_control_element(
        ctl,
        pOutputControl->pSwitchID,
        pOutputControl->szUDCESwitchName,
        pOutputControl->bSwitch,
        BOOL_TRUE
    );
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot add switch UDCE '%s'",
            pOutputControl->szUDCESwitchName
        );
        goto cleanup;
    }

    pOutputControl->bInitialized = BOOL_TRUE;

    iRet = ERR_OK;

cleanup:

    if (ERR_CODE_IS_ERROR(iRet)) {
        if (pOutputControl->pVolumeID) {
            snd_ctl_elem_id_free(pOutputControl->pVolumeID);
            pOutputControl->pVolumeID = NULL;
        }
        if (pOutputControl->pSwitchID) {
            snd_ctl_elem_id_free(pOutputControl->pSwitchID);
            pOutputControl->pSwitchID = NULL;
        }
    }

    return iRet;
}


/* *************************************************************************
 * Monitor Loop
 * ************************************************************************* */

/* Signal handler for the monitor loop */
static void monitor_loop_signal_handler(int iSignal) {
    (void)iSignal;
    gbServiceIsRunning = (sig_atomic_t)BOOL_FALSE;
}

/* Validate the value of a volume UDCE,
 * returning true if OK, and false otherwise */
static int validate_volume_value(int iVolume) {
    /* NOTE: for unknown reasons, sometimes the first time
     *       the volume value is read, it returns an invalid value */
    if ((iVolume < VOL_MIN) || (iVolume > VOL_MAX)) {
        log_verbose(
            "Invalid value '%d' for the volume, ignoring it",
            iVolume
        );
        return BOOL_FALSE;
    }
    return BOOL_TRUE;
}

/* Validate the value of a switch UDCE,
 * returning true if OK, and false otherwise */
static int validate_switch_value(int bSwitch) {
    /* Check explicitly != BOOL_TRUE, BOOL_FALSE instead of using
     * BOOL_IS_* macros, to ensure only the canonical values are read */
    if ((bSwitch != BOOL_TRUE) && (bSwitch != BOOL_FALSE)) {
        log_verbose(
            "Invalid value '%d' for the switch, ignoring it",
            bSwitch
        );
        return BOOL_FALSE;
    }
    return BOOL_TRUE;
}

/* Apply the current state (volume, mute) to the MIDI device */
static void apply_state(
    snd_rawmidi_t *midi,
    OutputControl *pOutputControl
) {
    if (
        (pOutputControl == NULL) ||
        (BOOL_IS_FALSE(pOutputControl->bInitialized))
    ) {
        /* output control is not initialized, exit immediately */
        return;
    }

    /* NOTE: here we ignore errors from the send_() functions */
    if (BOOL_IS_TRUE(pOutputControl->bSwitch)) {
        /* UDCE is enabled (mute off): send mute off and volume value */
        send_mute(
            midi,
            pOutputControl->chRMEDeviceID,
            pOutputControl->chRMEOutput,
            RME_VALUE_MUTE_OFF
        );
        send_volume(
            midi,
            pOutputControl->chRMEDeviceID,
            pOutputControl->chRMEOutput,
            pOutputControl->iVolume,
            pOutputControl->dVolumeMinDB,
            pOutputControl->dVolumeMaxDB
        );
    } else {
        /* UDCE is disabled (mute on): send mute on */
        send_mute(
            midi,
            pOutputControl->chRMEDeviceID,
            pOutputControl->chRMEOutput,
            RME_VALUE_MUTE_ON
        );
    }
}

/* Monitor loop (main service loop) */
static int monitor_loop(
    snd_ctl_t *ctl,
    snd_rawmidi_t *midi,
    OutputControl *pOutputControls[],
    size_t cOutputControls
) {
    int iCount = 0;
    int iRet = ERR_OK;
    int iVolumeNewValue = 0;
    int bSwitchNewValue = 0;
    unsigned short usRevents = 0;
    OutputControl *pEventFrom = NULL;
    snd_ctl_event_t *event = NULL;

    /* Allocate stack memory for the event */
    snd_ctl_event_alloca(&event);

    /* Subscribe to control events */
    iRet = snd_ctl_subscribe_events(ctl, 1);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error("Cannot subscribe to events: %s", snd_strerror(iRet));
        return ERR_ERROR_GENERIC;
    }

    /* Get poll descriptors */
    iCount = snd_ctl_poll_descriptors_count(ctl);
    if (iCount <= 0) {
        log_error("Invalid poll descriptor count: %d", iCount);
        return ERR_ERROR_GENERIC;
    }
    struct pollfd pfd[iCount];
    snd_ctl_poll_descriptors(ctl, pfd, iCount);

    /* Send initial state */
    for (size_t i = 0; i < cOutputControls; i++) {
        /* TODO implement a real MIDI SysEx read of mute and volume state */
        apply_state(midi, pOutputControls[i]);
    }
    for (size_t i = 0; i < cOutputControls; i++) {
        if (BOOL_IS_TRUE(pOutputControls[i]->bInitialized)) {
            log_info(
                "Monitoring ALSA user-defined control elements "
                "'%s' and '%s' for changes",
                pOutputControls[i]->szUDCEVolumeName,
                pOutputControls[i]->szUDCESwitchName
            );
        }
    }

    /* gbServiceIsRunning can be set to false by the signal handler,
     * interrupting the monitor loop */
    while (BOOL_IS_TRUE(gbServiceIsRunning)) {

        /* Wait for the next event or signal */
        iRet = poll(pfd, iCount, -1);
        if (iRet < 0) {
            /* poll returned an error: inspect errno */
            if (errno == EINTR) {
                /* system call poll interrupted by a signal:
                 * evaluates the loop condition again  */
                continue;
            }
            /* in all other cases (EFAULT, EINVAL, ENOMEM), error out */
            log_error("Event poll error: %s", strerror(errno));
            return ERR_ERROR_EVENT_POLL;
        }

        /* Check poll result */
        snd_ctl_poll_descriptors_revents(ctl, pfd, iCount, &usRevents);
        if (usRevents & (POLLERR | POLLHUP | POLLNVAL)) {
            /* The ALSA card was disconnected and/or powered off:
             * error out so that the service terminates
             * the current execution.
             * If run by systemd, a new execution can be attempted,
             * in case the ALSA card returns available later. */
            log_error("The ALSA card was disconnected");
            return ERR_ERROR_SOUND_CARD_DISCONNECTED;
        }
        if (!(usRevents & POLLIN)) {
            /* no data to be read:
             * evaluates the loop condition again  */
            continue;
        }

        /* Read events */
        while (snd_ctl_read(ctl, event) > 0) {
            pEventFrom = NULL;

            /* Check if the event is from a control element */
            if (snd_ctl_event_get_type(event) != SND_CTL_EVENT_ELEM) {
                /* evaluate next event */
                continue;
            }

            /* Check if the event belongs to one of the output controls */
            for (size_t i = 0; i < cOutputControls; i++) {
                if (BOOL_IS_TRUE(
                    is_event_from_output_control(event, pOutputControls[i])
                )) {
                    pEventFrom = pOutputControls[i];
                }
            }
            if (pEventFrom == NULL) {
                /* evaluate next event */
                continue;
            }

            /* Read the new values for volume and switch */
            iRet = read_alsa_udce_integer_value(
                ctl,
                pEventFrom->pVolumeID,
                &iVolumeNewValue
            );
            if (ERR_CODE_IS_ERROR(iRet)) {
                log_error("Unable to read the value of the volume");
                return iRet;
            }
            iRet = read_alsa_udce_boolean_value(
                ctl,
                pEventFrom->pSwitchID,
                &bSwitchNewValue
            );
            if (ERR_CODE_IS_ERROR(iRet)) {
                log_error("Unable to read the value of the mute switch");
                return iRet;
            }

            /* Validate the new values and apply them */
            if (BOOL_IS_TRUE(validate_volume_value(iVolumeNewValue))) {
                pEventFrom->iVolume = iVolumeNewValue;
            }
            if (BOOL_IS_TRUE(validate_switch_value(bSwitchNewValue))) {
                pEventFrom->bSwitch = bSwitchNewValue;
            }
            if (BOOL_IS_TRUE(control_has_new_state(pEventFrom))) {
                apply_state(midi, pEventFrom);
                save_volume_switch_values(pEventFrom);
            }

        } /* end of inner while (snd_clt_read(ctl, event) > 0) */

    } /* end of outer while (BOOL_IS_TRUE(gbServiceIsRunning)) */

    return ERR_OK;
}


/* *************************************************************************
 * CLI Helpers
 * ************************************************************************* */

/* Return true if at least one output is selected
 * (that is, at most one of --no-line12 and --no-phones34 was provided),
 * and false otherwise. */
static int validate_no_output_options() {
    if (
        BOOL_IS_TRUE(gpConfiguration.stLine12.bControl) ||
        BOOL_IS_TRUE(gpConfiguration.stPhones34.bControl)
    ) {
        return BOOL_TRUE;
    }
    log_error(
        "Options '--no-line12' and '--no-phones34' "
        "cannot be both specified at the same time"
    );
    return BOOL_FALSE;
}

/* Return true if the device ID in the configuration is supported
 * (or was not set), and false otherwise. */
static int validate_device_id(int bDeviceIDWasSet) {
    int iDeviceID = gpConfiguration.iDeviceID;
    if (BOOL_IS_TRUE(
        ((BOOL_IS_FALSE(bDeviceIDWasSet)) && (iDeviceID == DEVICE_ID_NOT_SET)) ||
        (iDeviceID == RME_DEVICE_FAMILY_ADI2_DAC) ||
        (iDeviceID == RME_DEVICE_FAMILY_ADI2_PRO) ||
        (iDeviceID == RME_DEVICE_FAMILY_ADI24_PRO)
    )) {
        return BOOL_TRUE;
    }
    log_error("Invalid device ID: '0x%02X'", iDeviceID);
    return BOOL_FALSE;
}

/* Return true if the device name in the configuration is supported
 * (or it was not set), and false otherwise. */
static int validate_device_name() {
    const char *szDeviceName = gpConfiguration.szDeviceName;
    size_t cbDeviceName = sizeof(gpConfiguration.szDeviceName);
    if (BOOL_IS_TRUE(
        (strncmp(szDeviceName, DEVICE_NAME_AUTODETECT, cbDeviceName) == 0) ||
        (strncmp(szDeviceName, DEVICE_NAME_RME_ADI2_DAC, cbDeviceName) == 0) ||
        (strncmp(szDeviceName, DEVICE_NAME_RME_ADI2_PRO, cbDeviceName) == 0) ||
        (strncmp(szDeviceName, DEVICE_NAME_RME_ADI24_PRO, cbDeviceName) == 0)
    )) {
        return BOOL_TRUE;
    }
    log_error("Invalid device name: '%s'", gpConfiguration.szDeviceName);
    return BOOL_FALSE;
}

/* Return true if the MIDI device in the configuration is supported
 * (or it was not set), and false otherwise. */
static int validate_midi_device() {
    /* NOTE: not checking if szMIDIDevice is in the form "hw:X[,Y[,Z]]"
     *       since the value might be provided by the user and
     *       it is not clear that that form is the only one accepted by ALSA. */
    const char *szMIDIDevice = gpConfiguration.szMIDIDevice;
    size_t cbMIDIDevice = sizeof(gpConfiguration.szMIDIDevice);
    if (BOOL_IS_TRUE(
        (strncmp(szMIDIDevice, MIDI_DEVICE_AUTODETECT, cbMIDIDevice) == 0) ||
        ((strnlen(szMIDIDevice, cbMIDIDevice) > 0))
    )) {
        return BOOL_TRUE;
    }
    log_error("Invalid midi device: '%s'", gpConfiguration.szMIDIDevice);
    return BOOL_FALSE;
}

/* Return true if the line12/phones34 initial volume values
 * in the configuration are supported (or they were not set),
 * and false otherwise. */
static int validate_initial_volume_value(int iVolume, const char *szOption) {
    if (
        (iVolume == INITIAL_VOLUME_VALUE_NOT_SET) ||
        ((iVolume >= VOL_MIN) && (iVolume <= VOL_MAX))
    ) {
        return BOOL_TRUE;
    }
    log_error(
        "Invalid initial volume value for option '%s': '%d'",
        szOption,
        iVolume
    );
    return BOOL_FALSE;
}
static int validate_initial_volume_values() {
    StringIntegerPair pstPairs[] = {
        {"--line12-volume", gpConfiguration.stLine12.iStartupVolume},
        {"--phones34-volume", gpConfiguration.stPhones34.iStartupVolume},
    };
    size_t cCount = sizeof(pstPairs) / sizeof(pstPairs[0]);

    for (size_t i = 0; i < cCount; i++) {
        if (BOOL_IS_FALSE(
            validate_initial_volume_value(
                pstPairs[i].iValue,
                pstPairs[i].szOptionName
            )
        )) {
            return BOOL_FALSE;
        }
    }
    return BOOL_TRUE;
}

/* Return true if the line12/phones34 initial switch values
 * in the configuration are supported (or they were not set),
 * and false otherwise. */
static int validate_initial_switch_value(int iValue, const char *szOption) {
    if (
        (iValue == INITIAL_SWITCH_VALUE_NOT_SET) ||
        (BOOL_IS_VALID(iValue))
    ) {
        return BOOL_TRUE;
    }
    log_error(
        "Invalid initial switch value for option '%s': '%d'",
        szOption,
        iValue
    );
    return BOOL_FALSE;
}
static int validate_initial_switch_values() {
    StringIntegerPair pstPairs[] = {
        {"--line12-switch", gpConfiguration.stLine12.bStartupSwitch},
        {"--phones34-switch", gpConfiguration.stPhones34.bStartupSwitch},
    };
    size_t cCount = sizeof(pstPairs) / sizeof(pstPairs[0]);

    for (size_t i = 0; i < cCount; i++) {
        if (BOOL_IS_FALSE(
            validate_initial_switch_value(
                pstPairs[i].iValue,
                pstPairs[i].szOptionName
            )
        )) {
            return BOOL_FALSE;
        }
    }
    return BOOL_TRUE;
}

/* Return true if the line12/phones34 min/max DB values
 * in the configuration are supported (or they were not set),
 * and false otherwise. */
static int validate_min_max_db_values() {
    StringDoublePair pstPairs[] = {
        {"--line12-min-db", gpConfiguration.stLine12.dMinDB},
        {"--line12-max-db", gpConfiguration.stLine12.dMaxDB},
        {"--phones34-min-db", gpConfiguration.stPhones34.dMinDB},
        {"--phones34-max-db", gpConfiguration.stPhones34.dMaxDB},
    };
    size_t cCount = sizeof(pstPairs) / sizeof(pstPairs[0]);

    for (size_t i = 0; i < cCount; i++) {
        if (BOOL_IS_TRUE(
            (pstPairs[i].dValue < RME_VALUE_VOLUME_MIN_DB) ||
            (pstPairs[i].dValue > RME_VALUE_VOLUME_MAX_DB)
        )) {
            log_error(
                "Invalid value '%0.1f' for option '%s': "
                "it must be between '%0.1f' dB and '%0.1f' dB",
                pstPairs[i].dValue,
                pstPairs[i].szOptionName,
                RME_VALUE_VOLUME_MIN_DB,
                RME_VALUE_VOLUME_MAX_DB
            );
            return BOOL_FALSE;
        }
    }

    for (size_t i = 0; i < cCount; i += 2) {
        if (BOOL_IS_TRUE(
            (pstPairs[i].dValue >= pstPairs[i + 1].dValue)
        )) {
            log_error(
                "The value of option '%s' must be smaller than "
                "the value of option '%s'. "
                "Got instead: '%0.1f' >= '%0.1f'.",
                pstPairs[i].szOptionName,
                pstPairs[i + 1].szOptionName,
                pstPairs[i].dValue,
                pstPairs[i + 1].dValue
            );
            return BOOL_FALSE;
        }
    }

    return BOOL_TRUE;
}

static void print_device_names() {
    const char *szDeviceNames[] = {
        DEVICE_NAME_AUTODETECT,
        DEVICE_NAME_RME_ADI2_DAC,
        DEVICE_NAME_RME_ADI2_PRO,
        DEVICE_NAME_RME_ADI24_PRO
    };
    size_t cCount = sizeof(szDeviceNames) / sizeof(szDeviceNames[0]);

    printf("RME Product Family (Device Name)\n");
    for (size_t i = 0; i < cCount; i++) {
        printf(
            "- '%s'\n",
            szDeviceNames[i]
        );
    }
}

static void print_device_ids() {
    DeviceIDWithName pszDeviceIDs[] = {
        {DEVICE_NAME_RME_ADI2_DAC, RME_DEVICE_FAMILY_ADI2_DAC},
        {DEVICE_NAME_RME_ADI2_PRO, RME_DEVICE_FAMILY_ADI2_PRO},
        {DEVICE_NAME_RME_ADI24_PRO, RME_DEVICE_FAMILY_ADI24_PRO}
    };
    size_t cCount = sizeof(pszDeviceIDs) / sizeof(pszDeviceIDs[0]);

    printf("ID\tRME Product Family\n");
    for (size_t i = 0; i < cCount; i++) {
        printf(
            "0x%02X\t%s\n",
            pszDeviceIDs[i].chDeviceID,
            pszDeviceIDs[i].szDeviceName
        );
    }
}

static void print_usage(const char *prog) {
    printf("Usage: %s [options]\n", prog);
    printf("\n");
    printf("Creates ALSA mute and volume controls for RME ADI-2 devices.\n");
    printf("\n");
    printf("Options:\n"); /* keep sorted by short option, then lexicographically */
    printf("  -C, --card-number INTEGER       Use the ALSA card with the given number; if specified, overrides the card detected by --device-name; option --list-cards prints the detected ones\n");
    printf("  -d, --device-name STRING        RME device name (case sensitive, default: '%s'); option --list-device-names prints the supported ones\n", DEFAULT_DEVICE_NAME);
    printf("  -D, --device-id STRING          RME device ID; if specified, overrides the device ID detected by --device-name; option --list-device-ids prints the supported ones\n");
    printf("  -h, --help                      Print this help\n");
    printf("      --license                   Print the license\n");
    printf("  -k, --line12-switch INTEGER     Initial state for line output 1/2 (%d=muted, %d=unmuted, default: %d)\n", BOOL_FALSE, BOOL_TRUE, gpConfiguration.stLine12.bStartupSwitch);
    printf("  -K, --line12-volume INTEGER     Initial volume for line output 1/2 (in [0, 100], default: %d)\n", gpConfiguration.stLine12.iStartupVolume);
    printf("  -l, --line12-min-db DB          Minimum dB value for line output 1/2, corresponding to 0%% volume (in [%0.1f, %0.1f], default: %.1f dB)\n", RME_VALUE_VOLUME_MIN_DB, RME_VALUE_VOLUME_MAX_DB, gpConfiguration.stLine12.dMinDB);
    printf("  -L, --line12-max-db DB          Maximum dB value for line output 1/2, corresponding to 100%% volume (in [%0.1f, %0.1f], default: %.1f dB)\n", RME_VALUE_VOLUME_MIN_DB, RME_VALUE_VOLUME_MAX_DB, gpConfiguration.stLine12.dMaxDB);
    printf("      --list-cards                List all ALSA cards and exit\n");
    printf("      --list-device-ids           List all supported device IDs\n");
    printf("      --list-device-names         List all supported device names\n");
    printf("      --list-midi-devices         List all supported MIDI devices\n");
    printf("  -M, --midi-device STRING        Use the specified MIDI device: 'autodetect' (default) or 'hw:X[,Y[,Z]]'; option --list-midi-devices prints the detected ones\n");
    printf("      --no-line12                 Do not install controls for line output 1/2\n");
    printf("      --no-phones34               Do not install controls for phones output 3/4\n");
    printf("      --no-uninstall-on-exit      If specified, do not uninstall ALSA user-defined control elements when the program exits\n");
    printf("  -o, --phones34-switch INTEGER   Initial state for phones output 3/4 (%d=muted, %d=unmuted, default: %d)\n", BOOL_FALSE, BOOL_TRUE, gpConfiguration.stPhones34.bStartupSwitch);
    printf("  -O, --phones34-volume INTEGER   Initial volume for phones output 3/4 (in [0, 100], default: %d)\n", gpConfiguration.stPhones34.iStartupVolume);
    printf("  -p, --phones34-min-db DB        Minimum dB value for phones output 3/4, corresponding to 0%% volume (in [%0.1f, %0.1f], default: %.1f dB)\n", RME_VALUE_VOLUME_MIN_DB, RME_VALUE_VOLUME_MAX_DB, gpConfiguration.stPhones34.dMinDB);
    printf("  -P, --phones34-max-db DB        Maximum dB value for phones output 3/4, corresponding to 100%% volume (in [%0.1f, %0.1f], default: %.1f dB)\n", RME_VALUE_VOLUME_MIN_DB, RME_VALUE_VOLUME_MAX_DB, gpConfiguration.stPhones34.dMaxDB);
    printf("      --uninstall                 Uninstall ALSA user-defined control elements and exit\n");
    printf("  -v, --verbose                   Enable verbose output\n");
    printf("  -V, --version                   Print the name and version of this program and exit\n");
    printf("\n");
    printf("Examples:\n");
    printf("  %s --list-cards\n", prog);
    printf("  %s --list-midi-devices\n", prog);
    printf("  %s --uninstall\n", prog);
    printf("  %s --verbose --device-name \"%s\"\n", prog, DEVICE_NAME_RME_ADI2_DAC);
    printf("  %s --card-number 1 --device-id 0x%02X --line12-min-db -25.0 --line12-max-db 0.0 --line12-volume 70 --line12-switch 1 --no-phones34\n", prog, RME_DEVICE_FAMILY_ADI24_PRO);
}

static void print_version(const char *prog) {
    printf("%s %s (build %s)\n", prog, PROGRAM_VERSION, PROGRAM_BUILD_DATE);
}

static void print_license() {
    printf("alsa-rme-adi2-volume-control - Service exposing ALSA mute/volume controls on an RME ADI-2 device via MIDI\n");
    printf("Copyright (C) 2026  Alberto Pettarin\n");
    printf("\n");
    printf("This program is free software: you can redistribute it and/or modify\n");
    printf("it under the terms of the GNU General Public License as published by\n");
    printf("the Free Software Foundation, either version 3 of the License, or\n");
    printf("(at your option) any later version.\n");
    printf("\n");
    printf("This program is distributed in the hope that it will be useful,\n");
    printf("but WITHOUT ANY WARRANTY; without even the implied warranty of\n");
    printf("MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the\n");
    printf("GNU General Public License for more details.\n");
    printf("\n");
    printf("You should have received a copy of the GNU General Public License\n");
    printf("along with this program.  If not, see <https://www.gnu.org/licenses/>.\n");
}

static int parse_args(int argc, char *argv[]) {
    struct option long_opts[] = {
        /* keep sorted by long option name; use {0,0,0,0} sentinel to end */
        {"card-number",          required_argument, 0, 'C'},
        {"device-id",            required_argument, 0, 'D'},
        {"device-name",          required_argument, 0, 'd'},
        {"help",                 no_argument,       0, 'h'},
        {"license",              no_argument,       0, 'R'},
        {"line12-max-db",        required_argument, 0, 'L'},
        {"line12-min-db",        required_argument, 0, 'l'},
        {"line12-switch",        required_argument, 0, 'k'},
        {"line12-volume",        required_argument, 0, 'K'},
        {"list-cards",           no_argument,       0, 'X'},    /* the short form is not public */
        {"list-device-ids",      no_argument,       0, 'Y'},    /* the short form is not public */
        {"list-device-names",    no_argument,       0, 'Z'},    /* the short form is not public */
        {"list-midi-devices",    no_argument,       0, 'Q'},    /* the short form is not public */
        {"midi-device",          required_argument, 0, 'M'},
        {"no-line12",            no_argument,       0, 'S'},    /* the short form is not public */
        {"no-phones34",          no_argument,       0, 'T'},    /* the short form is not public */
        {"no-uninstall-on-exit", no_argument,       0, 'U'},    /* the short form is not public */
        {"phones34-max-db",      required_argument, 0, 'P'},
        {"phones34-min-db",      required_argument, 0, 'p'},
        {"phones34-switch",      required_argument, 0, 'o'},
        {"phones34-volume",      required_argument, 0, 'O'},
        {"uninstall",            no_argument,       0, 'u'},    /* the short form is not public */
        {"verbose",              no_argument,       0, 'v'},
        {"version",              no_argument,       0, 'V'},
        {0,                      0,                 0,  0 }
    };

    int opt = 0;
    int bDeviceIDWasSet = BOOL_FALSE;
    while (
        (opt = getopt_long(
            argc,
            argv,
            "C:d:D:hk:K:l:L:M:o:O:p:P:QRSTuUvVXYZ",
            long_opts,
            NULL
        )) != -1
    ) {
        switch (opt) {
            case 'C':
                gpConfiguration.iCardNumber = atoi(optarg);
                break;
            case 'd':
                strncpy(gpConfiguration.szDeviceName, optarg, DEVICE_NAME_MAX_LENGTH - 1);
                break;
            case 'D':
                gpConfiguration.iDeviceID = (int)strtol(optarg, NULL, 0);
                bDeviceIDWasSet = BOOL_TRUE;
                break;
            case 'h':
                gpConfiguration.bPrintUsage = BOOL_TRUE;
                break;
            case 'k':
                gpConfiguration.stLine12.bStartupSwitch = atoi(optarg);
                break;
            case 'K':
                gpConfiguration.stLine12.iStartupVolume = atoi(optarg);
                break;
            case 'l':
                gpConfiguration.stLine12.dMinDB = atof(optarg);
                break;
            case 'L':
                gpConfiguration.stLine12.dMaxDB = atof(optarg);
                break;
            case 'M':
                strncpy(gpConfiguration.szMIDIDevice, optarg, MIDI_DEVICE_MAX_LENGTH - 1);
                break;
            case 'o':
                gpConfiguration.stPhones34.bStartupSwitch = atoi(optarg);
                break;
            case 'O':
                gpConfiguration.stPhones34.iStartupVolume = atoi(optarg);
                break;
            case 'p':
                gpConfiguration.stPhones34.dMinDB = atof(optarg);
                break;
            case 'P':
                gpConfiguration.stPhones34.dMaxDB = atof(optarg);
                break;
            case 'Q':
                gpConfiguration.bListMIDIDevices = BOOL_TRUE;
                break;
            case 'R':
                gpConfiguration.bPrintLicense = BOOL_TRUE;
                break;
            case 'S':
                gpConfiguration.stLine12.bControl = BOOL_FALSE;
                break;
            case 'T':
                gpConfiguration.stPhones34.bControl = BOOL_FALSE;
                break;
            case 'u':
                gpConfiguration.bUninstall = BOOL_TRUE;
                break;
            case 'U':
                gpConfiguration.bUninstallOnExit = BOOL_FALSE;
                break;
            case 'v':
                gpConfiguration.bVerboseLog = BOOL_TRUE;
                break;
            case 'V':
                gpConfiguration.bPrintVersion = BOOL_TRUE;
                break;
            case 'X':
                gpConfiguration.bListCards = BOOL_TRUE;
                break;
            case 'Y':
                gpConfiguration.bListDeviceIDs = BOOL_TRUE;
                break;
            case 'Z':
                gpConfiguration.bListDeviceNames = BOOL_TRUE;
                break;
            default:
                return EXIT_ERROR_USAGE_BAD_OPTION;
        } /* end switch opt */
    } /* end while opt */

    if (BOOL_IS_FALSE(validate_no_output_options())) {
        return EXIT_ERROR_USAGE_BAD_OPTION;
    }

    if (BOOL_IS_FALSE(validate_device_name())) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    if (BOOL_IS_FALSE(validate_device_id(bDeviceIDWasSet))) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    if (BOOL_IS_FALSE(validate_midi_device())) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    if (BOOL_IS_FALSE(validate_min_max_db_values())) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    if (BOOL_IS_FALSE(validate_initial_volume_values())) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    if (BOOL_IS_FALSE(validate_initial_switch_values())) {
        return EXIT_ERROR_USAGE_BAD_VALUE;
    }

    return ERR_OK;
}


/* *************************************************************************
 * CLI Main
 * ************************************************************************* */

int main(int argc, char *argv[]) {
    int iRet = ERR_OK;
    int iExitCode = EXIT_OK;
    snd_ctl_t *ctl = NULL;
    snd_rawmidi_t *midi = NULL;
    void (*pfLogFunction)(const char *msg, ...) = NULL;
    OutputControl stLine12;
    OutputControl stPhones34;

    /* Note that the OutputControl objects are allocated on the stack */
    OutputControl *pOutputControls[] = {
        &stLine12,
        &stPhones34
    };
    OutputParameters *pOutputParameters[] = {
        &(gpConfiguration.stLine12),
        &(gpConfiguration.stPhones34)
    };
    size_t cOutputControls = sizeof(pOutputControls) / sizeof(pOutputControls[0]);
    for (size_t i = 0; i < cOutputControls; i++) {
        memset(pOutputControls[i], 0, sizeof(*(pOutputControls[i])));
    }

    /* Parse command line arguments */
    iRet = parse_args(argc, argv);
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error("Cannot parse command line arguments: exit error %d", iRet);
        print_usage(argv[0]);
        iExitCode = iRet;
        goto cleanup;
    }

    /* Print the version and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bPrintVersion)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_version(argv[0]);
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the usage and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bPrintLicense)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_license();
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the usage and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bPrintUsage)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_usage(argv[0]);
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the list of cards and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bListCards)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_cards();
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the list of device IDs and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bListDeviceIDs)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_device_ids();
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the list of device names and exit */
    if (BOOL_IS_TRUE(gpConfiguration.bListDeviceNames)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_device_names();
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Print the list of MIDI devices */
    if (BOOL_IS_TRUE(gpConfiguration.bListMIDIDevices)) {
        gpConfiguration.bVerboseLog = BOOL_FALSE;
        print_midi_devices();
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Set up signal handlers, without setting SA_RESTART
     * so that poll() returns EINTR when interrupted. */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = monitor_loop_signal_handler;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);

    /* Ensure that the device ID and card number are set,
     * possibly autodetecting them if not set by the user. */
    iRet = ensure_device_id_and_card_number();
    if (ERR_CODE_IS_ERROR(iRet)) {
        iExitCode = EXIT_ERROR_CANNOT_FIND_CARD;
        goto cleanup;
    }
    log_info("Using device ID '0x%02X'", gpConfiguration.iDeviceID);
    log_info("Using ALSA card '%d'", gpConfiguration.iCardNumber);

    /* Set the card hw string from the card number */
    set_card_hw_string();

    /* Open card */
    iRet = snd_ctl_open(&ctl, gpConfiguration.szCardHw, 0);
    if (ERR_ALSA_CODE_IS_ERROR(iRet) || (ctl == NULL)) {
        log_error(
            "Cannot open ALSA card '%s': %s",
            gpConfiguration.szCardHw,
            snd_strerror(iRet)
        );
        iExitCode = EXIT_ERROR_CANNOT_OPEN_CARD;
        goto cleanup;
    }
    log_verbose("Opened ALSA card '%s'", gpConfiguration.szCardHw);

    if (BOOL_IS_TRUE(gpConfiguration.bUninstall)) {
        /* Uninstall mode: go to the service clean-up immediately */
        log_verbose("Uninstall mode: exit immediately");
        iExitCode = EXIT_OK;
        goto cleanup;
    }

    /* Normal mode: ensure no user-defined control elements are defined,
     * ignoring any errors that might occur trying to remove them,
     * for example because no such user-defined control elements
     * survived a previous execution of the service. */
    uninstall_all_alsa_udce_s(ctl);

    /* Ensure that the MIDI device is set,
     * possibly autodetecting it if not set by the user. */
    iRet = ensure_midi_device();
    if (ERR_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot find a valid MIDI device for ALSA card number '%d'",
            gpConfiguration.iCardNumber
        );
        iExitCode = EXIT_ERROR_CANNOT_FIND_MIDI_DEVICE;
        goto cleanup;
    }
    log_info("Using MIDI device '%s'", gpConfiguration.szMIDIDevice);

    /* Open the MIDI device with flag 0 (default, blocking) */
    iRet = snd_rawmidi_open(NULL, &midi, gpConfiguration.szMIDIDevice, 0);
    if (ERR_ALSA_CODE_IS_ERROR(iRet)) {
        log_error(
            "Cannot open MIDI device '%s': %s",
            gpConfiguration.szMIDIDevice,
            snd_strerror(iRet)
        );
        iExitCode = EXIT_ERROR_CANNOT_OPEN_MIDI_DEVICE;
        goto cleanup;
    }

    /* Initialize output controls */
    for (size_t i = 0; i < cOutputControls; i++) {
        iRet = init_output_control(
            ctl,
            gpConfiguration.iDeviceID,
            pOutputParameters[i],
            pOutputControls[i]
        );
        if (ERR_CODE_IS_ERROR(iRet)) {
            iExitCode = EXIT_ERROR_CANNOT_ADD_CONTROL;
            goto cleanup;
        }
    }

    /* Run the monitoring loop */
    log_info(
        "Start control loop for device ID '0x%02X' "
        "on MIDI device '%s' of ALSA card number '%d'",
        gpConfiguration.iDeviceID,
        gpConfiguration.szMIDIDevice,
        gpConfiguration.iCardNumber
    );
    iRet = monitor_loop(ctl, midi, pOutputControls, cOutputControls);
    log_info("Control loop exited with return code '%d'", iRet);
    if (ERR_CODE_IS_ERROR(iRet)) {
        switch (iRet) {
            case ERR_ERROR_EVENT_POLL:
                iExitCode = EXIT_ERROR_EVENT_POLL;
                break;
            case ERR_ERROR_SOUND_CARD_DISCONNECTED:
                iExitCode = EXIT_ERROR_SOUND_CARD_DISCONNECTED;
                break;
            default:
                iExitCode = EXIT_ERROR_GENERIC_IN_MONITOR_LOOP;
                break;
        }
        goto cleanup;
    }

    /* Service exited successfully */
    iExitCode = EXIT_OK;

cleanup:
    log_verbose("Cleaning service up ...");

    /* Uninstall user-defined control elements */
    if (
        BOOL_IS_FALSE(gpConfiguration.bUninstall) &&
        BOOL_IS_FALSE(gpConfiguration.bUninstallOnExit)
    ) {
        /* Normal mode, but no uninstall on exit was selected */
        log_info(
            "Skip uninstalling user-defined control elements on exit"
        );
    } else {
        /* Uninstall mode, or normal mode with uninstall on exit,
         * ignoring any errors */
        uninstall_all_alsa_udce_s(ctl);
        if (BOOL_IS_TRUE(gpConfiguration.bUninstall)) {
            /* in uninstall mode, print a log message at INFO level */
            pfLogFunction = log_info;
        } else {
            pfLogFunction = log_verbose;

        }
        pfLogFunction(
            "ALSA card '%d' no longer has user-defined control elements",
            gpConfiguration.iCardNumber
        );
    }

    /* Close objects */
    for (size_t i = 0; i < cOutputControls; i++) {
        free_output_control(pOutputControls[i]);
    }
    if (midi) {
        snd_rawmidi_close(midi);
        log_verbose("Closed raw MIDI object");
    }
    if (ctl) {
        snd_ctl_close(ctl);
        log_verbose("Closed ALSA sound object");
    }

    log_verbose("Cleaning service up ... done");
    log_verbose("Cleaned service up");

    /* Log exit code and return it */
    log_verbose("Service exited with code '%d'", iExitCode);
    return iExitCode;
}
