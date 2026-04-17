# Plugin Development Notes

## CRITICAL: Every config key MUST be declared in `config.json`

Volumio uses `v-conf` for config persistence. Any key that is **not** declared in
`stylish_player/config.json` will silently fail to save — `config.set()` does
nothing and `config.get()` always returns the hardcoded default.

### Required structure for each key

```json
"keyName": {
  "type": "string|boolean|number",
  "value": <default>
}
```

### Checklist when adding a new config option

1. Add field to `UIConfig.json` (the Volumio settings UI)
2. Add field to `config.json` with correct type + default ← **MOST COMMONLY MISSED**
3. Return it in the `/api/config` HTTP response in `index.js`
4. Save it in the relevant `configSave*` handler in `index.js`
5. Populate it in `getUIConfig` in `index.js` (so the settings UI reflects the saved value)
6. Add translation key to `i18n/strings_en.json`
7. Read it in the React app via `pluginConfig?.keyName`

### Types

| Volumio type | Use for |
|---|---|
| `"string"` | text, hex codes, URLs, JSON blobs |
| `"boolean"` | switches / toggles |
| `"number"` | numeric inputs |
