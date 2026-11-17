#!/usr/bin/env python3
# apply_replaygain.py <папка_альбома_в_выходной_библиотеке>...
# ПОСЛЕДНИЙ шаг: ReplayGain 2.0 (-18 LUFS), только track gain, для готовых файлов в выходной папке.
# Считает встроенный replaygain.py (ffmpeg ebur128 + mutagen), вызывается напрямую:
# ход работы по файлам и все ошибки сразу попадают в окно выполнения и лог.
import sys
from pathlib import Path

from common import cancel_requested, note, problem, progress
import replaygain as rg


def main():
    folders = [Path(a) for a in sys.argv[1:] if Path(a).is_dir()]
    for i, folder in enumerate(folders):
        if cancel_requested():
            note("stopped on request")
            return

        def on_step(k, n, name, i=i, folder=folder):
            progress(i=i + k / n, n=len(folders), file=f"{folder.name}: {name}")

        try:
            res = rg.process_folder(folder, on_step)
        except Exception as e:                           # noqa: BLE001
            problem(f"replaygain {folder}: {type(e).__name__}: {e}")
            continue
        if res is None:                                  # остановлено пользователем
            return
        written, total = res
        if total and written == total:                   # ошибки уже записаны через problem()
            print(f"✓ ReplayGain: {folder.name} ({written} tracks)")
    progress(i=len(folders), n=len(folders))


if __name__ == "__main__":
    main()
