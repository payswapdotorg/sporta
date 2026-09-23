#!/usr/bin/env python3
"""
THE REAL-SOURCE ACQUISITION MACHINE (Sporta Wave 6, Worker B).

Turns the operator's OUT-OF-BAND transfer of the real source video into an
ACQUIRED url-source registration through the server's own seam:

    registration (PENDING_TRANSFER)
        │  this script, acting for the operator's capability
        ├─ phase begin   → ACQUIRING (recorded BEFORE any byte moves)
        ├─ download      → yt-dlp (cookies session) | http(s) (file host) | file
        ├─ integrity     → size + sha-256 sidecar next to the bytes
        └─ phase ingest  → the SEAM measures, re-derives rights, runs the
                           studio's own session creation over the bytes
                           → ACQUIRED (session + asset + plan)

HOW THE TRANSFER IS DECIDED (the journal, last record wins):
    The operator's host keeps a transfer journal (JSONL). Each line is one
    record; the LAST record decides the acquisition method:

      {"kind": "cookies", "note": "operator signed in; cookies exported"}
          → yt-dlp with the cookies file against the registration URL
      {"kind": "url", "url": "https://file-host/.../match.mp4"}
          → a direct http(s) download of THAT url
      {"kind": "file", "path": "/path/on/this/host/match.mp4"}
          → the bytes are already on this host; ingest that path directly

    CLI overrides beat the journal: --bytes-url (kind url), --bytes-file
    (kind file), --cookies-file (kind cookies).

HONESTY CONTRACT (no silent fallback):
    * every failure is RECORDED (phase fail → state FAILED + the reason)
      and exits non-zero — the registration never silently resets;
    * the video bytes are NEVER fetched through a plain bot-walled GET for
      a cookies-kind transfer (that is the documented wall) — yt-dlp with
      the operator's session is the real path;
    * the integrity claim this script sends is cross-checked by the seam
      itself (it measures the bytes again, server-side);
    * an already-ACQUIRED registration refuses (the join exists) — no
      second session over the same registration.

USAGE
    python3 scripts/real-source/acquire.py \\
        --registration urlreg-<id> \\
        --acquisition-token <capability> \\
        [--server http://localhost:3000] \\
        [--journal /home/z/replay2/scripts/flags/source_transfer.jsonl] \\
        [--cookies-file /home/z/replay2/scripts/flags/source_cookies.txt] \\
        [--bytes-url URL | --bytes-file PATH] \\
        [--incoming-dir DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_SERVER = os.environ.get("SPORTA_ACQUIRE_SERVER", "http://localhost:3000")
DEFAULT_JOURNAL = Path(
    os.environ.get(
        "SPORTA_TRANSFER_JOURNAL", "/home/z/replay2/scripts/flags/source_transfer.jsonl"
    )
)
DEFAULT_COOKIES = Path(
    os.environ.get("SPORTA_SOURCE_COOKIES", "/home/z/replay2/scripts/flags/source_cookies.txt")
)
DEFAULT_INCOMING = Path(__file__).resolve().parent / "incoming"


# ---------------------------------------------------------------------------
# The seam client (pure stdlib HTTP — no bun, no node, no deps)
# ---------------------------------------------------------------------------


class SeamError(Exception):
    """A typed refusal from the seam (status + the server's own body)."""

    def __init__(self, status: int, body: dict[str, Any]):
        self.status = status
        self.body = body
        error = body.get("error") or {}
        super().__init__(
            f"the seam answered HTTP {status}: "
            f"{error.get('failureClass', 'unknown')} — {error.get('message', json.dumps(body))}"
        )


def seam_call(
    server: str,
    registration: str,
    capability: str,
    payload: dict[str, Any],
    timeout: float = 600.0,
) -> dict[str, Any]:
    url = f"{server.rstrip('/')}/api/create/url-sources/{registration}/transfer"
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "x-acquisition-token": capability,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return json.loads(text) if text.strip() else {}
    except urllib.error.HTTPError as err:
        body: dict[str, Any] = {}
        try:
            body = json.loads(err.read().decode("utf-8"))
        except Exception:  # noqa: BLE001 — the raw body rides in the message
            pass
        raise SeamError(err.code, body) from err


# ---------------------------------------------------------------------------
# The transfer journal (JSONL, last record wins)
# ---------------------------------------------------------------------------


def read_journal(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    last: dict[str, Any] | None = None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as err:
            raise SystemExit(
                f"the transfer journal '{path}' has a malformed line "
                f"({err}); fix or remove it — never a guessed transfer"
            ) from err
        if isinstance(record, dict):
            last = record
    return last


# ---------------------------------------------------------------------------
# The acquisition methods
# ---------------------------------------------------------------------------


def acquire_with_cookies(
    url: str, cookies_file: Path, incoming_dir: Path, registration: str
) -> Path:
    """The operator's authenticated session: yt-dlp with the cookies file."""
    ytdlp = shutil.which("yt-dlp") or shutil.which("yt-dlp_linux") or shutil.which("youtube-dl")
    if ytdlp is None:
        raise RuntimeError(
            "no yt-dlp binary on PATH — a cookies-kind transfer needs the real "
            "tool (pip install -U yt-dlp); refusing to fall back to a plain GET "
            "(the bot-walled host would only serve a refusal page)"
        )
    if not cookies_file.is_file():
        raise RuntimeError(
            f"the cookies file '{cookies_file}' does not exist — export the "
            "operator's authenticated session first (the journal's cookies "
            "record expects it)"
        )
    incoming_dir.mkdir(parents=True, exist_ok=True)
    target = incoming_dir / f"{registration}.mp4"
    command = [
        ytdlp,
        "--cookies",
        str(cookies_file),
        "--no-playlist",
        "-f",
        "bv*+ba/b[ext=mp4]/best",
        "--merge-output-format",
        "mp4",
        "-o",
        str(target),
        url,
    ]
    print(f"[acquire] cookies transfer: {' '.join(command)}", file=sys.stderr)
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0 or not target.is_file():
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        tail = " | ".join(detail[-3:]) if detail else "no diagnostic output"
        raise RuntimeError(f"yt-dlp failed (exit {completed.returncode}): {tail}")
    return target


def acquire_with_url(bytes_url: str, incoming_dir: Path, registration: str) -> Path:
    """A direct http(s) download of the file-host URL the journal recorded."""
    incoming_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(bytes_url.split("?")[0]).suffix or ".mp4"
    target = incoming_dir / f"{registration}{suffix}"
    print(f"[acquire] url transfer: {bytes_url} -> {target}", file=sys.stderr)
    request = urllib.request.Request(bytes_url, headers={"user-agent": "sporta-acquire/1.0"})
    with urllib.request.urlopen(request, timeout=1800) as response, open(target, "wb") as out:
        shutil.copyfileobj(response, out)
    if target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        raise RuntimeError("the download produced zero bytes — refusing an empty transfer")
    return target


def resolve_file(path: Path) -> Path:
    """The bytes are already on this host: use them where they are."""
    if not path.is_file():
        raise RuntimeError(f"the recorded file '{path}' does not exist on this host")
    return path


# ---------------------------------------------------------------------------
# The integrity sidecar (the honest local record next to the bytes)
# ---------------------------------------------------------------------------


def measure(path: Path) -> dict[str, int | str]:
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
            size += len(chunk)
    return {"byteSize": size, "sha256": digest.hexdigest()}


def write_sidecar(path: Path, registration: str, url: str, integrity: dict[str, Any]) -> Path:
    sidecar = path.with_suffix(path.suffix + ".integrity.json")
    sidecar.write_text(
        json.dumps(
            {
                "registrationId": registration,
                "url": url,
                "byteSize": integrity["byteSize"],
                "sha256": integrity["sha256"],
                "measuredBy": "scripts/real-source/acquire.py (pre-ingest)",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return sidecar


# ---------------------------------------------------------------------------
# The machine
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--registration", required=True, help="the urlreg-<id>")
    parser.add_argument("--acquisition-token", required=True, help="the machine capability")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--journal", type=Path, default=DEFAULT_JOURNAL)
    parser.add_argument("--cookies-file", type=Path, default=DEFAULT_COOKIES)
    parser.add_argument("--bytes-url", help="override: a direct file-host URL")
    parser.add_argument("--bytes-file", type=Path, help="override: bytes already on this host")
    parser.add_argument("--incoming-dir", type=Path, default=DEFAULT_INCOMING)
    args = parser.parse_args()

    server: str = args.server
    registration: str = args.registration
    capability: str = args.acquisition_token

    def record_failure(reason: str) -> None:
        """Every failure is RECORDED on the registration (never silent)."""
        try:
            seam_call(
                server,
                registration,
                capability,
                {"phase": "fail", "reason": reason},
                timeout=30.0,
            )
        except Exception as err:  # noqa: BLE001 — best-effort record, reported
            print(
                f"[acquire] WARNING: recording the failure also failed: {err}",
                file=sys.stderr,
            )

    try:
        # 1. The pre-flight read (the machine's own state).
        shown = seam_call(
            server, registration, capability, {"phase": "show"}, timeout=30.0
        )
        url: str = shown.get("url", "")
        state = (shown.get("acquisition") or {}).get("state")
        print(f"[acquire] registration {registration}: {state} for {url}", file=sys.stderr)
        if state == "ACQUIRED":
            print(
                "[acquire] already ACQUIRED — the session join exists "
                f"({shown.get('sessionId')}); nothing further can transfer",
                file=sys.stderr,
            )
            return 0
        if not url:
            raise RuntimeError("the seam's show answer carried no url — refusing to guess")

        # 2. Decide the transfer method (CLI > journal > error).
        journal = read_journal(args.journal)
        kind: str | None = None
        detail: str = ""
        if args.bytes_url is not None:
            kind, detail = "url", args.bytes_url
        elif args.bytes_file is not None:
            kind, detail = "file", str(args.bytes_file)
        elif journal is not None and "kind" in journal:
            kind = str(journal["kind"])
            if kind == "cookies":
                detail = f"cookies session ({args.cookies_file})"
            elif kind == "url":
                detail = str(journal.get("url", ""))
            elif kind == "file":
                detail = str(journal.get("path", ""))
            else:
                raise RuntimeError(
                    f"the journal's last record has unknown kind '{kind}' "
                    "(expected cookies | url | file)"
                )
        else:
            raise RuntimeError(
                f"no transfer method: the journal '{args.journal}' is absent or "
                "carries no kind, and neither --bytes-url nor --bytes-file was "
                "given — record the transfer in the journal or pass an override"
            )
        print(f"[acquire] transfer method: {kind} ({detail})", file=sys.stderr)

        # 3. Mark ACQUIRING BEFORE any byte moves (the honest in-flight state).
        seam_call(
            server,
            registration,
            capability,
            {"phase": "begin", "kind": kind, "detail": detail},
            timeout=30.0,
        )

        # 4. Acquire the bytes.
        if kind == "cookies":
            path = acquire_with_cookies(url, args.cookies_file, args.incoming_dir, registration)
        elif kind == "url":
            source_url = (journal or {}).get("url") if args.bytes_url is None else args.bytes_url
            if not source_url:
                raise RuntimeError("a url-kind transfer needs the url (--bytes-url or the journal)")
            path = acquire_with_url(str(source_url), args.incoming_dir, registration)
        elif kind == "file":
            file_path = args.bytes_file if args.bytes_file is not None else Path(detail)
            path = resolve_file(file_path)
        else:  # pragma: no cover — decided above
            raise RuntimeError(f"unreachable kind {kind}")

        # 5. Measure + write the integrity sidecar.
        integrity = measure(path)
        sidecar = write_sidecar(path, registration, url, integrity)
        print(
            f"[acquire] bytes: {path} ({integrity['byteSize']} bytes, "
            f"sha-256 {str(integrity['sha256'])[:16]}…; sidecar {sidecar})",
            file=sys.stderr,
        )

        # 6. THE SEAM — the binding. The seam re-measures and cross-checks.
        outcome = seam_call(
            server,
            registration,
            capability,
            {
                "phase": "ingest",
                "bytesPath": str(path.resolve()),
                "via": {"kind": kind, "detail": detail},
                "claimed": integrity,
            },
            timeout=1800.0,
        )
        acquired = (outcome.get("registration") or {}).get("acquisition") or {}
        print(
            json.dumps(
                {
                    "registrationId": registration,
                    "state": acquired.get("state"),
                    "sessionId": (outcome.get("registration") or {}).get("sessionId"),
                    "integrity": acquired.get("integrity"),
                },
                indent=2,
            )
        )
        return 0
    except SeamError as err:
        record_failure(f"the seam refused: {err}")
        print(json.dumps({"error": err.body}, indent=2), file=sys.stderr)
        return 1
    except Exception as err:  # noqa: BLE001 — the honest catch-all, recorded
        record_failure(f"the acquisition machine failed: {err}")
        print(f"[acquire] FAILED: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
