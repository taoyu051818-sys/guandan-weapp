#!/usr/bin/env python3
"""Extract the supplied chicken timer from its baked checkerboard background."""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image


def exterior_background(rgb: np.ndarray) -> np.ndarray:
    maximum = rgb.max(axis=2).astype(np.int16)
    minimum = rgb.min(axis=2).astype(np.int16)
    candidate = (maximum - minimum <= 8) & (minimum >= 190)
    height, width = candidate.shape
    outside = np.zeros((height, width), dtype=bool)
    queue: deque[tuple[int, int]] = deque()

    def enqueue(y: int, x: int) -> None:
        if candidate[y, x] and not outside[y, x]:
            outside[y, x] = True
            queue.append((y, x))

    for x in range(width):
        enqueue(0, x)
        enqueue(height - 1, x)
    for y in range(height):
        enqueue(y, 0)
        enqueue(y, width - 1)

    while queue:
        y, x = queue.popleft()
        if y > 0:
            enqueue(y - 1, x)
        if y + 1 < height:
            enqueue(y + 1, x)
        if x > 0:
            enqueue(y, x - 1)
        if x + 1 < width:
            enqueue(y, x + 1)
    return outside


def resize_premultiplied(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgba = np.asarray(image, dtype=np.float32)
    alpha = rgba[:, :, 3] / 255.0
    resized_alpha = np.asarray(
        Image.fromarray((alpha * 255).astype(np.uint8), "L").resize(size, Image.Resampling.LANCZOS),
        dtype=np.float32,
    ) / 255.0
    channels = []
    for index in range(3):
        premultiplied = rgba[:, :, index] * alpha
        resized = np.asarray(
            Image.fromarray(premultiplied.astype(np.uint8), "L").resize(size, Image.Resampling.LANCZOS),
            dtype=np.float32,
        )
        channels.append(np.divide(resized, resized_alpha, out=np.zeros_like(resized), where=resized_alpha > 0.001))
    result = np.dstack((*channels, resized_alpha * 255))
    return Image.fromarray(np.clip(result, 0, 255).astype(np.uint8), "RGBA")


def extract(source: Path, destination: Path, output_size: int) -> None:
    rgb = np.asarray(Image.open(source).convert("RGB"), dtype=np.uint8)
    outside = exterior_background(rgb)
    alpha = np.where(outside, 0, 255).astype(np.uint8)
    ys, xs = np.nonzero(alpha)
    if not len(xs):
        raise RuntimeError("No foreground was found in the timer source image.")

    padding = max(20, round(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.035))
    left = max(0, int(xs.min()) - padding)
    right = min(rgb.shape[1], int(xs.max()) + padding + 1)
    top = max(0, int(ys.min()) - padding)
    bottom = min(rgb.shape[0], int(ys.max()) + padding + 1)
    cropped = Image.fromarray(np.dstack((rgb, alpha)), "RGBA").crop((left, top, right, bottom))

    side = max(cropped.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    result = resize_premultiplied(square, (output_size, output_size))
    destination.parent.mkdir(parents=True, exist_ok=True)
    result.save(destination, optimize=True)
    result_alpha = np.asarray(result.getchannel("A"))
    print(
        f"wrote {destination} ({output_size}x{output_size}, "
        f"transparent={np.count_nonzero(result_alpha == 0)}, "
        f"partial={np.count_nonzero((result_alpha > 0) & (result_alpha < 255))})"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--size", type=int, default=512)
    args = parser.parse_args()
    extract(args.source, args.destination, args.size)


if __name__ == "__main__":
    main()
