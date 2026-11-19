#!/usr/bin/env python3
"""Build the offline, self-contained Hub. Python standard library only."""
import argparse
import base64
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def local_path(path):
    """Resolve every build input and output inside this source directory."""
    resolved = (ROOT / path).resolve()
    if not resolved.is_relative_to(ROOT.resolve()):
        raise ValueError('Build path must stay inside H')
    return resolved

def read_source(path):
    return local_path(path).read_text(encoding='utf-8')

def inline_script(source):
    # An HTML parser ends scripts even inside JS strings/comments.
    return re.sub(r'</script', r'<\\/script', source, flags=re.I)

def inline_avatars(source):
    """Embed literal avatarSrc and faces paths with the same local-only checks."""
    def replace(match):
        src = match['src']
        if not src or src.startswith('data:image/'):
            return match[0]
        if re.search(r'[:\\\x00-\x20]', src) or src.startswith('/'):
            raise ValueError('avatarSrc must be an offline relative image path or data:image URI')
        if src.startswith(('pets/', 'pets-build')):
            raise ValueError('Pet media must remain external')
        image = (ROOT / src).resolve()
        if not image.is_relative_to(ROOT.resolve()):
            raise ValueError('avatarSrc leaves the Hub directory')
        mime = {'.png':'image/png','.gif':'image/gif','.jpg':'image/jpeg','.jpeg':'image/jpeg',
                '.webp':'image/webp','.avif':'image/avif','.svg':'image/svg+xml'}.get(image.suffix.lower())
        if not mime:
            raise ValueError('Unsupported avatarSrc image type: ' + src)
        encoded = base64.b64encode(image.read_bytes()).decode('ascii')
        return match['key'] + match['quote'] + 'data:' + mime + ';base64,' + encoded + match['quote']
    source = re.sub(r"(?P<key>\bavatarSrc\s*:\s*)(?P<quote>['\"])(?P<src>[^'\"]*)(?P=quote)", replace, source)
    def replace_faces(match):
        return re.sub(r"(?P<key>\b(?:normal|thinking|thinkingAnim|done|confused)\s*:\s*)(?P<quote>['\"])(?P<src>[^'\"]*)(?P=quote)", replace, match[0])
    return re.sub(r'\bfaces\s*:\s*\{[^{}]*\}', replace_faces, source)

def build(output_path=None, demo='generic'):
    # 麦克风这一路的样式和脚本必须在，缺了就不要打包装。
    for voice_part in ('css/r29-voice.css', 'js/r29-voice.js'):
        read_source(voice_part)
    page = read_source('index.html')
    for rel in ('css/r29-settings.css', 'js/r29-settings.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        if not local_path(rel).is_file():
            raise ValueError('Missing ' + rel)
    if 'css/r29-avatars.css' not in page or 'js/r29-avatars.js' not in page:
        raise ValueError('r29 avatar files must be linked from index.html')
    if 'css/r29-pet.css' not in page or 'js/r29-pet/mount.js' not in page:
        raise ValueError('index.html must link the stage pet stylesheet and mount script')
    for rel in ('css/r29-welcome.css', 'js/r29-welcome.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        read_source(rel)
    sheets = re.findall(r'<link rel="stylesheet" href="([^"]+)">', page)
    if not sheets or sheets[-1] != 'css/r29-polish.css':
        raise ValueError('css/r29-polish.css must be the last stylesheet')
    board_css = 'css/r29-board-desktop.css'
    if board_css not in sheets or sheets.index(board_css) >= sheets.index('css/r29-polish.css'):
        raise ValueError('css/r29-board-desktop.css must be linked before css/r29-polish.css')
    read_source(board_css)
    if 'css/r30-board.css' not in sheets or sheets.index('css/r30-board.css') >= sheets.index('css/r29-polish.css'):
        raise ValueError('css/r30-board.css must be linked before css/r29-polish.css')
    read_source('css/r30-board.css')
    for rel in ('css/r30-group.css', 'js/r30-group.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        read_source(rel)
    # 接力的样式与脚本必须在，样式排在 r29-polish 前面（r29-polish 仍是最后一份）。
    for rel in ('css/r32-relay.css', 'js/r32-relay.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        read_source(rel)
    if sheets.index('css/r32-relay.css') >= sheets.index('css/r29-polish.css'):
        raise ValueError('css/r32-relay.css must be linked before css/r29-polish.css')
    # 开放认领（谁有空谁接）的样式与脚本必须在，样式排在 r29-polish 前面。
    for rel in ('css/r35-claim.css', 'js/r35-claim.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        read_source(rel)
    if sheets.index('css/r35-claim.css') >= sheets.index('css/r29-polish.css'):
        raise ValueError('css/r35-claim.css must be linked before css/r29-polish.css')
    # 触发（首席安排与卡片定时）的样式与脚本必须在，样式排在 r29-polish 前面。
    for rel in ('css/r38-trigger.css', 'js/r38-trigger.js'):
        if rel not in page:
            raise ValueError('index.html must include ' + rel)
        read_source(rel)
    if sheets.index('css/r38-trigger.css') >= sheets.index('css/r29-polish.css'):
        raise ValueError('css/r38-trigger.css must be linked before css/r29-polish.css')
    read_source('css/r29-polish.css')
    page = re.sub(r'<link rel="icon" href="([^"]+)">',
                  lambda m: '<link rel="icon" href="data:image/png;base64,' +
                  base64.b64encode(local_path(m[1]).read_bytes()).decode('ascii') + '">', page)
    page = re.sub(r'<link rel="stylesheet" href="([^"]+)">',
                  lambda m: '<style>\n' + read_source(m[1]) + '\n</style>', page)
    def selected_script(match):
        source = match[1]
        body = read_source(source)
        return '<script>\n' + inline_script(body) + '\n</script>'
    page = re.sub(r'<script defer src="([^"]+)"[^>]*></script>', selected_script, page)
    manifest = read_source('modules/manifest.js')
    # Manifest is intentionally declarative. Support JS strings, comments, trailing comma.
    clean = re.sub(r'/\*.*?\*/|//[^\n]*', '', manifest, flags=re.S)
    match = re.search(r'window\.HUB_MODULES\s*=\s*\[([\s\S]*?)\]\s*;?', clean)
    if not match:
        raise ValueError('manifest.js must assign a literal array to window.HUB_MODULES')
    items = re.findall(r"(['\"])([_a-zA-Z][\w-]*)\1", match[1])
    remainder = re.sub(r"(['\"])([_a-zA-Z][\w-]*)\1|[\s,]", '', match[1])
    if remainder:
        raise ValueError('Only quoted safe module names are allowed in manifest.js')
    chunks = []
    seen = set()
    for _, name in items:
        if name in seen:
            continue
        seen.add(name)
        path = local_path('modules/' + name + '.js')
        # Separate script blocks isolate both syntax and runtime failures.
        # A syntax error is caught by window.onerror and cannot stop later blocks.
        label = json.dumps(name)
        if path.is_file():
            module_source = path.read_text(encoding='utf-8')
            chunks.extend([
                '<script>window.__hubBuildModule=' + label + ';window.__hubBuildError=function(e){e.preventDefault();Hub.warn(window.__hubBuildModule,e.error||e.message);};window.addEventListener("error",window.__hubBuildError);</script>',
                '<script>Hub.installModule(' + label + ',function(){\n' + inline_script(module_source) + '\n});</script>',
                '<script>window.removeEventListener("error",window.__hubBuildError);</script>'
            ])
        else:
            chunks.append('<script>Hub.warn(' + label + ',"模块文件未加载");</script>')
    chunks.append('<script>Hub.start();</script>')
    page, count = re.subn(r'<!-- MODULE_BOOT:.*?-->\s*<script>[\s\S]*?</script>',
                         lambda _: '\n'.join(chunks), page, count=1)
    if count != 1:
        raise ValueError('Expected exactly one MODULE_BOOT block')
    output = ROOT / (output_path or ('dist-generic/DSH-Hub.html' if demo == 'generic' else 'dist/DSH-Hub.html'))
    if not output.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError('Build output must stay inside H')
    # Validate the complete copy plan before writing; symlinks cannot escape ROOT.
    sources = [local_path('manifest.webmanifest')]
    icons = local_path('assets/icons')
    for icon in sorted(icons.iterdir()):
        source = local_path(icon)
        if source.is_file():
            sources.append(source)
    copies = [(source, local_path(output.parent / ('manifest.webmanifest' if source == sources[0]
               else 'assets/icons/' + source.name))) for source in sources]
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(page, encoding='utf-8')
    for source, destination in copies:
        if source != destination:
            destination.parent.mkdir(parents=True, exist_ok=True)
            if source == sources[0]:
                # R22: startup/status-bar color follows the light ground meta.
                manifest_data = json.loads(source.read_text(encoding='utf-8'))
                color = re.search(r'<meta name="theme-color" media="\(prefers-color-scheme: light\)" content="(#[0-9a-fA-F]+)"', read_source('index.html'))[1]
                manifest_data.update(theme_color=color, background_color=color)
                destination.write_text(json.dumps(manifest_data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            else:
                shutil.copyfile(source, destination)
    pets_dir = ROOT / 'pets'
    if pets_dir.is_dir() and not pets_dir.is_symlink() and output.parent.resolve() != ROOT.resolve():
        shutil.copytree(pets_dir, output.parent / 'pets', dirs_exist_ok=True, symlinks=False)
    print(str(output.relative_to(ROOT)) + ' · ' + str(output.stat().st_size) + ' bytes')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Output path relative to H; default dist/DSH-Hub.html')
    parser.add_argument('--demo', choices=['generic'], default='generic', help='演示数据（公开版只有通用演示）')
    args = parser.parse_args()
    build(args.output, args.demo)
