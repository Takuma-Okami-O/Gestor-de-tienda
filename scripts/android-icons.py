#!/usr/bin/env python3
"""Genera los iconos de Android (clásico, redondo y adaptativo) desde assets/icon-foreground.png
y assets/icon-background.png, y elimina el icono por defecto de Capacitor (la X azul).
Se ejecuta en el workflow después de `npx cap add android`."""
import os, sys
from PIL import Image, ImageDraw
RES = 'android/app/src/main/res'
fg = Image.open('assets/icon-foreground.png').convert('RGBA')
bg = Image.open('assets/icon-background.png').convert('RGBA')
DENS = {'mdpi': (48, 108), 'hdpi': (72, 162), 'xhdpi': (96, 216), 'xxhdpi': (144, 324), 'xxxhdpi': (192, 432)}
def put(img, folder, name):
    os.makedirs(f'{RES}/{folder}', exist_ok=True); img.save(f'{RES}/{folder}/{name}')
for d, (leg, ada) in DENS.items():
    f = f'mipmap-{d}'
    # capas adaptativas (108dp): el primer plano va al 66 % para quedar dentro de la zona segura
    layer = Image.new('RGBA', (ada, ada), (0, 0, 0, 0)); k = int(ada * 0.667)
    layer.alpha_composite(fg.resize((k, k), Image.LANCZOS), ((ada - k) // 2, (ada - k) // 2))
    put(layer, f, 'ic_launcher_foreground.png'); put(bg.resize((ada, ada), Image.LANCZOS), f, 'ic_launcher_background.png')
    # clásicos (sin adaptativo): cuadrado con esquinas suaves y redondo
    base = bg.resize((leg, leg), Image.LANCZOS); k2 = int(leg * 0.92)
    base.alpha_composite(fg.resize((k2, k2), Image.LANCZOS), ((leg - k2) // 2, (leg - k2) // 2))
    def mask(shape):
        m = Image.new('L', (leg * 4, leg * 4), 0); dr = ImageDraw.Draw(m)
        (dr.ellipse if shape == 'round' else (lambda b, fill: dr.rounded_rectangle(b, radius=leg * 0.9, fill=fill)))((0, 0, leg * 4 - 1, leg * 4 - 1), fill=255)
        return m.resize((leg, leg), Image.LANCZOS)
    for shape, name in (('sq', 'ic_launcher.png'), ('round', 'ic_launcher_round.png')):
        o = Image.new('RGBA', (leg, leg), (0, 0, 0, 0)); o.paste(base, (0, 0), mask(shape)); put(o, f, name)
xml = '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n'
os.makedirs(f'{RES}/mipmap-anydpi-v26', exist_ok=True)
for n in ('ic_launcher.xml', 'ic_launcher_round.xml'): open(f'{RES}/mipmap-anydpi-v26/{n}', 'w').write(xml)
for p in (f'{RES}/drawable-v24/ic_launcher_foreground.xml', f'{RES}/drawable/ic_launcher_foreground.xml'):
    if os.path.exists(p): os.remove(p)
print('Iconos de Android generados:', len(DENS) * 4, 'PNG + XML adaptativo')
