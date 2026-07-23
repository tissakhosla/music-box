import os

import yt_dlp

from .title_parse import guess_artist_title


def _thumbnail_for(entry):
    thumbs = entry.get('thumbnails') or []
    if thumbs:
        return thumbs[-1].get('url')
    vid = entry.get('id')
    if vid:
        return f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg'
    return None


def _normalize(entry, index):
    raw_title = entry.get('title') or ''
    uploader = entry.get('uploader') or entry.get('channel') or ''
    artist, title = guess_artist_title(raw_title, uploader)
    upload_date = entry.get('upload_date')  # YYYYMMDD
    year = upload_date[:4] if upload_date else ''
    url = entry.get('webpage_url') or entry.get('url') or (
        f'https://www.youtube.com/watch?v={entry["id"]}' if entry.get('id') else None
    )
    return {
        'id': entry.get('id'),
        'url': url,
        'duration': entry.get('duration'),
        'uploader': uploader,
        'thumbnail': _thumbnail_for(entry),
        'suggested_title': title or raw_title,
        'suggested_artist': artist,
        'suggested_year': year,
        'suggested_track': index,
    }


def resolve(url):
    opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'extract_flat': 'in_playlist',
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)

    if info.get('entries') is not None:
        entries = [e for e in info.get('entries') or [] if e]
        return {
            'type': 'playlist',
            'playlist_title': info.get('title') or 'Playlist',
            'entries': [_normalize(e, i + 1) for i, e in enumerate(entries)],
        }

    return {
        'type': 'video',
        'playlist_title': None,
        'entries': [_normalize(info, 1)],
    }


def download_audio(video_url, out_dir):
    opts = {
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(out_dir, '%(id)s.%(ext)s'),
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '0',
        }],
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        filename = ydl.prepare_filename(info)
    return os.path.splitext(filename)[0] + '.mp3'


def download_video(video_url, out_dir):
    opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': os.path.join(out_dir, '%(id)s.%(ext)s'),
        'merge_output_format': 'mp4',
        'noplaylist': True,
        'quiet': True,
        'no_warnings': True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        filename = ydl.prepare_filename(info)
    return os.path.splitext(filename)[0] + '.mp4'
