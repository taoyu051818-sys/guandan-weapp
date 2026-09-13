"""Read-only media decoding and existing-build payload comparison; does not edit/re-encode files."""
import io, json, hashlib, pathlib, struct, subprocess, wave, tarfile, plistlib
from collections import Counter
import numpy as np
from PIL import Image
ROOT = pathlib.Path(__file__).resolve().parents[4]
BASE = ROOT / "work/guandan-cocos"
manifest = json.loads((ROOT / "docs/audit/2026-09-12/manifest.json").read_text())
rows = [f for f in manifest["files"] if f["category"] in ("resource-boundary", "third-party-boundary")]
images = [f for f in rows if pathlib.Path(f["path"]).suffix.lower() in (".png", ".jpg", ".webp", ".ico", ".icns")]
formats = Counter()
extension_mismatches = []
for row in images:
    blob = (ROOT / row["path"]).read_bytes()
    with Image.open(io.BytesIO(blob)) as img:
        img.verify()
    with Image.open(io.BytesIO(blob)) as img:
        img.load()
        assert img.width > 0 and img.height > 0, row["path"]
        formats[img.format] += 1
        expected = {'.png':'PNG', '.jpg':'JPEG', '.webp':'WEBP', '.ico':'ICO', '.icns':'ICNS'}[pathlib.Path(row['path']).suffix.lower()]
        if img.format != expected:
            extension_mismatches.append({'path':row['path'], 'detected':img.format})
            assert '/docs/assets/game-flow/' in row['path'], row['path']
vendor_containers = []
for row in rows:
    p = ROOT / row['path']
    if p.suffix == '.unitypackage':
        with tarfile.open(fileobj=io.BytesIO(p.read_bytes()),mode='r:gz') as archive:
            members = archive.getmembers()
            for member in members:
                n = pathlib.PurePosixPath(member.name)
                assert not n.is_absolute() and '..' not in n.parts, member.name
                assert member.isfile() or member.isdir(), member.name
            vendor_containers.append({'path':row['path'], 'entries':len(members), 'uncompressedBytes':sum(x.size for x in members), 'extracted':False})
    if p.suffix == '.plist':
        plistlib.loads(p.read_bytes())
audio = [f for f in rows if pathlib.Path(f["path"]).suffix.lower() in (".wav", ".mp3", ".ogg")]
wav_formats = []
for row in audio:
    p = ROOT / row["path"]
    if p.suffix == ".wav":
        with wave.open(str(p)) as w:
            payload = w.readframes(w.getnframes())
            assert len(payload) == w.getnframes() * w.getsampwidth() * w.getnchannels(), row["path"]
            wav_formats.append({"path": row["path"], "rate": w.getframerate(), "channels": w.getnchannels(), "bits": w.getsampwidth()*8, "frames": w.getnframes()})
audio_check = subprocess.run(["/usr/bin/afinfo", "-b", *[str(ROOT/f["path"]) for f in audio if not f["path"].endswith(".ogg")]], capture_output=True, text=True, timeout=45, check=True)
assert "Error" not in audio_check.stdout + audio_check.stderr, audio_check.stderr
# macOS AudioFile APIs do not promise OGG support; inspect Ogg container pages without claiming audible decoding.
ogg_pages = 0
for row in audio:
    if not row["path"].endswith(".ogg"):
        continue
    blob = (ROOT / row["path"]).read_bytes()
    cursor = 0
    while cursor < len(blob):
        assert blob[cursor:cursor+4] == b"OggS", row["path"]
        assert blob[cursor+4] == 0
        n = blob[cursor+26]
        size = sum(blob[cursor+27:cursor+27+n])
        cursor += 27 + n + size
        assert cursor <= len(blob)
        ogg_pages += 1
    assert cursor == len(blob)
bundle = BASE / "assets/game-assets"
source_images = [f for f in images if f["path"].startswith("work/guandan-cocos/assets/game-assets/")]
build_results = []
for platform in ("wechatgame", "web-desktop"):
    folder = BASE / "build" / platform / ("subpackages/game-assets" if platform == "wechatgame" else "assets/game-assets")
    same = 0
    transparent_only = []
    visible_differences = []
    for row in source_images:
        source = ROOT / row["path"]
        uid = json.loads(pathlib.Path(str(source)+".meta").read_text())["uuid"]
        native = folder / "native" / uid[:2] / (uid + source.suffix)
        assert native.exists(), str(native)
        with Image.open(source) as s, Image.open(native) as n:
            s.load(); n.load()
            assert s.size == n.size, row["path"]
            a = np.asarray(s.convert("RGBA"))
            b = np.asarray(n.convert("RGBA"))
            if np.array_equal(a,b):
                same += 1
                continue
            color_changed = np.any(a[:,:,:3] != b[:,:,:3],axis=2)
            alpha_changed = a[:,:,3] != b[:,:,3]
            visible_changed = color_changed & ((a[:,:,3] > 0) | (b[:,:,3] > 0))
            entry = {"path":row["path"],"changedRgbPixels":int(color_changed.sum()),"changedAlphaPixels":int(alpha_changed.sum()),"changedVisibleRgbPixels":int(visible_changed.sum())}
            if not alpha_changed.any() and not visible_changed.any():
                transparent_only.append(entry)
            else:
                visible_differences.append(entry)
    assert not visible_differences, visible_differences
    license_copies = []
    for source in bundle.rglob("*.txt"):
        uid = json.loads(pathlib.Path(str(source)+".meta").read_text())["uuid"]
        imported = folder / "import" / uid[:2] / (uid+".json")
        data = json.loads(imported.read_text())
        # Cocos serialized TextAsset content must remain exact, including license notices.
        def contains(value, target):
            if isinstance(value, str): return value == target
            if isinstance(value, list): return any(contains(v,target) for v in value)
            if isinstance(value, dict): return any(contains(v,target) for v in value.values())
            return False
        assert contains(data,source.read_bytes().decode("utf8")), str(source)
        license_copies.append(str(source.relative_to(ROOT)))
    build_results.append({"platform":platform,"imageCount":len(source_images),"pixelExact":same,"transparentRgbOnly":transparent_only,"visibleDifferences":visible_differences,"verbatimLicenseTextAssets":license_copies})
print(json.dumps({"pass":True,"decodedImages":len(images),"formats":dict(formats),"historicalScreenshotExtensionMismatches":extension_mismatches,"vendorContainers":vendor_containers,"audioFileInfoAccepted":len([r for r in audio if not r['path'].endswith('.ogg')]),"wavPayloads":wav_formats,"archivedOggPages":ogg_pages,"builds":build_results,"limits":["Image decoding is not visual quality review; afinfo/WAV/OGG checks do not listen to speech or verify WeChat playback.","Current compiled resource payloads are compared, not current application-code freshness."]},ensure_ascii=False,indent=2))
