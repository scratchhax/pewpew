"""WAD art for FRAGNET: one uploaded IWAD, shared by every screen.

FRAGNET ships a small Freedoom-derived asset pack; this lets a LAN owner
swap in a legally-owned DOOM.WAD / DOOM1.WAD / freedoom*.wad instead. The
file is stored server-side like the background tracks; the theme fetches
the active WAD and parses it in the browser. Nothing here is a copy of
anything commercial - that part stays the owner's business.

  GET    /api/wads          -> {"wads": [...], "active": name|null, "max_mb": n}
  POST   /api/wads          multipart "file" -> {"name": ...}   (becomes active)
  PUT    /api/wads-active   json {"name": name|null} -> ok
  DELETE /api/wads/{name}   -> ok
  GET    /wads/{name}       the WAD file
"""

import json
import logging
import os
import re
import time

from aiohttp import web

logger = logging.getLogger("pewpew-relay.wads")

HERE = os.path.dirname(os.path.abspath(__file__))


def safe_name(raw: str) -> str | None:
    """A plain .wad file name we're willing to store: no paths, wad extension."""
    base = os.path.basename(raw.replace("\\", "/")).strip()
    stem, ext = os.path.splitext(base)
    if ext.lower() != ".wad":
        return None
    stem = re.sub(r"[^A-Za-z0-9 ._()-]+", "_", stem).strip(" ._") or "wads"
    return (stem[:96] + ".wad")


class WadStore:
    def __init__(self, folder: str, max_mb: int):
        self.dir = os.path.abspath(folder)
        self.max_bytes = max_mb * 1024 * 1024
        os.makedirs(self.dir, exist_ok=True)
        self.state_file = os.path.join(self.dir, "wads.json")

    def _state(self) -> dict:
        try:
            with open(self.state_file) as f:
                data = json.load(f)
        except (OSError, ValueError):
            data = {}
        data.setdefault("active", None)
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
        wads = []
        for fn in sorted(os.listdir(self.dir)):
            if safe_name(fn) != fn:
                continue
            st = os.stat(os.path.join(self.dir, fn))
            wads.append({"name": fn, "size": st.st_size, "mtime": int(st.st_mtime)})
        names = {w["name"] for w in wads}
        active = state.get("active") if state.get("active") in names else None
        return {"wads": wads, "active": active, "max_mb": self.max_bytes // (1024 * 1024)}


def add_wad_routes(app: web.Application, cfg: dict) -> None:
    folder = cfg.get("wads_dir") or os.path.join(HERE, "wads")
    if not os.path.isabs(folder):
        folder = os.path.join(HERE, folder)
    store = WadStore(folder, int(cfg.get("max_wad_mb", 40)))
    logger.info("fragnet WAD art in %s (max %d MB)", store.dir, store.max_bytes // (1024 * 1024))

    async def list_wads(_):
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
            raise web.HTTPUnsupportedMediaType(text="a .wad file only")
        tmp = os.path.join(store.dir, f".upload-{int(time.time() * 1000)}")
        size = 0
        try:
            with open(tmp, "wb") as f:
                while chunk := await field.read_chunk(1 << 16):
                    size += len(chunk)
                    if size > store.max_bytes:
                        raise web.HTTPRequestEntityTooLarge(max_size=store.max_bytes, actual_size=size)
                    f.write(chunk)
            # a real WAD starts with the four-byte magic IWAD or PWAD
            with open(tmp, "rb") as f:
                magic = f.read(4)
            if magic not in (b"IWAD", b"PWAD"):
                raise web.HTTPBadRequest(text="not a WAD file (magic is not IWAD/PWAD)")
            os.replace(tmp, os.path.join(store.dir, name))
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        state = store._state()
        state["active"] = name
        store._save(state)
        logger.info("wad uploaded and made active: %s (%.1f MB)", name, size / 1e6)
        return web.json_response({"name": name, "size": size})

    async def put_active(request: web.Request):
        body = await request.json()
        name = body.get("name")
        if name:
            if not store.path(name):
                raise web.HTTPNotFound()
        state = store._state()
        state["active"] = name or None
        store._save(state)
        return web.json_response({"ok": True})

    async def delete(request: web.Request):
        name = request.match_info["name"]
        p = store.path(name)
        if not p:
            raise web.HTTPNotFound()
        os.remove(p)
        state = store._state()
        if state.get("active") == name:
            state["active"] = None
        store._save(state)
        logger.info("wad deleted: %s", name)
        return web.json_response({"ok": True})

    async def serve(request: web.Request):
        p = store.path(request.match_info["name"])
        if not p:
            raise web.HTTPNotFound()
        return web.FileResponse(p, headers={"Cache-Control": "no-cache"})

    app.router.add_get("/api/wads", list_wads)
    app.router.add_post("/api/wads", upload)
    app.router.add_put("/api/wads-active", put_active)
    app.router.add_delete("/api/wads/{name}", delete)
    app.router.add_get("/wads/{name}", serve)
