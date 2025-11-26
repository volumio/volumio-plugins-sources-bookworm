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

**Description:** Retrieves current plugin status and statistics.

**Response:**
```json
{
  "deviceState": "idle",
  "fmStationsLoaded": 15,
  "dabStationsLoaded": 23,
  "dbLoadedAt": "2025-01-15T10:30:00.000Z",
  "dbVersion": 1,
  "serverPort": 3456,
  "timestamp": "2025-01-15T12:45:30.000Z"
}
```

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
