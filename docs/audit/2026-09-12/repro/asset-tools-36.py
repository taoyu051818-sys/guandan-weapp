"""Audit-only isolated checks. Product scripts are read, never called with product outputs."""
from __future__ import annotations
import ast
import contextlib
import hashlib
import io
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import wave
from unittest.mock import patch
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
COCOS = ROOT / "work/guandan-cocos"
def digest(data):
    return hashlib.sha256(data).hexdigest()
def module(relative):
    path = COCOS / relative
    ns = {"__file__": str(path), "__name__": "audit_only_no_entrypoint"}
    exec(compile(path.read_text(), str(path), "exec"), ns)
    return ns

# Existing modules are guarded by __main__; no save/build entrypoints are invoked.
timer = module("scripts/extract-timer-frame.py")
bomb = module("scripts/generate-bomb-vfx-assets.py")
docpath = COCOS / "scripts/generate-gameplay-audio-effects-docx.py"
doctree = ast.parse(docpath.read_text())
compile(doctree, str(docpath), "exec")
assert any(isinstance(n, ast.If) and "__main__" in ast.unparse(n.test) for n in doctree.body)
pictures = sorted({n.value for n in ast.walk(doctree) if isinstance(n, ast.Constant)
                   and isinstance(n.value, str) and n.value.endswith(".png")})
assert len(pictures) == 8
assert all((COCOS / "docs/assets/game-flow" / name).is_file() for name in pictures)
# Deliberately do not build the historical Word document, so no product docx is replaced.
doc = {"syntax": True, "existingPictureInputs": len(pictures), "buildInvoked": False,
       "hardcodedHistoricalDate": "2026-08-04"}

# Exterior fill must not erase white details enclosed inside a colored object.
rgb = np.full((9, 9, 3), 220, dtype=np.uint8)
rgb[2:7, 2:7] = [120, 80, 10]
rgb[3:6, 3:6] = 255
outside = timer["exterior_background"](rgb)
assert np.count_nonzero(outside) == 56
assert not outside[4, 4]
solid = np.full((5, 5, 3), [200, 210, 200], dtype=np.uint8)
assert not timer["exterior_background"](solid).any()
assert timer["exterior_background"](np.full((5, 5, 3), 200, dtype=np.uint8)).all()
synthetic = np.zeros((9, 9, 4), dtype=np.uint8)
synthetic[2:7, 2:7] = [240, 0, 0, 255]
resized = timer["resize_premultiplied"](Image.fromarray(synthetic), (27, 27))
pixels = np.asarray(resized)
assert pixels.shape == (27, 27, 4)
assert (pixels[:, :, 3] == 0).any() and (pixels[:, :, 3] == 255).any()
assert (pixels[:, :, 3] > 0).any()
assert not pixels[:, :, 1:3].any()
# Eight-bit premultiplication amplifies rounding at nearly transparent pixels.
# Check color retention where alpha >= 64; fully transparent pixels need no color bound.
assert (pixels[:, :, 0][pixels[:, :, 3] >= 64] >= 230).all()

# Replace only the final Pillow save boundary; original extraction executes on synthetic input.
captured = []
save_original = Image.Image.save
def capture_save(image, target, *args, **kwargs):
    buffer = io.BytesIO()
    save_original(image, buffer, format="PNG", **kwargs)
    captured.append({"image": image.copy(), "data": buffer.getvalue(), "target": str(target)})
with tempfile.TemporaryDirectory(prefix="audit-assets36-") as td:
    scratch = Path(td)
    source = scratch / "synthetic-timer.png"
    Image.fromarray(rgb).save(source)
    target = scratch / "output" / "timer.png"
    with patch.object(Image.Image, "save", capture_save), contextlib.redirect_stdout(io.StringIO()):
        timer["extract"](source, target, 64)
    assert not target.exists() and captured[-1]["image"].size == (64, 64)
    blank = scratch / "blank.png"
    Image.new("RGB", (9, 9), (220, 220, 220)).save(blank)
    try:
        timer["extract"](blank, scratch / "blank-output.png", 64)
        raise AssertionError("blank source unexpectedly accepted")
    except RuntimeError as error:
        assert "No foreground" in str(error)
    assert not (scratch / "blank-output.png").exists()
timer_result = {"borderPixelsRemoved": 56, "enclosedWhitePreserved": True,
                "premultipliedNoGreenBlueBleed": True, "syntheticExtract": "64x64",
                "blankRejected": True, "productImagesWritten": 0}

# Bleeding may only change RGB, never alpha or pixels outside the specified distance.
bleed_input = Image.new("RGBA", (9, 9))
bleed_input.putpixel((4, 4), (240, 70, 10, 255))
bled = bomb["transparent_rgb_bleed"](bleed_input, distance=2)
assert bled.getchannel("A").tobytes() == bleed_input.getchannel("A").tobytes()
assert bled.getpixel((2, 2)) == (240, 70, 10, 0)
assert bled.getpixel((1, 1)) == (0, 0, 0, 0)
assert bleed_input.getpixel((2, 2)) == (0, 0, 0, 0)

class MemoryFile:
    def __init__(self, name): self.name = name; self.data = None
    def read_bytes(self): assert self.data is not None; return self.data
class MemoryDirectory:
    def __init__(self): self.files = {}
    def __truediv__(self, name):
        return self.files.setdefault(name, MemoryFile(name))
memory_output = MemoryDirectory()
def bomb_save(image, target, *args, **kwargs):
    assert isinstance(target, MemoryFile)
    output = io.BytesIO()
    save_original(image, output, *args, **kwargs)
    target.data = output.getvalue()

assets = []
for name, (size, generator, transparent) in bomb["ASSETS"].items():
    first, second = generator(), generator()
    assert first.mode == "RGBA" and first.size == size
    assert first.tobytes() == second.tobytes()
    with patch.object(Image.Image, "save", bomb_save), contextlib.redirect_stdout(io.StringIO()):
        sha = bomb["save_asset"](name, first, memory_output, transparent)
    rendered = memory_output.files[name].data
    existing = COCOS / "assets/game-assets/effects/bomb-v1" / name
    with Image.open(existing) as bundled:
        bundled_rgba = bundled.convert("RGBA")
        memory_rgba = Image.open(io.BytesIO(rendered)).convert("RGBA")
        pixel_match = bundled_rgba.size == memory_rgba.size and bundled_rgba.tobytes() == memory_rgba.tobytes()
    assets.append({"name": name, "size": size, "deterministicPixels": True,
                   "generatedSha256": sha, "existingSha256": digest(existing.read_bytes()),
                   "byteMatch": rendered == existing.read_bytes(), "pixelMatch": pixel_match})
# Source/runtime equality is recorded, not assumed from deterministic generation alone.
bomb_result = {"assets": assets, "bleedAlphaUnchanged": True, "productImagesWritten": 0}

# Check the existing cutout metadata without running its destructive top-level save.
cutout_path = COCOS / "art-source/ui/tournament-cutout.py"
compile(ast.parse(cutout_path.read_text()), str(cutout_path), "exec")
with Image.open(COCOS / "assets/game-assets/ui/lobby/entry-tournament-cutout-v4.png") as existing:
    assert existing.size == (512, 512) and existing.mode == "RGBA"
    assert existing.getchannel("A").getextrema() == (0, 255)
    cutout = {"size": existing.size, "mode": existing.mode, "alpha": [0, 255],
              "scriptExecuted": False}

# Audio CLI gets only new synthetic WAVs. No original voice or profile data is changed.
audio_script = COCOS / "scripts/prepare-steel-plate-voice.py"
audio_cases = []
env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
def make_wav(path, channels=1, silent=False):
    rate = 24000
    samples = np.zeros(rate, dtype="<i2")
    if not silent:
        for i in range(6000, 18000):
            samples[i] = round(6000 * math.sin(2 * math.pi * 440 * i / rate))
    with wave.open(str(path), "wb") as stream:
        stream.setparams((channels, 2, rate, 0, "NONE", "not compressed"))
        stream.writeframes(np.repeat(samples, channels).astype("<i2").tobytes())
with tempfile.TemporaryDirectory(prefix="audit-audio36-") as td:
    scratch = Path(td)
    source, output = scratch / "input.wav", scratch / "out.wav"
    make_wav(source)
    source_hash = digest(source.read_bytes())
    result = subprocess.run([sys.executable, str(audio_script), str(source), str(output)],
                            capture_output=True, text=True, env=env, timeout=20)
    assert result.returncode == 0, result.stderr
    with wave.open(str(output), "rb") as stream:
        assert stream.getparams()[:3] == (1, 2, 24000)
        pcm = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2")
        assert .25 < len(pcm)/24000 < 2.5
        assert pcm[0] == pcm[-1] == 0
        assert np.abs(pcm.astype(np.int32)).max() <= 32767 * 10**(-3/20) + 1
        audio_cases.append({"case": "syntheticSuccess", "duration": len(pcm)/24000,
                            "monoPcm16": True, "fadeEndpointsZero": True})
    output_hash = digest(output.read_bytes())
    retry = subprocess.run([sys.executable, str(audio_script), str(source), str(output)],
                           capture_output=True, text=True, env=env, timeout=20)
    assert retry.returncode != 0 and "Destination exists" in retry.stderr
    assert digest(output.read_bytes()) == output_hash and digest(source.read_bytes()) == source_hash
    audio_cases.append({"case": "existingDestinationRejected", "bothUnchanged": True})
    for name, kwargs, message in [
        ("silence", {"silent": True}, "Silent source"),
        ("stereo", {"channels": 2}, "AssertionError"),
    ]:
        src, dst = scratch / (name + ".wav"), scratch / (name + "-out.wav")
        make_wav(src, **kwargs)
        rejected = subprocess.run([sys.executable, str(audio_script), str(src), str(dst)],
                                  capture_output=True, text=True, env=env, timeout=20)
        assert rejected.returncode != 0 and message in rejected.stderr
        assert not dst.exists()
        audio_cases.append({"case": name + "Rejected", "noOutput": True})

print(json.dumps({"python": sys.version.split()[0], "pillow": Image.__version__,
                  "timer": timer_result, "bomb": bomb_result, "cutout": cutout,
                  "historicalDocument": doc, "audio": audio_cases,
                  "scope": "memory or owned temporary fixtures; no product write, TTS, network or build"}, indent=2))
