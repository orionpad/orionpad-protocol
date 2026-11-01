"""One-off asset step: reads brand/ + reference/ bytes, writes src/assets and tools/palette-report.json.
Run: python -I tools/make-assets.py   (needs Pillow, numpy, scikit-learn)"""
import json, struct, numpy as np
from PIL import Image, ImageDraw
from sklearn.cluster import KMeans

import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))).replace(chr(92), '/')
LOGO_T = ROOT + '/brand/LOGO ORIONPAD PNG...png'   # RGBA, transparent background
LOGO_O = ROOT + '/brand/LOGO ORIONPAD PNG.png'     # RGBA, fully opaque (alpha 255 everywhere)
BANNER = ROOT + '/reference/SAMPUL ORIONPAD JPG.jpg.jpeg'
SLIDE2 = ROOT + '/reference/ORIONPAD 2.jpg.jpeg'
OUT = ROOT + '/src/assets/brand'

report = {'files': {}, 'colors': {}}

def ihdr(p):
    b = open(p, 'rb').read()
    w, h, bd, ct = struct.unpack('>IIBB', b[16:26])
    return dict(width=w, height=h, bitDepth=bd, colorType=ct, bytes=len(b))

def kmeans(a, mask, k=8):
    px = a[mask][:, :3].astype(float)
    ys, xs = np.where(mask)
    idx = np.random.RandomState(0).choice(len(px), min(60000, len(px)), replace=False)
    km = KMeans(k, n_init=3, random_state=0).fit(px[idx])
    cnt = np.bincount(km.labels_)
    out = []
    for c, n in sorted(zip(km.cluster_centers_, cnt), key=lambda t: -t[1]):
        j = int(((px - c) ** 2).sum(1).argmin())
        r = px[j].astype(int)
        out.append(dict(center='#%02x%02x%02x' % tuple(int(v) for v in c), share=round(100 * n / len(idx), 2),
                        snapped='#%02x%02x%02x' % tuple(r), x=int(xs[j]), y=int(ys[j])))
    return out

for name, p in (('logoTransparent', LOGO_T), ('logoOpaque', LOGO_O)):
    im = Image.open(p).convert('RGBA'); a = np.array(im); al = a[..., 3]
    info = ihdr(p)
    info['alphaHistogram'] = dict(zip(['0', '1-31', '32-127', '128-254', '255'], [int(v) for v in np.histogram(al, bins=[0, 1, 32, 128, 255, 256])[0]]))
    tr = a[al == 0]
    info['transparentPixels'] = int(len(tr)); info['pureBlackTransparent'] = int((tr[:, :3].sum(1) == 0).sum())
    info['kmeans'] = kmeans(a, al > 200)
    report['files'][name] = info
for name, p in (('banner', BANNER), ('slide2', SLIDE2)):
    a = np.array(Image.open(p).convert('RGBA'))
    report['files'][name] = dict(size=list(Image.open(p).size), kmeans=kmeans(a, a[..., 3] > 0))

# ---- logo: crop content box, premultiplied resize (pure-black transparent regions would fringe otherwise)
im = Image.open(LOGO_T).convert('RGBA'); a = np.array(im)
ys, xs = np.where(a[..., 3] > 8)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
side = int(max(x1 - x0, y1 - y0) * 1.06); cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
crop = im.crop(box)
def pm_resize(img, n):
    return img.convert('RGBa').resize((n, n), Image.LANCZOS).convert('RGBA')
pm_resize(crop, 640).save(OUT + '/orionpad-logo.png', optimize=True)
pm_resize(crop, 192).save(OUT + '/orionpad-logo-192.png', optimize=True)
report['logoCropBox'] = [int(v) for v in box]

# ---- banner for social card
Image.open(BANNER).convert('RGB').save(OUT + '/orionpad-banner.jpg', quality=88, optimize=True)

# ---- palette: tokens must come from these pixel snaps
def px(p, x, y): return '#%02x%02x%02x' % tuple(np.array(Image.open(p).convert('RGB'))[y, x])
pal = {
  'ink':      (LOGO_O, 976, 446),   # ring body
  'ember':    (LOGO_O, 1299, 753),  # orange dot
  'cream':    (LOGO_O, 1081, 911),  # cream dots
  'paper':    (LOGO_O, 0, 0),       # logo ground
  'ground':   (BANNER, 868, 11),    # banner ground
  'peach':    (BANNER, 1128, 0),
  'peach-2':  (BANNER, 1263, 104),
  'lilac':    (BANNER, 260, 0),
  'ink-2':    (BANNER, 532, 161),   # banner lettering shade
  'ember-hi': (BANNER, 982, 227),
  'clay':     (BANNER, 548, 181),   # shadow tan
  'ember-deep': (SLIDE2, 1595, 724),
}
for k, (p, x, y) in pal.items():
    report['colors'][k] = dict(hex=px(p, x, y), file=p.split('/')[-1], x=x, y=y)

# ---- favicon traced from logo pixel grid
al = a[..., 3] > 128; rgb = a[..., :3].astype(int)
def near(c, t=40): return (np.abs(rgb - np.array(c)).sum(2) < t) & al
ink = near((0x29, 0x26, 0x2a)); ember = near((0xfe, 0x81, 0x3c), 60); cream = near((0xf2, 0xe7, 0xda), 40)
from scipy import ndimage
def blobs(m, minpx=2000):
    lab, n = ndimage.label(m); r = []
    for i in range(1, n + 1):
        yy, xx = np.where(lab == i)
        if len(yy) >= minpx: r.append((xx.mean(), yy.mean(), (xx.max() - xx.min() + 1) / 2, (yy.max() - yy.min() + 1) / 2))
    return r
S = 32 / side
def tr(v, o): return round((v - o) * S, 2)
yy, xx = np.where(ink)
ox0, ox1, oy0, oy1 = xx.min(), xx.max() + 1, yy.min(), yy.max() + 1
mid = (cy)  # scan through ring centre for hole edges
row = ink[mid]; cols = np.where(row)[0]
gaps = np.where(np.diff(cols) > 50)[0]
hx0 = cols[gaps[0]] + 1 if len(gaps) else ox0 + 150; hx1 = ox1 - (hx0 - ox0)  # right side of the hole is cut by the ember dot, mirror the left wall
colv = ink[:, cx]; rows = np.where(colv)[0]; g2 = np.where(np.diff(rows) > 50)[0]
hy0 = rows[g2[0]] + 1 if len(g2) else oy0 + 150; hy1 = rows[g2[0] + 1] if len(g2) else oy1 - 150
bx, by = box[0], box[1]
def el(cxp, cyp, rx, ry, fill, extra=''):
    return '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"%s/>' % (tr(cxp, bx), tr(cyp, by), round(rx * S, 2), round(ry * S, 2), fill, extra)
col = lambda k: report['colors'][k]['hex']
parts = []
ring = '<path fill-rule="evenodd" fill="%s" d="M%s %sa%s %s 0 1 0 .01 0Z M%s %sa%s %s 0 1 1 -.01 0Z"/>' % (
    col('ink'), tr(ox0, bx), tr((oy0 + oy1) / 2, by), round((ox1 - ox0) / 2 * S, 2), round((oy1 - oy0) / 2 * S, 2),
    tr(hx0, bx), tr((hy0 + hy1) / 2, by), round((hx1 - hx0) / 2 * S, 2), round((hy1 - hy0) / 2 * S, 2))
# ring path as two ellipses (outer clockwise, inner reversed) -> evenodd hole
outer = '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"/>' % (tr((ox0 + ox1) / 2, bx), tr((oy0 + oy1) / 2, by), round((ox1 - ox0) / 2 * S, 2), round((oy1 - oy0) / 2 * S, 2), col('ink'))
hole = '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="%s"/>' % (tr((hx0 + hx1) / 2, bx), tr((hy0 + hy1) / 2, by), round((hx1 - hx0) / 2 * S, 2), round((hy1 - hy0) / 2 * S, 2), col('paper'))
parts += [outer, hole]
for (x, y, rx, ry) in blobs(cream, 1500): parts.append(el(x, y, rx, ry, col('cream')))
for (x, y, rx, ry) in blobs(ember, 5000): parts.append(el(x, y, rx, ry, col('ember'), ' stroke="%s" stroke-width="1.2"' % col('paper')))
svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' + ''.join(parts) + '</svg>\n'
assert '--' not in svg
open(OUT + '/favicon.svg', 'w').write(svg)
report['faviconSource'] = dict(ringOuter=[int(ox0), int(ox1), int(oy0), int(oy1)], hole=[int(hx0), int(hx1), int(hy0), int(hy1)])
json.dump(report, open(ROOT + '/tools/palette-report.json', 'w'), indent=1)
print(json.dumps({k: v['hex'] for k, v in report['colors'].items()}))
print(svg)
