"""Prepare a decoded mono PCM16 TTS recording; no network or game dependencies.

Source: edge-tts 7.2.8, zh-CN-XiaoxiaoNeural, text 钢板！, rate +8%.
Decode MP3 with afconvert/ffmpeg before running this script.
Usage: python3 scripts/prepare-steel-plate-voice.py input.wav output.wav
"""
import argparse
import array
import math
import sys
import wave
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
args = parser.parse_args()
if args.destination.exists():
    raise SystemExit('Destination exists; use a new path to preserve the current clip.')
with wave.open(str(args.source), 'rb') as source:
    assert source.getnchannels() == 1 and source.getsampwidth() == 2
    rate = source.getframerate()
    samples = array.array('h', source.readframes(source.getnframes()))
if sys.byteorder != 'little':
    samples.byteswap()
window = max(1, round(rate * .01))
active = [i for i in range(0, len(samples), window)
          if math.sqrt(sum(s*s for s in samples[i:i+window])/len(samples[i:i+window])) > 100]
if not active:
    raise SystemExit('Silent source; refusing to create a runtime clip.')
# Keep consonant attacks and the final syllable; trim only outer silence.
start = max(0, active[0] - round(rate * .035))
end = min(len(samples), active[-1] + window + round(rate * .08))
samples = samples[start:end]
peak = max(abs(s) for s in samples)
gain = min(2, (32767 * 10 ** (-3 / 20)) / peak)
fade = max(1, round(rate * .006))
for i, value in enumerate(samples):
    envelope = min(1, i / fade, (len(samples) - 1 - i) / fade)
    samples[i] = round(value * gain * envelope)
assert .25 < len(samples)/rate < 2.5
assert max(abs(s) for s in samples) < 32767
args.destination.parent.mkdir(parents=True, exist_ok=True)
if sys.byteorder != 'little':
    samples.byteswap()
with wave.open(str(args.destination), 'wb') as target:
    target.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    target.writeframes(samples.tobytes())
print(f'{args.destination}: {len(samples)/rate:.3f}s, {rate}Hz, mono PCM16, peak <= -3dBFS')
