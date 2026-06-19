import math
import random
from array import array
from typing import Dict, List, NamedTuple, Tuple

from PIL import Image


RGB = Tuple[int, int, int]

BRIANS_BRAIN_PALETTES: Dict[str, Tuple[RGB, RGB]] = {
    'cyan_amber': ((0, 220, 255), (160, 42, 0)),
    'green_magenta': ((60, 255, 80), (90, 0, 150)),
    'blue_red': ((50, 120, 255), (150, 0, 20)),
    'white_violet': ((245, 245, 255), (70, 0, 120)),
}

LANGTONS_ANT_PALETTES: Dict[str, Tuple[RGB, ...]] = {
    'cyan_amber': ((0, 220, 255), (255, 150, 0), (50, 80, 255), (255, 40, 120)),
    'green_magenta': ((60, 255, 80), (255, 40, 220), (0, 190, 255), (255, 180, 30)),
    'blue_red': ((50, 120, 255), (255, 35, 45), (0, 230, 210), (255, 170, 0)),
    'white_violet': ((245, 245, 255), (150, 60, 255), (70, 220, 255), (255, 90, 190)),
}

CHAOS_GAME_PALETTES: Dict[str, Tuple[RGB, ...]] = {
    'cyan_amber': ((0, 220, 255), (255, 170, 0), (255, 60, 130)),
    'green_magenta': ((60, 255, 80), (255, 40, 220), (40, 200, 255)),
    'blue_red': ((50, 120, 255), (255, 35, 45), (0, 230, 210)),
    'white_violet': ((245, 245, 255), (160, 70, 255), (70, 210, 255)),
}

GRAY_SCOTT_PALETTES: Dict[str, Tuple[RGB, ...]] = {
    'cyan_amber': ((5, 10, 25), (0, 70, 110), (0, 200, 255), (255, 210, 90), (255, 140, 30)),
    'green_magenta': ((10, 0, 20), (90, 0, 110), (200, 20, 160), (120, 230, 120), (60, 255, 80)),
    'blue_red': ((5, 5, 25), (20, 50, 140), (40, 110, 255), (255, 90, 70), (255, 50, 50)),
    'white_violet': ((10, 0, 30), (70, 0, 90), (200, 20, 160), (80, 180, 255), (140, 255, 255)),
}


class Ant(NamedTuple):
    x: int
    y: int
    direction: int
    color_index: int


class BriansBrain:
    def __init__(
        self,
        width: int,
        height: int,
        palette: str = 'cyan_amber',
        density: float = 0.22,
        seed: str = '',
    ):
        self.width = int(width)
        self.height = int(height)
        self.size = self.width * self.height
        self.state = bytearray(self.size)
        self.next_state = bytearray(self.size)
        self.rgb = bytearray(self.size * 3)
        self.neighbors = self._build_neighbors()
        self.ready_rgb, self.dying_rgb = self._palette(palette)
        self.dead_rgb = (0, 0, 0)
        self.random = random.Random(seed or None)
        self.density = max(0.02, min(0.45, float(density)))
        self._seed()

    def _build_neighbors(self):
        neighbors = []
        for y in range(self.height):
            y_up = (y - 1) % self.height
            y_down = (y + 1) % self.height
            row = y * self.width
            row_up = y_up * self.width
            row_down = y_down * self.width
            for x in range(self.width):
                x_left = (x - 1) % self.width
                x_right = (x + 1) % self.width
                neighbors.append((
                    row_up + x_left,
                    row_up + x,
                    row_up + x_right,
                    row + x_left,
                    row + x_right,
                    row_down + x_left,
                    row_down + x,
                    row_down + x_right,
                ))
        return neighbors

    def _palette(self, name: str) -> Tuple[RGB, RGB]:
        return BRIANS_BRAIN_PALETTES.get(name, BRIANS_BRAIN_PALETTES['cyan_amber'])

    def _seed(self):
        state = self.state
        density = self.density
        rand = self.random.random
        for i in range(self.size):
            state[i] = 1 if rand() < density else 0

    def frame(self) -> Image.Image:
        self._step()
        self._render_rgb()
        return Image.frombytes('RGB', (self.width, self.height), bytes(self.rgb))

    def _step(self):
        state = self.state
        next_state = self.next_state
        neighbors = self.neighbors
        active = 0

        for i in range(self.size):
            cell = state[i]
            if cell == 1:
                next_state[i] = 2
                active += 1
            elif cell == 2:
                next_state[i] = 0
            else:
                ready_neighbors = 0
                for n in neighbors[i]:
                    if state[n] == 1:
                        ready_neighbors += 1
                if ready_neighbors == 2:
                    next_state[i] = 1
                    active += 1
                else:
                    next_state[i] = 0

        self.state, self.next_state = self.next_state, self.state
        if active < 8:
            self._seed()

    def _render_rgb(self):
        state = self.state
        rgb = self.rgb
        ready = self.ready_rgb
        dying = self.dying_rgb
        dead = self.dead_rgb

        j = 0
        for cell in state:
            if cell == 1:
                color = ready
            elif cell == 2:
                color = dying
            else:
                color = dead
            rgb[j] = color[0]
            rgb[j + 1] = color[1]
            rgb[j + 2] = color[2]
            j += 3


class LangtonsAnt:
    def __init__(
        self,
        width: int,
        height: int,
        palette: str = 'cyan_amber',
        ant_count: int = 4,
        steps_per_frame: int = 96,
        seed: str = '',
    ):
        self.width = int(width)
        self.height = int(height)
        self.size = self.width * self.height
        self.state = bytearray(self.size)
        self.rgb = bytearray(self.size * 3)
        self.random = random.Random(seed or None)
        self.colors = self._palette(palette)
        self.ant_count = max(1, min(8, int(ant_count)))
        self.steps_per_frame = max(1, min(512, int(steps_per_frame)))
        self.ants: List[Ant] = []
        self._seed()

    def _palette(self, name: str) -> Tuple[RGB, ...]:
        return LANGTONS_ANT_PALETTES.get(name, LANGTONS_ANT_PALETTES['cyan_amber'])

    def _seed(self):
        self.state[:] = b'\x00' * self.size
        self.rgb[:] = b'\x00' * (self.size * 3)
        self.ants = []
        used = set()
        for i in range(self.ant_count):
            for _ in range(32):
                x = self.random.randrange(self.width)
                y = self.random.randrange(self.height)
                if (x, y) not in used:
                    break
            used.add((x, y))
            self.ants.append(Ant(
                x=x,
                y=y,
                direction=self.random.randrange(4),
                color_index=i % len(self.colors),
            ))

    def frame(self) -> Image.Image:
        for _ in range(self.steps_per_frame):
            self._step()
        self._render_ants()
        return Image.frombytes('RGB', (self.width, self.height), bytes(self.rgb))

    def _step(self):
        next_ants = []
        width = self.width
        height = self.height
        state = self.state
        rgb = self.rgb
        colors = self.colors

        for ant in self.ants:
            idx = ant.y * width + ant.x
            cell = state[idx]
            direction = (ant.direction + (1 if cell == 0 else -1)) % 4
            state[idx] = 1 - cell

            j = idx * 3
            if cell == 0:
                color = colors[ant.color_index]
                rgb[j] = color[0]
                rgb[j + 1] = color[1]
                rgb[j + 2] = color[2]
            else:
                rgb[j] = 0
                rgb[j + 1] = 0
                rgb[j + 2] = 0

            if direction == 0:
                x = ant.x
                y = (ant.y - 1) % height
            elif direction == 1:
                x = (ant.x + 1) % width
                y = ant.y
            elif direction == 2:
                x = ant.x
                y = (ant.y + 1) % height
            else:
                x = (ant.x - 1) % width
                y = ant.y
            next_ants.append(Ant(x, y, direction, ant.color_index))

        self.ants = next_ants

    def _render_ants(self):
        rgb = self.rgb
        colors = self.colors
        for ant in self.ants:
            idx = (ant.y * self.width + ant.x) * 3
            color = colors[ant.color_index]
            rgb[idx] = min(255, color[0] + 60)
            rgb[idx + 1] = min(255, color[1] + 60)
            rgb[idx + 2] = min(255, color[2] + 60)


class ChaosGame:
    def __init__(
        self,
        width: int,
        height: int,
        palette: str = 'cyan_amber',
        points_per_frame: int = 320,
        fade: int = 12,
        rotation_speed: int = 2,
        seed: str = '',
    ):
        self.width = int(width)
        self.height = int(height)
        self.size = self.width * self.height
        self.rgb = bytearray(self.size * 3)
        self.random = random.Random(seed or None)
        self.colors = self._palette(palette)
        self.points_per_frame = max(8, min(2048, int(points_per_frame)))
        self.fade = max(0, min(64, int(fade)))
        self.rotation_speed = max(-16, min(16, int(rotation_speed)))
        self.frame_count = 0
        self.x = self.random.randrange(self.width)
        self.y = self.random.randrange(self.height)

    def _palette(self, name: str) -> Tuple[RGB, ...]:
        return CHAOS_GAME_PALETTES.get(name, CHAOS_GAME_PALETTES['cyan_amber'])

    def frame(self) -> Image.Image:
        if self.fade:
            self._fade()
        vertices = self._vertices()
        colors = self.colors
        for _ in range(self.points_per_frame):
            vertex_index = self.random.randrange(3)
            vx, vy = vertices[vertex_index]
            self.x = (self.x + vx) >> 1
            self.y = (self.y + vy) >> 1
            self._plot(self.x, self.y, colors[vertex_index])
        self.frame_count += 1
        return Image.frombytes('RGB', (self.width, self.height), bytes(self.rgb))

    def _vertices(self) -> Tuple[Tuple[int, int], Tuple[int, int], Tuple[int, int]]:
        radius = min(self.width, self.height) * 0.44
        cx = (self.width - 1) / 2.0
        cy = (self.height - 1) / 2.0
        angle = self.frame_count * self.rotation_speed * math.pi / 180.0
        return tuple(
            (
                max(0, min(self.width - 1, int(round(cx + math.cos(angle + offset) * radius)))),
                max(0, min(self.height - 1, int(round(cy + math.sin(angle + offset) * radius)))),
            )
            for offset in (-math.pi / 2.0, (math.pi * 7.0) / 6.0, (math.pi * 11.0) / 6.0)
        )

    def _fade(self):
        rgb = self.rgb
        fade = self.fade
        for i, value in enumerate(rgb):
            rgb[i] = value - fade if value > fade else 0

    def _plot(self, x: int, y: int, color: RGB):
        idx = (y * self.width + x) * 3
        rgb = self.rgb
        rgb[idx] = max(rgb[idx], color[0])
        rgb[idx + 1] = max(rgb[idx + 1], color[1])
        rgb[idx + 2] = max(rgb[idx + 2], color[2])


class GrayScott:
    def __init__(
        self,
        width: int,
        height: int,
        palette: str = 'cyan_amber',
        feed: float = 0.055,
        kill: float = 0.062,
        grid_scale: int = 2,
        seed: str = '',
    ):
        self.width = int(width)
        self.height = int(height)
        self.grid_scale = max(1, min(4, int(grid_scale)))
        self.gw = max(8, self.width // self.grid_scale)
        self.gh = max(8, self.height // self.grid_scale)
        self.size = self.gw * self.gh
        self.a = array('d', [1.0]) * self.size
        self.b = array('d', [0.0]) * self.size
        self.next_a = array('d', [0.0]) * self.size
        self.next_b = array('d', [0.0]) * self.size
        self.neighbors = self._build_neighbors()
        self.feed = max(0.0, min(0.1, float(feed)))
        self.kill = max(0.0, min(0.12, float(kill)))
        self.da = 1.0
        self.db = 0.5
        self.lut = self._build_lut(palette)
        self.value_scale = 255 / 0.45
        self.random = random.Random(seed or None)
        self._seed_spots()

    def _build_neighbors(self):
        neighbors = []
        for y in range(self.gh):
            y_up = (y - 1) % self.gh
            y_down = (y + 1) % self.gh
            row = y * self.gw
            row_up = y_up * self.gw
            row_down = y_down * self.gw
            for x in range(self.gw):
                x_left = (x - 1) % self.gw
                x_right = (x + 1) % self.gw
                neighbors.append((
                    row_up + x_left,
                    row_up + x,
                    row_up + x_right,
                    row + x_left,
                    row + x_right,
                    row_down + x_left,
                    row_down + x,
                    row_down + x_right,
                ))
        return neighbors

    def _build_lut(self, name: str) -> List[RGB]:
        stops = GRAY_SCOTT_PALETTES.get(name, GRAY_SCOTT_PALETTES['cyan_amber'])
        steps = len(stops) - 1
        lut = []
        for i in range(256):
            pos = i / 255 * steps
            j = min(int(pos), steps - 1)
            t = pos - j
            c0, c1 = stops[j], stops[j + 1]
            lut.append((
                round(c0[0] + (c1[0] - c0[0]) * t),
                round(c0[1] + (c1[1] - c0[1]) * t),
                round(c0[2] + (c1[2] - c0[2]) * t),
            ))
        return lut

    def _seed_spots(self):
        rand = self.random
        for _ in range(4):
            cx = rand.randrange(self.gw)
            cy = rand.randrange(self.gh)
            for dy in range(-3, 4):
                for dx in range(-3, 4):
                    x = (cx + dx) % self.gw
                    y = (cy + dy) % self.gh
                    idx = y * self.gw + x
                    self.b[idx] = 1.0
                    self.a[idx] = 0.0

    def frame(self) -> Image.Image:
        self._step()
        img = self._render()
        if self.grid_scale != 1:
            img = img.resize((self.width, self.height), Image.BILINEAR)
        return img

    def _step(self):
        a, b = self.a, self.b
        na, nb = self.next_a, self.next_b
        neighbors = self.neighbors
        feed, kill, da, db = self.feed, self.kill, self.da, self.db
        for i in range(self.size):
            ai = a[i]
            bi = b[i]
            n0, n1, n2, n3, n4, n5, n6, n7 = neighbors[i]
            lap_a = (
                -ai
                + 0.2 * (a[n1] + a[n3] + a[n4] + a[n6])
                + 0.05 * (a[n0] + a[n2] + a[n5] + a[n7])
            )
            lap_b = (
                -bi
                + 0.2 * (b[n1] + b[n3] + b[n4] + b[n6])
                + 0.05 * (b[n0] + b[n2] + b[n5] + b[n7])
            )
            reaction = ai * bi * bi
            new_a = ai + da * lap_a - reaction + feed * (1.0 - ai)
            new_b = bi + db * lap_b + reaction - (kill + feed) * bi
            na[i] = 0.0 if new_a < 0.0 else (1.0 if new_a > 1.0 else new_a)
            nb[i] = 0.0 if new_b < 0.0 else (1.0 if new_b > 1.0 else new_b)
        self.a, self.next_a = self.next_a, self.a
        self.b, self.next_b = self.next_b, self.b

    def _render(self) -> Image.Image:
        rgb = bytearray(self.size * 3)
        lut = self.lut
        scale = self.value_scale
        j = 0
        for val in self.b:
            g = int(val * scale)
            g = 0 if g < 0 else (255 if g > 255 else g)
            color = lut[g]
            rgb[j] = color[0]
            rgb[j + 1] = color[1]
            rgb[j + 2] = color[2]
            j += 3
        return Image.frombytes('RGB', (self.gw, self.gh), bytes(rgb))
