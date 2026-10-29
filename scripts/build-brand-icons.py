"""Create Windows icon sizes from the approved 512 px convergence mark.

Development only: requires Pillow. The resulting ICO is committed and packaging
does not depend on Python or an image service.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'public' / 'brand'
SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

with Image.open(BRAND / 'icon-512.png') as source:
    assert source.size == (512, 512), 'Use the approved 512 px design export.'
    source.convert('RGBA').save(BRAND / 'app.ico', format='ICO', sizes=[(s, s) for s in SIZES])

with Image.open(BRAND / 'app.ico') as result:
    assert result.ico.sizes() == {(s, s) for s in SIZES}
    for size in SIZES:
        frame = result.ico.getimage((size, size)).convert('RGBA')
        assert frame.getextrema()[3][0] == 0, 'Transparent corners must remain transparent.'
        assert frame.getextrema()[3][1] == 255, 'The mark must not be empty.'
print('Windows ICO sizes verified: ' + ', '.join(map(str, SIZES)))
