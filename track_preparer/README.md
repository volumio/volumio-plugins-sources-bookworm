# Track Preparer — a Volumio plugin

**English** · [Русский](#русский)

One-button preparation of a music collection for the [Volumio](https://volumio.com) library: splits CUE+image albums, converts formats, trims silence, embeds covers, merges multi-disc albums, sorts everything into `Artist/Album/` by tags and writes ReplayGain tags. Your files go in one folder, clean and tagged files come out of another: the plugin moves them, so the input folder is emptied as albums are finished.

---

## English

### Contents

- [Features](#features)
- [How it works](#how-it-works)
- [ReplayGain](#replaygain)
- [Enabling ReplayGain in Volumio](#enabling-replaygain-in-volumio)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Progress window](#progress-window)
- [Logs and diagnostics](#logs-and-diagnostics)
- [Safety guarantees](#safety-guarantees)
- [Known limitations](#known-limitations)
- [Uninstall](#uninstall)
- [Changelog](#changelog)
- [License](#license)

### Features

- Unpacks archives and images (`.zip`, `.iso`, `.iso.wv`) — the type is detected by content, not by extension; Cyrillic names from Windows archives (cp866/cp1251) are restored.
- Converts formats: lossless (ape, wv, wav, aiff, tta, ALAC, …) → FLAC, lossy (m4a/aac, ogg, opus, wma, ac3, mp2, …) → MP3 VBR V0.
- Splits CUE + image albums into tracks and tags them from the CUE (UTF-8 conversion, any CUE encoding). Handles the awkward cases too: **several `.cue` files in one folder** (CD1 + CD2), **one cue with several image files** (side A / side B), an image stored **in parts** (`Side A.flac` + `Side B.flac` described by one cue), and CUE files that describe **already split** tracks.
- Finds the cover (including subfolders), resizes it to a square 1000–1024 px and embeds it in every track.
- Trims silence at the start and end of tracks (MP3 is cut without re-encoding).
- Merges `cd1/cd2/disc N` into one album with continuous track numbering.
- Cleans file names (`01 - Title.flac` → `Title.flac`, characters forbidden on NTFS/exFAT/FAT are removed); track number and title stay in the tags.
- Sorts into `<output>/<artist>/<album>/` using **tags**, not the input folder structure.
- Writes **ReplayGain 2.0 track gain** (−18 LUFS) and True Peak, and advises replacing tracks whose True Peak is above 0 dBTP.
- Live progress page with start/stop buttons, ETA and a colour-coded log.

### How it works

The input folder is `/mnt/HDD/in/music`. **Its structure does not matter:** every nested folder that directly contains audio (or a CUE) is processed on its own, at any depth. `cd1/cd2/disc N` subfolders count as part of their parent; nested folders are processed before their parent. Artist and album for the output come from the **tags**.

| Step | What happens |
|---|---|
| 0. Archives | `.iso.wv`, `.zip`, `.iso` are unpacked next to the original; the archive is deleted only after its size is verified. Real ISO images need 7z/bsdtar. |
| 1. Formats | Anything other than FLAC/MP3 is converted (see above). Tags and embedded covers are kept. `.m4b` (audiobooks) is skipped. An embedded `CUESHEET` tag is written out as a `.cue` file. |
| 2. CUE | CUE → UTF-8; every image is split into tracks (`shnsplit`, falling back to `ffmpeg`, e.g. for hi-res/multichannel); tags come from the CUE. **Several cue files in one folder:** each gets its own image (matched by `FILE` name, by cue name, or in order if the names do not match); discs of one album go to `CD1`, `CD2`… (merged later by step 6), different albums — to subfolders named after the cue. **One cue, several images** (a `FILE` per side, or one `FILE` with the image stored in `Side A`/`Side B` parts, or timecodes restarting on side B): each side is split separately and track numbers continue from the cue. If the CUE describes already split tracks (one `FILE` per track, or as many audio files as CUE tracks), nothing is split: missing tags are filled from the CUE (existing tags are never overwritten) and the CUE is removed. |
| 3. Readiness check | If **all** tracks already have title/album/artist tags and an embedded cover, the album is "ready": silence trimming and cover search are skipped. Disc merging, renaming and moving still happen. |
| 4. Cover | Found (also in subfolders), squared to 1000–1024 px and embedded. The cover file itself is **not** moved to the output. |
| 5. Silence | Silence below −50 dB at the start/end is trimmed. Tracks without silence are not touched. |
| 6. Discs | `cd1/cd2/…` are merged into one album with continuous numbering. |
| 7. Names | Track numbers are removed from file names; forbidden characters are cleaned. |
| 8. Sorting | Moved to `<output>/<artist>/<album>/`. Album = most frequent `album` tag without a trailing disc marker (`CD1`, `- Disc 2`, `(Disc 1)`), else the folder name. Disc markers are also removed from the `album` tag itself, `discnumber` is filled in, and when several discs of one album end up in the same folder (even from different runs, in any order) the track numbers are renumbered continuously in "disc, track" order. Artist = `albumartist`, else `artist` if it covers ≥ 60 % of tracks; different artists → `Various Artists`; no tags → `_unknown`. Loose files in the input root are sorted the same way, each by its own tags. |
| 9. ReplayGain | The last step, run on the final files in the output folder. See below. |

At the end of a run, folders that no longer contain audio or CUE are removed from the input folder, including leftovers such as `folder.jpg`, `Thumbs.db`, hidden files and nfo/txt/log. A folder with audio, a CUE or other files (e.g. a PDF) stays and the reason is logged.

### ReplayGain

Built-in calculator: `ffmpeg` (`ebur128`) + `mutagen`. No external tools are needed (rsgain/loudgain are **not** used — they cannot be installed on Volumio's Debian).

- **Track gain only**, reference −18 LUFS (ReplayGain 2.0), plus `REPLAYGAIN_TRACK_PEAK` (True Peak) and `REPLAYGAIN_REFERENCE_LOUDNESS`. Album gain is deliberately not written (the library is played in shuffle).
- **Input data is not trusted.** Every file is measured again and its tags are force-rewritten. All old ReplayGain-like tags are removed first: `REPLAYGAIN_*` (including `ALBUM_*`), `R128_*`, ID3 `RVA2`/`RVAD`/`RVA`, `iTunNORM`, and ReplayGain keys in an APEv2 tag on MP3 — including zeroed or foreign values.
- **Clip protection in the tag:** the gain value is lowered if, after applying it, True Peak would exceed −1 dBTP (like `loudgain -k`). Audio files are never modified. Set `CLIP_PROTECT = False` in `bin/replaygain.py` to write pure `−18 − LUFS` values.
- Silence (ffmpeg reports −70 LUFS) is not measured and gets no tags, instead of an absurd +52 dB gain. The same applies to any track that cannot be measured: its old ReplayGain tags are removed (no tags are better than false ones) and a single `⚠` line per folder is shown. The measurement works with ffmpeg 4.2 – 7.x (checked on 4.2, 4.4, 5.1, 6.1, 7.0).
- If the True Peak cannot be measured, the peak tag is skipped (rather than written as zero); a sample-peak fallback (`astats`/`volumedetect`) is tried first.
- **Advice:** for tracks with True Peak **above 0 dBTP** the run window (yellow `⚠` lines) and `errors.log` (`[ADVICE]`) list the track, its value and a recommendation to replace it with a better source. Advice does not count as a problem.

Keep in mind that True Peak above 0 dBTP is common in loud masters and in MP3, so treat the list as a hint, not a verdict — start with the highest values.

### Enabling ReplayGain in Volumio

Writing the tags is not enough: **volume leveling is off by default in Volumio.** MPD ignores the tags, and web radio plays noticeably louder than the library. That is why the first section of the plugin settings is **Volume leveling (ReplayGain)** with a switch. Nothing is changed until you turn it on.

The switch does not edit any file by hand. The plugin registers a configuration callback in Volumio's own MPD plugin (`registerConfigCallback` — the same public mechanism the official `mpdoutput` plugin uses for its `audio_output` blocks) and asks it to rebuild `/etc/mpd.conf` and restart MPD. MPD appends these lines itself:

```
replaygain "track"
replaygain_preamp "0"
replaygain_missing_preamp "-8"
replaygain_limit "yes"
```

So:

- no root access and no `sudoers` rules, no edits of `mpd.conf.tmpl`, no writes to `/etc/mpd.conf` from the plugin;
- the lines are present at every rebuild — after a reboot, a settings change or an MPD restart — because MPD asks the plugin for them;
- turning the switch off, disabling the plugin or uninstalling it removes the lines and rebuilds the file; the switch position is stored in `rg_enabled`;
- MPD restarts once on each change, so playback stops for a few seconds.

`replaygain_preamp "0"` applies the measured gain to tagged tracks (they are measured at −18 LUFS, so no extra offset is needed). `replaygain_missing_preamp "-8"` attenuates streams and files without tags (web radio) by 8 dB. `replaygain_limit "yes"` prevents clipping.

If Volumio's own **volume normalization** is enabled in Playback Options, switch it off: it would correct the volume a second time on top of ReplayGain, and the result is worse than either correction alone. The plugin cannot do this for you — the line is written by Volumio's MPD template, and a configuration callback can only append to it.

The standalone `tools/enable-replaygain.sh` script in the repository root is only for machines where the plugin is not installed. **Do not run it while the switch is on:** it edits the template, and together with the plugin's own lines MPD would get a duplicate directive and refuse to start. The script checks for this and stops.

### Requirements

- **Volumio 4 on Debian 12 "Bookworm"** (`package.json`: `os: bookworm`, `volumio >=4`, `node >=20`; architectures `amd64`, `armhf`). The system Python 3.11 is used.
- A disk mounted at `/mnt/HDD` (see [Usage](#usage)).
- Installed automatically by `install.sh`: `python3`, `python3-mutagen`, `python3-pil`, `ffmpeg` (with `ffprobe`), `flac` (`metaflac`).
- Optional: `shntool` (`shnsplit`; without it CUE splitting uses ffmpeg), `p7zip-full` (real `.iso` images).

### Installation

```bash
scp track_preparer.zip volumio@volumio.local:/tmp/
ssh volumio@volumio.local
cd /tmp && unzip track_preparer.zip && cd track_preparer
volumio plugin install
```

Run `volumio plugin install` **on a Bookworm device** (Volumio 4); it installs the Node dependencies (`fs-extra`, `kew`, `v-conf`) and runs `install.sh`. Then: **Settings → Plugins → Installed plugins →** enable **Track Preparer**.

### Usage

1. Copy albums into the input folder (default `/mnt/HDD/in/music`).
2. Open the plugin page, press **Open preparation window**, then **Start processing**.
3. Find the result in the output folder (default `/mnt/HDD/out/music`).

Both folders must be inside `/mnt/HDD`; if the disk is not mounted the plugin creates nothing and reports an error (so it never writes to the SD card). The input and output folders must not be nested in one another, and `/mnt/HDD` itself cannot be used. The paths are stored in `config.json` (`in_music`, `out_music`; there is no UI for them), and for manual runs they can be overridden with `TP_IN_MUSIC` / `TP_OUT_MUSIC`.

### Progress window

The plugin serves its own page at **`http://<volumio-address>:8765/`** (the next port, 8766…, is used if it is busy; a link and an **Open preparation window** button are on the plugin page). It shows overall percentage with elapsed/remaining time, the current album, step and file, albums done, problem count, and a live log (errors red, finished files green, advice yellow).

**Start processing** and **Stop** work from this page. Stopping takes effect after the current step: finished albums are already in the output folder, the rest stay in the input folder and are picked up on the next run. You can close the page — processing continues on Volumio.

### Logs and diagnostics

- `log/run.log` — the last run (what the progress window shows).
- `log/errors.log` — cumulative log; `[PROBLEM]` lines are counted in the final notification, `[ADVICE]` lines are recommendations.

```bash
tail -f /data/plugins/music_service/track_preparer/log/errors.log
```

Manual run for debugging:

```bash
cd /data/plugins/music_service/track_preparer/bin
export TP_IN_MUSIC=/mnt/HDD/in/music TP_OUT_MUSIC=/mnt/HDD/out/music   # optional
python3 run_pipeline.py
```

Self-check (send the output when reporting a problem):

```bash
cd /data/plugins/music_service/track_preparer/bin
python3 diagnose.py /mnt/HDD/in/music /mnt/HDD/out/music
```

It reports Python/mutagen/ffmpeg versions, the presence of `shnsplit`/`flac`/`metaflac`, whether ffmpeg can measure loudness and peak, whether tags can be written, the file system type of both folders and whether `:` and `?` are allowed in names.

### Safety guarantees

- **It works as a move, not a copy.** Finished albums are moved to the output folder; the album folder itself, covers, nfo and other leftovers are then removed from the input. After a successful run the input folder is empty again (the folder itself stays); only folders the plugin cannot sort remain, each with a reason in the log.
- A source file is deleted only after its result is verified to exist (size/duration): conversion, CUE splitting and the move to the output folder.
- If an image cannot be split by its CUE, the folder is **not processed further and nothing is deleted** — it stays in the input folder with a `[PROBLEM]` entry, so an image never ends up in the library as one long track.
- The image for a CUE is found regardless of name and extension: the `FILE` name (e.g. `Album.iso.wv`) is matched to the real file (`Album.flac`); otherwise the only audio file is used, and among several files the one the CUE fits into by duration. A CUE with a foreign extension (`Album.cue.iso.wv`) is renamed to `.cue`.
- `shnsplit` does not understand hi-res/multichannel FLAC (`unsupported format 0xfffe`); the plugin then splits with ffmpeg automatically.
- The destination of every album is logged (`moved N/N file(s) -> ...`).
- File names are cleaned of characters forbidden on NTFS/exFAT/FAT (`: ? * " < > | \ /`); the original titles are kept in the tags.

### Known limitations

- Silence trimming can break gapless playback on concept/live albums with an intentional pause between tracks. The threshold and behaviour are constants in `bin/process_tracks.py`.
- If a cue cannot be matched to its image(s) — a `FILE` entry that matches no file, a track that crosses the boundary between two image parts, a cue that does not fit its image by duration, or a different number of cue sections and audio files — the folder is **skipped as a whole**: nothing is moved or deleted, and a `[PROBLEM]` entry explains why.
- Lossy sources (m4a/aac, ogg, opus, wma, …) are re-encoded to MP3 V0, which costs some quality. Prefer lossless sources where possible. `.m4b` is not handled.
- ReplayGain tags are written for FLAC and MP3 only.

### Uninstall

**Settings → Plugins → Installed plugins →** disable and remove. The input and output folders are not deleted.

### Changelog

See [CHANGELOG.md](CHANGELOG.md).

### License

MIT (see `LICENSE` and `package.json`).

---

<a id="русский"></a>

## Русский

**[English](#track-preparer--a-volumio-plugin)** · Русский

Плагин Volumio, который готовит музыкальную коллекцию для библиотеки одной кнопкой: режет образы CUE, конвертирует форматы, обрезает тишину, встраивает обложки, объединяет многодисковые альбомы, раскладывает всё по `Артист/Альбом/` по тегам и записывает теги ReplayGain. Файлы кладутся в одну папку, готовые и размеченные забираются из другой: плагин их переносит, поэтому входная папка по мере работы очищается.

### Содержание

- [Возможности](#возможности)
- [Как это работает](#как-это-работает)
- [ReplayGain](#replaygain-1)
- [Включение ReplayGain в Volumio](#включение-replaygain-в-volumio)
- [Требования](#требования)
- [Установка](#установка)
- [Использование](#использование)
- [Окно выполнения](#окно-выполнения)
- [Логи и диагностика](#логи-и-диагностика)
- [Надёжность](#надёжность)
- [Известные особенности](#известные-особенности)
- [Удаление](#удаление)
- [История изменений](#история-изменений)
- [Лицензия](#лицензия)

### Возможности

- Распаковывает архивы и образы (`.zip`, `.iso`, `.iso.wv`): тип определяется по содержимому, а не по расширению; кириллические имена из Windows-архивов (cp866/cp1251) восстанавливаются.
- Конвертирует форматы: lossless (ape, wv, wav, aiff, tta, ALAC, …) → FLAC, lossy (m4a/aac, ogg, opus, wma, ac3, mp2, …) → MP3 VBR V0.
- Режет альбомы «CUE + образ» на треки и проставляет теги из CUE (перекодировка в UTF-8, любая кодировка CUE). Понимает cue для **уже нарезанных** треков.
- Находит обложку (в том числе в подпапках), приводит её к квадрату 1000–1024 px и встраивает в треки.
- Обрезает тишину в начале и конце треков (mp3 режется без перекодирования).
- Объединяет `cd1/cd2/disc N` в один альбом со сквозной нумерацией.
- Очищает имена файлов (`01 - Title.flac` → `Title.flac`, запрещённые на NTFS/exFAT/FAT символы убираются); номер и название остаются в тегах.
- Раскладывает в `<выход>/<артист>/<альбом>/` **по тегам**, а не по структуре входной папки.
- Пишет **ReplayGain 2.0 track gain** (−18 LUFS) и True Peak, а для треков с True Peak выше 0 dBTP рекомендует заменить источник.
- Страница прогресса с кнопками запуска и остановки, оставшимся временем и цветным журналом.

### Как это работает

Входная папка — `/mnt/HDD/in/music`. **Структура не важна:** каждая вложенная папка, в которой прямо лежит аудио (или cue), обрабатывается отдельно, на любой глубине. Папки `cd1/cd2/disc N` считаются частью своей папки; вложенные папки обрабатываются раньше родительской. Артист и альбом для выхода берутся **из тегов**.

| Шаг | Что происходит |
|---|---|
| 0. Архивы | `.iso.wv`, `.zip`, `.iso` распаковываются рядом с оригиналом; архив удаляется только после проверки размеров. Настоящие ISO требуют 7z/bsdtar. |
| 1. Форматы | Всё, кроме FLAC/MP3, конвертируется (см. выше). Теги и встроенные обложки сохраняются. `.m4b` (аудиокниги) пропускаются. Встроенный тег `CUESHEET` выписывается в `.cue` рядом. |
| 2. CUE | CUE → UTF-8; каждый образ режется на треки (`shnsplit`, при неудаче — `ffmpeg`, например для hi-res/многоканального); теги берутся из CUE. **Несколько cue в одной папке:** у каждого свой образ (по имени в `FILE`, по имени cue, а если имена не совпали — по порядку); диски одного альбома кладутся в `CD1`, `CD2`… (позже их сводит шаг 6), разные альбомы — в подпапки по имени cue. **Один cue, несколько образов** (по `FILE` на сторону, либо один `FILE`, а образ лежит частями `Side A`/`Side B`, либо таймкоды стороны B начинаются заново): каждая сторона режется отдельно, нумерация треков продолжается по cue. Если cue описывает уже нарезанные треки (по `FILE` на трек либо аудиофайлов столько же, сколько треков в cue), нарезка не нужна: из cue дописываются недостающие теги (заполненные не перезаписываются), после чего cue удаляется. |
| 3. Проверка готовности | Если **все** треки уже имеют теги title/album/artist и встроенную обложку, альбом «готов»: обрезка тишины и поиск обложки пропускаются. Объединение дисков, переименование и перенос выполняются. |
| 4. Обложка | Находится (в т. ч. в подпапках), приводится к квадрату 1000–1024 px и встраивается. Сам файл обложки в выходную папку **не переносится**. |
| 5. Тишина | Тишина тише −50 дБ в начале/конце обрезается. Файлы без тишины не трогаются. |
| 6. Диски | `cd1/cd2/…` объединяются в один альбом со сквозной нумерацией. |
| 7. Имена | Номер трека убирается из имени файла, запрещённые символы чистятся. |
| 8. Раскладка | Перенос в `<выход>/<артист>/<альбом>/`. Альбом — самый частый тег album без метки диска в конце (`CD1`, `- Disc 2`, `(Disc 1)`), иначе имя папки. Метка также убирается из самого тега `album`, заполняется `discnumber`, а когда в одной папке оказываются несколько дисков альбома (даже из разных запусков и в любом порядке), нумерация треков становится сквозной в порядке «диск, трек». Артист — albumartist, иначе artist, если он у ≥ 60 % треков; разные исполнители — `Various Artists`; тегов нет — `_unknown`. Одиночные файлы в корне входной папки раскладываются так же, каждый по своим тегам. |
| 9. ReplayGain | Последний шаг, на готовых файлах в выходной папке. См. ниже. |

В конце запуска из входной папки убираются папки, где нет аудио и cue, в том числе с остатками (`folder.jpg`, `Thumbs.db`, скрытые файлы, nfo/txt/log). Папка с аудио, cue или другими файлами (например PDF) остаётся, причина пишется в лог.

### ReplayGain

Встроенный расчёт: `ffmpeg` (`ebur128`) + `mutagen`. Внешние утилиты не нужны (rsgain/loudgain **не используются** — на Debian из Volumio их нельзя просто установить).

- **Только track gain**, эталон −18 LUFS (ReplayGain 2.0), плюс `REPLAYGAIN_TRACK_PEAK` (True Peak) и `REPLAYGAIN_REFERENCE_LOUDNESS`. Album gain сознательно не пишется (библиотека играет в shuffle).
- **Входным данным нет доверия.** Каждый файл измеряется заново, теги перезаписываются принудительно. Сначала удаляются все старые ReplayGain-подобные теги: `REPLAYGAIN_*` (включая `ALBUM_*`), `R128_*`, ID3 `RVA2`/`RVAD`/`RVA`, `iTunNORM` и ключи ReplayGain в APEv2 у mp3, в том числе нулевые и чужие значения.
- **Защита от клиппинга в теге:** значение gain занижается, если после его применения True Peak превысил бы −1 dBTP (как `loudgain -k`). Аудиофайлы не меняются. Чтобы писать «чистое» значение `−18 − LUFS`, поставьте `CLIP_PROTECT = False` в `bin/replaygain.py`.
- Тишина (ffmpeg выдаёт −70 LUFS) не измеряется и тегов не получает — вместо абсурдного gain +52 dB. То же для любого трека, который измерить не удалось: старые ReplayGain-теги в нём удаляются (лучше без тегов, чем с ложными), а в окне показывается одна строка `⚠` на папку. Замер работает с ffmpeg 4.2 – 7.x (проверено на 4.2, 4.4, 5.1, 6.1, 7.0).
- Если True Peak измерить нельзя, тег пика не пишется (вместо нулевого значения); сначала пробуется запасной сэмпловый пик (`astats`/`volumedetect`).
- **Рекомендация:** для треков с True Peak **выше 0 dBTP** в окне выполнения (жёлтые строки `⚠`) и в `errors.log` (`[ADVICE]`) выводятся трек, значение и совет заменить его на лучший источник. В счётчик проблем это не входит.

Учтите: True Peak выше 0 dBTP — обычное дело для громких мастеров и mp3, поэтому список — подсказка, а не вердикт; начинайте с самых высоких значений.

### Включение ReplayGain в Volumio

Записать теги мало: **выравнивание громкости в Volumio по умолчанию выключено.** MPD игнорирует теги, а веб-радио играет заметно громче медиатеки. Поэтому первая секция настроек плагина — **Выравнивание громкости (ReplayGain)** с тумблером. Пока вы его не включили, ничего не меняется.

Тумблер ничего не правит руками. Плагин регистрирует колбэк конфигурации в MPD-плагине Volumio (`registerConfigCallback` — тот же публичный механизм, которым официальный плагин `mpdoutput` добавляет свои блоки `audio_output`), и просит пересобрать `/etc/mpd.conf` и перезапустить MPD. Сами строки MPD добавляет сам:

```
replaygain "track"
replaygain_preamp "0"
replaygain_missing_preamp "-8"
replaygain_limit "yes"
```

Поэтому:

- не нужны root, правила `sudoers`, правка `mpd.conf.tmpl` и запись в `/etc/mpd.conf` из плагина;
- строки есть при каждой пересборке — после перезагрузки, смены настроек или перезапуска MPD, потому что MPD сам спрашивает их у плагина;
- выключение тумблера, отключение и удаление плагина убирают строки и пересобирают файл; положение тумблера хранится в `rg_enabled`;
- при каждом изменении MPD перезапускается один раз, воспроизведение прерывается на несколько секунд.

`replaygain_preamp "0"` применяет измеренный gain к размеченным трекам (они измерены в −18 LUFS, поэтому добавочный сдвиг не нужен). `replaygain_missing_preamp "-8"` убавляет на 8 дБ потоки и файлы без тегов (веб-радио). `replaygain_limit "yes"` не даёт клиппировать.

Если в настройках воспроизведения Volumio включена встроенная **нормализация громкости**, выключите её: это вторая, более грубая коррекция поверх ReplayGain.

Отдельный скрипт `tools/enable-replaygain.sh` в корне репозитория нужен только на машинах, где плагин не установлен. **Не запускайте его при включённом тумблере:** он правит шаблон, и вместе со строками плагина MPD получит дубль директивы и не запустится. Скрипт это проверяет и останавливается.

### Требования

- **Volumio 4 на Debian 12 «Bookworm»** (`package.json`: `os: bookworm`, `volumio >=4`, `node >=20`; архитектуры `amd64`, `armhf`). Используется системный Python 3.11.
- Диск, смонтированный в `/mnt/HDD` (см. [Использование](#использование)).
- Устанавливаются автоматически через `install.sh`: `python3`, `python3-mutagen`, `python3-pil`, `ffmpeg` (с `ffprobe`), `flac` (`metaflac`).
- По желанию: `shntool` (`shnsplit`; без него CUE режется через ffmpeg), `p7zip-full` (настоящие `.iso`).

### Установка

```bash
scp track_preparer.zip volumio@volumio.local:/tmp/
ssh volumio@volumio.local
cd /tmp && unzip track_preparer.zip && cd track_preparer
volumio plugin install
```

Выполняйте `volumio plugin install` **на устройстве с Bookworm** (Volumio 4): команда ставит Node-зависимости (`fs-extra`, `kew`, `v-conf`) и запускает `install.sh`. Затем: **Настройки → Плагины → Установленные плагины →** включить **Track Preparer**.

### Использование

1. Скопируйте альбомы во входную папку (по умолчанию `/mnt/HDD/in/music`).
2. Откройте страницу плагина, нажмите **Открыть окно подготовки**, затем **Начать обработку**.
3. Результат — в выходной папке (по умолчанию `/mnt/HDD/out/music`).

Обе папки должны лежать внутри `/mnt/HDD`; если диск не смонтирован, плагин ничего не создаёт и сообщает об ошибке (чтобы не писать на SD-карту). Входная и выходная папки не должны лежать одна внутри другой, `/mnt/HDD` целиком использовать нельзя. Пути хранятся в `config.json` (`in_music`, `out_music`; интерфейса для них нет), а при ручном запуске их можно переопределить переменными `TP_IN_MUSIC` / `TP_OUT_MUSIC`.

### Окно выполнения

Плагин поднимает собственную страницу: **`http://<адрес Volumio>:8765/`** (если порт занят, берётся следующий — 8766…; ссылка и кнопка «Открыть окно подготовки» есть на странице плагина). Она показывает общий прогресс в процентах, прошедшее и оставшееся время, текущий альбом, этап и файл, число обработанных альбомов и проблем, а также живой журнал (ошибки красным, готовые файлы зелёным, рекомендации жёлтым).

Кнопки **Начать обработку** и **Остановить** работают прямо с этой страницы. Остановка срабатывает после текущего этапа: готовые альбомы уже перенесены в выходную папку, остальные остаются во входной и подхватываются при следующем запуске. Страницу можно закрыть — обработка идёт на Volumio и не прерывается.

### Логи и диагностика

- `log/run.log` — журнал последнего запуска (то, что в окне выполнения).
- `log/errors.log` — накопительный журнал; строки `[PROBLEM]` учитываются в итоговом уведомлении, строки `[ADVICE]` — рекомендации.

```bash
tail -f /data/plugins/music_service/track_preparer/log/errors.log
```

Ручной запуск (отладка):

```bash
cd /data/plugins/music_service/track_preparer/bin
export TP_IN_MUSIC=/mnt/HDD/in/music TP_OUT_MUSIC=/mnt/HDD/out/music   # при необходимости
python3 run_pipeline.py
```

Самопроверка (присылайте её вывод, если что-то не работает):

```bash
cd /data/plugins/music_service/track_preparer/bin
python3 diagnose.py /mnt/HDD/in/music /mnt/HDD/out/music
```

Она показывает версии Python/mutagen/ffmpeg, наличие `shnsplit`/`flac`/`metaflac`, умеет ли ffmpeg измерять громкость и пик, пишутся ли теги, тип файловой системы папок и допустимы ли в ней символы `:` и `?` в именах.

### Надёжность

- **Это перенос, а не копирование.** Готовые альбомы уезжают в выходную папку, а сама папка альбома, обложки, nfo и прочий мусор удаляются из входной. После успешного прогона входная папка снова пустая (сама папка остаётся); остаются только папки, которые плагин не смог разобрать, — каждая с причиной в логе.
- Файл-источник удаляется только после проверки, что результат реально существует (размер/длительность): конвертация, нарезка по cue и перенос в выходную папку.
- Если образ не удалось порезать по cue, папка **не обрабатывается дальше и ничего не удаляется**: она остаётся во входной с записью `[PROBLEM]`, образ не попадёт в библиотеку одним длинным треком.
- Образ для cue ищется независимо от имени и расширения: имя в строке `FILE` (например `Album.iso.wv`) сопоставляется с реальным файлом (`Album.flac`); если имена не совпали — берётся единственный аудиофайл, а среди нескольких — тот, в который по длительности укладывается cue. Cue с «чужим» расширением (`Album.cue.iso.wv`) переименовывается в `.cue`.
- `shnsplit` не понимает hi-res/многоканальный flac (`unsupported format 0xfffe`): тогда нарезка автоматически идёт через ffmpeg.
- В лог пишется, куда именно перенесён альбом (`moved N/N file(s) -> ...`).
- Имена файлов очищаются от символов, запрещённых на NTFS/exFAT/FAT (`: ? * " < > | \ /`); оригинальные названия сохраняются в тегах.

### Известные особенности

- Обрезка тишины может нарушить «бесшовность» (gapless) концептуальных и живых альбомов с намеренной паузой между треками. Порог и поведение — константы в `bin/process_tracks.py`.
- Если cue не удаётся сопоставить с образом (образами) — строка `FILE` не совпала ни с одним файлом, трек пересекает границу между частями образа, cue не подходит к образу по длительности или число секций cue и аудиофайлов не совпадает, — папка **пропускается целиком**: ничего не переносится и не удаляется, причина пишется как `[PROBLEM]`.
- Lossy-источники (m4a/aac, ogg, opus, wma, …) перекодируются в MP3 V0, что стоит части качества. По возможности берите lossless. `.m4b` не обрабатывается.
- Теги ReplayGain пишутся только для FLAC и MP3.

### Удаление

**Настройки → Плагины → Установленные →** выключить и удалить. Входные и выходные папки не удаляются.

### История изменений

См. [CHANGELOG.md](CHANGELOG.md).

### Лицензия

MIT (см. `LICENSE` и `package.json`).
