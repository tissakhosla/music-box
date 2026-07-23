import base64
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

import requests
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .auth import SESSION_COOKIE, check_password, require_auth
from .dropbox_upload import ensure_rclone_config, upload_to_dropbox
from .tagging import write_tags
from .title_parse import sanitize_filename
from .ytdlp_service import download_audio, download_video, resolve

ensure_rclone_config()

app = FastAPI(title='Music Box YouTube Importer')


class LoginBody(BaseModel):
    password: str


@app.post('/api/login')
def login(body: LoginBody, response: Response):
    token = check_password(body.password)
    if not token:
        raise HTTPException(status_code=401, detail='Wrong password')
    response.set_cookie(
        SESSION_COOKIE, token,
        httponly=True, samesite='lax', secure=True, max_age=60 * 60 * 24 * 30,
    )
    return {'ok': True}


@app.get('/api/whoami')
def whoami(_=Depends(require_auth)):
    return {'ok': True}


@app.get('/api/resolve')
def api_resolve(url: str, _=Depends(require_auth)):
    try:
        return resolve(url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class DownloadBody(BaseModel):
    url: str
    format: str = 'audio'  # 'audio' | 'video'
    title: str = ''
    artist: str = ''
    album: str = ''
    genre: str = ''
    track: Optional[int] = None
    disc: Optional[int] = None
    year: str = ''
    artwork_url: Optional[str] = None
    artwork_b64: Optional[str] = None  # data URL, e.g. "data:image/jpeg;base64,...."
    dest_folder: str = 'YouTube Downloads'


@app.post('/api/download')
def api_download(body: DownloadBody, _=Depends(require_auth)):
    tmp_dir = tempfile.mkdtemp(prefix='ytbox_')
    try:
        if body.format == 'video':
            local_path = download_video(body.url, tmp_dir)
        else:
            local_path = download_audio(body.url, tmp_dir)

            artwork_bytes, artwork_mime = None, None
            if body.artwork_b64:
                header, _, data = body.artwork_b64.partition(',')
                artwork_bytes = base64.b64decode(data)
                artwork_mime = 'image/png' if 'png' in header else 'image/jpeg'
            elif body.artwork_url:
                r = requests.get(body.artwork_url, timeout=15)
                r.raise_for_status()
                artwork_bytes = r.content
                artwork_mime = r.headers.get('Content-Type', 'image/jpeg')

            write_tags(
                local_path, body.title, body.artist, body.album,
                body.genre, body.track, body.disc, body.year,
                artwork_bytes, artwork_mime,
            )

        base_name = (
            f'{body.artist} - {body.title}' if body.artist and body.title
            else (body.title or Path(local_path).stem)
        )
        filename = sanitize_filename(base_name) + Path(local_path).suffix
        dest = upload_to_dropbox(local_path, body.dest_folder, filename)
        return {'ok': True, 'path': dest}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


app.mount('/', StaticFiles(directory='static', html=True), name='static')


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
