# Volumio Bookworm Submission Checklist

## Plugin/package prep

- [ ] Confirm plugin manifest metadata:
  - `engines.node >= 20`
  - `volumio >= 4`
  - `volumio_info.os = ["bookworm"]`
  - `architectures = ["amd64", "armhf"]`
- [ ] Verify package version and lockfile version are aligned (`0.1.3`).
- [ ] Verify install/uninstall scripts are executable.
- [ ] Verify default `config.json` contains `alarm_ids` and `alarm_1`.

## Local validation

- [ ] `cd /path/to/korean_radio_alarm`
- [ ] `npm ci`
- [ ] `npm test`

## Source repo sync

- [ ] `cd /path/to`
- [ ] `git clone <your-fork> volumio-plugins-sources-bookworm`
- [ ] `cd volumio-plugins-sources-bookworm`
- [ ] Copy the plugin folder into the root of your forked source tree:
  - `cp -R /path/to/korean_radio_alarm .`
- [ ] Open PR in your fork for Bookworm plugin-sources tree.

## Device validation (Bookworm)

- [ ] On Bookworm device, install plugin from the forked tree or via plugin manager flow.
- [ ] Verify browse view lists station groups and station items.
- [ ] Playback test:
  - open `kbs-classic-fm`, `cbs-music-fm`, and one stream with resolver if available
  - confirm playback starts and track metadata appears in player UI
- [ ] Alarm persistence test:
  - enable `alarm_1` for current minute +1 and matching weekday
  - wait for trigger
  - confirm alarm wakes and plays selected station
  - confirm `alarm_ids` and saved alarm slot values persist after restart
- [ ] Uninstall test:
  - run uninstall flow and confirm no browse source remains

## Cleanup

- [ ] On plugin source device/worktree: remove dependency artifacts before committing final PR (`rm -rf node_modules`).
- [ ] Submit PR from fork and include test outputs.
- [ ] Run Bookworm submission flow from your Volumio environment (`volumio plugin submit` path for your deployment).
