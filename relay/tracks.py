"""Background tracks: audio files uploaded from the viewer, shared by every screen.

Files live in ``tracks_dir`` (default ``relay/tracks/``, git-ignored) next to a
small ``tracks.json`` holding each track's analysed tempo/key and which track
each theme plays. Everything here is LAN-local like the rest of the relay.

  GET    /api/tracks                 -> {"tracks": [...], "assign": {theme: name}}
  POST   /api/tracks                 multipart "file" -> {"name": ...}
  PUT    /api/tracks/{name}/meta     json {bpm, offset, root, minor} -> ok
  DELETE /api/tracks/{name}          -> ok
  PUT    /api/tracks-assign          json {"theme": id, "name": name|null} -> ok
  GET    /tracks/{name}              the audio file (range requests supported)
"""

import json
import logging
import os
import re
import time

from aiohttp import web

logger = logging.getLogger("pewpew-relay.tracks")

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO_EXT = {".mp3", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".flac", ".webm"}
THEME_ID = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def safe_name(raw: str) -> str | None:
    """A plain file name we're willing to store: no paths, a known audio extension."""
    base = os.path.basename(raw.replace("\\", "/")).strip()
    stem, ext = os.path.splitext(base)
    ext = ext.lower()
    if ext not in AUDIO_EXT:
        return None
    stem = re.sub(r"[^A-Za-z0-9 ._()-]+", "_", stem).strip(" ._") or "track"
    return stem[:96] + ext


class TrackStore:
    def __init__(self, folder: str, max_mb: int):
        self.dir = os.path.abspath(folder)
        self.max_bytes = max_mb * 1024 * 1024
        os.makedirs(self.dir, exist_ok=True)
        self.state_file = os.path.join(self.dir, "tracks.json")

    def _state(self) -> dict:
        try:
            with open(self.state_file) as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        data.setdefault("meta", {})
        data.setdefault("assign", {})
        return data

    def _save(self, data: dict) -> None:
        tmp = self.state_file + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, indent=1)
        os.replace(tmp, self.state_file)

    def path(self, name: str) -> str | None:
        clean = safe_name(name)
        if clean != name:
            return None
        p = os.path.join(self.dir, clean)
        return p if os.path.isfile(p) else None

    def listing(self) -> dict:
        state = self._state()
        tracks = []
        for fn in sorted(os.listdir(self.dir)):
            if safe_name(fn) != fn:
                continue
            st = os.stat(os.path.join(self.dir, fn))
            tracks.append({"name": fn, "size": st.st_size, "mtime": int(st.st_mtime),
                           "meta": state["meta"].get(fn)})
        names = {t["name"] for t in tracks}
        assign = {k: v for k, v in state["assign"].items() if v in names}
        return {"tracks": tracks, "assign": assign, "max_mb": self.max_bytes // (1024 * 1024)}


def add_track_routes(app: web.Application, cfg: dict) -> None:
    folder = cfg.get("tracks_dir") or os.path.join(HERE, "tracks")
    if not os.path.isabs(folder):
        folder = os.path.join(HERE, folder)
    store = TrackStore(folder, int(cfg.get("max_track_mb", 60)))
    logger.info("background tracks in %s (max %d MB)", store.dir, store.max_bytes // (1024 * 1024))

    async def list_tracks(_):
        return web.json_response(store.listing())

    async def upload(request: web.Request):
        reader = await request.multipart()
        field = await reader.next()
        while field is not None and field.name != "file":
            field = await reader.next()
        if field is None or not field.filename:
            raise web.HTTPBadRequest(text="expected a multipart field named 'file'")
        name = safe_name(field.filename)
        if not name:
            raise web.HTTPUnsupportedMediaType(text="audio files only: " + ", ".join(sorted(AUDIO_EXT)))
        tmp = os.path.join(store.dir, f".upload-{int(time.time() * 1000)}")
        size = 0
        try:
            with open(tmp, "wb") as f:
                while chunk := await field.read_chunk(1 << 16):
                    size += len(chunk)
                    if size > store.max_bytes:
                        raise web.HTTPRequestEntityTooLarge(max_size=store.max_bytes, actual_size=size)
                    f.write(chunk)
            os.replace(tmp, os.path.join(store.dir, name))
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        state = store._state()
        state["meta"].pop(name, None)            # a replaced file gets analysed again
        store._save(state)
        logger.info("track uploaded: %s (%.1f MB)", name, size / 1e6)
        return web.json_response({"name": name, "size": size})

    async def put_meta(request: web.Request):
        name = request.match_info["name"]
        if not store.path(name):
            raise web.HTTPNotFound()
        body = await request.json()
        try:
            meta = {"bpm": float(body["bpm"]), "offset": float(body["offset"]),
                    "root": int(body["root"]) % 12, "minor": bool(body["minor"]),
                    "manual": bool(body.get("manual", False))}
        except (KeyError, TypeError, ValueError):
            raise web.HTTPBadRequest(text="expected bpm, offset, root, minor")
        if not 40 <= meta["bpm"] <= 240:
            raise web.HTTPBadRequest(text="bpm out of range")
        state = store._state()
        state["meta"][name] = meta
        store._save(state)
        return web.json_response({"ok": True})

    async def delete(request: web.Request):
        name = request.match_info["name"]
        p = store.path(name)
        if not p:
            raise web.HTTPNotFound()
        os.remove(p)
        state = store._state()
        state["meta"].pop(name, None)
        state["assign"] = {k: v for k, v in state["assign"].items() if v != name}
        store._save(state)
        logger.info("track deleted: %s", name)
        return web.json_response({"ok": True})

    async def assign(request: web.Request):
        body = await request.json()
        theme, name = body.get("theme"), body.get("name")
        if not isinstance(theme, str) or not THEME_ID.match(theme):
            raise web.HTTPBadRequest(text="bad theme")
        state = store._state()
        if name:
            if not store.path(name):
                raise web.HTTPNotFound()
            state["assign"][theme] = name
        else:
            state["assign"].pop(theme, None)
        store._save(state)
        return web.json_response({"ok": True})

    async def serve(request: web.Request):
        p = store.path(request.match_info["name"])
        if not p:
            raise web.HTTPNotFound()
        return web.FileResponse(p, headers={"Cache-Control": "no-cache"})

    app.router.add_get("/api/tracks", list_tracks)
    app.router.add_post("/api/tracks", upload)
    app.router.add_put("/api/tracks/{name}/meta", put_meta)
    app.router.add_delete("/api/tracks/{name}", delete)
    app.router.add_put("/api/tracks-assign", assign)
    app.router.add_get("/tracks/{name}", serve)
