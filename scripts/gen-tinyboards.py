#!/usr/bin/env python3
"""gen-tinyboards - draws the built-in tinyBoard breadboard artwork.

Writes one Fritzing-style SVG per board into
    src/renderer/src/assets/tinyboards/
and prints the pin map + tinyProto bus list that partsLibrary.ts hard-codes.

Fritzing conventions the output follows:
  * the root <svg> carries the real-world size in inches with a viewBox in
    points (72 units/inch), so the part is dimensionally correct;
  * the art sits in a <g id="breadboard"> layer;
  * every connector carries a `connectorNpin` element and a
    `connectorNterminal` marker at its attachment point;
  * EVERY gradient id is namespaced per board - the Circuit view inlines all
    the boards into one DOM, and shared ids make every board render with the
    first board's fill.

Geometry is measured off the product photos: a 1.9in (48.26 mm) regular
octagon, 0.1in pitch, 8 pins up the left (ANALOG), 8 up the right (DIGITAL),
9 across the bottom (SERIAL). tinyProto additionally carries its 183-hole
prototyping cross - 15 columns x the 8 header rows, plus the 9 header columns
x 15 rows - with five silkscreened power buses.

Usage:  python3 scripts/gen-tinyboards.py [--json]
Stdlib only.
"""
import json
import math
import os
import sys


DPI_VB = 72.0
IN = 1.9
W = IN * DPI_VB            # 136.8
H = W
U = 0.1 * DPI_VB           # 7.2 — one 0.1" pitch
CH = W / (2 + math.sqrt(2))  # 40.07 — regular-octagon chamfer
CX = W / 2
CY = H / 2

X_L = CX - 8.75 * U        # 5.4
X_R = CX + 8.75 * U        # 131.4
Y_B = CY + 8.25 * U        # 127.8
Y_SIDE = [CY - 3.5 * U + i * U for i in range(8)]
X_BOT = [CX - 4.0 * U + i * U for i in range(9)]

LEFT_NAMES = ['GND', '3V3', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0']
RIGHT_NAMES = ['D8', 'D9', 'D10', 'D11', 'D12', 'D13', '3V3.2', 'GND.2']
BOT_NAMES = ['SCK', 'MO', 'MI', 'RX', 'TX', 'SDA', 'SCL', 'PWR', 'GND.3']
# what the family silkscreens by default
LEFT_SILK = ['GND', '3V3', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0']
RIGHT_SILK = ['8', '9', '10', '11', '12', '13', '3V3', 'GND']
BOT_SILK = ['SCK', 'MO', 'MI', 'RX', 'TX', 'SDA', 'SCL', 'PWR', 'GND']

SANS = 'DejaVu Sans, Verdana, Arial, Helvetica, sans-serif'
PX = 96.0 / DPI_VB


def connectors():
    out = []
    for n, s, y in zip(LEFT_NAMES, LEFT_SILK, Y_SIDE):
        out.append((n, s, X_L, y, 'L'))
    for n, s, y in zip(RIGHT_NAMES, RIGHT_SILK, Y_SIDE):
        out.append((n, s, X_R, y, 'R'))
    for n, s, x in zip(BOT_NAMES, BOT_SILK, X_BOT):
        out.append((n, s, x, Y_B, 'B'))
    return out


def stack_pin_map():
    return {n: [round(x * PX, 2), round(y * PX, 2)] for n, _s, x, y, _d in connectors()}


def octagon(inset=0.0):
    c = CH + inset * (math.sqrt(2) - 1)
    a, b = inset, W - inset
    return [(c, a), (W - c, a), (b, c), (b, H - c),
            (W - c, b), (c, b), (a, H - c), (a, c)]


def poly(pts):
    return ' '.join('%.2f,%.2f' % (x, y) for x, y in pts)


def inside(px, py, m=0.0):
    """Is (px,py) at least m inside the octagon?"""
    k = CH + m * (math.sqrt(2) - 1)
    return (m < px < W - m and m < py < H - m and
            px + py > k and (W - px) + py > k and
            px + (H - py) > k and (W - px) + (H - py) > k)


# ── text ────────────────────────────────────────────────────────────────────
def txt(x, y, s, size=3.2, fill='#fff', anchor='middle', weight='normal',
        style='normal', deg=None, ls=None, family=None):
    tr = ' transform="rotate(%g,%.2f,%.2f)"' % (deg, x, y) if deg else ''
    sp = ' letter-spacing="%s"' % ls if ls else ''
    return ('<text x="%.2f" y="%.2f" font-family="%s" font-size="%.2f" fill="%s" '
            'text-anchor="%s" font-weight="%s" font-style="%s"%s%s>%s</text>'
            % (x, y, family or SANS, size, fill, anchor, weight, style, sp, tr, s))


def credit(silk, name='GEOFF McINTYRE', size=2.5):
    """The two-line designer credit that runs at 45 deg along the SE chamfer."""
    mid = (W + (W - CH)) / 2
    out = []
    for i, s in enumerate(('BOARD DESIGN BY:', name)):
        d = 12.5 + i * 4.4
        c = mid - d / math.sqrt(2)
        out.append(txt(c, c, s, size, silk, 'middle', deg=-45, ls='0.35'))
    return ''.join(out)


# ── copper ──────────────────────────────────────────────────────────────────


def pad_ring(idx, x, y, r=2.6, hole=1.3, ring='#d7ab48', edge='#9b7a24', hole_fill='#141414'):
    return ('<circle id="connector%dpin" cx="%.2f" cy="%.2f" r="%.2f" fill="%s" '
            'stroke="%s" stroke-width="0.3"/>'
            '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>'
            '<rect id="connector%dterminal" x="%.2f" y="%.2f" width="0.3" height="0.3" fill="none"/>'
            % (idx, x, y, r, ring, edge, x, y, hole, hole_fill, idx, x - 0.15, y - 0.15))


def pad_socket(idx, x, y, s=5.6):
    """A 0.1in female receptacle: black shell, square cavity."""
    return ('<rect id="connector%dpin" x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.5" '
            'fill="#17181c" stroke="#34373d" stroke-width="0.35"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.3" fill="#0a0b0d"/>'
            '<rect id="connector%dterminal" x="%.2f" y="%.2f" width="0.3" height="0.3" fill="none"/>'
            % (idx, x - s / 2, y - s / 2, s, s, x - s * 0.29, y - s * 0.29,
               s * 0.58, s * 0.58, idx, x - 0.15, y - 0.15))


def pad_dome(idx, x, y, r=2.9):
    """Solder-domed gold pad (HASL/ENIG finish, as photographed)."""
    return ('<circle id="connector%dpin" cx="%.2f" cy="%.2f" r="%.2f" fill="#c9a03c"/>'
            '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#e6c979"/>'
            '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#1b1a15"/>'
            '<rect id="connector%dterminal" x="%.2f" y="%.2f" width="0.3" height="0.3" fill="none"/>'
            % (idx, x, y, r, x, y, r * 0.78, x, y, r * 0.40, idx, x - 0.15, y - 0.15))


def header_pads(style='ring', **kw):
    fn = {'ring': pad_ring, 'socket': pad_socket, 'dome': pad_dome}[style]
    return ''.join(fn(i, x, y, **kw) for i, (_n, _s, x, y, _d) in enumerate(connectors()))


def header_boxes(silk, w=3.7, pin1=True):
    """Silkscreen outline round each header, with pin 1 boxed on its own —
    the convention used across the family."""
    o = []

    def rect(x0, y0, x1, y1, rx=0.9):
        o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="none" '
                 'stroke="%s" stroke-width="0.6"/>' % (x0, y0, x1 - x0, y1 - y0, rx, silk))
    ys, ye = Y_SIDE[0], Y_SIDE[-1]
    # left: pin 1 = top
    rect(X_L - w, ys - w, X_L + w, ys + w)
    rect(X_L - w, Y_SIDE[1] - w, X_L + w, ye + w)
    # right: pin 1 = bottom
    rect(X_R - w, ye - w, X_R + w, ye + w)
    rect(X_R - w, ys - w, X_R + w, Y_SIDE[-2] + w)
    # bottom: pin 1 = rightmost
    rect(X_BOT[-1] - w, Y_B - w, X_BOT[-1] + w, Y_B + w)
    rect(X_BOT[0] - w, Y_B - w, X_BOT[-2] + w, Y_B + w)
    return ''.join(o)


def header_labels(silk, size=3.1, side_deg=0, bottom_deg=0, over=None, skip=(),
                  gap=4.6, bgap=4.8, bsize=None):
    """Pin names. `side_deg`/`bottom_deg` are 0 or -90 (reading bottom-to-top);
    the family is not consistent about this, so each board says what it prints."""
    o = []
    over = over or {}
    for n, s, x, y, d in connectors():
        s = over.get(n, s)
        if not s or n in skip:
            continue
        if d == 'B':
            bs = bsize or size
            if bottom_deg:
                o.append(txt(x, y - bgap, s, bs, silk, 'start', deg=bottom_deg))
            else:
                o.append(txt(x, y - bgap, s, bs, silk, 'middle'))
        else:
            sx = x + gap if d == 'L' else x - gap
            if side_deg:
                o.append(txt(sx, y, s, size, silk, 'middle', deg=side_deg))
            else:
                o.append(txt(sx, y + size * 0.36, s, size, silk,
                             'start' if d == 'L' else 'end'))
    return ''.join(o)


def tiny_logo(x, y, k=13.0, silk='#fff'):
    """The chip mark every tinyBoard carries."""
    sw = k * 0.105
    o = ['<g transform="translate(%.2f,%.2f)">' % (x, y),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="none" '
         'stroke="%s" stroke-width="%.2f"/>' % (-k / 2, -k / 2, k, k, k * 0.13, silk, sw)]
    for i in range(4):
        t = -k / 2 + k * (i + 1) / 5.0
        for a, b, c, d in ((t, -k / 2, t, -k / 2 - k * 0.13),
                           (t, k / 2, t, k / 2 + k * 0.13),
                           (-k / 2, t, -k / 2 - k * 0.13, t),
                           (k / 2, t, k / 2 + k * 0.13, t)):
            o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" '
                     'stroke-width="%.2f" stroke-linecap="round"/>' % (a, b, c, d, silk, sw))
    o.append(txt(0, k * 0.20, 'tiny', k * 0.40, silk, 'middle', style='italic'))
    o.append('</g>')
    return ''.join(o)


def defs(slug, mask, mask2, extra=''):
    """Gradients etc. EVERY id is namespaced: several boards share one DOM in
    the Circuit view, and duplicate ids made every board pick up the first
    board's (near-black) soldermask."""
    return ('<defs>'
            '<linearGradient id="%s-mask" x1="0.12" y1="0" x2="0.8" y2="1">'
            '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>'
            '<linearGradient id="%s-metal" x1="0" y1="0" x2="0.2" y2="1">'
            '<stop offset="0" stop-color="#eceff3"/><stop offset="0.45" stop-color="#b6bbc4"/>'
            '<stop offset="0.6" stop-color="#d2d7dd"/><stop offset="1" stop-color="#8e949d"/>'
            '</linearGradient>'
            '<linearGradient id="%s-green" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#6fc784"/><stop offset="0.45" stop-color="#33984f"/>'
            '<stop offset="1" stop-color="#1a6733"/></linearGradient>'
            % (slug, mask, mask2, slug, slug) + extra + '</defs>')


def board_base(slug, edge='#000'):
    return ('<polygon points="%s" fill="url(#%s-mask)"/>'
            '<polygon points="%s" fill="none" stroke="%s" stroke-width="1.1" opacity="0.30"/>'
            % (poly(octagon()), slug, poly(octagon(0.55)), edge))


def svg(body, title):
    return ('<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
            'width="%gin" height="%gin" viewBox="0 0 %.1f %.1f">'
            '<title>%s</title><g id="breadboard">%s</g></svg>' % (IN, IN, W, H, title, body))



def g(x, y, deg=0):
    return '<g transform="translate(%.2f,%.2f) rotate(%g)">' % (x, y, deg)

def smd_res(x, y, deg=0, code='103', w=4.6, h=2.5):
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#cbcfd5"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#232428"/>'
            % (-w/2, -h/2, w, h, -w/2+0.95, -h/2, w-1.9, h) +
            txt(0, h/2-0.8, code, 1.6, '#eceff3') + '</g>')

def smd_cap(x, y, deg=0, w=5.0, h=3.4, body='#cfc0a2'):
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.35" fill="#b9bec6"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#ffffff" opacity="0.16"/>'
            '</g>' % (-w/2, -h/2, w, h, -w/2+1.05, -h/2, w-2.1, h, body,
                      -w/2+1.05, -h/2, w-2.1, h*0.3))

def sot23(x, y, deg=0, w=4.6, h=3.3):
    legs = ''.join('<rect x="%.2f" y="%.2f" width="1.05" height="1.15" fill="#c6cbd2"/>' % (lx, ly)
                   for lx, ly in ((-w/2-1.0, -h/4-0.6), (-w/2-1.0, h/4-0.6), (w/2-0.05, -0.58)))
    return (g(x, y, deg) + legs +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.35" fill="#26272b"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#3c3e44" opacity="0.7"/>'
            '</g>' % (-w/2, -h/2, w, h, -w/2, -h/2, w, h*0.3))

def soic(s, x, y, deg=0, w=7.2, h=5.2, n=4, label=''):
    legs = ''
    for i in range(n):
        ly = -h/2 + h*(i+0.5)/n
        legs += ('<rect x="%.2f" y="%.2f" width="1.25" height="1.0" fill="#c6cbd2"/>'
                 '<rect x="%.2f" y="%.2f" width="1.25" height="1.0" fill="#c6cbd2"/>'
                 % (-w/2-1.15, ly-0.5, w/2-0.1, ly-0.5))
    t = txt(0, 0.9, label, 1.9, '#8d9199') if label else ''
    return (g(x, y, deg) + legs +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.5" fill="#26272b"/>'
            '<circle cx="%.2f" cy="%.2f" r="0.6" fill="#4d5057"/>'
            % (-w/2, -h/2, w, h, -w/2+1.3, -h/2+1.3) + t + '</g>')

def inductor(s, x, y, size=15.5, deg=0):
    """Shielded power inductor: dark ferrite body, bright plated end terminals."""
    k = size
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.3" fill="#3a3d42"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.1" fill="#4c5057"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#d8dce1"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#d8dce1"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#c2c7cd"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#c2c7cd"/>'
            % (-k/2, -k/2, k, k, -k/2+0.9, -k/2+0.9, k-1.8, k-1.8,
               -k*0.30, -k/2+0.7, k*0.34, k*0.20, -k*0.04, k/2-k*0.27, k*0.34, k*0.20,
               -k/2+0.7, k*0.30, k*0.20, k*0.17, k/2-k*0.27, -k*0.47, k*0.20, k*0.17) +
            txt(-k*0.06, k*0.10, '4R7', k*0.20, '#2b2e33', 'middle', deg=-30) + '</g>')

def screw_terminal(s, x, y, poles=3, pitch=10.0, deg=0):
    """Pluggable green screw terminal, screws facing outward (up)."""
    w, h = poles*pitch, 17.5
    o = [g(x, y, deg),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.2" fill="url(#%s-green)"/>'
         % (-w/2, -h/2, w, h, s),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#8fd8a2" opacity="0.30"/>'
         % (-w/2, -h/2, w, h*0.22),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#0f4a24" opacity="0.35"/>'
         % (-w/2, h/2-3.6, w, 3.6)]
    for i in range(poles):
        sx = -w/2 + pitch*(i+0.5)
        o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#7d838c"/>' % (sx, -h/2+5.2, pitch*0.36))
        o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="url(#%s-metal)"/>' % (sx, -h/2+5.2, pitch*0.30, s))
        o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="1.35" rx="0.4" fill="#5b6068" '
                 'transform="rotate(%d,%.2f,%.2f)"/>' % (sx-pitch*0.26, -h/2+4.5, pitch*0.52,
                                                         (i*37) % 90 - 45, sx, -h/2+5.2))
        o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="4.4" rx="0.8" fill="#0b3d1c"/>'
                 % (sx-pitch*0.30, h/2-7.0, pitch*0.60))
        if i:
            o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#12481f" '
                     'stroke-width="0.55" opacity="0.8"/>' % (-w/2+pitch*i, -h/2, -w/2+pitch*i, h/2))
    o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.2" fill="none" '
             'stroke="#0d3d1c" stroke-width="0.55"/></g>' % (-w/2, -h/2, w, h))
    return ''.join(o)

def slide_switch(s, x, y, w=12.6, h=24.6):
    """SPDT slide switch, metal shell, actuator toward the ON (upper) end."""
    return (g(x, y) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="2.6" rx="0.6" fill="#aeb3ba"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="2.6" rx="0.6" fill="#aeb3ba"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.0" fill="url(#%s-metal)" '
            'stroke="#767c85" stroke-width="0.45"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.6" fill="#1d1f23"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.5" fill="#0a0b0d"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.4" fill="#585d65"/>'
            '</g>' % (-w*0.22, -h/2-1.8, w*0.44, -w*0.22, h/2-0.8, w*0.44,
                      -w/2, -h/2, w, h, s,
                      -w/2+2.0, -h/2+2.6, w-4.0, h-5.2,
                      -w/2+2.6, -h/2+3.4, w-5.2, h*0.40,
                      -w/2+3.2, -h/2+4.2, w-6.4, h*0.28))

def tact_button(s, x, y, k=9.6):
    return (g(x, y) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.8" fill="url(#%s-metal)" '
            'stroke="#6f747d" stroke-width="0.4"/>'
            '<circle cx="0" cy="0" r="%.2f" fill="#2a2c31"/>'
            '<ellipse cx="0" cy="%.2f" rx="%.2f" ry="%.2f" fill="#4a4d54"/></g>'
            % (-k/2, -k/2, k, k, s, k*0.31, -k*0.03, k*0.24, k*0.22))

def usb_c(s, x, y, deg=0, w=22.0, h=13.0):
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.8" fill="url(#%s-metal)" '
            'stroke="#767c85" stroke-width="0.5"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="%.2f" fill="#17191d"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="2.4" rx="1.2" fill="#5c616a"/>'
            % (-w/2, -h/2, w, h, s, -w/2+2.8, -h/2+2.6, w-5.6, h-5.2, (h-5.2)/2,
               -w/2+4.4, -1.2, w-8.8) +
            txt(w*0.16, h*0.30, 'GCT', 2.2, '#9aa0a8') + '</g>')

def jst(x, y, deg=0, w=9.6, h=7.2):
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#f2e9d6" '
            'stroke="#cbc0a6" stroke-width="0.4"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.4" fill="#dbcfb3"/>'
            '<rect x="-2.6" y="%.2f" width="1.4" height="%.2f" fill="#9aa0a9"/>'
            '<rect x="1.2" y="%.2f" width="1.4" height="%.2f" fill="#9aa0a9"/></g>'
            % (-w/2, -h/2, w, h, -w/2+1.1, -h/2+1.1, w-2.2, h-2.8,
               -h/2+1.7, h-4.0, -h/2+1.7, h-4.0))

def led(x, y, colour='#d8452f', k=3.0):
    return ('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#bcc1c7"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.3" fill="%s"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#fff" opacity="0.4"/>'
            % (x-k/2-0.8, y-k/2, k+1.6, k, x-k/2, y-k/2, k, k, colour,
               x-k/2+0.35, y-k/2+0.35, k*0.38, k*0.38))

def esp_module(s, x, y, w=46.0, h=50.0):
    """ESP32-S3-MINI-1: cream module PCB, shield can, antenna keep-out on top."""
    sh_x, sh_y, sh_w, sh_h = -w/2+2.0, -h/2+9.6, w-4.0, h-13.0
    o = [g(x, y),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.8" fill="#efe9da" '
         'stroke="#cec7b6" stroke-width="0.4"/>' % (-w/2, -h/2, w, h)]
    for i in range(15):
        px = -w/2 + 1.8 + i*(w-3.6)/14
        o.append('<rect x="%.2f" y="%.2f" width="1.5" height="1.8" fill="#c9a24a"/>' % (px-0.75, -h/2-0.6))
        o.append('<rect x="%.2f" y="%.2f" width="1.5" height="1.8" fill="#c9a24a"/>' % (px-0.75, h/2-1.2))
    # antenna
    o.append('<path d="M%.2f,%.2f h3.4 v2.1 h-3.4 v2.1 h3.4 v2.1 h-3.4" fill="none" '
             'stroke="#c9a24a" stroke-width="0.9"/>' % (-w/2+8.0, -h/2+2.4))
    o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.0" fill="url(#%s-metal)" '
             'stroke="#8b9099" stroke-width="0.45"/>' % (sh_x, sh_y, sh_w, sh_h, s))
    o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="none" '
             'stroke="#a9aeb6" stroke-width="0.35"/>' % (sh_x+1.1, sh_y+1.1, sh_w-2.2, sh_h-2.2))
    o.append(txt(1.5, sh_y+7.0, 'ESPRESSIF', 3.1, '#484d55'))
    o.append(txt(1.5, sh_y+11.6, 'ESP32-S3-MINI-1', 3.3, '#3c414a'))
    o.append(txt(1.5, sh_y+16.6, 'CE', 3.0, '#585d65'))
    for i, ln in enumerate(('FCC ID: 2AC7Z-ESP32S3MINI1', 'IC: 21098-ESP32S3MINI1',
                            'CMIIT ID: 2022DP6085')):
        o.append(txt(1.5, sh_y+21.0+i*3.0, ln, 1.75, '#6b7079'))
    o.append('<rect x="%.2f" y="%.2f" width="8.6" height="6.6" rx="0.5" fill="#e6e9ee" '
             'stroke="#9aa0a9" stroke-width="0.3"/>' % (-3.0, sh_y+sh_h-8.6))
    for i in range(6):
        for j in range(5):
            o.append('<rect x="%.2f" y="%.2f" width="0.75" height="0.62" fill="#2f3238"/>'
                     % (-2.4+i*1.32, sh_y+sh_h-7.9+j*1.16))
    o.append('</g>')
    return ''.join(o)

def speaker(s, cx, cy, r=58.0):
    """Round mylar speaker: raised rim, swirled cone, centre dome."""
    o = ['<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#000" opacity="0.28"/>' % (cx+1.2, cy+1.6, r+1.4),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#1b1c1f"/>' % (cx, cy, r),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#0d0e10"/>' % (cx, cy, r*0.955),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#141518"/>' % (cx, cy, r*0.90)]
    n, ri, ro = 34, r*0.30, r*0.885
    for i in range(n):
        a0 = i*2*math.pi/n
        x0, y0 = cx+ro*math.cos(a0), cy+ro*math.sin(a0)
        a1 = a0 + 0.62
        x1, y1 = cx+ri*math.cos(a1), cy+ri*math.sin(a1)
        am = a0 + 0.24
        rm = (ri+ro)*0.52
        xm, ym = cx+rm*math.cos(am), cy+rm*math.sin(am)
        o.append('<path d="M%.2f,%.2f Q%.2f,%.2f %.2f,%.2f" fill="none" stroke="#43464c" '
                 'stroke-width="%.2f" stroke-linecap="round" opacity="0.95"/>'
                 % (x0, y0, xm, ym, x1, y1, r*0.052))
    o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#0f1012"/>' % (cx, cy, r*0.33))
    o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#191a1d"/>' % (cx, cy, r*0.30))
    o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#131417"/>' % (cx, cy, r*0.125))
    o.append('<ellipse cx="%.2f" cy="%.2f" rx="%.2f" ry="%.2f" fill="#5a5f66" opacity="0.16"/>'
             % (cx-r*0.30, cy-r*0.34, r*0.30, r*0.20))
    return ''.join(o)

def audio_jack(x, y, deg=0, w=15.0, h=11.0):
    return (g(x, y, deg) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="1.2" fill="#232529" '
            'stroke="#121316" stroke-width="0.4"/>'
            '<circle cx="%.2f" cy="0" r="%.2f" fill="#0b0c0e"/>'
            '<circle cx="%.2f" cy="0" r="%.2f" fill="#35383e"/>'
            '<rect x="%.2f" y="%.2f" width="3.0" height="%.2f" rx="0.5" fill="#c8a24a"/>'
            '<rect x="%.2f" y="%.2f" width="3.0" height="%.2f" rx="0.5" fill="#c8a24a"/></g>'
            % (-w/2, -h/2, w, h, -w/2+3.4, h*0.30, -w/2+3.4, h*0.17,
               w/2-3.4, -h/2-1.6, 3.2, w/2-3.4, h/2-1.6, 3.2))

def round_lcd(s, cx, cy, r_bezel=51.0, r_glass=46.0):
    o = ['<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#000" opacity="0.30"/>' % (cx+1.0, cy+1.4, r_bezel+1.0),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#111318"/>' % (cx, cy, r_bezel),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#07080b"/>' % (cx, cy, r_bezel*0.965),
         '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="url(#%s-lcd)"/>' % (cx, cy, r_glass, s)]
    for i in range(60):
        a = i*2*math.pi/60 - math.pi/2
        L = r_glass*0.105 if i % 5 == 0 else r_glass*0.055
        wd = r_glass*0.020 if i % 5 == 0 else r_glass*0.011
        rr = r_glass*0.94
        o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#e6ecff" '
                 'stroke-width="%.2f" opacity="0.92" stroke-linecap="round"/>'
                 % (cx+rr*math.cos(a), cy+rr*math.sin(a),
                    cx+(rr-L)*math.cos(a), cy+(rr-L)*math.sin(a), wd))
    o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#fff" stroke-width="2.4" '
             'stroke-linecap="round"/>' % (cx, cy, cx-r_glass*0.30, cy-r_glass*0.56))
    o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#fff" stroke-width="1.9" '
             'stroke-linecap="round"/>' % (cx, cy, cx+r_glass*0.42, cy-r_glass*0.52))
    o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#f2622f" stroke-width="1.1" '
             'stroke-linecap="round"/>' % (cx, cy, cx+r_glass*0.32, cy+r_glass*0.62))
    o.append(txt(cx-r_glass*0.16, cy+r_glass*0.40, '2:05', r_glass*0.115, '#dfe6ff'))
    o.append('<ellipse cx="%.2f" cy="%.2f" rx="%.2f" ry="%.2f" fill="#ffffff" opacity="0.05"/>'
             % (cx-r_glass*0.28, cy-r_glass*0.30, r_glass*0.42, r_glass*0.16))
    return ''.join(o)

def gas_sensor(s, x, y, k=13.0):
    """MEMS gas sensor in a gold-plated can with a 3x3 vent grid."""
    o = [g(x, y),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.9" fill="#8d7c52"/>' % (-k/2, -k/2, k, k),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.7" fill="#cbbf9b"/>'
         % (-k/2+0.7, -k/2+0.7, k-1.4, k-1.4),
         '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.5" fill="#b6a884"/>'
         % (-k*0.30, -k*0.30, k*0.60, k*0.60)]
    for i in range(3):
        for j in range(3):
            o.append('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#26241c"/>'
                     % (-k*0.19+i*k*0.19, -k*0.19+j*k*0.19, k*0.055))
    o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.9" fill="none" '
             'stroke="#6f6142" stroke-width="0.4"/></g>' % (-k/2, -k/2, k, k))
    return ''.join(o)

def fpc(x, y, w=30.0, h=6.0):
    return (g(x, y) +
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="0.6" fill="#1e2b52" '
            'stroke="#101828" stroke-width="0.35"/>'
            '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#2f4a86"/></g>'
            % (-w/2, -h/2, w, h, -w/2+1.4, -h/2+1.2, w-2.8, h-2.8))

def mount_hole(x, y, r=4.4, ring='#efeee9'):
    return ('<circle cx="%.2f" cy="%.2f" r="%.2f" fill="%s"/>'
            '<circle cx="%.2f" cy="%.2f" r="%.2f" fill="#0e0f11" opacity="0.25"/>'
            % (x, y, r, ring, x, y, r*0.9))



WHITE = '#f4f6f8'

# ── tinyCore ────────────────────────────────────────────────────────────────
def tinycore():
    s = 'tc'
    o = [defs(s, '#1b2422', '#0d1413'), board_base(s, '#000')]
    o.append(esp_module(s, 68.0, 33.0, 46.0, 50.0))
    o.append(tact_button(s, 37.7, 16.0, 9.0))
    o.append(tact_button(s, 98.2, 16.0, 9.0))
    o.append(txt(37.7, 25.6, 'BOOT', 3.6, WHITE, weight='bold'))
    o.append(txt(98.2, 25.6, 'RST', 3.6, WHITE, weight='bold'))
    o.append(jst(19.5, 104.0, 90))
    o.append(usb_c(s, 111.5, 108.5, -45, 24.0, 14.0))          # on the SE chamfer, at 45deg
    o.append(mount_hole(29.5, 72.0, 4.6))
    o.append(mount_hole(107.3, 72.0, 4.6))
    for x in (24.0, 30.5, 106.0, 112.5):
        o.append(smd_res(x, 44.0, 90, '103', 4.4, 2.4))
    for x, y in ((22.0, 53.5), (114.5, 53.5), (20.5, 65.0), (116.0, 65.0)):
        o.append(smd_cap(x, y, 0, 4.4, 2.9))
    for x in (30.0, 36.5, 100.0, 106.5):
        o.append(smd_cap(x, 30.5, 0, 4.4, 2.9))
    o.append(sot23(23.0, 88.5, 0))
    o.append(sot23(114.0, 88.5, 0))
    o.append(soic(s, 68.0, 88.0, 0, 7.6, 5.2, 4, ''))
    for x in (44.0, 52.0, 60.0, 76.0):
        o.append(smd_cap(x, 99.5, 0, 4.4, 2.9))
    o.append(smd_res(34.0, 99.5, 0, '472', 4.4, 2.4))
    # status LEDs — measured off the board
    for lx, col, nm in ((36.2, '#4fd07a', 'PWR'), (51.5, '#f0a93b', 'CRG'),
                        (66.5, '#4a8ff0', 'BOOT'), (82.1, '#e8524a', 'SIG')):
        o.append(led(lx, 64.0, col))
        o.append(txt(lx + 4.8, 72.4, nm, 3.2, WHITE, weight='bold'))
    o.append(tiny_logo(87.8, 83.7, 12.2, WHITE))
    o.append(txt(99.0, 89.6, '5V', 3.4, WHITE, weight='bold'))
    o.append('<circle cx="97.4" cy="93.6" r="1.8" fill="#c8c9cb"/>'
             '<circle cx="97.4" cy="98.2" r="1.8" fill="#c8c9cb"/>')
    o.append(header_boxes(WHITE))
    o.append(header_pads('socket'))
    # tinyCore prints its side names horizontally and its bottom names at 90deg
    o.append(header_labels(WHITE, 3.4, side_deg=0, bottom_deg=-90, bgap=4.6))
    o.append(txt(X_L + 21.0, 64.0, 'ANALOG', 3.8, WHITE, deg=90, ls='1.0'))
    o.append(txt(X_R - 21.0, 64.0, 'DIGITAL', 3.8, WHITE, deg=-90, ls='1.0'))
    o.append(txt(68.0, 104.5, 'SERIAL', 3.8, WHITE, 'middle', ls='1.0'))
    return ''.join(o)

# ── tinyGlow ────────────────────────────────────────────────────────────────
def tinyglow():
    s = 'tg'
    o = [defs(s, '#1d4bad', '#0e2c73'), board_base(s, '#04102e')]
    # three 3-pole terminals: the outer two ride the top chamfers at +/-45deg
    ch = ((33.8, 11.3, -45, 'CH3'), (68.4, 4.3, 0, 'CH2'), (103.7, 11.7, 45, 'CH1'))
    for x, y, d, _n in ch:
        o.append(screw_terminal(s, x, y, 3, 10.0, d))
    o.append(txt(28.0, 30.0, 'CH3', 3.6, WHITE, deg=-90))
    o.append(txt(63.0, 32.0, 'CH2', 3.6, WHITE, deg=-90))
    o.append(txt(98.5, 30.0, 'CH1', 3.6, WHITE, deg=-90))
    o.append(txt(18.5, 24.5, '4A MAX', 2.6, WHITE, deg=-45))
    o.append(txt(68.4, 22.5, '4A MAX', 2.6, WHITE))
    o.append(txt(118.0, 24.5, '4A MAX', 2.6, WHITE, deg=45))
    for i, (ix, iy) in enumerate(((40.8, 46.4), (76.4, 47.1), (113.9, 47.2))):
        o.append('<rect x="%.2f" y="%.2f" width="21.0" height="21.0" fill="none" stroke="%s" '
                 'stroke-width="0.5" opacity="0.7"/>' % (ix - 10.5, iy - 10.5, WHITE))
        o.append(inductor(s, ix, iy, 18.5))
        o.append(sot23(ix - 12.0, 35.5))
        o.append(smd_cap(ix - 15.5, 29.0, 0, 4.6, 3.0))
        o.append(smd_cap(ix - 15.5, 34.5, 0, 4.6, 3.0))
        o.append(smd_cap(ix - 3.0, 27.5, 0, 4.6, 3.0))
        o.append(smd_res(ix - 9.5, 60.5, 0, '103', 4.4, 2.4))
        o.append(smd_res(ix - 3.0, 60.5, 0, '472', 4.4, 2.4))
        o.append(smd_cap(ix + 10.5, 39.5, 90, 4.6, 3.0))
        o.append(smd_cap(ix + 15.0, 39.5, 90, 4.6, 3.0))
        o.append(sot23(ix - 9.0, 72.5, 0))
    o.append(mount_hole(29.7, 77.5, 4.2, '#dfe4ea'))
    o.append(mount_hole(102.9, 76.0, 4.2, '#dfe4ea'))
    sw = (39.2, 62.7, 86.0)
    for i, x in enumerate(sw):
        o.append(slide_switch(s, x, 97.0, 11.6, 26.0))
        o.append(txt(x - 0.5, 82.0, 'ON', 3.4, WHITE, weight='bold'))
        o.append(txt(x - 6.4, 116.5, 'S%d' % (3 - i), 4.6, WHITE, weight='bold'))
        o.append(txt(x + 7.0, 116.5, 'OFF', 3.2, WHITE, weight='bold'))
        o.append(smd_res(x + 8.5, 97.0, 90, '103', 4.4, 2.4))
    # VIN input, bottom right, labelled along the chamfer
    o.append(txt(112.5, 100.0, '+VIN', 2.9, WHITE, deg=-90))
    o.append(txt(118.0, 100.0, 'GND', 2.9, WHITE, deg=-90))
    o.append(txt(106.5, 112.0, '5V - 24V', 2.9, WHITE, deg=-45))
    for vx in (112.5, 119.0):
        o.append('<circle cx="%.2f" cy="108.5" r="2.7" fill="#d7ab48" stroke="#9b7a24" '
                 'stroke-width="0.3"/><circle cx="%.2f" cy="108.5" r="1.35" fill="#101114"/>'
                 % (vx, vx))
    o.append(header_boxes(WHITE))
    o.append(header_pads('ring'))
    # the real board only silkscreens the three channel pins
    o.append(header_labels(WHITE, 2.9, side_deg=-90,
                           over={n: '' for n in LEFT_NAMES + BOT_NAMES + RIGHT_NAMES}))
    for i, nm in enumerate(('1', '2', '3')):          # CH1..CH3 print in two lines
        o.append(txt(X_R - 8.4, Y_SIDE[i], 'CH', 2.6, WHITE, deg=-90))
        o.append(txt(X_R - 4.6, Y_SIDE[i], nm, 2.6, WHITE, deg=-90))
    o.append(tiny_logo(23.0, 96.5, 17.2, WHITE))
    return ''.join(o)

# ── tinyProto ───────────────────────────────────────────────────────────────
GRID_X = [18.0 + i * U for i in range(15)]      # cols 3..11 are the bottom header
GRID_Y = [14.4 + i * U for i in range(15)]      # rows 4..11 are the side headers
COL0, ROW0 = 3, 4                                # index of X_BOT[0] / Y_SIDE[0]

def proto_holes():
    """The cross: 15 cols x the 8 header rows, plus the 9 header cols x 15 rows."""
    out = []
    for r in range(15):
        for c in range(15):
            in_h = ROW0 <= r < ROW0 + 8
            in_v = COL0 <= c < COL0 + 9
            if in_h or in_v:
                out.append((c, r))
    return out

def hole_name(c, r):
    return '%s.%d' % ('ABCDEFGHIJKLMNO'[c], r + 1)

# silkscreen bus groups, read off the board photo
PROTO_BUSES = [
    [(0, 4), (1, 4), (2, 4), (3, 1), (3, 2), (3, 3)],   # left GND  (L-shaped)
    [(0, 5), (1, 5), (2, 5)],                            # left 3V3
    [(12, 10), (13, 10), (14, 10)],                      # right 3V3
    [(12, 11), (13, 11), (14, 11), (11, 12), (11, 13), (11, 14)],  # right + bottom GND
    [(10, 12), (10, 13), (10, 14)]                       # bottom PWR
]

def tinyproto():
    s = 'tp'
    o = [defs(s, '#0a9950', '#046f39'), board_base(s, '#03361c')]
    hs = set(proto_holes())
    ring = []
    for c, r in sorted(hs):
        x, y = GRID_X[c], GRID_Y[r]
        ring.append('<circle cx="%.2f" cy="%.2f" r="2.55" fill="#c9ced4" stroke="#8d939b" '
                    'stroke-width="0.25"/><circle cx="%.2f" cy="%.2f" r="1.3" fill="#0a4a26"/>'
                    % (x, y, x, y))
    o.append(''.join(ring))
    # bus outlines + the short leader from each header pad to its first hole
    def cap(cells):
        xs = [GRID_X[c] for c, _ in cells]; ys = [GRID_Y[r] for _, r in cells]
        return (min(xs) - 3.6, min(ys) - 3.6, max(xs) + 3.6, max(ys) + 3.6)
    def runs(cells):
        """split an L-shaped bus into its axis-aligned oval segments"""
        by_r, by_c = {}, {}
        for c, r in cells:
            by_r.setdefault(r, []).append(c); by_c.setdefault(c, []).append(r)
        segs = []
        for r, cs in by_r.items():
            if len(cs) > 1: segs.append([(c, r) for c in sorted(cs)])
        for c, rs in by_c.items():
            if len(rs) > 1: segs.append([(c, r) for r in sorted(rs)])
        return segs
    for bus in PROTO_BUSES:
        segs = runs(bus)
        for seg in segs:
            x0, y0, x1, y1 = cap(seg)
            o.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" rx="3.6" fill="none" '
                     'stroke="%s" stroke-width="0.6"/>' % (x0, y0, x1 - x0, y1 - y0, WHITE))
        if len(segs) == 2:   # link the two arms of an L
            a, b = segs
            ax, ay = GRID_X[a[-1][0]], GRID_Y[a[-1][1]]
            bx, by = GRID_X[b[0][0]], GRID_Y[b[0][1]]
            o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" '
                     'stroke-width="0.6"/>' % (ax + 2.4, ay - 2.4, bx - 2.4, by + 2.4, WHITE))
    # single-hole rings for the signal pins + leaders from every pad
    def leader(px, py, hx, hy):
        o.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" '
                 'stroke-width="0.6"/>' % (px, py, hx, hy, WHITE))
    busy = {cell for bs in PROTO_BUSES for cell in bs}
    for i, y in enumerate(Y_SIDE):
        r = ROW0 + i
        # left pad -> its first hole; right pad -> its last hole
        if (0, r) in busy:
            leader(X_L + 3.8, y, GRID_X[2] + 3.6, y)
        else:
            o.append('<circle cx="%.2f" cy="%.2f" r="3.6" fill="none" stroke="%s" '
                     'stroke-width="0.6"/>' % (GRID_X[0], y, WHITE))
            leader(X_L + 3.8, y, GRID_X[0] - 3.6, y)
        if (14, r) in busy:
            leader(X_R - 3.8, y, GRID_X[12] - 3.6, y)
        else:
            o.append('<circle cx="%.2f" cy="%.2f" r="3.6" fill="none" stroke="%s" '
                     'stroke-width="0.6"/>' % (GRID_X[14], y, WHITE))
            leader(X_R - 3.8, y, GRID_X[14] + 3.6, y)
    for i, x in enumerate(X_BOT):
        c = COL0 + i
        if (c, 14) in busy:
            leader(x, Y_B - 3.8, x, GRID_Y[12] - 3.6)
        else:
            o.append('<circle cx="%.2f" cy="%.2f" r="3.6" fill="none" stroke="%s" '
                     'stroke-width="0.6"/>' % (x, GRID_Y[14], WHITE))
            leader(x, Y_B - 3.8, x, GRID_Y[14] + 3.6)
    o.append(header_boxes(WHITE))
    o.append(header_pads('ring', ring='#cbd0d6', edge='#8d939b'))
    o.append(header_labels(WHITE, 3.0, side_deg=-90, bottom_deg=0, gap=4.4, bgap=5.0,
                           bsize=2.6))
    o.append(txt(68.0, 9.5, 'tinyProto', 8.6, WHITE, style='italic', ls='0.7'))
    o.append(credit(WHITE, size=2.2))
    o.append(tiny_logo(23.0, 103.0, 12.5, WHITE))
    return ''.join(o)

# ── tinySniff ───────────────────────────────────────────────────────────────
def tinysniff():
    s = 'ts'
    o = [defs(s, '#efb812', '#c8900a'), board_base(s, '#7d5c06')]
    # three silkscreen zones: H2 top-left, CH4 top-right, H2S bottom-centre
    zones = [
        ('HYDROGEN', [(29.0, 14.0), (67.2, 14.0), (67.2, 68.5), (16.0, 68.5), (16.0, 27.0)],
         37.6, 38.4, 60.5),
        ('METHANE', [(69.6, 14.0), (108.0, 14.0), (121.0, 27.0), (121.0, 68.5), (69.6, 68.5)],
         98.3, 37.7, 75.0),
        ('HYDROGEN SULFIDE', [(45.0, 70.5), (121.0, 70.5), (121.0, 121.0), (45.0, 121.0)],
         69.2, 100.6, 92.0)]
    for name, pts, _sx, _sy, lx in zones:
        o.append('<polygon points="%s" fill="none" stroke="%s" stroke-width="0.65" '
                 'opacity="0.9"/>' % (poly(pts), WHITE))
    for name, pts, _sx, _sy, lx in zones:
        ys = [p[1] for p in pts]
        o.append(txt(lx, (min(ys) + max(ys)) / 2, name, 3.6, WHITE, deg=-90, ls='0.5'))
    # sensor centres and the parts that ring them, measured off the photo
    zoneparts = [
        (37.6, 38.4, 'R6', 'R5', ('C12', 'C9', 'C11', 'C10')),
        (98.3, 37.7, 'R2', 'R1', ('C4', 'C1', 'C3', 'C2')),
        (69.2, 100.6, 'R3', 'R4', ('C6', 'C7', 'C5', 'C8'))]
    for (sx, sy, ra, rb, (cul, cll, cur, clr)) in zoneparts:
        for dx, dy, nm, up in ((-14.5, -4.8, cul, True), (-14.3, 3.9, cll, False),
                               (15.1, -4.5, cur, True), (15.2, 4.0, clr, False)):
            o.append(smd_cap(sx + dx, sy + dy, 90, 7.6, 5.0))
            o.append(txt(sx + dx, sy + dy + (-5.2 if up else 8.0), nm, 3.0, WHITE))
        o.append(smd_res(sx + 4.3, sy - 14.4, 0, '472', 7.4, 3.6))
        o.append(txt(sx + 4.3, sy - 18.6, ra, 3.0, WHITE))
        o.append(smd_res(sx - 6.6, sy + 15.6, 0, '104', 6.4, 3.4))
        o.append(txt(sx - 6.6, sy + 21.0, rb, 3.0, WHITE))
        o.append(sot23(sx + 4.0, sy + 16.0, 0, 6.4, 4.4))
        o.append(gas_sensor(s, sx, sy, 15.5))
    o.append(mount_hole(31.6, 75.5, 4.4, '#f6efdc'))
    o.append(mount_hole(105.6, 75.5, 4.4, '#f6efdc'))
    o.append(header_boxes(WHITE))
    o.append(header_pads('dome'))
    o.append(header_labels(WHITE, 3.0,
                           over={n: '' for n in LEFT_NAMES + RIGHT_NAMES + BOT_NAMES}
                                 | {'A2': 'A2-H2', 'A1': 'A1-H2S', 'A0': 'A0-CH4'}))
    o.append(txt(CX, 10.5, 'tinySniff', 8.6, WHITE, style='italic', ls='0.6'))
    o.append(txt(124.0, 66.0, '83070014A_Y1.09_250122', 2.7, WHITE, deg=-90, ls='0.3'))
    o.append(tiny_logo(107.1, 94.9, 13.9, WHITE))
    o.append(credit(WHITE, size=2.2))
    return ''.join(o)

# ── tinySpeak ───────────────────────────────────────────────────────────────
SPEAK_SILK = {'D8': 'DIN', 'D9': 'BCLK', 'D10': 'LRC', 'D11': 'WS',
              'D12': 'DOUT', 'D13': 'SCLK', '3V3.2': '3V3', 'GND.2': 'GND',
              'GND.3': 'G'}

def tinyspeak():
    s = 'tk'
    o = [defs(s, '#e8382c', '#b81f18'), board_base(s, '#5d0b0a')]
    o.append(smd_res(78.0, 8.5, 0, '105', 5.2, 2.8))
    o.append(txt(90.0, 9.0, 'R1  1M', 2.8, WHITE))
    o.append(soic(s, 104.0, 15.0, 0, 7.0, 5.0, 4, ''))
    o.append(smd_cap(60.0, 7.5, 0, 4.6, 3.0))
    o.append(smd_cap(67.0, 7.5, 0, 4.6, 3.0))
    o.append(txt(30.0, 116.0, 'MIC', 2.8, WHITE))
    o.append('<circle cx="30.0" cy="110.0" r="3.6" fill="#33363b"/>'
             '<circle cx="30.0" cy="110.0" r="1.4" fill="#0e0f11"/>')
    o.append(header_boxes(WHITE))
    o.append(header_pads('ring', ring='#d3d8de', edge='#93989f'))
    o.append(header_labels(WHITE, 3.0, over=SPEAK_SILK))
    o.append(credit(WHITE, 'JOHN LETTANG'))
    # the speaker sits on top of everything, overhanging the top edge
    o.append(audio_jack(28.0, 15.0, -45))
    o.append(speaker(s, 67.9, 66.4, 58.0))
    return ''.join(o)

# ── tinyDisplay ─────────────────────────────────────────────────────────────
def tinydisplay():
    s = 'td'
    lcd = ('<radialGradient id="td-lcd" cx="0.36" cy="0.28" r="0.92">'
           '<stop offset="0" stop-color="#212f63"/><stop offset="0.55" stop-color="#101a44"/>'
           '<stop offset="1" stop-color="#070c26"/></radialGradient>')
    o = [defs(s, '#0e7d6c', '#065247', lcd), board_base(s, '#032b25')]
    for x in (46.0, 58.0, 79.0, 91.0):
        o.append('<circle cx="%.2f" cy="12.5" r="2.6" fill="#c9a03c"/>'
                 '<circle cx="%.2f" cy="12.5" r="1.2" fill="#0a3b33"/>' % (x, x))
    o.append(fpc(68.4, 118.0, 30.0, 6.0))
    o.append(smd_cap(46.0, 118.5, 0, 4.6, 3.0))
    o.append(smd_cap(91.0, 118.5, 0, 4.6, 3.0))
    o.append(header_boxes(WHITE))
    o.append(header_pads('dome'))
    o.append(header_labels(WHITE, 3.0, side_deg=-90, bottom_deg=0, gap=4.6, bgap=5.0))
    o.append(tiny_logo(25.1, 102.6, 9.5, WHITE))
    o.append(credit(WHITE))
    o.append(round_lcd(s, 67.6, 65.0, 49.0, 44.3))
    return ''.join(o)


BOARDS = {
    'tinycore':    ('tinyCore', 'ESP32-S3', tinycore, 'var(--cyan)', '#1b2422', '#ffffff'),
    'tinyglow':    ('tinyGlow', '3-channel LED driver', tinyglow, 'var(--pink)', '#1d4bad', '#ffffff'),
    'tinyproto':   ('tinyProto', 'Prototyping / breakout', tinyproto, '#3fc47a', '#0a9950', '#ffffff'),
    'tinysniff':   ('tinySniff', 'MEMS gas sensor array', tinysniff, '#e0a90d', '#efb812', '#2a2410'),
    'tinyspeak':   ('tinySpeak', 'Microphone + speaker', tinyspeak, '#f0655c', '#e8382c', '#ffffff'),
    'tinydisplay': ('tinyDisplay', 'Round LCD module', tinydisplay, '#2fbfa6', '#0e7d6c', '#ffffff')
}

def proto_pin_map():
    pins = stack_pin_map()
    for c, r in proto_holes():
        pins[hole_name(c, r)] = [round(GRID_X[c] * PX, 2), round(GRID_Y[r] * PX, 2)]
    return pins

def proto_bus_names():
    return [[hole_name(c, r) for c, r in bus] for bus in PROTO_BUSES]



if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = os.path.join(root, 'src', 'renderer', 'src', 'assets', 'tinyboards')
    os.makedirs(dest, exist_ok=True)
    for slug, (label, sub, fn, accent, mask, ink) in BOARDS.items():
        art = svg(fn(), label)
        with open(os.path.join(dest, slug + '.svg'), 'w', encoding='utf-8') as fh:
            fh.write(art)
        print('%-13s %7d bytes  ->  %s.svg' % (slug, len(art), slug))
    print('board box: %.1f x %.1f px @ 96 DPI (%.2fin)  |  proto holes: %d'
          % (W * 96 / 72, H * 96 / 72, IN, len(proto_holes())))
    if '--json' in sys.argv:
        print(json.dumps({'stack': stack_pin_map(), 'proto': proto_pin_map(),
                          'protoBuses': proto_bus_names()}, indent=1))
