"""Audit-only render of the retained historical DOCX using the bundled renderer and LibreOffice.
All explicit conversion/profile/output paths stay inside docs/audit/2026-09-12.
No source DOCX changes, no artifact-authoring marker, no third-party links/macros.
"""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import importlib.util, os, tempfile, hashlib, json
ROOT = Path(__file__).resolve().parents[4]
AUDIT = ROOT / 'docs/audit/2026-09-12'
SOURCE = ROOT / 'work/guandan-cocos/docs/陵水掼蛋牌局音效与动效说明.docx'
OUT = AUDIT / 'evidence/docx-40'
PACKAGE = Path('/Users/mac/.codex/plugins/cache/openai-primary-runtime/documents/26.909.12148/skills/documents')
RUNTIME = Path('/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies')
before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
with ZipFile(SOURCE) as z:
    assert z.testzip() is None
    for name in z.namelist():
        assert 'vba' not in name.lower() and 'embeddings/' not in name
        if name.endswith('.rels'):
            assert not any(r.get('TargetMode') == 'External' for r in etree.fromstring(z.read(name)))
OUT.mkdir(parents=True,exist_ok=True)
os.environ['FONTCONFIG_FILE'] = str(AUDIT/'repro/docx-fontconfig-40.xml')
spec = importlib.util.spec_from_file_location('audit_bundled_docx_renderer',PACKAGE/'render_docx.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
# The packaged renderer normally redirects macOS scratch files to /private/tmp.
# Override that environment-only helper to honor this audit's narrower write scope.
render._default_macos_tmpdir_for_soffice = lambda: None
with tempfile.TemporaryDirectory(prefix='scratch-', dir=OUT) as temp:
    tempfile.tempdir = temp
    os.environ['TMPDIR'] = temp
    os.environ['TEMP'] = temp
    os.environ['TMP'] = temp
    original_env = render._build_lo_env
    def scoped_env(profile):
        assert Path(profile).is_relative_to(OUT)
        env = original_env(profile)
        for key in ('XDG_CONFIG_HOME','XDG_CACHE_HOME'):
            assert Path(env[key]).is_relative_to(OUT), key
        return env
    render._build_lo_env = scoped_env
    assert Path(render._resolve_soffice()) == RUNTIME/'bin/override/soffice'
    pages = render.rasterize(str(SOURCE),str(OUT),144,True,False)
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest() == before
print(json.dumps({'sourceUnchanged':True,'sha256':before,'pages':pages,'renderer':'bundled render_docx.py','scratchScope':str(OUT)},ensure_ascii=False,indent=2))
