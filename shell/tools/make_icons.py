#!/usr/bin/env python3
"""用纯 Python 画出示意团子图标（几何图形，无任何第三方素材）。输出 PNG 到指定目录。
用法：make_icons.py <输出目录>。生成 icon-512 / icon-192 / icon-maskable-512 / apple-touch-icon-180 / favicon-64。"""
import sys, zlib, struct, math
from pathlib import Path

def ell(x, y, cx, cy, rx, ry):
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0

def shade(x, y):
    """返回 (r,g,b) 画面像素；坐标 0..1。"""
    r, g, b = 220, 239, 227                      # 底色
    if ell(x, y, .5, .805, .29, .034):           # 地面影子
        r, g, b = 188, 206, 196
    for fx in (.38, .62):                        # 脚
        if ell(x, y, fx, .795, .075, .05):
            r, g, b = 240, 186, 40
    in_body = (ell(x, y, .5, .60, .335, .235) or ell(x, y, .36, .42, .15, .14)
               or ell(x, y, .5, .36, .165, .15) or ell(x, y, .64, .42, .15, .14))
    if in_body:
        t = min(max((y - .22) / .55, 0), 1)       # 上浅下深
        r, g, b = int(255 - 15 * t), int(222 - 40 * t), int(110 - 60 * t)
        if ell(x, y, .34, .44, .055, .028):       # 高光
            r, g, b = 255, 243, 190
        if ell(x, y, .31, .645, .052, .032) or ell(x, y, .69, .645, .052, .032):  # 腮红
            r, g, b = 247, 160, 150
        if ell(x, y, .40, .575, .027, .042) or ell(x, y, .60, .575, .027, .042):  # 眼睛
            r, g, b = 60, 38, 28
        d = math.hypot(x - .5, y - .60)           # 微笑：圆环下半
        if y > .605 and abs(d - .05) < .0085:
            r, g, b = 60, 38, 28
    return r, g, b

def render(size, scale=1.0, ss=3):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            acc = [0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    x = (i + (si + .5) / ss) / size
                    y = (j + (sj + .5) / ss) / size
                    x = (x - .5) / scale + .5
                    y = (y - .5) / scale + .5
                    c = shade(x, y)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = ss * ss
            row += bytes((acc[0] // n, acc[1] // n, acc[2] // n))
        rows.append(bytes(row))
    return rows

def png(path, size, scale=1.0):
    raw = b''.join(render(size, scale))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    Path(path).write_bytes(data)

if __name__ == '__main__':
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    png(out / 'icon-512.png', 512)
    png(out / 'icon-192.png', 192)
    png(out / 'icon-maskable-512.png', 512, .78)
    png(out / 'apple-touch-icon-180.png', 180)
    png(out / 'favicon-64.png', 64)
