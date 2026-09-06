from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src-tauri" / "icons" / "icon.png"
PWA_192 = ROOT / "public" / "kea3d-192.png"
PWA_512 = ROOT / "public" / "kea3d-512.png"


with Image.open(SOURCE) as image:
    rgba = image.convert("RGBA")
    rgba.resize((192, 192), Image.Resampling.LANCZOS).save(PWA_192)
    rgba.resize((512, 512), Image.Resampling.LANCZOS).save(PWA_512)
