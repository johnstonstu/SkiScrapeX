# Crop each follow-cam frame around the rider (red jacket) so the legs are readable.
from PIL import Image
import numpy as np, glob, os, sys
for d in sorted(glob.glob('sb_*/')):
    os.makedirs(d + 'zoom', exist_ok=True)
    for f in sorted(glob.glob(d + 'f*.jpg')):
        im = Image.open(f); a = np.asarray(im).astype(int)
        m = (a[:, :, 0] > 150) & (a[:, :, 1] < 80)
        ys, xs = np.nonzero(m)
        if len(xs) < 20: continue
        cx, cy = int(np.median(xs)), int(np.median(ys))
        im.crop((cx - 100, cy - 95, cx + 100, cy + 115)).resize((400, 420)).save(d + 'zoom/' + os.path.basename(f))
    fr = sorted(glob.glob(d + 'zoom/f*.jpg'))
    notes = open(d + 'notes.txt').read().splitlines()
    sel = fr[::max(1, len(fr) // 8)][:8]
    o = Image.new('RGB', (400 * 4, 420 * 2), 'white')
    for k, f in enumerate(sel): o.paste(Image.open(f), ((k % 4) * 400, (k // 4) * 420))
    o.save(d + 'contact_zoom.jpg'); print(d, len(fr))
