# Pi Screen Setup - Preset Manager API Documentation

## Overview

The Pi Screen Setup plugin exposes a REST API on port 4567 for managing display presets. This API powers the Preset Manager web interface and can be used for programmatic access, automation, and integration.

**Base URL**: `http://volumio.local:4567/api`

**Authentication**: None required (local network access only)

**Content-Type**: All POST requests expect `application/json`

## Table of Contents

1. [Language and i18n](#language-and-i18n)
2. [Database Information](#database-information)
3. [Preset Management](#preset-management)
4. [Database Operations](#database-operations)
5. [Backup Management](#backup-management)
6. [Data Structures](#data-structures)
7. [Error Handling](#error-handling)
8. [Usage Examples](#usage-examples)

---

## Language and i18n

### GET /api/language

Returns the current Volumio system language code.

**Request**
```
GET /api/language
```

**Response**
```json
{
  "language": "en"
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| language | string | ISO 639-1 language code (en, de, fr, es, it, nl) |

**Notes**
- Returns "en" as fallback if language detection fails
- Language is read from Volumio's sharedVars system

---

### GET /api/i18n/:lang

Returns translation strings for the specified language.

**Request**
```
GET /api/i18n/de
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| lang | path | yes | Language code (en, de, fr, es, it, nl) |

**Response**
```json
{
  "PM_TITLE": "Preset-Manager",
  "PM_SEARCH_PLACEHOLDER": "Presets durchsuchen...",
  "PM_ADD_PRESET": "Preset hinzufugen",
  ...
}
```

**Response Fields**
- Object containing all translation key-value pairs
- Keys prefixed with PM_* are for Preset Manager
- Keys without prefix are for main plugin UI

**Error Response** (500)
```json
{
  "error": "Failed to load translations"
}
```

**Notes**
- Falls back to English if requested language not found
- Translation files stored in plugin's i18n/ directory

---

## Database Information

### GET /api/database/info

Returns metadata about the current presets database.

**Request**
```
GET /api/database/info
```

**Response**
```json
{
  "localVersion": "1.4.0",
  "remoteVersion": "1.4.2",
  "presetCount": 144,
  "source": "bundled"
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| localVersion | string | Version of currently loaded database |
| remoteVersion | string | Version available from GitHub (or "-" if unknown) |
| presetCount | integer | Number of presets in current database |
| source | string | Database source: "bundled", "cached", or "remote" |

---

## Preset Management

### GET /api/presets

Returns all presets from the current draft database.

**Request**
```
GET /api/presets
```

**Response**
```json
{
  "version": "1.4.0",
  "presets": {
    "auto": {
      "name": "Auto Detect (EDID)",
      "type": "hdmi",
      "description": "Let the display report its capabilities",
      "config": {}
    },
    "waveshare-11.9-hdmi": {
      "name": "Waveshare 11.9\" HDMI LCD (320x1480)",
      "type": "hdmi",
      "description": "Portrait native bar display",
      "native_resolution": "320x1480",
      "rotated_resolution": "1480x320",
      "config": {
        "hdmi_group": 2,
        "hdmi_mode": 87,
        "hdmi_timings": "320 0 80 16 32 1480 0 16 4 12 0 0 0 60 0 42000000 3",
        "max_framebuffer_height": 1480
      },
      "video_mode": "320x1480M@60",
      "recommended_rotation": 90,
      "notes": "Requires volumio-adaptive plymouth theme"
    },
    ...
  }
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| version | string | Database version string |
| presets | object | Map of preset ID to preset object |

---

### GET /api/presets/:id

Returns a single preset by ID.

**Request**
```
GET /api/presets/waveshare-7-hdmi
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| id | path | yes | Preset identifier |

**Response** (200)
```json
{
  "id": "waveshare-7-hdmi",
  "preset": {
    "name": "Waveshare 7\" HDMI LCD (1024x600)",
    "type": "hdmi",
    "description": "Standard 7-inch HDMI display",
    "native_resolution": "1024x600",
    "config": {
      "hdmi_group": 2,
      "hdmi_mode": 87,
      "hdmi_cvt": "1024 600 60 6 0 0 0"
    },
    "recommended_rotation": 0
  }
}
```

**Error Response** (404)
```json
{
  "error": "Preset not found"
}
```

---

### POST /api/presets

Creates a new preset.

**Request**
```
POST /api/presets
Content-Type: application/json

{
  "id": "myvendor-10inch-hdmi",
  "name": "MyVendor 10\" HDMI Display",
  "type": "hdmi",
  "description": "Custom 10-inch display with touch",
  "config": {
    "hdmi_group": 2,
    "hdmi_mode": 87,
    "hdmi_cvt": "1280 800 60 6 0 0 0"
  },
  "version": "1.4.1"
}
```

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Unique preset identifier (lowercase, hyphens) |
| name | string | yes | Human-readable display name |
| type | string | no | Display type: hdmi, dsi, dpi (default: hdmi) |
| description | string | no | Description of the display |
| config | object | no | Configuration parameters (default: {}) |
| version | string | no | Update database version after adding |

**Response** (200)
```json
{
  "success": true,
  "id": "myvendor-10inch-hdmi"
}
```

**Error Response** (400)
```json
{
  "error": "ID and name are required"
}
```

**Error Response** (409)
```json
{
  "error": "Preset ID already exists"
}
```

**Notes**
- New presets are automatically published to working copy
- Draft dirty flag is set after creation

---

### POST /api/presets/:id

Updates an existing preset.

**Request**
```
POST /api/presets/myvendor-10inch-hdmi
Content-Type: application/json

{
  "name": "MyVendor 10\" HDMI Display (Updated)",
  "description": "Custom 10-inch display with 10-point touch",
  "config": {
    "hdmi_group": 2,
    "hdmi_mode": 87,
    "hdmi_cvt": "1280 800 60 6 0 0 0",
    "hdmi_drive": 2
  },
  "version": "1.4.2"
}
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| id | path | yes | Preset identifier to update |

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | no | New display name (keeps existing if omitted) |
| type | string | no | New display type (keeps existing if omitted) |
| description | string | no | New description (keeps existing if omitted) |
| config | object | no | New config (keeps existing if omitted) |
| version | string | no | Update database version |

**Response** (200)
```json
{
  "success": true,
  "id": "myvendor-10inch-hdmi"
}
```

**Error Response** (404)
```json
{
  "error": "Preset not found"
}
```

---

### DELETE /api/presets/:id

Deletes a preset.

**Request**
```
DELETE /api/presets/myvendor-10inch-hdmi?version=1.4.3
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| id | path | yes | Preset identifier to delete |
| version | query | no | Update database version after deletion |

**Response** (200)
```json
{
  "success": true
}
```

**Error Response** (404)
```json
{
  "error": "Preset not found"
}
```

---

## Database Operations

### POST /api/database/import-url

Imports a presets database from a remote URL.

**Request**
```
POST /api/database/import-url
Content-Type: application/json

{
  "url": "https://raw.githubusercontent.com/foonerd/pi_screen_setup/main/display_presets.json"
}
```

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | yes | URL to JSON database file |

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.2",
  "count": 144
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Operation result |
| version | string | Version of imported database |
| count | integer | Number of presets imported |

**Error Response** (400)
```json
{
  "error": "URL is required"
}
```

**Error Response** (500)
```json
{
  "error": "Invalid database format"
}
```

---

### POST /api/database/import-path

Imports a presets database from a local file path.

**Request**
```
POST /api/database/import-path
Content-Type: application/json

{
  "path": "/home/volumio/my_presets.json"
}
```

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | yes | Absolute path to JSON database file |

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.0",
  "count": 150
}
```

**Error Response** (400)
```json
{
  "error": "Path is required"
}
```

**Error Response** (404)
```json
{
  "error": "File not found"
}
```

---

### POST /api/database/import-data

Imports a presets database from POST body data.

**Request**
```
POST /api/database/import-data
Content-Type: application/json

{
  "version": "1.5.0",
  "presets": {
    "custom-display-1": {
      "name": "Custom Display",
      "type": "hdmi",
      "description": "My custom display",
      "config": {}
    }
  }
}
```

**Request Body Fields**
- Complete database object with version and presets

**Response** (200)
```json
{
  "success": true,
  "version": "1.5.0",
  "count": 1
}
```

**Error Response** (400)
```json
{
  "error": "Invalid database format"
}
```

---

### GET /api/database/export

Downloads the current database as a JSON file.

**Request**
```
GET /api/database/export
```

**Response**
- Content-Type: application/json
- Content-Disposition: attachment; filename=display_presets.json

```json
{
  "version": "1.4.0",
  "date": "2026-01-19",
  "presets": {
    ...
  }
}
```

**Notes**
- Triggers browser download
- Includes current date in exported file

---

### POST /api/database/export-pr

Exports database to a file on the filesystem for GitHub PR submission.

**Request**
```
POST /api/database/export-pr
```

**Response** (200)
```json
{
  "success": true,
  "path": "/data/plugins/system_hardware/pi_screen_setup/presets_cache/display_presets_export.json"
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Operation result |
| path | string | Filesystem path to exported file |

**Notes**
- File can be copied via SSH for pull request submission
- Export location: /data/plugins/system_hardware/pi_screen_setup/presets_cache/

---

### POST /api/database/publish

Publishes the current draft to the cached database.

**Request**
```
POST /api/database/publish
```

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.0"
}
```

**Error Response** (400)
```json
{
  "error": "No draft to publish"
}
```

**Notes**
- Saves draft to: /data/plugins/system_hardware/pi_screen_setup/presets_cache/remote.json
- Sets database source to "cached"
- Clears draft dirty flag

---

### POST /api/database/revert

Reverts to the bundled (original) database shipped with the plugin.

**Request**
```
POST /api/database/revert
```

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.0"
}
```

**Notes**
- Discards all custom changes
- Resets draft to bundled version
- Sets database source to "bundled"
- Clears draft dirty flag

---

### POST /api/database/reload-cache

Reloads the database from the cached file.

**Request**
```
POST /api/database/reload-cache
```

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.0"
}
```

**Error Response** (404)
```json
{
  "error": "No cached database found"
}
```

**Notes**
- Loads from: /data/plugins/system_hardware/pi_screen_setup/presets_cache/remote.json
- Useful after manual file edits
- Sets database source to "cached"

---

## Backup Management

### GET /api/backups

Lists all available preset database backups.

**Request**
```
GET /api/backups
```

**Response** (200)
```json
{
  "backups": [
    {
      "name": "presets_backup_2026-01-19T14-30-00-000Z.json",
      "date": "2026-01-19T14:30:00.000Z"
    },
    {
      "name": "presets_backup_2026-01-18T10-15-00-000Z.json",
      "date": "2026-01-18T10:15:00.000Z"
    }
  ]
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| backups | array | List of backup objects |
| backups[].name | string | Backup filename |
| backups[].date | string | ISO 8601 timestamp of backup creation |

**Notes**
- Backups sorted by date (newest first)
- Stored in: /data/plugins/system_hardware/pi_screen_setup/presets_cache/backups/

---

### POST /api/backups

Creates a new backup of the current draft database.

**Request**
```
POST /api/backups
```

**Response** (200)
```json
{
  "success": true,
  "name": "presets_backup_2026-01-19T14-30-00-000Z.json"
}
```

**Response Fields**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Operation result |
| name | string | Generated backup filename |

---

### GET /api/backups/:name

Downloads a specific backup file.

**Request**
```
GET /api/backups/presets_backup_2026-01-19T14-30-00-000Z.json
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| name | path | yes | Backup filename |

**Response**
- File download of the backup JSON

**Error Response** (404)
```json
{
  "error": "Backup not found"
}
```

---

### DELETE /api/backups/:name

Deletes a specific backup file.

**Request**
```
DELETE /api/backups/presets_backup_2026-01-19T14-30-00-000Z.json
```

**Parameters**
| Parameter | Location | Required | Description |
|-----------|----------|----------|-------------|
| name | path | yes | Backup filename to delete |

**Response** (200)
```json
{
  "success": true
}
```

**Error Response** (404)
```json
{
  "error": "Backup not found"
}
```

---

### POST /api/backups/upload

Uploads a backup file from client data.

**Request**
```
POST /api/backups/upload
Content-Type: application/json

{
  "name": "my_custom_backup.json",
  "data": {
    "version": "1.4.0",
    "presets": {
      ...
    }
  }
}
```

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | no | Backup filename (auto-generated if omitted) |
| data | object | yes | Complete database object with presets |

**Response** (200)
```json
{
  "success": true,
  "name": "my_custom_backup.json"
}
```

**Error Response** (400)
```json
{
  "error": "Invalid backup data"
}
```

---

### POST /api/backups/restore

Restores a backup to the current draft and working copy.

**Request**
```
POST /api/backups/restore
Content-Type: application/json

{
  "name": "presets_backup_2026-01-19T14-30-00-000Z.json"
}
```

**Request Body Fields**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Backup filename to restore |

**Response** (200)
```json
{
  "success": true,
  "version": "1.4.0"
}
```

**Error Response** (404)
```json
{
  "error": "Backup not found"
}
```

**Error Response** (400)
```json
{
  "error": "Invalid backup format"
}
```

**Notes**
- Overwrites current draft with backup data
- Immediately updates working copy
- Clears draft dirty flag

---

## Data Structures

### Database Object

The top-level structure for preset databases.

```json
{
  "version": "1.4.0",
  "last_updated": "2026-01-19",
  "presets": {
    "preset-id": { ... },
    ...
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| version | string | Semantic version string |
| last_updated | string | Date in YYYY-MM-DD format |
| presets | object | Map of preset ID to preset object |

---

### Preset Object

Structure for individual display presets.

**HDMI Preset Example**
```json
{
  "name": "Waveshare 11.9\" HDMI LCD (320x1480)",
  "type": "hdmi",
  "description": "Portrait native bar display, requires rotation for landscape use",
  "native_resolution": "320x1480",
  "rotated_resolution": "1480x320",
  "config": {
    "hdmi_group": 2,
    "hdmi_mode": 87,
    "hdmi_timings": "320 0 80 16 32 1480 0 16 4 12 0 0 0 60 0 42000000 3",
    "max_framebuffer_height": 1480
  },
  "video_mode": "320x1480M@60",
  "recommended_rotation": 90,
  "notes": "Requires volumio-adaptive plymouth theme for proper boot splash"
}
```

**DSI Preset Example**
```json
{
  "name": "Raspberry Pi Touch Display 7\" (Original)",
  "type": "dsi",
  "description": "Official 7-inch DSI touchscreen (800x480)",
  "native_resolution": "800x480",
  "config": {
    "dtoverlay": "vc4-kms-dsi-7inch"
  },
  "recommended_rotation": 0,
  "notes": "Original 7-inch display with FT5406 touch controller",
  "overlay_rotation_param": false
}
```

**DPI Preset Example**
```json
{
  "name": "Waveshare 2.8\" DPI LCD (480x640)",
  "type": "dpi",
  "description": "Portrait DPI display with 5-point capacitive touch",
  "native_resolution": "480x640",
  "rotated_resolution": "640x480",
  "config": {
    "dtoverlay": "vc4-kms-v3d",
    "dtoverlay_2": "vc4-kms-dpi-2inch8",
    "dtoverlay_3": "waveshare-28dpi-3b-4b",
    "dtoverlay_4": "waveshare-touch-28dpi"
  },
  "recommended_rotation": 90,
  "notes": "Requires Waveshare overlay files in /boot/overlays. Portrait native."
}
```

**Preset Fields Reference**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | yes | Human-readable display name |
| type | string | yes | Display type: hdmi, dsi, dpi |
| description | string | no | Description of the display |
| native_resolution | string | no | Native resolution (e.g., "1024x600") |
| rotated_resolution | string | no | Resolution when rotated 90 degrees |
| config | object | yes | Configuration parameters for config.txt |
| video_mode | string | no | Kernel video= parameter value |
| recommended_rotation | integer | no | Recommended rotation: 0, 90, 180, 270 |
| notes | string | no | Additional notes for users |
| overlay_rotation_param | boolean | no | Whether overlay supports rotation parameter |

---

### Config Object Parameters

Parameters stored in the config object are written to /boot/videoconfig.txt.

**HDMI Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| hdmi_group | integer | HDMI group (1=CEA, 2=DMT) |
| hdmi_mode | integer | HDMI mode number (87 for custom) |
| hdmi_timings | string | Raw timing values for custom modes |
| hdmi_cvt | string | CVT timing generator parameters |
| hdmi_drive | integer | HDMI mode (1=DVI, 2=HDMI with audio) |
| hdmi_pixel_freq_limit | integer | Maximum pixel clock frequency |
| max_framebuffer_height | integer | Maximum framebuffer height for tall displays |
| gpu_mem | integer | GPU memory allocation in MB |

**DSI/DPI Parameters**
| Parameter | Type | Description |
|-----------|------|-------------|
| dtoverlay | string | Primary device tree overlay |
| dtoverlay_2 | string | Secondary overlay (if needed) |
| dtoverlay_3 | string | Tertiary overlay (if needed) |
| dtoverlay_4 | string | Fourth overlay (if needed) |

---

## Error Handling

All API endpoints return consistent error responses.

### Error Response Format
```json
{
  "error": "Error message description"
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | Request completed successfully |
| 400 | Bad Request | Missing required fields, invalid format |
| 404 | Not Found | Preset/backup/file not found |
| 409 | Conflict | Duplicate preset ID |
| 500 | Server Error | Internal error, file system issues |

---

## Usage Examples

### curl Examples

**Get database info**
```bash
curl http://volumio.local:4567/api/database/info
```

**List all presets**
```bash
curl http://volumio.local:4567/api/presets
```

**Get specific preset**
```bash
curl http://volumio.local:4567/api/presets/waveshare-7-hdmi
```

**Add new preset**
```bash
curl -X POST http://volumio.local:4567/api/presets \
  -H "Content-Type: application/json" \
  -d '{
    "id": "custom-display",
    "name": "My Custom Display",
    "type": "hdmi",
    "description": "Custom 7-inch display",
    "config": {
      "hdmi_group": 2,
      "hdmi_mode": 87,
      "hdmi_cvt": "1024 600 60 6 0 0 0"
    }
  }'
```

**Update preset**
```bash
curl -X POST http://volumio.local:4567/api/presets/custom-display \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "config": {
      "hdmi_group": 2,
      "hdmi_mode": 87,
      "hdmi_cvt": "1024 600 60 6 0 0 0",
      "hdmi_drive": 2
    }
  }'
```

**Delete preset**
```bash
curl -X DELETE http://volumio.local:4567/api/presets/custom-display
```

**Import from URL**
```bash
curl -X POST http://volumio.local:4567/api/database/import-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/presets.json"}'
```

**Export database (save to file)**
```bash
curl http://volumio.local:4567/api/database/export > my_presets.json
```

**Create backup**
```bash
curl -X POST http://volumio.local:4567/api/backups
```

**List backups**
```bash
curl http://volumio.local:4567/api/backups
```

**Restore backup**
```bash
curl -X POST http://volumio.local:4567/api/backups/restore \
  -H "Content-Type: application/json" \
  -d '{"name": "presets_backup_2026-01-19T14-30-00-000Z.json"}'
```

**Revert to bundled database**
```bash
curl -X POST http://volumio.local:4567/api/database/revert
```

---

### JavaScript/Fetch Examples

**Get presets**
```javascript
fetch('http://volumio.local:4567/api/presets')
  .then(response => response.json())
  .then(data => {
    console.log('Version:', data.version);
    console.log('Preset count:', Object.keys(data.presets).length);
  });
```

**Add preset**
```javascript
fetch('http://volumio.local:4567/api/presets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'my-display',
    name: 'My Display',
    type: 'hdmi',
    config: { hdmi_group: 2, hdmi_mode: 82 }
  })
})
.then(response => response.json())
.then(data => console.log(data));
```

---

## File Locations

| Path | Description |
|------|-------------|
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/ | Cache directory |
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/remote.json | Cached/published database |
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/draft.json | Working draft |
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/metadata.json | Remote version metadata |
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/backups/ | Backup files |
| /data/plugins/system_hardware/pi_screen_setup/presets_cache/display_presets_export.json | PR export file |

---

## Version History

| Version | Changes |
|---------|---------|
| 0.7.3 | Added /api/language and /api/i18n/:lang endpoints |
| 0.7.1 | Initial API implementation |
