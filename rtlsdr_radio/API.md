# RTL-SDR Radio Plugin - API Documentation

## Overview

The RTL-SDR Radio plugin provides a RESTful API for managing radio stations, scanning, and backup/restore operations. All endpoints are accessible via the web management server running on port 3456.

Base URL: `http://<volumio-ip>:3456/api`

## Station Management API

### Get All Stations

**Endpoint:** `GET /api/stations`

**Description:** Retrieves all FM and DAB stations from the database.

**Response:**
```json
{
  "version": 1,
  "fm": [
    {
      "frequency": "94.9",
      "name": "BBC Radio London",
      "favorite": false,
      "hidden": false,
      "deleted": false,
      "id": "fm-94.9"
    }
  ],
  "dab": [
    {
      "ensemble": "12B",
      "service": "BBC Radio1",
      "name": "BBC Radio 1",
      "favorite": false,
      "hidden": false,
      "deleted": false,
      "id": "dab-12B-BBC Radio1"
    }
  ]
}
```

### Save Stations

**Endpoint:** `POST /api/stations`

**Description:** Updates the stations database with modified stations.

**Request Body:**
```json
{
  "stations": {
    "version": 1,
    "fm": [...],
    "dab": [...]
  }
}
```

**Response:**
```json
{
  "success": true
}
```

### Purge Deleted Stations

**Endpoint:** `POST /api/stations/purge`

**Description:** Permanently removes all stations marked as deleted from the database.

**Response:**
```json
{
  "success": true,
  "purgedCount": 5
}
```

### Clear All FM Stations

**Endpoint:** `POST /api/stations/clear-fm`

**Description:** Marks all FM stations as deleted (moves to recycle bin).

**Response:**
```json
{
  "success": true,
  "deletedCount": 12
}
```

### Clear All DAB Stations

**Endpoint:** `POST /api/stations/clear-dab`

**Description:** Marks all DAB stations as deleted (moves to recycle bin).

**Response:**
```json
{
  "success": true,
  "deletedCount": 18
}
```

## Scanning API

### Scan FM Stations

**Endpoint:** `POST /api/stations/scan-fm`

**Description:** Initiates an FM band scan. This is a long-running operation.

**Response:**
```json
{
  "success": true,
  "message": "FM scan started"
}
```

**Notes:**
- Scan duration: 5-15 minutes depending on region
- Uses scan sensitivity from plugin configuration
- Results automatically saved to database

### Scan DAB Stations

**Endpoint:** `POST /api/stations/scan-dab`

**Description:** Initiates a DAB band scan. This is a long-running operation.

**Response:**
```json
{
  "success": true,
  "message": "DAB scan started"
}
```

**Notes:**
- Scan duration: 3-8 minutes
- Scans all DAB Band III channels
- Results automatically saved to database

## Antenna Positioning API

### RF Spectrum Scan

**Endpoint:** `POST /api/antenna/spectrum-scan`

**Description:** Performs a full-band RF spectrum scan to visualize signal strength across FM and DAB frequencies. Useful for antenna positioning and orientation.

**Response:**
```json
{
  "success": true,
  "message": "Spectrum scan started"
}
```

**Notes:**
- Scan duration: Approximately 2 seconds
- Frequency range: 87.5 MHz to 240 MHz (covers FM and DAB Band III)
- Uses fn-rtl_power for spectrum analysis
- Results provide relative signal strength visualization
- Helps identify optimal antenna orientation for available signals
- Requires network access to crates.io for fn-rtl_power dependencies

### DAB Channel Validation (SSE Streaming)

**Endpoint:** `POST /api/antenna/validate-channels`

**Description:** Validates DAB channels for signal presence and service count. Returns progressive results via Server-Sent Events (SSE) as each channel completes.

**Request Body:**
```json
{
  "channels": ["11C", "11D", "12A", "12B", "12C", "12D"]
}
```

**Response Format:** `text/event-stream`

**SSE Event Stream:**
```
data: {"status":"started","total":6}

data: {"channel":"12A","sync":true,"services":17,"quality":"excellent","progress":1,"total":6}

data: {"channel":"12B","sync":true,"services":14,"quality":"excellent","progress":2,"total":6}

data: {"channel":"11C","sync":false,"services":0,"quality":"none","progress":3,"total":6}

data: {"status":"complete","timestamp":"2025-11-21T12:30:45.678Z"}
```

**Event Types:**

1. **Started Event:**
```json
{
  "status": "started",
  "total": 6
}
```

2. **Channel Result Event:**
```json
{
  "channel": "12A",
  "sync": true,
  "services": 17,
  "quality": "excellent",
  "progress": 1,
  "total": 6
}
```

3. **Complete Event:**
```json
{
  "status": "complete",
  "timestamp": "2025-11-21T12:30:45.678Z"
}
```

**Quality Levels:**
- `excellent` - Strong signal, sync achieved, services decoded
- `none` - No signal detected on this channel

**Notes:**
- Progressive results: Each channel streams immediately upon completion
- Validation time per channel:
  - With signal: 10-15 seconds
  - No signal: 2-3 seconds
- Total validation time scales with selected channel count
- Channels are validated sequentially
- Results may arrive out of order (frontend handles automatic sorting)
- Uses custom fn-dab-scanner binaries with filtered debug output
- Three critical bugs fixed in chat 22:
  - Service count detection (PTY wrapper filtering)
  - Completion timeout (immediate kill on completion marker)
  - No-signal overshoot (immediate kill on channel switch)

**Integration Example (JavaScript):**
```javascript
const eventSource = new EventSource('/api/antenna/validate-channels');

eventSource.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.status === 'started') {
    console.log(`Validating ${data.total} channels...`);
  } else if (data.channel) {
    console.log(`${data.channel}: ${data.sync ? data.services + ' services' : 'No signal'}`);
    // Update UI progressively
  } else if (data.status === 'complete') {
    console.log('Validation complete');
    eventSource.close();
  }
});

eventSource.addEventListener('error', (error) => {
  console.error('SSE error:', error);
  eventSource.close();
});
```

## Status API

### Get Plugin Status

**Endpoint:** `GET /api/status`

**Description:** Retrieves current plugin status, statistics, and signal quality information.

**Response:**
```json
{
  "deviceState": "playing_fm",
  "fmStationsLoaded": 15,
  "dabStationsLoaded": 23,
  "dbLoadedAt": "2025-01-15T10:30:00.000Z",
  "dbVersion": 1,
  "serverPort": 3456,
  "signal": {
    "type": "fm",
    "level": 3,
    "percent": 72,
    "frequency": 94.9
  },
  "timestamp": "2025-01-15T12:45:30.000Z"
}
```

**Signal Object (FM):**
```json
{
  "type": "fm",
  "level": 3,
  "percent": 72,
  "frequency": 94.9
}
```

**Signal Object (DAB):**
```json
{
  "type": "dab",
  "level": 4,
  "percent": 87,
  "station": {
    "channel": "12C",
    "serviceName": "Heart London",
    "exactName": "Heart London",
    "stationTitle": "Heart London"
  }
}
```

**Signal Levels:**
- Level 0: No signal / very poor
- Level 1: Weak signal (red indicator)
- Level 2: Fair signal (orange indicator)
- Level 3: Good signal (yellow indicator)
- Level 4: Strong signal (green indicator)
- Level 5: Excellent signal (bright green indicator)

**Notes:**
- `signal` is null when no station is playing
- FM signal derived from RDS block error rate (BLER)
- DAB signal derived from FIB quality and AAC decode success rate
- Signal is polled by station manager every 2 seconds

## Internationalization API

### Get Translations

**Endpoint:** `GET /api/i18n/:lang`

**Description:** Retrieves translation strings for specified language.

**Parameters:**
- `lang` - Language code (en, de, es, fr, it, ja, nl, pl, pt, ru, zh_cn)

**Response:**
```json
{
  "TAB_FM": "FM Radio",
  "TAB_DAB": "DAB Radio",
  "STATION_NAME": "Station Name",
  ...
}
```

### Get Current Language

**Endpoint:** `GET /api/language`

**Description:** Retrieves the current Volumio language setting.

**Response:**
```json
{
  "language": "en"
}
```

## Artwork Block List API

### Get Block List

**Endpoint:** `GET /api/blocklist`

**Description:** Retrieves current artwork blocklist phrases. These phrases are excluded from artwork lookups to prevent false matches on station slogans, time announcements, etc.

**Response:**
```json
{
  "phrases": [
    "traffic update",
    "news update",
    "weather",
    "breaking news",
    "travel news"
  ]
}
```

### Save Block List

**Endpoint:** `POST /api/blocklist`

**Description:** Saves artwork blocklist phrases.

**Request Body:**
```json
{
  "phrases": [
    "traffic update",
    "news update",
    "custom phrase"
  ]
}
```

**Response:**
```json
{
  "success": true
}
```

### Reset Block List

**Endpoint:** `POST /api/blocklist/reset`

**Description:** Resets blocklist to default phrases.

**Response:**
```json
{
  "success": true,
  "phrases": [
    "traffic update",
    "news update",
    "weather",
    "breaking news",
    "travel news"
  ]
}
```

**Notes:**
- Blocklist uses fuzzy matching (75% similarity threshold) to handle RDS text corruption
- Phrases are case-insensitive
- Blocklist has separate backup/restore from stations and config

## Backup and Restore API

### Get Maintenance Settings

**Endpoint:** `GET /api/maintenance/settings`

**Description:** Retrieves current maintenance settings.

**Response:**
```json
{
  "autoBackup": false
}
```

### Save Maintenance Settings

**Endpoint:** `POST /api/maintenance/settings`

**Description:** Updates maintenance settings.

**Request Body:**
```json
{
  "autoBackup": true
}
```

**Response:**
```json
{
  "success": true
}
```

### List Available Backups

**Endpoint:** `GET /api/maintenance/backup/list`

**Description:** Retrieves list of all available backups.

**Response:**
```json
{
  "stations": [
    {
      "filename": "stations-2025-01-15T10-30-00-000Z.json",
      "timestamp": "2025-01-15T10-30-00-000Z",
      "size": 4582,
      "date": "2025-01-15T10:30:00.000Z"
    }
  ],
  "config": [
    {
      "filename": "config-2025-01-15T10-30-00-000Z.json",
      "timestamp": "2025-01-15T10-30-00-000Z",
      "size": 256,
      "date": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

### Create Backup

**Endpoint:** `POST /api/maintenance/backup/create`

**Description:** Creates a new backup.

**Request Body:**
```json
{
  "type": "stations"
}
```

**Parameters:**
- `type` - Backup type: `stations`, `config`, or `full`

**Response:**
```json
{
  "success": true,
  "message": "Backup created successfully"
}
```

**Notes:**
- `full` type creates both stations and config backups with same timestamp
- Automatic pruning keeps only 5 most recent backups per type
- Backups stored in `/data/rtlsdr_radio_backups/`

### Restore Backup

**Endpoint:** `POST /api/maintenance/backup/restore`

**Description:** Restores from selected backups and restarts plugin.

**Request Body:**
```json
{
  "stationsTimestamp": "2025-01-15T10-30-00-000Z",
  "configTimestamp": "2025-01-15T10-30-00-000Z"
}
```

**Parameters:**
- `stationsTimestamp` - Timestamp of stations backup (optional)
- `configTimestamp` - Timestamp of config backup (optional)
- At least one timestamp must be provided

**Response:**
```json
{
  "success": true,
  "message": "Backup restored, restarting..."
}
```

**Notes:**
- Triggers system reboot after restore
- Mix-and-match restore supported (different timestamps)
- Empty string or null uses latest backup for that type

### Delete Backup

**Endpoint:** `DELETE /api/maintenance/backup/delete`

**Description:** Permanently deletes a backup file.

**Request Body:**
```json
{
  "type": "stations",
  "timestamp": "2025-01-15T10-30-00-000Z"
}
```

**Parameters:**
- `type` - Backup type: `stations` or `config`
- `timestamp` - Backup timestamp

**Response:**
```json
{
  "success": true
}
```

### Download Backup

**Endpoint:** `GET /api/maintenance/backup/download`

**Description:** Downloads a backup as a ZIP file.

**Query Parameters:**
- `type` - Backup type: `stations` or `config`
- `timestamp` - Backup timestamp

**Response:**
- Content-Type: `application/zip`
- File download stream

**Example:**
```
GET /api/maintenance/backup/download?type=stations&timestamp=2025-01-15T10-30-00-000Z
```

### Upload and Preview Backup

**Endpoint:** `POST /api/maintenance/backup/upload`

**Description:** Uploads and validates a backup file without restoring it.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file` - ZIP file containing backup

**Response:**
```json
{
  "success": true,
  "info": {
    "type": "stations",
    "fmCount": 15,
    "dabCount": 23
  }
}
```

**Error Response:**
```json
{
  "error": "Invalid backup file format"
}
```

**Notes:**
- Validates JSON structure
- Detects backup type automatically
- Returns station counts for stations backups
- Does not modify system

### Upload and Restore Backup

**Endpoint:** `POST /api/maintenance/backup/upload-restore`

**Description:** Uploads a backup file and restores it immediately.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file` - ZIP file containing backup

**Response:**
```json
{
  "success": true,
  "message": "Backup restored, restarting..."
}
```

**Notes:**
- Validates backup before restoring
- Automatically detects backup type
- Triggers system reboot after restore
- Cleans up temporary files

## CSV Import/Export

The CSV endpoints allow offline station management through standard CSV files.

### Download FM Template

**Endpoint:** `GET /api/csv/template/fm`

**Description:** Downloads an empty FM stations CSV template with headers and example row.

**Response:** CSV file download

**Template Content:**
```csv
frequency,name,customName,favorite,hidden,notes
94.9,Example FM,My Radio,false,false,Optional notes
```

### Download DAB Template

**Endpoint:** `GET /api/csv/template/dab`

**Description:** Downloads an empty DAB stations CSV template with headers and example row.

**Response:** CSV file download

**Template Content:**
```csv
channel,exactName,name,customName,ensemble,serviceId,favorite,hidden,notes
12C,BBC Radio 1,BBC Radio 1,,London 1,0,true,false,Optional notes
```

### Export FM Stations

**Endpoint:** `GET /api/csv/export/fm`

**Description:** Exports all non-deleted FM stations to CSV file.

**Response:** CSV file download with timestamp filename (e.g., `stations_fm_2025-01-15T10-30-00.csv`)

**CSV Headers:**
- `frequency` - FM frequency (e.g., "94.9")
- `name` - Station name from scan
- `customName` - User-defined custom name
- `favorite` - true/false
- `hidden` - true/false
- `notes` - User notes

### Export DAB Stations

**Endpoint:** `GET /api/csv/export/dab`

**Description:** Exports all non-deleted DAB stations to CSV file.

**Response:** CSV file download with timestamp filename (e.g., `stations_dab_2025-01-15T10-30-00.csv`)

**CSV Headers:**
- `channel` - DAB channel (e.g., "12C")
- `exactName` - Exact service name (with trailing spaces preserved)
- `name` - Display name
- `customName` - User-defined custom name
- `ensemble` - Ensemble name
- `serviceId` - DAB service identifier (technical field, use "0" for manual entries)
- `favorite` - true/false
- `hidden` - true/false
- `notes` - User notes

### Validate CSV File

**Endpoint:** `POST /api/csv/validate`

**Description:** Validates a CSV file without importing. Use before import to check for errors.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file` - CSV file to validate

**Response:**
```json
{
  "valid": true,
  "type": "fm",
  "filename": "my_stations.csv",
  "totalRows": 25,
  "validCount": 23,
  "errors": [
    { "line": 5, "message": "Invalid frequency \"abc\"" },
    { "line": 12, "message": "Frequency 110.5 out of range (87.5-108.0)" }
  ],
  "stations": [...]
}
```

**Validation Rules:**

FM Stations:
- `frequency` - Required, numeric, must be within configured FM band (default 87.5-108.0)
- `name` - Optional, defaults to "FM {frequency}"
- `customName` - Optional
- `favorite` - Optional, accepts true/false/1/0/yes/no
- `hidden` - Optional, accepts true/false/1/0/yes/no
- `notes` - Optional

DAB Stations:
- `channel` - Required, valid DAB channel (5A-13F)
- `exactName` - Required, service identifier (spaces preserved)
- `name` - Optional, defaults to exactName
- `customName` - Optional
- `ensemble` - Optional
- `serviceId` - Optional, defaults to "0" (technical field from DAB scan)
- `favorite` - Optional
- `hidden` - Optional
- `notes` - Optional

### Import CSV File

**Endpoint:** `POST /api/csv/import`

**Description:** Imports stations from CSV file with specified operation.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file` - CSV file to import
- `operation` - Import operation (replace/amend/extend/remove)

**Operations:**

| Operation | Description |
|-----------|-------------|
| `replace` | Clear all stations of detected type (FM or DAB), import all from CSV |
| `amend` | Update existing stations that match, preserve playCount/lastPlayed/dateAdded |
| `extend` | Add new stations only, skip stations that already exist |
| `remove` | Mark matching stations as deleted |

**Matching Logic:**
- FM: Matches by frequency (parseFloat comparison)
- DAB: Matches by channel AND exactName (exact string match)

**Response:**
```json
{
  "success": true,
  "type": "fm",
  "operation": "extend",
  "imported": 5,
  "updated": 0,
  "removed": 0,
  "skipped": 18
}
```

**Error Response:**
```json
{
  "error": "Validation failed",
  "errors": [
    { "line": 3, "message": "Invalid frequency" }
  ]
}
```

**Notes:**
- File is validated before import
- Maximum file size: 1MB
- Type (FM/DAB) detected automatically from headers
- FM frequency range respects `fm_lower_freq` configuration setting
- Quoted values with commas are handled correctly
- Import triggers automatic save to stations database

## Error Responses

All endpoints return standard error responses:

```json
{
  "error": "Error message description"
}
```

**HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (invalid parameters)
- `404` - Resource not found
- `500` - Internal server error

## Rate Limiting

Currently no rate limiting is implemented. Scanning endpoints should not be called more than once every few minutes to avoid conflicts.

## Authentication

No authentication is currently required. Access control should be implemented at the network level (firewall, reverse proxy).

## File Locations

### Station Database
- Path: `/data/plugins/music_service/rtlsdr_radio/stations.json`
- Format: JSON
- Versioned: Yes (version field in JSON)

### Plugin Configuration
- Path: `/data/configuration/music_service/rtlsdr_radio/config.json`
- Format: JSON
- Managed by: Volumio configuration system

### Backups
- Base path: `/data/rtlsdr_radio_backups/`
- Stations: `/data/rtlsdr_radio_backups/stations/`
- Config: `/data/rtlsdr_radio_backups/config/`
- Format: JSON (stored as .zip when downloaded)

## Data Formats

### Station Object (FM)
```json
{
  "frequency": "94.9",
  "name": "BBC Radio London",
  "favorite": false,
  "hidden": false,
  "deleted": false,
  "id": "fm-94.9"
}
```

### Station Object (DAB)
```json
{
  "ensemble": "12B",
  "service": "BBC Radio1",
  "name": "BBC Radio 1",
  "favorite": false,
  "hidden": false,
  "deleted": false,
  "id": "dab-12B-BBC Radio1"
}
```

### Station Database Structure
```json
{
  "version": 1,
  "fm": [
    // Array of FM station objects
  ],
  "dab": [
    // Array of DAB station objects
  ]
}
```

### Configuration Structure
```json
{
  "enabled": {
    "type": "boolean",
    "value": false
  },
  "fm_enabled": {
    "type": "boolean",
    "value": false
  },
  "dab_enabled": {
    "type": "boolean",
    "value": false
  },
  "fm_gain": {
    "type": "number",
    "value": 50
  },
  "dab_gain": {
    "type": "number",
    "value": 80
  },
  "dab_ppm": {
    "type": "number",
    "value": 0
  },
  "scan_sensitivity": {
    "type": "number",
    "value": 8
  },
  "sample_rate": {
    "type": "number",
    "value": 48000
  },
  "auto_backup_on_uninstall": {
    "type": "boolean",
    "value": false
  },
  "artwork_ttl": {
    "type": "number",
    "value": 0
  },
  "artwork_debug_logging": {
    "type": "boolean",
    "value": false
  }
}
```

## Integration Examples

### JavaScript (Fetch API)

```javascript
// Get all stations
fetch('http://volumio.local:3456/api/stations')
  .then(response => response.json())
  .then(data => console.log(data));

// Create backup
fetch('http://volumio.local:3456/api/maintenance/backup/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'full' })
})
  .then(response => response.json())
  .then(data => console.log(data));

// Upload backup
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('http://volumio.local:3456/api/maintenance/backup/upload', {
  method: 'POST',
  body: formData
})
  .then(response => response.json())
  .then(data => console.log(data));
```

### Python (requests)

```python
import requests

# Get all stations
response = requests.get('http://volumio.local:3456/api/stations')
stations = response.json()

# Create backup
response = requests.post(
    'http://volumio.local:3456/api/maintenance/backup/create',
    json={'type': 'full'}
)
result = response.json()

# Upload backup
files = {'file': open('backup.zip', 'rb')}
response = requests.post(
    'http://volumio.local:3456/api/maintenance/backup/upload',
    files=files
)
result = response.json()
```

### cURL

```bash
# Get all stations
curl http://volumio.local:3456/api/stations

# Create backup
curl -X POST http://volumio.local:3456/api/maintenance/backup/create \
  -H "Content-Type: application/json" \
  -d '{"type":"full"}'

# Download backup
curl -O http://volumio.local:3456/api/maintenance/backup/download?type=stations&timestamp=2025-01-15T10-30-00-000Z

# Upload backup
curl -X POST http://volumio.local:3456/api/maintenance/backup/upload \
  -F "file=@backup.zip"
```

## Changelog

### API v1.3.5
- SNR measurement tool enhancements
  - Fixed NaN handling in parseRtlPowerOutput for malformed CSV data
  - Invalid power values now filtered during noise floor calculation
  - Single channel measurements now work correctly
- Default gain range updated to 0-50 (was -10 to 49)
- Maximum gain range extended to 100 for V4/extended hardware
- No new API endpoints (internal improvements only)

### API v1.3.4
- Added SNR measurement endpoint POST /api/antenna/snr-scan
  - Measures SNR for specified channels across gain range
  - Returns SSE stream with progress updates and final results
  - Response includes per-channel measurements and best gain recommendation
- New lib/snr.js module with DAB channel frequencies and SNR calculation
- Fixed extractAndValidateZip to recognize blocklist backup format
- Blocklist backups now validate correctly when uploading via maintenance UI
- Added phraseCount to validation info response for blocklist uploads

### API v1.3.1
- Added Open Opus API integration for classical music composer portraits
- New metadata.js exports:
  - openOpusLookup(composer, callback) - queries Open Opus API for composer portrait
  - isLikelyClassicalComposer(artist) - checks against 150+ known classical composers
- lookupAlbum() now falls back to Open Opus when Last.fm has no artwork
- Lookup results may include isComposerPortrait flag indicating direct portrait URL
- Portrait URLs served directly from assets.openopus.org (no Volumio proxy)

### API v1.3.0
- Fixed FM artwork throttle bug - metadata parsing now happens before throttle check
- Debug logging for artwork system now controlled by artwork_debug_logging setting
- Consolidated all v1.2.9 fixes for production release

### API v1.2.9
- Added Last.fm artwork integration via track.getInfo API
- New configuration fields:
  - artwork_confidence_threshold (0, 20, 40, 60, 80, 95 - default 60)
  - artwork_persistence (boolean, default true)
  - artwork_ttl (0, 2, 5, 10, 15, 30 minutes)
  - artwork_debug_logging (boolean, default false)
- New blocklist API endpoints:
  - GET /api/blocklist - retrieve current blocklist phrases
  - POST /api/blocklist - save blocklist phrases
  - POST /api/blocklist/reset - reset to default blocklist
- Blocklist backup/restore:
  - Separate backup folder: /data/rtlsdr_radio_backups/blocklist/
  - GET /api/maintenance/backups now includes blocklist backups
  - POST /api/maintenance/backup/create supports type: "blocklist"
  - POST /api/maintenance/restore supports blocklistTimestamp parameter
- POST /api/stations now validates FM frequency types, converting numbers to strings
- Fixes issue where Station Manager frequency edits broke Recently Played tracking
- Plugin startup auto-repairs existing stations with number frequencies

### API v1.2.6
- Fixed signal quality not updating in playback screen (throttle bypass for signal changes)
- Fixed custom station names not displaying at playback start (FM and DAB)
- Custom names now looked up from database at playback time, not from queued track
- Fixed hidden stations still appearing in browse views (FM, DAB, ensemble)

### API v1.2.5
- Added real-time signal quality to `/api/status` endpoint
- Signal object includes: type, level (0-5), percent, and station info
- FM signal quality derived from RDS block error rate (BLER)
- DAB signal quality derived from FIB quality and AAC decode success rate
- Station manager polls signal every 2 seconds for live display
- Signal indicator shown in playback screen (Unicode circles)
- Signal indicator shown in station manager (Font Awesome icon, color-coded)

### API v1.2.2
- DAB playback now pushes DLS metadata (artist/title) to Volumio state
- Volumio state fields updated during DAB playback:
  - `title`: Station display name (customName > station.name)
  - `artist`: DLS-parsed artist or ensemble name
  - `album`: DLS-parsed title or "DAB Radio"
- Internal: Added `-i /tmp/dab/` flag to fn-dab command for metadata output
- No new configuration fields - DLS metadata is automatically enabled

### API v1.2.1
- Added dab_ppm configuration field for frequency correction
- PPM correction resolves DAB reception issues with cheap RTL-SDR dongles
- Range: -200 to +200 (typical values: 40-60 for cheap dongles, 0 for quality dongles)
- DAB scanning and playback commands now include -p flag when PPM is non-zero

### API v1.0.9
- Added Antenna Positioning API
- RF Spectrum Scan endpoint for full-band signal visualization
- DAB Channel Validation with Server-Sent Events (SSE) streaming
- Progressive channel validation results
- Fixed three critical DAB scanner bugs:
  - Service count detection (PTY wrapper filtering)
  - Completion timeout (immediate scanner termination)
  - No-signal channel overshoot (channel switch detection)
- Translation concept corrected: "positioning" (antenna orientation) not "alignment" (leveling)
- All 11 language files validated and aligned (366 keys each)
- Complete antenna positioning tab translation coverage

### API v1.0.7
- Added backup and restore endpoints
- Added maintenance settings endpoints
- Introduced automatic backup pruning
- Added ZIP export/import functionality
- Mix-and-match restore capability

### API v1.0.0
- Initial API release
- Station management endpoints
- Scanning endpoints
- Status and i18n endpoints
