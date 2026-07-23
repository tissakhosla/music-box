import base64
import os
import pathlib
import subprocess

RCLONE_CONFIG_PATH = '/app/rclone.conf'


def ensure_rclone_config():
    b64 = os.environ.get('RCLONE_CONF_B64', '')
    if not b64:
        return
    pathlib.Path(RCLONE_CONFIG_PATH).write_bytes(base64.b64decode(b64))


def upload_to_dropbox(local_path, remote_folder, filename):
    remote_folder = (remote_folder or '').strip('/')
    dest = f'dropbox:{remote_folder}/{filename}' if remote_folder else f'dropbox:{filename}'

    cmd = ['rclone', 'copyto', local_path, dest]
    if os.path.exists(RCLONE_CONFIG_PATH):
        cmd += ['--config', RCLONE_CONFIG_PATH]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f'rclone upload failed: {(result.stderr or result.stdout).strip()}')
    return dest
