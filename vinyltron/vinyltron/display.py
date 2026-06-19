import logging
import os
import random
import sys
from typing import Dict, List, NamedTuple, Optional, Tuple

from PIL import Image, ImageOps

sys.path.insert(0, '/home/volumio/rpi-rgb-led-matrix/bindings/python')
from rgbmatrix import RGBMatrix, RGBMatrixOptions

log = logging.getLogger(__name__)

IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp')


class Glyph(NamedTuple):
    rows: Tuple[int, ...]
    width: int
    height: int
    advance: int


class PixelFont(NamedTuple):
    name: str
    glyphs: Dict[str, Glyph]
    height: int
    trim_right: int = 1


FONT_3X5: Dict[str, Tuple[int, ...]] = {
    ' ': (0b000, 0b000, 0b000, 0b000, 0b000),
    '-': (0b000, 0b000, 0b111, 0b000, 0b000),
    '/': (0b001, 0b001, 0b010, 0b100, 0b100),
    '.': (0b000, 0b000, 0b000, 0b000, 0b010),
    '0': (0b111, 0b101, 0b101, 0b101, 0b111),
    '1': (0b010, 0b110, 0b010, 0b010, 0b111),
    '2': (0b111, 0b001, 0b111, 0b100, 0b111),
    '3': (0b111, 0b001, 0b111, 0b001, 0b111),
    '4': (0b101, 0b101, 0b111, 0b001, 0b001),
    '5': (0b111, 0b100, 0b111, 0b001, 0b111),
    '6': (0b111, 0b100, 0b111, 0b101, 0b111),
    '7': (0b111, 0b001, 0b010, 0b010, 0b010),
    '8': (0b111, 0b101, 0b111, 0b101, 0b111),
    '9': (0b111, 0b101, 0b111, 0b001, 0b111),
    'A': (0b010, 0b101, 0b111, 0b101, 0b101),
    'B': (0b110, 0b101, 0b110, 0b101, 0b110),
    'C': (0b111, 0b100, 0b100, 0b100, 0b111),
    'D': (0b110, 0b101, 0b101, 0b101, 0b110),
    'E': (0b111, 0b100, 0b110, 0b100, 0b111),
    'F': (0b111, 0b100, 0b110, 0b100, 0b100),
    'G': (0b111, 0b100, 0b101, 0b101, 0b111),
    'H': (0b101, 0b101, 0b111, 0b101, 0b101),
    'I': (0b111, 0b010, 0b010, 0b010, 0b111),
    'J': (0b001, 0b001, 0b001, 0b101, 0b111),
    'K': (0b101, 0b101, 0b110, 0b101, 0b101),
    'L': (0b100, 0b100, 0b100, 0b100, 0b111),
    'M': (0b101, 0b111, 0b111, 0b101, 0b101),
    'N': (0b101, 0b111, 0b111, 0b111, 0b101),
    'O': (0b111, 0b101, 0b101, 0b101, 0b111),
    'P': (0b111, 0b101, 0b111, 0b100, 0b100),
    'Q': (0b111, 0b101, 0b101, 0b111, 0b001),
    'R': (0b110, 0b101, 0b110, 0b101, 0b101),
    'S': (0b111, 0b100, 0b111, 0b001, 0b111),
    'T': (0b111, 0b010, 0b010, 0b010, 0b010),
    'U': (0b101, 0b101, 0b101, 0b101, 0b111),
    'V': (0b101, 0b101, 0b101, 0b101, 0b010),
    'W': (0b101, 0b101, 0b111, 0b111, 0b101),
    'X': (0b101, 0b101, 0b010, 0b101, 0b101),
    'Y': (0b101, 0b101, 0b010, 0b010, 0b010),
    'Z': (0b111, 0b001, 0b010, 0b100, 0b111),
}


def _builtin_font() -> PixelFont:
    glyphs = {}
    for char, rows in FONT_3X5.items():
        normalized_rows = []
        for row in rows:
            normalized = 0
            for x in range(3):
                if row & (1 << (2 - x)):
                    normalized |= 1 << x
            normalized_rows.append(normalized)
        glyphs[char] = Glyph(rows=tuple(normalized_rows), width=3, height=5, advance=4)
    return PixelFont(name='tom_thumb', glyphs=glyphs, height=5, trim_right=1)


def _load_bdf_font(path: str, name: str) -> PixelFont:
    glyphs = {}
    current = None
    in_bitmap = False
    bitmap = []
    font_ascent = None
    font_descent = None
    cap_height = None

    with open(path, 'r', encoding='ascii', errors='ignore') as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            parts = line.split()

            if parts[0] == 'FONT_ASCENT' and len(parts) > 1:
                font_ascent = int(parts[1])
            elif parts[0] == 'FONT_DESCENT' and len(parts) > 1:
                font_descent = int(parts[1])
            elif parts[0] == 'CAP_HEIGHT' and len(parts) > 1:
                cap_height = int(parts[1])
            elif parts[0] == 'STARTCHAR':
                current = {
                    'encoding': None,
                    'advance': 0,
                    'bbx': (0, 0, 0, 0),
                }
                bitmap = []
                in_bitmap = False
            elif current is not None and parts[0] == 'ENCODING' and len(parts) > 1:
                current['encoding'] = int(parts[1])
            elif current is not None and parts[0] == 'DWIDTH' and len(parts) > 1:
                current['advance'] = int(parts[1])
            elif current is not None and parts[0] == 'BBX' and len(parts) >= 5:
                current['bbx'] = tuple(int(part) for part in parts[1:5])
            elif current is not None and parts[0] == 'BITMAP':
                in_bitmap = True
            elif current is not None and parts[0] == 'ENDCHAR':
                encoding = current['encoding']
                if encoding is not None and 32 <= encoding <= 126:
                    glyph = _bdf_glyph(current, bitmap, font_ascent)
                    glyphs[chr(encoding)] = glyph
                current = None
                in_bitmap = False
            elif current is not None and in_bitmap:
                bitmap.append(line)

    if ' ' not in glyphs:
        glyphs[' '] = Glyph(rows=tuple(), width=0, height=0, advance=3)
    if not glyphs:
        raise ValueError("BDF font contains no ASCII glyphs")

    height_candidates = [glyph.height for glyph in glyphs.values()]
    if cap_height:
        height = max(cap_height, max(height_candidates))
    elif font_ascent is not None and font_descent is not None:
        height = font_ascent + font_descent
    else:
        height = max(height_candidates)
    return PixelFont(name=name, glyphs=glyphs, height=height, trim_right=1)


def _bdf_glyph(current, bitmap, font_ascent) -> Glyph:
    width, height, x_offset, y_offset = current['bbx']
    advance = current['advance'] or width + 1
    if width <= 0 or height <= 0:
        return Glyph(rows=tuple(), width=0, height=0, advance=max(1, advance))

    if font_ascent is None:
        top_padding = 0
        glyph_height = height
    else:
        top_padding = max(0, font_ascent - y_offset - height)
        glyph_height = max(height + top_padding, font_ascent)

    rows = [0] * glyph_height
    for src_y, hex_row in enumerate(bitmap[:height]):
        bits = int(hex_row, 16) if hex_row else 0
        total_bits = len(hex_row) * 4
        dst_y = top_padding + src_y
        row = 0
        for x in range(width):
            if bits & (1 << (total_bits - 1 - x)):
                dst_x = x + max(0, x_offset)
                if 0 <= dst_x < max(width + max(0, x_offset), advance):
                    row |= 1 << dst_x
        if 0 <= dst_y < len(rows):
            rows[dst_y] = row

    return Glyph(
        rows=tuple(rows),
        width=max(width + max(0, x_offset), advance),
        height=glyph_height,
        advance=max(1, advance),
    )


class TextOverlay(NamedTuple):
    text: str
    color_rgb: Tuple[int, int, int]


class ProgressOverlay(NamedTuple):
    filled_width: int
    height: int
    foreground_rgb: Tuple[int, int, int]
    background_rgb: Optional[Tuple[int, int, int]]


def _snd_bcm2835_loaded() -> bool:
    try:
        with open('/proc/modules') as f:
            return any(line.split()[0] == 'snd_bcm2835' for line in f)
    except OSError:
        return False


def _pi5_detected() -> bool:
    try:
        with open('/proc/device-tree/model') as f:
            return 'Raspberry Pi 5' in f.read()
    except OSError:
        return False


def _build_gamma_lut(gamma: float):
    single = bytes(int((i / 255.0) ** gamma * 255 + 0.5) for i in range(256))
    return single * 3  # Pillow needs 768 entries for RGB (256 per channel)


class Display:
    def __init__(self, cfg: dict):
        d = cfg['display']
        opts = RGBMatrixOptions()
        opts.rows = d['rows']
        opts.cols = d['cols']
        opts.brightness = d['brightness']
        opts.gpio_slowdown = d['slowdown_gpio']
        if d.get('limit_refresh_rate_hz'):
            opts.limit_refresh_rate_hz = d['limit_refresh_rate_hz']
        if d.get('pwm_bits'):
            opts.pwm_bits = d['pwm_bits']
        opts.hardware_mapping = d.get('hardware_mapping', 'adafruit-hat-pwm')
        opts.disable_hardware_pulsing = d.get('disable_hardware_pulsing', False)
        if not opts.disable_hardware_pulsing and _snd_bcm2835_loaded():
            log.warning(
                "snd_bcm2835 sound module is loaded; forcing disable_hardware_pulsing=True "
                "to avoid rpi-rgb-led-matrix exiting on startup (expect more flicker). "
                "See docs/engineering-spec.md for how to disable the sound module."
            )
            opts.disable_hardware_pulsing = True
        if not opts.disable_hardware_pulsing and _pi5_detected():
            log.warning(
                "Raspberry Pi 5 detected; forcing disable_hardware_pulsing=True. "
                "Hardware-pulse mode hangs the daemon on this Pi 5 (rpi-rgb-led-matrix "
                "predates RP1 GPIO support) and is unsupported here. "
                "See docs/engineering-spec.md for details."
            )
            opts.disable_hardware_pulsing = True
        opts.pixel_mapper_config = f"Rotate:{d['rotation']}"
        if d.get('panel_type'):
            opts.panel_type = d['panel_type']

        self._matrix = RGBMatrix(options=opts)
        self._canvas = self._matrix.CreateFrameCanvas()
        self._size = (d['cols'], d['rows'])
        self._gamma_lut = _build_gamma_lut(d['gamma'])
        self._fallback_cfg = cfg.get('fallback', {})
        self._fallback = self._load_fallback(self._fallback_cfg.get('image', 'assets/idle.png'))
        self._text_font = self._load_text_font(cfg)
        self._current_image = Image.new('RGB', self._size, (0, 0, 0))
        self._text_overlay = None
        self._progress_overlay = None

    def _load_text_font(self, cfg: dict) -> PixelFont:
        overlays = cfg.get('overlays', {})
        font_name = str(overlays.get('format_font', 'tom_thumb')).strip().lower()
        if font_name in ('tom_thumb', 'default', ''):
            return _builtin_font()

        if font_name == 'tiny5':
            path = overlays.get('format_font_path') or 'assets/fonts/Tiny5.bdf'
        elif font_name == 'spleen':
            path = overlays.get('format_font_path') or 'assets/fonts/spleen-5x8.bdf'
        else:
            path = overlays.get('format_font_path')

        if not path:
            log.warning("No BDF path configured for format font %s; using tom_thumb", font_name)
            return _builtin_font()

        try:
            if not os.path.exists(path):
                raise IOError("font file not found")
            font = _load_bdf_font(path, font_name)
            log.info("Loaded format font %s from %s", font.name, path)
            return font
        except Exception as e:
            log.warning("Could not load format font %s from %s: %s; using tom_thumb", font_name, path, e)
            return _builtin_font()

    def _load_fallback(self, path: str) -> Image.Image:
        try:
            img = self._open_source_image(path)
            return self._process(img)
        except Exception as e:
            log.warning("Could not load fallback image %s: %s — using blank", path, e)
            return Image.new('RGB', self._size, (0, 0, 0))

    def _open_source_image(self, path: str) -> Image.Image:
        img = Image.open(path)
        img = ImageOps.exif_transpose(img)
        return img.convert('RGB')

    def _process(self, img: Image.Image) -> Image.Image:
        img = self._center_crop_square(img)
        img = img.resize(self._size, Image.LANCZOS)
        img = img.point(self._gamma_lut)
        return img

    def _center_crop_square(self, img: Image.Image) -> Image.Image:
        width, height = img.size
        side = min(width, height)
        if side <= 0:
            return img
        left = int((width - side) / 2)
        top = int((height - side) / 2)
        return img.crop((left, top, left + side, top + side))

    def show_image(self, img: Image.Image):
        processed = self._process(img)
        self._current_image = processed.copy()
        self._render()

    def show_fallback(self):
        self._current_image = self._select_fallback_image()
        self._text_overlay = None
        self._progress_overlay = None
        self._render()

    def show_screensaver_frame(self, img: Image.Image):
        self._current_image = img.point(self._gamma_lut)
        self._render()

    def _select_fallback_image(self) -> Image.Image:
        mode = str(self._fallback_cfg.get('mode', 'single')).strip().lower()
        if mode == 'selected':
            img = self._load_selected_fallback()
            if img is not None:
                return img
        elif mode == 'random_folder':
            img = self._load_random_fallback()
            if img is not None:
                return img
        return self._fallback.copy()

    def _load_selected_fallback(self) -> Optional[Image.Image]:
        folder = self._fallback_folder()
        filename = os.path.basename(str(self._fallback_cfg.get('selected_image', '')).strip())
        if not folder or not filename:
            return None
        return self._load_folder_fallback(os.path.join(folder, filename))

    def _load_random_fallback(self) -> Optional[Image.Image]:
        files = self._fallback_files()
        random.shuffle(files)
        for path in files:
            img = self._load_folder_fallback(path)
            if img is not None:
                return img
        return None

    def _load_folder_fallback(self, path: str) -> Optional[Image.Image]:
        try:
            img = self._open_source_image(path)
            log.info("Loaded idle image %s", path)
            return self._process(img)
        except Exception as e:
            log.warning("Could not load idle image %s: %s", path, e)
            return None

    def _fallback_folder(self) -> Optional[str]:
        folder = str(self._fallback_cfg.get('image_folder', '')).strip()
        if not folder or not os.path.isdir(folder):
            return None
        return folder

    def _fallback_files(self) -> List[str]:
        folder = self._fallback_folder()
        if not folder:
            return []
        try:
            return [
                os.path.join(folder, name)
                for name in os.listdir(folder)
                if self._is_supported_image_name(name) and os.path.isfile(os.path.join(folder, name))
            ]
        except Exception as e:
            log.warning("Could not scan idle image folder %s: %s", folder, e)
            return []

    def _is_supported_image_name(self, name: str) -> bool:
        return not name.startswith('.') and name.lower().endswith(IMAGE_EXTENSIONS)

    def show_text(self, text: str, color_rgb: Tuple[int, int, int]):
        self._text_overlay = TextOverlay(self._fit_text(text), color_rgb)
        self._render()

    def clear_badge(self):
        self.clear_text()

    def clear_text(self):
        self._text_overlay = None
        self._render()

    def show_progress(
        self,
        filled_width: int,
        height: int,
        foreground_rgb: Tuple[int, int, int],
        background_rgb: Optional[Tuple[int, int, int]],
    ):
        filled_width = max(0, min(self._size[0], int(filled_width)))
        height = max(1, min(self._size[1], int(height)))
        self._progress_overlay = ProgressOverlay(filled_width, height, foreground_rgb, background_rgb)
        self._render()

    def clear_progress(self):
        self._progress_overlay = None
        self._render()

    def _render(self):
        img = self._current_image.copy()

        if self._progress_overlay:
            self._draw_progress(img, self._progress_overlay)

        if self._text_overlay:
            self._draw_text(img, self._text_overlay)

        self._canvas.SetImage(img, unsafe=False)
        self._canvas = self._matrix.SwapOnVSync(self._canvas)

    def _draw_text(self, img: Image.Image, overlay):
        pixels = img.load()
        x0, y0 = 2, 2
        text_width = self._text_width(overlay.text)
        font = self._text_font

        for y in range(y0 - 1, y0 + font.height + 2):
            for x in range(x0 - 1, min(self._size[0], x0 + text_width + 1)):
                if 0 <= x < self._size[0] and 0 <= y < self._size[1]:
                    pixels[x, y] = (0, 0, 0)

        cursor = x0
        for char in overlay.text:
            glyph = font.glyphs.get(char, font.glyphs[' '])
            for y, row in enumerate(glyph.rows):
                for x in range(glyph.width):
                    if row & (1 << x):
                        px = cursor + x
                        py = y0 + y
                        if 0 <= px < self._size[0] and 0 <= py < self._size[1]:
                            pixels[px, py] = overlay.color_rgb
            cursor += glyph.advance

    def _draw_progress(self, img: Image.Image, overlay):
        pixels = img.load()
        y0 = self._size[1] - overlay.height

        if overlay.background_rgb is not None:
            for y in range(y0, self._size[1]):
                for x in range(self._size[0]):
                    pixels[x, y] = overlay.background_rgb

        for y in range(y0, self._size[1]):
            for x in range(overlay.filled_width):
                pixels[x, y] = overlay.foreground_rgb

    def reconfigure(self, cfg: dict):
        """Hot-reload brightness, gamma, and fallback image. Matrix geometry requires restart."""
        d = cfg['display']
        self._matrix.brightness = d['brightness']
        self._gamma_lut = _build_gamma_lut(d['gamma'])
        self._fallback_cfg = cfg.get('fallback', {})
        self._fallback = self._load_fallback(self._fallback_cfg.get('image', 'assets/idle.png'))
        self._text_font = self._load_text_font(cfg)

    def clear(self):
        self._canvas.Clear()
        self._canvas = self._matrix.SwapOnVSync(self._canvas)
        self._current_image = Image.new('RGB', self._size, (0, 0, 0))
        self._text_overlay = None
        self._progress_overlay = None

    def _fit_text(self, text: str) -> str:
        text = ''.join(ch for ch in text.upper() if ch in self._text_font.glyphs)
        while text and self._text_width(text) > self._size[0] - 4:
            text = text[:-1]
        return text

    def _text_width(self, text: str) -> int:
        if not text:
            return 0
        width = sum(self._text_font.glyphs.get(char, self._text_font.glyphs[' ']).advance for char in text)
        return max(0, width - self._text_font.trim_right)
