import re

_STRIP_PATTERNS = [
    r'\(official video\)', r'\(official audio\)', r'\(official music video\)',
    r'\[official video\]', r'\[official audio\]', r'\[official music video\]',
    r'\(lyrics?\)', r'\(lyric video\)', r'\[lyrics?\]', r'\[lyric video\]',
    r'\(audio\)', r'\[audio\]', r'\(hd\)', r'\[hd\]', r'\(4k\)', r'\[4k\]',
    r'\(official\)', r'\[official\]', r'\(visualizer\)', r'\[visualizer\]',
    r'\(official music\)', r'\[official music\]',
]
_STRIP_RE = re.compile('|'.join(_STRIP_PATTERNS), re.IGNORECASE)
_TOPIC_RE = re.compile(r'^(.*?)\s*-\s*Topic$', re.IGNORECASE)
_UNSAFE_RE = re.compile(r'[\\/:*?"<>|]')


def guess_artist_title(raw_title, uploader):
    cleaned = _STRIP_RE.sub('', raw_title or '').strip(' -–—|').strip()
    artist, title = '', cleaned
    for sep in (' - ', ' – ', ' — '):
        if sep in cleaned:
            left, right = cleaned.split(sep, 1)
            artist, title = left.strip(), right.strip()
            break
    if not artist and uploader:
        m = _TOPIC_RE.match(uploader.strip())
        if m:
            artist = m.group(1).strip()
    return artist, title


def sanitize_filename(name):
    name = _UNSAFE_RE.sub('_', name or '').strip()
    return (name[:180] if name else 'track')
