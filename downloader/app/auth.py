import hmac
import hashlib
import os

from fastapi import HTTPException, Request

APP_PASSWORD = os.environ.get('APP_PASSWORD', '')
SESSION_COOKIE = 'ytbox_session'


def _session_token():
    return hmac.new(APP_PASSWORD.encode(), b'authenticated', hashlib.sha256).hexdigest()


def check_password(password):
    if not APP_PASSWORD or not hmac.compare_digest(password or '', APP_PASSWORD):
        return None
    return _session_token()


def require_auth(request: Request):
    if not APP_PASSWORD:
        return  # no password configured — open access, dev only
    token = request.cookies.get(SESSION_COOKIE, '')
    if not hmac.compare_digest(token, _session_token()):
        raise HTTPException(status_code=401, detail='Not authenticated')
