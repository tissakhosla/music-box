from mutagen.id3 import (
    ID3, ID3NoHeaderError, TIT2, TPE1, TALB, TCON, TRCK, TPOS, TDRC, APIC,
)


def write_tags(mp3_path, title, artist, album, genre, track, disc, year,
                artwork_bytes, artwork_mime):
    try:
        tags = ID3(mp3_path)
    except ID3NoHeaderError:
        tags = ID3()

    if title:
        tags.setall('TIT2', [TIT2(encoding=3, text=title)])
    if artist:
        tags.setall('TPE1', [TPE1(encoding=3, text=artist)])
    if album:
        tags.setall('TALB', [TALB(encoding=3, text=album)])
    if genre:
        tags.setall('TCON', [TCON(encoding=3, text=genre)])
    if track:
        tags.setall('TRCK', [TRCK(encoding=3, text=str(track))])
    if disc:
        tags.setall('TPOS', [TPOS(encoding=3, text=str(disc))])
    if year:
        tags.setall('TDRC', [TDRC(encoding=3, text=str(year))])

    if artwork_bytes:
        tags.delall('APIC')
        tags.add(APIC(
            encoding=3,
            mime=artwork_mime or 'image/jpeg',
            type=3,  # front cover
            desc='Cover',
            data=artwork_bytes,
        ))

    tags.save(mp3_path, v2_version=3)
