#!/usr/bin/env python3
# run_pipeline.py — оркестратор.
# Пишет состояние в status.json и живой лог в run.log (их показывает окно
# выполнения плагина). Последняя строка stdout: {"skipped": N}
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from common import (ANY_AUDIO, CANCEL_FLAG, DISC, IN_MUSIC, LOG_FILE,
                    PROBLEM, RUN_LOG, STATUS_FILE, problem, rm, visible_dirs)

BIN = Path(__file__).resolve().parent
MEDIA = ANY_AUDIO | {".cue"}

# Доли работы над одним альбомом (в сумме 1.0), нужны для процентов
# Порядок: конвертация форматов -> нарезка cue -> проверка готовности -> обложка ->
# обрезка тишины -> объединение дисков -> имена -> перенос в out -> ReplayGain
# ПОСЛЕДНИМ шагом, уже на готовых файлах в выходной папке.
ALBUM_STEPS = [("unpack", 0.07), ("cue", 0.08), ("check", 0.01),
               ("cover", 0.02), ("tracks", 0.37), ("merge", 0.02),
               ("names", 0.01), ("sort", 0.02), ("replaygain", 0.40)]
# у «готового» альбома (теги + встроенная обложка) эти шаги пропускаются
SKIP_WHEN_READY = {"cover", "tracks"}


class Cancelled(Exception):
    pass


def log_offset():
    return LOG_FILE.stat().st_size if LOG_FILE.exists() else 0


def count_problems(offset):
    if not LOG_FILE.exists():
        return 0
    if LOG_FILE.stat().st_size < offset:          # лог ротировался
        offset = 0
    n = 0
    with LOG_FILE.open("rb") as f:
        f.seek(offset)
        for raw in f:
            if PROBLEM in raw.decode("utf-8", "replace"):
                n += 1
    return n


def media_bytes(d):
    total = 0
    for p in Path(d).rglob("*"):
        try:
            if p.is_file() and p.suffix.lower() in ANY_AUDIO:
                total += p.stat().st_size
        except OSError:
            pass
    return max(total, 1_000_000)


def has_media(d):
    return any(p.is_file() and not p.name.startswith(".")
               and p.suffix.lower() in MEDIA for p in d.iterdir())


class Run:
    """Состояние запуска + запись status.json / run.log."""

    def __init__(self):
        self.t0 = time.time()
        self.total = 1.0
        self.done_w = 0.0        # вес завершённых элементов
        self.cur_w = 0.0         # вес текущего элемента
        self.frac_before = 0.0   # доля элемента, пройденная до текущего шага
        self.step_w = 0.0        # вес текущего шага внутри элемента
        self.sub = 0.0           # прогресс внутри шага 0..1
        self.percent = 0.0
        self.last_write = 0.0
        self.last_out = []
        self.s = {"state": "running", "started": self.t0, "updated": self.t0,
                  "finished": None, "percent": 0.0, "eta": None, "kind": "",
                  "item": "", "step": "", "file": "", "items_done": 0,
                  "items_total": 0, "problems": 0, "cancelling": False,
                  "message": ""}
        RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
        self.log = RUN_LOG.open("w", encoding="utf-8")

    # --- запись ---
    def write(self, force=False):
        now = time.time()
        if not force and now - self.last_write < 0.4:
            return
        self.last_write = now
        frac = self.frac_before + self.step_w * self.sub
        pct = (self.done_w + self.cur_w * frac) / self.total * 100
        self.percent = max(self.percent, min(pct, 99.0))
        if self.s["state"] == "done":
            self.percent = 100.0
        self.s["percent"] = round(self.percent, 1)
        self.s["updated"] = now
        el = now - self.t0
        self.s["eta"] = (round(el * (100 - self.percent) / self.percent)
                         if self.s["state"] == "running" and self.percent > 3 else None)
        tmp = STATUS_FILE.with_name(STATUS_FILE.name + ".tmp")
        tmp.write_text(json.dumps(self.s, ensure_ascii=False), encoding="utf-8")
        os.replace(str(tmp), str(STATUS_FILE))

    def line(self, text):
        self.log.write(f"{time.strftime('%H:%M:%S')} {text}\n")
        self.log.flush()
        if text.startswith("✖"):
            self.s["problems"] += 1

    def fail(self, msg):
        problem(msg)
        self.line("✖ " + msg)
        self.write(True)

    # --- структура работы ---
    def begin_item(self, kind, name, weight, done_count):
        self.cur_w, self.frac_before, self.step_w, self.sub = weight, 0.0, 0.0, 0.0
        self.s.update(kind=kind, item=name, step="", file="", items_done=done_count)
        self.line(f"=== {name}")
        self.write(True)

    def end_item(self):
        self.done_w += self.cur_w
        self.cur_w = self.frac_before = self.step_w = self.sub = 0.0
        self.s["items_done"] += 1
        self.write(True)

    def begin_step(self, key, weight):
        self.frac_before += self.step_w          # предыдущий шаг считаем пройденным
        self.step_w, self.sub = weight, 0.0
        self.s["step"], self.s["file"] = key, ""
        self.write(True)

    def check_cancel(self):
        if CANCEL_FLAG.exists():
            raise Cancelled()

    def finish(self, state, message=""):
        self.s.update(state=state, message=message, finished=time.time(),
                      step="", file="", cancelling=False)
        self.write(True)
        self.log.close()

    # --- запуск дочернего скрипта с трансляцией вывода ---
    def run_script(self, script, *args, scale=(0, 1)):
        cmd = [sys.executable, "-u", str(BIN / script)] + [str(a) for a in args]
        env = dict(os.environ, PYTHONUNBUFFERED="1")
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             text=True, encoding="utf-8", errors="replace",
                             env=env)
        out = []
        for raw in p.stdout:
            text = raw.rstrip("\n")
            if text.startswith("@@"):
                try:
                    ev = json.loads(text[2:])
                except ValueError:
                    continue
                if "file" in ev:
                    self.s["file"] = ev["file"]
                if "i" in ev and ev.get("n"):
                    self.sub = (scale[0] + ev["i"] / ev["n"]) / scale[1]
            elif text.strip():
                out.append(text)
                self.line(text)
            if CANCEL_FLAG.exists():
                self.s["cancelling"] = True
            self.write()
        rc = p.wait()
        self.last_out = out
        self.sub = (scale[0] + 1) / scale[1]
        if rc != 0:
            self.fail(f"{script} failed (exit {rc}): "
                      f"{' | '.join(out[-3:])[-400:]}")
            return ""
        return out[-1] if out else ""


# ---------------------------------------------------------------- музыка

def is_album(d):
    """Единица обработки — любая папка, в которой прямо лежит аудио/cue или есть
    cd1/cd2/disc N. Название и положение папки (артист, альбом, сборник, жанр)
    не важны: структуру входной папки не анализируем, артист/альбом для выхода
    берутся из тегов."""
    return has_media(d) or any(DISC.match(s.name) for s in visible_dirs(d))


def plan_music():
    """-> (список папок для обработки, предупреждения).
    Обход вглубь на любую глубину; вложенные папки идут РАНЬШЕ родительской
    (иначе родитель не удалится, пока в нём лежит необработанное аудио)."""
    units, warnings = [], []
    if not IN_MUSIC.is_dir():
        return units, warnings

    def walk(d):
        for entry in visible_dirs(d):
            if DISC.match(entry.name) and d != IN_MUSIC and is_album(d):
                continue                      # cd1/cd2 — часть папки-родителя
            walk(entry)                       # сначала вложенные папки
            if is_album(entry):
                units.append(entry)

    walk(IN_MUSIC)
    return units, warnings


def dest_dirs(lines):
    """Папки назначения из вывода sort_library (строки '→ путь')."""
    out = []
    for l in lines:
        if l.startswith("→ "):
            d = l[2:].strip()
            if d and d not in out:
                out.append(d)
    return out


def process_album(run, album_dir):
    cover = ""
    ready = False
    dests = []
    for key, w in ALBUM_STEPS:
        run.check_cancel()
        if ready and key in SKIP_WHEN_READY:
            continue
        run.begin_step(key, w)
        if key == "unpack":
            run.run_script("unpack_images.py", album_dir)
        elif key == "cue":
            out = run.run_script("prepare_cue.py", album_dir)
            if out and out.startswith("CUE_FAILED"):
                # образ не порезан: НЕ обрабатываем его как один трек и ничего не
                # удаляем — папка остаётся во входной (с cue) для повторной попытки
                run.fail(f"папка пропущена, образ не порезан (файлы не тронуты): {album_dir}")
                return
        elif key == "check":
            out = run.run_script("check_ready.py", album_dir)
            ready = bool(out) and out.startswith("READY")
        elif key == "cover":
            out = run.run_script("find_cover.py", album_dir)
            cover = out if out and Path(out).is_file() else ""
        elif key == "tracks":
            # папки cd1/cd2 могли появиться на шаге cue (несколько cue в одной папке)
            targets = [album_dir] + [d for d in visible_dirs(album_dir)
                                     if DISC.match(d.name)]
            for idx, d in enumerate(targets):
                args = [d] + (["--cover", cover] if cover else [])
                run.run_script("process_tracks.py", *args,
                               scale=(idx, len(targets)))
        elif key == "merge":
            run.run_script("merge_discs.py", album_dir)
        elif key == "names":
            run.run_script("clean_names.py", album_dir)
        elif key == "sort":
            run.run_script("sort_library.py", IN_MUSIC, "--album", album_dir)
            dests = dest_dirs(run.last_out)
        elif key == "replaygain":
            if dests:                       # ReplayGain на готовых файлах в out
                run.run_script("apply_replaygain.py", *dests)


def main():
    offset = log_offset()
    rm(STATUS_FILE)
    run = Run()
    try:
        # шаг 0: архивы (.iso.wv / .zip / .iso) -> папки, до планирования
        run.s.update(kind="music", item="", step="extract", file="")
        run.write(True)
        run.run_script("extract_archives.py", IN_MUSIC)
        run.check_cancel()
        albums, warnings = plan_music()
        a_w = [media_bytes(a) for a in albums]
        run.total = float(sum(a_w)) or 1.0
        run.s["items_total"] = len(albums)
        run.line(f"Плановый объём: папок {len(albums)}")
        for w in warnings:
            run.fail(w)
        run.write(True)

        for done, (album, w) in enumerate(zip(albums, a_w)):
            run.check_cancel()
            run.begin_item("music", str(album.relative_to(IN_MUSIC)), w, done)
            process_album(run, album)
            run.end_item()
        if IN_MUSIC.is_dir():
            run.check_cancel()
            run.cur_w = run.frac_before = run.step_w = 0.0
            run.s.update(kind="music", item="", step="sort", file="")
            run.write(True)
            run.run_script("sort_library.py", IN_MUSIC, "--loose")   # одиночные файлы, пустые папки
            loose = dest_dirs(run.last_out)
            if loose:
                run.s["step"] = "replaygain"
                run.run_script("apply_replaygain.py", *loose)
        run.finish("done")
    except Cancelled:
        run.line("⏹ Остановлено пользователем (после текущего шага)")
        run.finish("cancelled", "stopped by user")
    except Exception as e:                      # noqa: BLE001
        problem(f"pipeline crashed: {e}")
        run.line(f"✖ pipeline crashed: {e}")
        run.finish("error", str(e))
    finally:
        rm(CANCEL_FLAG)
        print(json.dumps({"skipped": count_problems(offset)}))


if __name__ == "__main__":
    main()
