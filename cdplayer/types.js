/**
 * @typedef {Object} CdTrack
 * @property {string}   album
 * @property {string}   artist
 * @property {string}   title
 * @property {string}   trackType
 * @property {string}   type
 * @property {string}   service
 * @property {string}   uri
 * @property {number}   duration
 */

/**
 * @typedef {Object} TrackMetadata
 * @property {number|null} no
 * @property {string}       title
 * @property {number|null}  durationSec
 *
 * @typedef {Object} CdMetadata
 * @property {string}   album
 * @property {string}   artist
 * @property {string}   releaseId
 * @property {TrackMetadata[]} tracks
 */

/**
 * Describes the udev device properties we care about.
 * @typedef {Object} UdevProps
 * @property {string} [ID_CDROM_MEDIA]  '1' when a CD is inserted; may be undefined when tray is empty
 * @property {string} [SYSTEMD_READY]   '0' when the device is not ready (often after eject)
 */

/**
 * Information about a udev event record.
 * @typedef {Object} UdevEvent
 * @property {'add'|'remove'|'change'|''} action  The udev action type
 * @property {string} devname                      Full device path (e.g. "/dev/sr0")
 * @property {string} [ID_CDROM_MEDIA]             Current media flag
 * @property {string} [SYSTEMD_READY]              Current ready flag
 */

/**
 * Callback fired on every parsed udev event.
 * @callback TrayWatcherEventCallback
 * @param {UdevEvent} event
 * @returns {void}
 */

/**
 * Callback fired when an eject (tray open or no media) is detected.
 * @callback TrayWatcherEjectCallback
 * @param {{ devname: string, media?: string, ready?: string }} info
 * @returns {void}
 */

/**
 * Options used to create a TrayWatcher instance.
 * @typedef {Object} TrayWatcherOptions
 * @property {Console|{info:Function,error:Function}} [logger] Logger or console-like object for logs
 * @property {string} [device] Optional device path filter (e.g. "/dev/sr0")
 * @property {TrayWatcherEjectCallback} [onEject] Called when a CD eject / no media state is detected
 * @property {TrayWatcherEventCallback} [onEvent] Called for every udev event, for debugging or metrics
 * @property {number} [debounceMs=1000] Minimum delay (ms) between successive eject notifications
 */

/**
 * A lightweight watcher that monitors udev for optical-drive insert/eject events.
 * @typedef {Object} TrayWatcher
 * @property {() => void} start   Start monitoring udev events
 * @property {() => void} stop    Stop monitoring and kill the underlying process
 * @property {() => boolean} isRunning  Whether the watcher process is active
 */
