# Stylish Player Plugin

Volumio Plugin to show currently playing screen in with animated players, controls, and visualizations on the display (external or internal)

Requires a screen attached ot device, or external device with screen capable of loading <http://volumio.local:3339> (or a different user configurable port), which is different than the Volumio itself. For best results, use a Full HD or higher resolution screen, with touch capabilities.

### Source repository for the UI displayed by the Plugin

<https://github.com/kjavia/Volumio-UI-React/>

### Follow new feature list on this page

<https://community.volumio.com/t/plugin-stylish-player-ui/75996>

Above repository contains instructions on how to develop the plugin.

### Peppy settings

The **Peppy** section in Stylish Player settings contains meter and spectrum pack
uploads and pack/model selection. Use the **Peppy Meter / Peppy Spectrum** radio
buttons to choose which pack selectors and upload control are shown. Each type
retains its own selection. Choose the active visualization separately in
**Player Configuration**.

- **Needle Sensitivity** sets the meter gain multiplier from 0.1 to 5.0 (default
  0.5). Higher values increase needle movement; the output is capped at full scale.
- **Smoothness** sets the averaging window from 1 to 30 frames (default 6).
  Higher values produce smoother but slower movement. A value of 1 disables averaging.

Both controls apply to all Peppy Meter views and are saved on the server. They do
not change Peppy Spectrum behavior.

When updating this feature, install both the bundled UI and the plugin server
code, then restart Volumio (`volumio vrestart`). Replacing only the UI or leaving
the old server running prevents Peppy settings from being saved. After restarting,
reload the settings page. The plugin's `/api/config` response must include
`peppyNeedleSensitivity` and `peppySmoothness`; if those keys are absent, the
running server is still an older version.
