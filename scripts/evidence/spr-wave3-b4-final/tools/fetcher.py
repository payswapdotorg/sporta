#!/usr/bin/env python3
"""Parallel itag-230 HLS segment fetcher over the recorded chain (w2a method).

Rebuild of the w2a-recorded acquisition deviation (README §6): ffmpeg's own
HLS pull through the TLS relay is ~90 KB/s (per-segment CONNECT setup), so
windows are fetched by a parallel segment fetcher over the SAME
relay->gost egress (6 concurrent CONNECT tunnels, per-segment retry, raw
MPEG-TS concatenation — segments have no EXT-X-MAP). Content provenance is
unchanged (same itag-230 HLS, same proxy exit); only transport scheduling
differs.

Usage:
  fetcher.py --start A --end B --name wNAME [--out DIR] [--concurrency 6]
Writes: DIR/wNAME.ts (raw concatenated segments, playlist order)
        DIR/wNAME-window.json (exact segment math map, w2a format)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WORK = Path("/home/z/spr-w3c-work")
PLAYLIST = WORK / "playlist-230.m3u8"
URLFILE = WORK / "url-230.txt"
RELAY = "http://127.0.0.1:8128"
YTDLP = "/home/z/sporta-w3c/.venv/bin/yt-dlp"


def refresh_playlist() -> None:
    """Re-resolve the itag-230 playlist URL through the chain (token expiry)."""
    print("[fetcher] refreshing playlist URL through the chain...", file=sys.stderr)
    subprocess.run(
        [YTDLP, "--proxy", RELAY,
         "--extractor-args", "youtube:player_client=visionos",
         "-g", "-f", "230", "https://www.youtube.com/watch?v=93LPZJkCW2w"],
        check=True, capture_output=True, text=True,
    ).stdout.strip().splitlines()
    url = subprocess.run(
        [YTDLP, "--proxy", RELAY,
         "--extractor-args", "youtube:player_client=visionos",
         "-g", "-f", "230", "https://www.youtube.com/watch?v=93LPZJkCW2w"],
        check=True, capture_output=True, text=True,
    ).stdout.strip().splitlines()[0]
    URLFILE.write_text(url)
    subprocess.run(["curl", "-s", "-m", "90", "-x", RELAY, "-o", str(PLAYLIST), url],
                   check=True)
    print(f"[fetcher] playlist refreshed ({PLAYLIST.stat().st_size} bytes)",
          file=sys.stderr)


def parse_playlist() -> list[dict]:
    """Parse the media playlist into [{url, dur, start}] with cumulative starts."""
    lines = PLAYLIST.read_text().splitlines()
    segments: list[dict] = []
    dur = 0.0
    start = 0.0
    for line in lines:
        line = line.strip()
        if line.startswith("#EXTINF:"):
            dur = float(line.split(":", 1)[1].rstrip(","))
        elif line.startswith("http"):
            segments.append({"url": line, "dur": dur, "start": start})
            start += dur
    total = sum(s["dur"] for s in segments)
    print(f"[fetcher] playlist: {len(segments)} segments, total {total:.2f}s",
          file=sys.stderr)
    return segments


def fetch_segment(url: str, dest: Path, attempts: int = 4) -> None:
    """Fetch one TS segment through the relay (CONNECT tunnel via curl).

    A URL-keyed cache avoids re-downloading segments shared between the
    cross-check pulls and the sweep windows (pure transport optimization;
    the cache key is the full segment URL, so rotated URLs never alias).
    """
    import hashlib
    cache = WORK / "seg-cache"
    cache.mkdir(exist_ok=True)
    ckey = cache / (hashlib.sha1(url.encode()).hexdigest()[:24] + ".ts")
    if ckey.exists() and ckey.stat().st_size > 0:
        dest.write_bytes(ckey.read_bytes())
        return
    for attempt in range(1, attempts + 1):
        # unlink-before-every-attempt (the w2a stale-output law)
        dest.unlink(missing_ok=True)
        proc = subprocess.run(
            ["curl", "-s", "--fail", "-m", "120", "-x", RELAY, "-o", str(dest), url],
            capture_output=True,
        )
        if proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0:
            head = dest.open("rb").read(1)
            if head == b"\x47":  # MPEG-TS sync byte
                ckey.write_bytes(dest.read_bytes())
                return
        print(f"[fetcher] seg attempt {attempt} failed rc={proc.returncode} "
              f"size={dest.stat().st_size if dest.exists() else -1}", file=sys.stderr)
        time.sleep(1.5 * attempt)
    raise RuntimeError(f"segment fetch failed after {attempts} attempts: {url[:80]}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=float, required=True)
    ap.add_argument("--end", type=float, required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", default=str(WORK / "windows"))
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    if not PLAYLIST.exists():
        refresh_playlist()
    segments = parse_playlist()
    total = sum(s["dur"] for s in segments)

    # selection: every segment overlapping the open (start, end) interval —
    # the w2a trueWindow convention (requested boundary inside a segment =>
    # that segment is included; trueWindow = [cum[first], cum[last+1]])
    first = next(i for i, s in enumerate(segments) if s["start"] + s["dur"] > args.start)
    last = next((i for i, s in enumerate(segments) if s["start"] >= args.end),
                len(segments)) - 1
    chosen = segments[first:last + 1]
    true_start = chosen[0]["start"]
    true_end = chosen[-1]["start"] + chosen[-1]["dur"]
    print(f"[fetcher] {args.name}: requested [{args.start}, {args.end}] -> "
          f"true [{true_start:.2f}, {true_end:.2f}] "
          f"({true_end - true_start:.2f}s, {len(chosen)} segments)", file=sys.stderr)

    tmpdir = outdir / f".{args.name}-segs"
    tmpdir.mkdir(exist_ok=True)
    t0 = time.time()
    jobs = []
    for i, seg in enumerate(chosen):
        dest = tmpdir / f"seg_{i:04d}.ts"
        jobs.append((seg["url"], dest))
        seg["file"] = str(dest)
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        list(pool.map(lambda j: fetch_segment(*j), jobs))
    wall = time.time() - t0

    # concatenate raw TS in playlist order
    ts_path = outdir / f"{args.name}.ts"
    nbytes = 0
    with open(ts_path, "wb") as out:
        for seg in chosen:
            data = Path(seg["file"]).read_bytes()
            out.write(data)
            nbytes += len(data)
    for seg in chosen:
        Path(seg["file"]).unlink(missing_ok=True)
    tmpdir.rmdir()

    window_map = {
        "requested": [args.start, args.end],
        "trueWindow": [round(true_start, 2), round(true_end, 2)],
        "segments": len(chosen),
        "bytes": nbytes,
        "wallSec": round(wall, 1),
        "segmentDurs": [round(s["dur"], 2) for s in chosen],
    }
    map_path = outdir / f"{args.name}-window.json"
    map_path.write_text(json.dumps(window_map, indent=1) + "\n")
    print(f"[fetcher] {args.name}: {ts_path} ({nbytes} bytes, {wall:.1f}s wall) "
          f"map {map_path}", file=sys.stderr)
    print(json.dumps({"name": args.name, **window_map}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
