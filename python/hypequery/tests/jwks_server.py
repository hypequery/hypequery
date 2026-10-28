"""A local JSON Web Key Set endpoint for JWT tests, on a background thread."""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class _QuietServer(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request: object, client_address: object) -> None:
        # A client that gave up mid-response (timeouts, size limits) is expected.
        return


class JwksServer:
    """Serves `document` at any path; tests change it, and how it answers."""

    def __init__(self, document: dict[str, Any]) -> None:
        self.document: Any = document
        self.status = 200
        self.delay = 0.0
        #: When set, the body is sent one byte per this many seconds, forever.
        self.drip = 0.0
        self.paths: list[str] = []
        #: When False, no content-length: the body ends when the connection does.
        self.length = True
        self.body: bytes | None = None
        self.headers: dict[str, str] = {}
        self.hits = 0
        server = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                server.hits += 1
                server.paths.append(self.path)
                if server.drip:
                    self._drip()
                    return
                if server.delay:
                    time.sleep(server.delay)
                body = (
                    server.body
                    if server.body is not None
                    else json.dumps(server.document).encode("utf-8")
                )
                self.send_response(server.status)
                self.send_header("content-type", "application/json")
                if server.length:
                    self.send_header("content-length", str(len(body)))
                for name, value in server.headers.items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(body)

            def _drip(self) -> None:
                self.send_response(200)
                self.send_header("content-length", str(10**6))
                self.end_headers()
                while True:
                    time.sleep(server.drip)
                    self.wfile.write(b" ")
                    self.wfile.flush()

            def log_message(self, format: str, *args: object) -> None:  # noqa: A002
                return

        self._http = _QuietServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self._http.server_address[1]}/jwks.json"
        self._thread = threading.Thread(target=self._http.serve_forever, daemon=True)

    def __enter__(self) -> JwksServer:
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._http.shutdown()
        self._http.server_close()
