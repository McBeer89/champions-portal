"""Static server for the Champions portal + a tiny ownership API.

Replaces ``py -m http.server`` in the launchers. It serves the **project root**
statically (so the page can fetch ``/portal/...`` and ``/data/...``) and adds
two endpoints that persist which Pokémon the PM owns, server-side, in
``data/owned-overrides.json`` — shared by every device that connects and durable
across browser resets:

  GET  /api/owned  -> {"overrides": {slug: bool, ...}}       (no-store)
  POST /api/owned  -> body {"slug": "<slug>", "owned": bool}
                      validates + atomically merges, returns {"ok", "overrides"}

The validation/merge logic is factored into module-level pure functions so it is
unit-testable without a socket (see ``scripts/test_serve.py``).

Run from anywhere (paths resolve off this file):

    py portal\\serve.py                 # localhost only (default)
    py portal\\serve.py --bind 0.0.0.0  # expose on the home LAN
"""

from __future__ import annotations

import argparse
import functools
import json
import os
import re
import socket
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
POKEMON_DIR = PROJECT_DIR / "data" / "dex" / "pokemon"
OVERRIDES_PATH = PROJECT_DIR / "data" / "owned-overrides.json"

SLUG_RE = re.compile(r"[a-z0-9-]{1,64}")
MAX_BODY_BYTES = 10_000  # ownership payloads are tiny; reject anything larger


# --------------------------------------------------------------------------
# Pure logic (no socket / no I/O beyond the explicit path args) — unit-tested.
# --------------------------------------------------------------------------
def is_valid_slug(slug: Any, pokemon_dir: Path) -> bool:
    """True iff *slug* is lowercase-kebab AND names a real dex file.

    The regex rejects uppercase, dots, and slashes, so directory-traversal
    inputs like ``../x`` fail by construction before any path is built.
    """
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        return False
    return (pokemon_dir / f"{slug}.json").is_file()


def parse_owned_body(raw: bytes) -> tuple[str, bool]:
    """Parse a POST body into ``(slug, owned)`` or raise ``ValueError``.

    Enforces the shape ``{"slug": str, "owned": bool}``. Does *not* check that
    the slug names a real mon — that is :func:`is_valid_slug`'s job.
    """
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("malformed JSON body") from exc
    if not isinstance(data, dict):
        raise ValueError("body must be a JSON object")
    slug = data.get("slug")
    owned = data.get("owned")
    if not isinstance(slug, str):
        raise ValueError("'slug' must be a string")
    # bool is a subclass of int; guard against ints/None slipping through.
    if not isinstance(owned, bool):
        raise ValueError("'owned' must be a boolean")
    return slug, owned


def load_overrides(path: Path) -> dict[str, bool]:
    """Read the overrides map. Missing or corrupt file -> ``{}``.

    Coerces to a clean ``{str: bool}`` map so a hand-mangled file can never
    inject non-boolean values downstream.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, bool)}


def merge_override(overrides: dict[str, bool], slug: str, owned: bool) -> dict[str, bool]:
    """Return a new map with ``slug`` set to ``owned`` (originals untouched)."""
    merged = dict(overrides)
    merged[slug] = owned
    return merged


def atomic_write_json(path: Path, data: Any) -> None:
    """Write JSON durably: temp file in the same dir, then ``os.replace``."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".owned-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def lan_ip() -> str | None:
    """Best-effort LAN IPv4 via the UDP-connect trick; None when offline."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


def parse_content_length(value: str | None) -> int | None:
    """Parse a Content-Length header value. None means non-numeric — that
    must map to a clean 400, never a traceback in the handler."""
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------
class PortalHandler(SimpleHTTPRequestHandler):
    """Static files from the project root + the /api/owned endpoints."""

    def end_headers(self) -> None:
        # Static assets get no Cache-Control from SimpleHTTPRequestHandler, so
        # browsers heuristically cache JS modules/data for hours and keep
        # rendering stale UI after an update. no-cache = always revalidate
        # (cheap 304s on the LAN) while still allowing conditional caching.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _send_json(self, status: int, obj: Any, *, no_store: bool = False) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if no_store:
            self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        path = urlparse(self.path).path
        if path == "/api/owned":
            self._send_json(HTTPStatus.OK, {"overrides": load_overrides(OVERRIDES_PATH)},
                            no_store=True)
        elif path.startswith("/api/"):
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such endpoint"})
        else:
            super().do_GET()

    def do_POST(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        path = urlparse(self.path).path
        if path != "/api/owned":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "no such endpoint"})
            return
        length = parse_content_length(self.headers.get("Content-Length"))
        if length is None:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid Content-Length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "missing or oversized body"})
            return
        raw = self.rfile.read(length)
        try:
            slug, owned = parse_owned_body(raw)
        except ValueError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        if not is_valid_slug(slug, POKEMON_DIR):
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "unknown or invalid slug"})
            return
        overrides = merge_override(load_overrides(OVERRIDES_PATH), slug, owned)
        try:
            atomic_write_json(OVERRIDES_PATH, overrides)
        except OSError as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR,
                            {"error": f"could not save: {exc.strerror or 'write failed'}"})
            return
        self._send_json(HTTPStatus.OK, {"ok": True, "overrides": overrides})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the Champions portal + ownership API.")
    parser.add_argument("--bind", default="127.0.0.1",
                        help="interface to bind (default 127.0.0.1; use 0.0.0.0 for LAN)")
    parser.add_argument("--port", type=int, default=8737, help="port (default 8737)")
    args = parser.parse_args(argv)

    handler = functools.partial(PortalHandler, directory=str(PROJECT_DIR))
    server = ThreadingHTTPServer((args.bind, args.port), handler)

    # flush=True so the addresses appear immediately even when stdout is a pipe
    # (serve_forever never returns to flush the buffer on its own).
    print(f"Serving Champions portal at http://127.0.0.1:{args.port}/portal/", flush=True)
    if args.bind not in ("127.0.0.1", "localhost"):
        ip = lan_ip()
        if ip:
            print(f"On your home network:      http://{ip}:{args.port}/portal/", flush=True)
        print(f"(bound to {args.bind} — reachable by other devices on your network)", flush=True)
    print("Press Ctrl+C to stop.", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
