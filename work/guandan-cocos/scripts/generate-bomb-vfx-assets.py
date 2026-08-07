#!/usr/bin/env python3
"""Generate the deterministic bomb-v1 runtime texture set."""

from __future__ import annotations

import argparse
import hashlib
import math
import random
from collections import deque
from pathlib import Path
from typing import Iterable, Sequence

from PIL import Image, ImageDraw, ImageFilter


SEED = 0x20260806
SUPERSAMPLE = 4
SCRIPT_PATH = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT_PATH.parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "assets/game-assets/effects/bomb-v1"

RGBA = tuple[int, int, int, int]
Point = tuple[float, float]


def clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return float(value >= edge1)
    t = clamp((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def mix(left: float, right: float, amount: float) -> float:
    return left + (right - left) * amount


def mix_rgba(left: RGBA, right: RGBA, amount: float) -> RGBA:
    return tuple(round(mix(left[index], right[index], amount)) for index in range(4))  # type: ignore[return-value]


def sample_stops(stops: Sequence[tuple[float, RGBA]], position: float) -> RGBA:
    position = clamp(position)
    for index in range(1, len(stops)):
        left_position, left_color = stops[index - 1]
        right_position, right_color = stops[index]
        if position <= right_position:
            span = max(1e-9, right_position - left_position)
            return mix_rgba(left_color, right_color, (position - left_position) / span)
    return stops[-1][1]


def asset_rng(name: str) -> random.Random:
    digest = hashlib.sha256(f"{SEED}:{name}".encode("ascii")).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def scaled_points(points: Iterable[Point], scale: int = SUPERSAMPLE) -> list[tuple[int, int]]:
    return [(round(x * scale), round(y * scale)) for x, y in points]


def high_res_layer(size: tuple[int, int]) -> Image.Image:
    return Image.new("RGBA", (size[0] * SUPERSAMPLE, size[1] * SUPERSAMPLE), (0, 0, 0, 0))


def downsample(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    return image.resize(size, Image.Resampling.LANCZOS)


def cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, steps: int = 36) -> list[Point]:
    points: list[Point] = []
    for index in range(steps + 1):
        t = index / steps
        inverse = 1.0 - t
        x = inverse**3 * p0[0] + 3 * inverse**2 * t * p1[0] + 3 * inverse * t**2 * p2[0] + t**3 * p3[0]
        y = inverse**3 * p0[1] + 3 * inverse**2 * t * p1[1] + 3 * inverse * t**2 * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


def radial_layer(
    size: tuple[int, int],
    center: Point,
    radii: Point,
    stops: Sequence[tuple[float, RGBA]],
    wobble: tuple[float, int, float] | None = None,
) -> Image.Image:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    pixels = image.load()
    for y in range(size[1]):
        for x in range(size[0]):
            dx = (x + 0.5 - center[0]) / radii[0]
            dy = (y + 0.5 - center[1]) / radii[1]
            radius = math.hypot(dx, dy)
            if wobble is not None and radius > 0:
                amplitude, lobes, phase = wobble
                angle = math.atan2(dy, dx)
                radius /= 1.0 + amplitude * math.sin(angle * lobes + phase)
            if radius <= 1.0:
                pixels[x, y] = sample_stops(stops, radius)
    return image


def transparent_rgb_bleed(image: Image.Image, distance: int = 5, alpha_threshold: int = 8) -> Image.Image:
    """Bleed stable edge colors beneath transparent pixels without changing alpha."""
    result = image.convert("RGBA")
    width, height = result.size
    pixels = list(result.get_flattened_data())
    covered = [pixel[3] >= alpha_threshold and any(pixel[:3]) for pixel in pixels]
    queue: deque[tuple[int, int]] = deque((index, 0) for index, value in enumerate(covered) if value)
    neighbors = (-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1)

    while queue:
        index, depth = queue.popleft()
        if depth >= distance:
            continue
        x = index % width
        y = index // width
        for offset in neighbors:
            target = index + offset
            if target < 0 or target >= len(pixels) or covered[target] or pixels[target][3] >= alpha_threshold:
                continue
            target_x = target % width
            target_y = target // width
            if abs(target_x - x) > 1 or abs(target_y - y) > 1:
                continue
            red, green, blue, _ = pixels[index]
            pixels[target] = (red, green, blue, pixels[target][3])
            covered[target] = True
            queue.append((target, depth + 1))

    result.putdata(pixels)
    return result


def make_bomb_body() -> Image.Image:
    size = (256, 256)
    center = (117.0, 143.0)
    radius = 79.0

    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    shadow = radial_layer(
        size,
        (119.0, 174.0),
        (101.0, 72.0),
        ((0.0, (0, 0, 0, 118)), (0.55, (0, 0, 0, 56)), (1.0, (0, 0, 0, 0))),
    ).filter(ImageFilter.GaussianBlur(6.0))
    canvas = Image.alpha_composite(canvas, shadow)

    sphere = Image.new("RGBA", size, (0, 0, 0, 0))
    pixels = sphere.load()
    light = (-0.58, -0.66, 0.47)
    light_length = math.sqrt(sum(component * component for component in light))
    light = tuple(component / light_length for component in light)
    for y in range(size[1]):
        for x in range(size[0]):
            nx = (x + 0.5 - center[0]) / radius
            ny = (y + 0.5 - center[1]) / radius
            distance_squared = nx * nx + ny * ny
            if distance_squared >= 1.035:
                continue
            edge_alpha = clamp((1.035 - distance_squared) * radius * 0.9)
            if distance_squared >= 1.0:
                pixels[x, y] = (13, 16, 20, round(255 * edge_alpha))
                continue
            nz = math.sqrt(1.0 - distance_squared)
            diffuse = max(0.0, nx * light[0] + ny * light[1] + nz * light[2])
            rim = (1.0 - nz) ** 1.7
            highlight = math.exp(-(((nx + 0.39) / 0.24) ** 2 + ((ny + 0.43) / 0.31) ** 2) * 2.0)
            red = 19 + 28 * diffuse + 58 * highlight + 12 * rim
            green = 24 + 30 * diffuse + 61 * highlight + 9 * rim
            blue = 30 + 35 * diffuse + 64 * highlight + 6 * rim
            pixels[x, y] = (round(red), round(green), round(blue), 255)
    canvas = Image.alpha_composite(canvas, sphere)

    rng = asset_rng("bomb-body")
    texture = Image.new("RGBA", size, (0, 0, 0, 0))
    texture_draw = ImageDraw.Draw(texture)
    for _ in range(48):
        angle = rng.random() * math.tau
        radial = radius * math.sqrt(rng.random()) * 0.78
        x = center[0] + math.cos(angle) * radial
        y = center[1] + math.sin(angle) * radial
        dot_radius = rng.uniform(0.45, 1.25)
        alpha = rng.randint(7, 20)
        tone = rng.choice(((255, 255, 255, alpha), (3, 5, 7, alpha + 5), (92, 105, 110, alpha)))
        texture_draw.ellipse((x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius), fill=tone)
    texture = texture.filter(ImageFilter.GaussianBlur(0.45))
    canvas = Image.alpha_composite(canvas, texture)

    details = high_res_layer(size)
    draw = ImageDraw.Draw(details)
    scale = SUPERSAMPLE
    draw.ellipse((36 * scale, 62 * scale, 198 * scale, 224 * scale), outline=(4, 7, 10, 220), width=3 * scale)
    draw.arc((49 * scale, 74 * scale, 185 * scale, 210 * scale), 132, 292, fill=(93, 106, 113, 92), width=2 * scale)

    # Brass fuse collar.
    collar = scaled_points(((153, 85), (168, 68), (184, 83), (169, 101)))
    draw.polygon(collar, fill=(93, 54, 19, 255))
    inner_collar = scaled_points(((157, 84), (168, 73), (179, 83), (168, 95)))
    draw.polygon(inner_collar, fill=(238, 163, 55, 255))
    draw.line(scaled_points(((158, 81), (169, 72), (179, 81))), fill=(255, 229, 144, 230), width=2 * scale)

    # Small poker-diamond badge keeps the prop tied to the card-table theme.
    draw.ellipse((82 * scale, 111 * scale, 151 * scale, 180 * scale), fill=(7, 10, 14, 105), outline=(182, 133, 54, 215), width=2 * scale)
    badge = scaled_points(((116.5, 124), (132, 145.5), (116.5, 168), (101, 145.5)))
    draw.polygon(badge, fill=(156, 35, 29, 230))
    draw.line(badge + [badge[0]], fill=(255, 166, 72, 245), width=2 * scale, joint="curve")
    details = downsample(details, size)
    canvas = Image.alpha_composite(canvas, details)

    fuse = high_res_layer(size)
    fuse_draw = ImageDraw.Draw(fuse)
    fuse_points = cubic_bezier((171, 79), (183, 54), (196, 57), (216, 31))
    scaled_fuse = scaled_points(fuse_points)
    fuse_draw.line(scaled_fuse, fill=(22, 14, 9, 255), width=9 * scale, joint="curve")
    fuse_draw.line(scaled_fuse, fill=(151, 93, 38, 255), width=5 * scale, joint="curve")
    fuse_draw.line(scaled_fuse, fill=(243, 175, 72, 210), width=2 * scale, joint="curve")
    fuse = downsample(fuse, size)
    canvas = Image.alpha_composite(canvas, fuse)

    ember = radial_layer(
        size,
        (217.0, 30.0),
        (26.0, 26.0),
        ((0.0, (255, 255, 228, 255)), (0.16, (255, 220, 105, 250)), (0.42, (255, 84, 18, 185)), (1.0, (206, 25, 4, 0))),
    )
    canvas = Image.alpha_composite(canvas, ember)
    ember_core = high_res_layer(size)
    ember_draw = ImageDraw.Draw(ember_core)
    ember_draw.ellipse((212 * scale, 25 * scale, 222 * scale, 35 * scale), fill=(255, 246, 188, 255))
    canvas = Image.alpha_composite(canvas, downsample(ember_core, size))
    return canvas


def make_hot_core() -> Image.Image:
    size = (256, 256)
    rng = asset_rng("hot-core")
    phase = rng.random() * math.tau
    core = radial_layer(
        size,
        (128.0, 128.0),
        (118.0, 111.0),
        (
            (0.0, (255, 255, 244, 255)),
            (0.13, (255, 249, 199, 255)),
            (0.34, (255, 190, 62, 246)),
            (0.60, (255, 82, 16, 202)),
            (0.82, (218, 29, 5, 90)),
            (1.0, (152, 13, 2, 0)),
        ),
        wobble=(0.055, 9, phase),
    )

    rays = high_res_layer(size)
    draw = ImageDraw.Draw(rays)
    cx = cy = 128 * SUPERSAMPLE
    for index in range(18):
        angle = index / 18 * math.tau + rng.uniform(-0.055, 0.055)
        half_width = rng.uniform(0.012, 0.032)
        length = rng.uniform(77, 126) * SUPERSAMPLE
        inner = rng.uniform(17, 31) * SUPERSAMPLE
        left = (cx + math.cos(angle - half_width) * inner, cy + math.sin(angle - half_width) * inner)
        tip = (cx + math.cos(angle) * length, cy + math.sin(angle) * length)
        right = (cx + math.cos(angle + half_width) * inner, cy + math.sin(angle + half_width) * inner)
        draw.polygon((left, tip, right), fill=(255, rng.randint(135, 220), 42, rng.randint(35, 95)))
    rays = downsample(rays.filter(ImageFilter.GaussianBlur(4.0 * SUPERSAMPLE)), size)
    result = Image.alpha_composite(rays, core)

    white = radial_layer(
        size,
        (124.0, 123.0),
        (43.0, 38.0),
        ((0.0, (255, 255, 255, 255)), (0.38, (255, 255, 227, 245)), (1.0, (255, 216, 109, 0))),
    )
    return Image.alpha_composite(result, white)


def make_trail_soft() -> Image.Image:
    size = (256, 64)
    rng = asset_rng("trail-soft")
    phase_a = rng.random() * math.tau
    phase_b = rng.random() * math.tau
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    pixels = image.load()
    for y in range(size[1]):
        for x in range(size[0]):
            t = x / (size[0] - 1)
            if t <= 0.01 or t >= 0.99:
                continue
            center = 31.5 + math.sin(t * math.tau * 2.2 + phase_a) * (1.8 * (1.0 - t))
            half_width = 2.0 + 18.5 * (t**0.82)
            normalized_y = abs(y + 0.5 - center) / half_width
            if normalized_y >= 1.15:
                continue
            cross = math.exp(-(normalized_y * 2.25) ** 2)
            turbulence = 0.86 + 0.10 * math.sin(t * 41.0 + phase_b) + 0.04 * math.sin(t * 97.0 + phase_a)
            envelope = smoothstep(0.01, 0.13, t) * (1.0 - smoothstep(0.91, 0.995, t))
            intensity = clamp((t**0.28) * cross * envelope * turbulence)
            if intensity <= 0.003:
                continue
            heat = clamp(t * 1.08 - normalized_y * 0.22)
            color = sample_stops(
                (
                    (0.0, (174, 24, 6, 0)),
                    (0.34, (255, 65, 10, 172)),
                    (0.67, (255, 169, 38, 226)),
                    (0.90, (255, 239, 159, 250)),
                    (1.0, (255, 255, 242, 255)),
                ),
                heat,
            )
            pixels[x, y] = (color[0], color[1], color[2], round(color[3] * intensity))

    glow = image.filter(ImageFilter.GaussianBlur(4.5))
    glow.putalpha(glow.getchannel("A").point(lambda value: min(130, round(value * 0.72))))
    result = Image.alpha_composite(glow, image)

    core_hi = high_res_layer(size)
    core_draw = ImageDraw.Draw(core_hi)
    core_points = ((159, 31.8), (201, 31.2), (244, 31.5))
    core_draw.line(scaled_points(core_points), fill=(255, 255, 236, 255), width=2 * SUPERSAMPLE, joint="curve")
    return Image.alpha_composite(result, downsample(core_hi, size))


def make_spark_streak() -> Image.Image:
    size = (128, 32)
    rng = asset_rng("spark-streak")
    center_y = 15.5 + rng.uniform(-0.7, 0.7)
    points = [(8.0, center_y + 1.2), (51.0, center_y - 0.8), (91.0, center_y + 0.4), (119.0, center_y)]

    glow_hi = high_res_layer(size)
    glow_draw = ImageDraw.Draw(glow_hi)
    glow_draw.line(scaled_points(points), fill=(255, 91, 14, 170), width=8 * SUPERSAMPLE, joint="curve")
    glow = downsample(glow_hi.filter(ImageFilter.GaussianBlur(3.0 * SUPERSAMPLE)), size)

    core_hi = high_res_layer(size)
    draw = ImageDraw.Draw(core_hi)
    draw.polygon(scaled_points(((5, center_y), (101, center_y - 3.2), (122, center_y), (101, center_y + 3.2))), fill=(255, 145, 29, 238))
    draw.line(scaled_points(points), fill=(255, 238, 145, 255), width=3 * SUPERSAMPLE, joint="curve")
    draw.line(scaled_points(((38, center_y), (118, center_y))), fill=(255, 255, 241, 255), width=1 * SUPERSAMPLE)
    draw.ellipse(((114 * SUPERSAMPLE), round((center_y - 4) * SUPERSAMPLE), (123 * SUPERSAMPLE), round((center_y + 4) * SUPERSAMPLE)), fill=(255, 255, 229, 255))
    core = downsample(core_hi, size)
    return Image.alpha_composite(glow, core)


def make_debris_shard() -> Image.Image:
    size = (64, 64)
    rng = asset_rng("debris-shard")
    points: list[Point] = []
    for index, base_radius in enumerate((25.0, 19.0, 27.0, 21.0, 24.0, 18.0)):
        angle = -math.pi / 2 + index / 6 * math.tau + rng.uniform(-0.16, 0.16)
        radius = base_radius + rng.uniform(-2.5, 2.5)
        points.append((32 + math.cos(angle) * radius, 32 + math.sin(angle) * radius))

    glow = radial_layer(
        size,
        (32.0, 32.0),
        (31.0, 31.0),
        ((0.0, (255, 94, 17, 90)), (0.62, (255, 49, 5, 42)), (1.0, (190, 14, 2, 0))),
    ).filter(ImageFilter.GaussianBlur(2.5))

    shard_hi = high_res_layer(size)
    draw = ImageDraw.Draw(shard_hi)
    polygon = scaled_points(points)
    draw.polygon(polygon, fill=(41, 24, 19, 255))
    draw.line(polygon + [polygon[0]], fill=(255, 103, 26, 245), width=3 * SUPERSAMPLE, joint="curve")
    inset = [(mix(x, 32.0, 0.33), mix(y, 32.0, 0.33)) for x, y in points]
    inset_polygon = scaled_points(inset)
    draw.polygon(inset_polygon, fill=(137, 43, 18, 250))
    draw.line(inset_polygon + [inset_polygon[0]], fill=(255, 190, 66, 230), width=1 * SUPERSAMPLE, joint="curve")
    draw.line(scaled_points((inset[0], (32, 32), inset[3])), fill=(79, 20, 11, 220), width=1 * SUPERSAMPLE)
    draw.line(scaled_points((inset[1], (32, 32), inset[4])), fill=(255, 124, 32, 180), width=1 * SUPERSAMPLE)
    shard = downsample(shard_hi, size)
    return Image.alpha_composite(glow, shard)


def make_noise_tile() -> Image.Image:
    size = (128, 128)
    rng = asset_rng("noise-tile")
    waves: list[tuple[int, int, float, float]] = []
    for _ in range(28):
        frequency_x = rng.randint(1, 13)
        frequency_y = rng.randint(1, 13)
        amplitude = rng.uniform(0.35, 1.0) / math.sqrt(frequency_x * frequency_x + frequency_y * frequency_y)
        waves.append((frequency_x, frequency_y, amplitude, rng.random() * math.tau))

    values: list[float] = []
    for y in range(size[1]):
        for x in range(size[0]):
            value = 0.0
            for frequency_x, frequency_y, amplitude, phase in waves:
                angle = math.tau * (frequency_x * x / size[0] + frequency_y * y / size[1]) + phase
                value += math.sin(angle) * amplitude
            values.append(value)

    minimum = min(values)
    maximum = max(values)
    span = max(1e-9, maximum - minimum)
    image = Image.new("RGBA", size, (0, 0, 0, 255))
    pixels = []
    for value in values:
        normalized = clamp((value - minimum) / span)
        normalized = smoothstep(0.04, 0.96, normalized)
        gray = round(22 + normalized * 218)
        pixels.append((gray, gray, gray, 255))
    image.putdata(pixels)
    return image


ASSETS = {
    "bomb-body.png": ((256, 256), make_bomb_body, True),
    "trail-soft.png": ((256, 64), make_trail_soft, True),
    "hot-core.png": ((256, 256), make_hot_core, True),
    "spark-streak.png": ((128, 32), make_spark_streak, True),
    "debris-shard.png": ((64, 64), make_debris_shard, True),
    "noise-tile.png": ((128, 128), make_noise_tile, False),
}


def save_asset(name: str, image: Image.Image, output_directory: Path, expects_transparency: bool) -> str:
    expected_size = ASSETS[name][0]
    if image.size != expected_size:
        raise ValueError(f"{name}: expected size {expected_size}, got {image.size}")
    image = image.convert("RGBA")
    if expects_transparency:
        image = transparent_rgb_bleed(image)
    alpha_minimum, alpha_maximum = image.getchannel("A").getextrema()
    if expects_transparency and (alpha_minimum != 0 or alpha_maximum != 255):
        raise ValueError(f"{name}: expected alpha range 0..255, got {alpha_minimum}..{alpha_maximum}")
    if not expects_transparency and (alpha_minimum != 255 or alpha_maximum != 255):
        raise ValueError(f"{name}: expected opaque alpha, got {alpha_minimum}..{alpha_maximum}")

    output_path = output_directory / name
    image.save(output_path, format="PNG", optimize=False, compress_level=9)
    digest = hashlib.sha256(output_path.read_bytes()).hexdigest()
    print(f"{name}\t{image.width}x{image.height}\talpha={alpha_minimum}..{alpha_maximum}\tsha256={digest}")
    return digest


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT, help="Directory for generated PNG files")
    return parser.parse_args()


def main() -> None:
    arguments = parse_arguments()
    output_directory = arguments.output_dir.resolve()
    output_directory.mkdir(parents=True, exist_ok=True)
    print(f"seed=0x{SEED:08X}")
    print(f"output={output_directory}")
    for name, (_, generator, expects_transparency) in ASSETS.items():
        save_asset(name, generator(), output_directory, expects_transparency)


if __name__ == "__main__":
    main()
