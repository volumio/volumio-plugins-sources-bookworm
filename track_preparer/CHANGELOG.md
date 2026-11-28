# Changelog / История изменений

## 1.12.3
- **The plugin no longer edits `/etc/mpd.conf`.** Writing the file is not possible without root (the plugin runs as `volumio`), and touching a file owned by Volumio's MPD plugin is not something a plugin should do. If Volumio's own **volume normalization** is enabled in Playback Options, switch it off by hand: the plugin now only says so in the ReplayGain section and the README. ReplayGain itself still works through the MPD config callback and needs no root.
- **Плагин больше не правит `/etc/mpd.conf`.** Записать этот файл без root нельзя (плагин работает под пользователем `volumio`), а трогать файл, которым владеет MPD-плагин Volumio, сторонний плагин не должен. Если в настройках воспроизведения Volumio включена встроенная **нормализация громкости**, выключите её вручную: теперь плагин только напоминает об этом в секции ReplayGain и в README. Сам ReplayGain по-прежнему работает через колбэк конфигурации MPD и root не требует.

## 1.12.2
- **While the ReplayGain switch is on, the `volume_normalization` line in `/etc/mpd.conf` is commented out** (prefix `#TP_RG# `): MPD's own normalization on top of ReplayGain spoils the sound. The line is written by Volumio's template and a config callback can only append, so it is edited in place after each rebuild of the file (also those Volumio starts itself); MPD is restarted only if something was changed. Switching off or stopping the plugin rebuilds the file from the template and the line returns as set in Playback Options.
- **Пока тумблер ReplayGain включён, строка `volume_normalization` в `/etc/mpd.conf` закомментирована** (префикс `#TP_RG# `): штатная нормализация MPD поверх ReplayGain портит звук. Строку пишет шаблон Volumio, а колбэк конфигурации умеет только дописывать, поэтому она правится на месте после каждой пересборки файла (в том числе запущенной самим Volumio); MPD перезапускается только если что-то изменилось. При выключении тумблера или остановке плагина файл пересобирается из шаблона, и строка возвращается как в настройках воспроизведения.
- `install.sh` removes the plugin folder when a required package cannot be installed (no broken plugin is left behind); the one remaining Russian line of the run log is now English.
- `install.sh` удаляет папку плагина, если обязательный пакет не установился (битый плагин не остаётся); последняя русская строка журнала выполнения переведена на английский.

## 1.12.1
- **Fixed: the ReplayGain switch always showed "off" after reloading the page and had no effect.** The plugin config was loaded only in `onVolumioStart`, which Volumio calls at boot only; a plugin installed or enabled from the UI had no config, so saving the switch failed silently (`Cannot read properties of undefined`). The config is now loaded on demand and written to disk immediately on save.
- **Fixed: the preparation window ignored the Volumio language.** It followed the browser language. The server now reports the Volumio UI language in `/api/status`, and the window switches to it live (no reload), matching the settings page.
- **Исправлено: тумблер ReplayGain после перезахода на страницу всегда был выключен и ничего не делал.** Конфиг загружался только в `onVolumioStart`, а Volumio вызывает его лишь при загрузке системы; у плагина, установленного или включённого из интерфейса, конфига не было, и сохранение тумблера молча падало. Теперь конфиг загружается по требованию и сразу записывается на диск.
- **Исправлено: окно подготовки не следовало языку Volumio.** Оно ориентировалось на язык браузера. Теперь сервер отдаёт язык интерфейса Volumio в `/api/status`, и окно переключается на него на лету, как и страница настроек.

## 1.12.0
- **ReplayGain switch is the first section of the plugin settings and no longer writes any configuration file.** Instead of patching `/etc/mpd.conf` under `sudo`, the plugin registers a config callback in Volumio's own MPD plugin (`registerConfigCallback`, the public mechanism the official `mpdoutput` plugin uses for its `audio_output` blocks) and asks it to rebuild `/etc/mpd.conf` and restart MPD. MPD appends `replaygain "track"`, `replaygain_preamp "0"`, `replaygain_missing_preamp "-8"`, `replaygain_limit "yes"` itself at every rebuild, so no root rights, no `sudoers` rules, no `mpd.conf.tmpl` edits and no file watchers are needed. Removing the callback (switch off, plugin stopped or uninstalled) takes the lines away again. The old `bin/mpd_replaygain.py` is gone, `diagnose.py` reads the state from `/etc/mpd.conf` directly.
- The switch and its explanation moved from the progress window to the top of the plugin settings page; the progress window is left with starting, stopping and the log. `package.json` is back to the store template: author, repository, MIT license, fixed dependency versions.
- **Тумблер ReplayGain — первая плашка настроек плагина, и он больше не пишет конфигурационные файлы.** Вместо патча `/etc/mpd.conf` через `sudo` плагин регистрирует колбэк конфигурации в MPD-плагине Volumio (`registerConfigCallback` — публичный механизм, которым официальный `mpdoutput` добавляет свои `audio_output`) и просит пересобрать `/etc/mpd.conf` и перезапустить MPD. Строки `replaygain …` MPD добавляет сам при каждой пересборке: не нужны root, `sudoers`, правка `mpd.conf.tmpl` и слежение за файлом. Снятие колбэка (выключение тумблера, остановка или удаление плагина) убирает строки. Старый `bin/mpd_replaygain.py` удалён, `diagnose.py` читает состояние прямо из `/etc/mpd.conf`.
- Тумблер и его объяснение переехали из окна выполнения в начало страницы настроек; в окне остались запуск, остановка и журнал. `package.json` приведён к шаблону магазина: автор, репозиторий, лицензия MIT, фиксированные версии зависимостей.

## 1.11.0
- **ReplayGain volume leveling switch, done the Volumio way.** Editing `mpd.conf.tmpl` is not allowed by Volumio's rules (it blocks updates and is rejected on review), so the 1.10.0 approach is gone. The switch in the plugin window now patches the **live `/etc/mpd.conf`** at runtime, inserting only its own block between `## BEGIN/END track_preparer_replaygain_patch` (`replaygain "track"`, `replaygain_preamp "0"`, `replaygain_missing_preamp "-8"`, `replaygain_limit "yes"`) in the global section; other blocks (e.g. Audio Keepalive) and `audio_output { }` contents are untouched. Idempotent (an existing block is updated in place, never duplicated; no change = no write and no MPD restart); written to a temporary file and renamed, retried if Volumio regenerates the file in the meantime. Conflicting active `replaygain*` / `volume_normalization` lines outside the block are commented out with `#TP_RG# ` and restored exactly on removal.
- While the switch is on, the plugin watches `/etc/mpd.conf` (plus a once-a-minute safety check) and re-applies the block after Volumio regenerates it (settings change, reboot, MPD restart) and restarts MPD only when something was actually changed. The block is removed cleanly (and MPD restarted) when the switch is turned off, when the plugin is stopped and on uninstall (`uninstall.sh`). A leftover from 1.10.0 in the template is removed automatically.
- The window now warns that volume leveling is off by default in Volumio (web radio plays louder than the library) until the switch is turned on. `diagnose.py` reports the MPD state.
- Тумблер «Включить выравнивание громкости ReplayGain» патчит рабочий `/etc/mpd.conf` (шаблон Volumio не трогается), идемпотентно, с атомарной записью; плагин следит за файлом и возвращает блок после перегенерации Volumio; блок убирается при выключении тумблера, остановке и удалении плагина. В окне есть предупреждение, что по умолчанию выравнивание выключено.

## 1.10.0 (superseded by 1.11.0)
- **Button "Enable ReplayGain" in the plugin window.** Volumio has no GUI option for ReplayGain, so MPD ignores the tags the plugin writes. The new panel shows the current state and, on a click only, edits the MPD settings template (`mpd.conf.tmpl`) with a marked block (`replaygain "track"`, `replaygain_preamp "0"`, `replaygain_missing_preamp "-8"`, `replaygain_limit "yes"`), then asks Volumio's MPD plugin to rebuild `/etc/mpd.conf` and restart MPD (not the whole Volumio). Existing `replaygain*` / `volume_normalization` lines are commented out with a `#TP# ` prefix and restored byte-for-byte by "Disable"; a backup `mpd.conf.tmpl.track_preparer.bak` is made before the first change; repeated clicks are harmless. `diagnose.py` reports the MPD ReplayGain state.
- Кнопка «Включить ReplayGain» в окне плагина: правка шаблона `mpd.conf.tmpl` по нажатию (свой блок между маркерами, бэкап, побайтовый откат кнопкой «Выключить»), пересборка `/etc/mpd.conf` и перезапуск MPD без перезапуска всей Volumio.

## 1.9.0
- **Discs marked in the album tag are merged into one album.** A trailing disc marker — `Album CD1`, `Album - CD 2`, `Album, disc 2`, `Album (Disc 1)`, `Album [CD3]` (1–2 digits, so `CD 2000` is left alone) — is removed from the `album` tag and from the output folder name, and `discnumber` is filled in if empty. Discs that arrive as separate folders, even in different runs and in any order, end up in one folder; track numbers are then renumbered continuously in "disc, track" order (like `merge_discs` does). Re-running changes nothing.
- Диски с меткой в названии альбома (`CD1`, `- Disc 2`, `(Disc 1)`) теперь складываются в один альбом: метка убирается из тега `album` и имени папки, заполняется `discnumber`, нумерация треков становится сквозной независимо от порядка прихода дисков.

## 1.8.2
- **ReplayGain fixed on ffmpeg 4.x–5.1 (Debian 12 / Volumio 4).** The filter option `ebur128=framelog=quiet` is not accepted by these versions: ffmpeg exits with an error but still prints an empty summary (`I: 0.0 LUFS`, `Peak: -inf`), which was taken for a real result — every track got gain `-18.00 dB` and no peak. Now the ffmpeg exit code is checked, `framelog` is no longer used, and the loudness is read only from a real `Summary:` block. Verified with ffmpeg 4.2, 4.4, 5.1, 6.1 and 7.0 (identical results).
- If a track cannot be measured (silence, damaged file, ffmpeg failure) its old ReplayGain tags are removed (no tags are better than false ones) and the run window shows one calm `⚠` line per folder instead of a `✖` line per track; details go to `errors.log` only. Such tracks no longer count as problems.
- Исправлено: на ffmpeg 4.x–5.1 (Debian 12) каждый трек измерялся как 0 LUFS (gain −18,00 dB, без пиков). Теперь проверяется код возврата ffmpeg, `framelog` не используется. Неизмеренный трек остаётся без тегов (старые удаляются), а в окне — одна спокойная строка на папку вместо «✖» на каждый трек.

## 1.8.1
- ReplayGain: a measured loudness of about 0 LUFS (decode failure — it produced "−18.00 dB" gain tags without peaks) is rejected instead of written; after writing, the track gain tag is read back and compared; `diagnose.py` now runs an end-to-end test on a FLAC with an embedded cover and stale `-18.00 dB`/album tags.
- Исправлено: нулевая громкость (сбой замера) больше не записывается как gain −18,00 dB; запись тега проверяется чтением; `diagnose.py` проверяет flac со встроенной обложкой и старыми тегами.

## 1.8.0
- Volumio 4 / Bookworm only: `package.json` brought to the Bookworm plugin template (`os: bookworm`, Node >= 20, Volumio >= 4, dependencies); `install.sh` no longer creates anything on the disk at install time (folders are created in `onStart`); the plugin stops a running job in `onStop`.
- CUE: several `.cue` files in one folder (each with its own image; discs go to `CD1`, `CD2`… and are merged later, or to subfolders by cue name when the albums differ); one cue with several `FILE` images (side A / side B); one cue whose image is stored in parts (`Side A.flac` + `Side B.flac`); cue whose timecodes restart on side B; mixed cases.
- An unresolved cue next to a long image keeps the whole folder in the input (nothing is moved or deleted), also for 4+ files and short sides.
- Исправлено то же по-русски: поддержаны несколько cue в папке, один cue с образами сторон A/B, образ частями; неразобранный cue больше не приводит к переносу образа в библиотеку.

## 1.7.1
- cue for already split tracks (FILE per track, or as many audio files as cue tracks) is no longer an error: missing tags are filled from the cue (existing tags untouched) and the cue is removed, audio is not touched; real multi-FILE images still reported.

## 1.7.0
- album gain removed (shuffle library; stale album tags purged), only track gain + peak; every file re-measured and tags force-rewritten; advice list for tracks with True Peak above 0 dBTP.

## 1.6.3
- rsgain removed (not installable on Volumio), ReplayGain is the built-in ffmpeg+mutagen calculator only; fixed: RVA2/RVAD tags not purged, silence measured as -70 LUFS (+52 dB gain), album loudness wrong for mixed sample rates, multi-disc album gain skipped, wasted album pass for mixed albums, album gain written without peak, ffmpeg output decode errors; progress and errors now shown per file.

## 1.6.2
- cue/image matching ignores name and extension differences (.iso.wv vs .flac), picks the image by duration; cue with a wrong extension is renamed.

## 1.6.1
- shnsplit failure falls back to ffmpeg (hi-res/multichannel); an image that failed to split is no longer processed as one track and nothing is deleted.

## 1.6.0
- archives (.iso.wv/.zip/.iso) unpacked first; ReplayGain via rsgain as the last step on output files; disc number tag.

## 1.5.0
- every nested folder is processed as is, output sorted by tags (artist/album); new interface; safe cross-filesystem move.

## 1.4.0
- audiobooks removed; unpack of iso.wv/ape/wav images first; recursive album detection; no cover file in output; numbering stripped from names; stale ReplayGain tags purged.

## 1.3.0
- single clean window (start + live log in one page), hardcoded paths.

## 1.2.0
- progress window, graceful stop, per-album transfer.
