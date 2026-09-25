#!/usr/bin/env python3
"""Single-image VLM call with the w2a-discipline poison protections.

- ONE image per call (the multi-image mis-attribution law)
- unlink-before-every-attempt (the stale-/tmp-output 429 poisoning law)
- retry with exponential backoff, honest ERROR on final failure
- 429 rate-limiting retried up to --rate-retries waits (backoff 30..120 s);
  beyond the budget the frame is honestly burned as ERROR and documented
  (worker instruction, post-quota-window: "record them as ERROR and
  proceed; every ERROR frame is documented, none load-bearing")
- raw response JSON preserved per call for the audit trail

Usage: vlm1.py <image> <prompt> <outjson> [--retries 6] [--rate-retries 10] [--model-tag tag]
Exit 0 with verdict JSON written; exit 3 on exhausted retries.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

CLI = "z-ai"


def call_once(image: str, prompt: str, out: Path) -> dict:
    out.unlink(missing_ok=True)  # THE LAW: unlink before every attempt
    proc = subprocess.run(
        [CLI, "vision", "-p", prompt, "-i", image, "-o", str(out)],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0 or not out.exists():
        raise RuntimeError(
            f"vlm call rc={proc.returncode} out_exists={out.exists()} "
            f"tail={(proc.stderr or proc.stdout or '').strip()[-200:]}")
    data = json.loads(out.read_text())
    content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content")
    if not content or not str(content).strip():
        raise RuntimeError(f"vlm call returned empty content: {json.dumps(data)[:200]}")
    return data


def is_rate_limited(detail: str) -> bool:
    return "429" in detail or "Too many requests" in detail


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("prompt")
    ap.add_argument("out")
    ap.add_argument("--retries", type=int, default=8)
    ap.add_argument("--rate-retries", type=int, default=10,
                    help="max consecutive 429 waits before honest ERROR")
    ap.add_argument("--tag", default=None, help="label written into the result json")
    args = ap.parse_args()
    out = Path(args.out)
    last_err = None
    attempt = 0
    rate_waits = 0
    first_429 = None
    while True:
        attempt += 1
        try:
            data = call_once(args.image, args.prompt, out)
            if args.tag or attempt > 1:
                data["_meta"] = {"tag": args.tag, "attempt": attempt,
                                 "rate_waits": rate_waits}
                out.write_text(json.dumps(data, indent=1) + "\n")
            return 0
        except Exception as exc:  # noqa: BLE001 — retried, then honestly reported
            last_err = f"{type(exc).__name__}: {exc}"
            if is_rate_limited(last_err):
                # a 429 is "try later", not a call failure — but the retry
                # budget is bounded (worker instruction, post-quota-window:
                # record as ERROR after the budget; every ERROR frame is
                # documented, none load-bearing)
                if first_429 is None:
                    first_429 = time.time()
                rate_waits += 1
                if rate_waits > args.rate_retries:
                    waited_min = (time.time() - first_429) / 60.0
                    last_err = (f"rate-limited: 429 persisted for {attempt} "
                                f"attempts over ~{waited_min:.1f} min "
                                f"(budget {args.rate_retries} waits)")
                    print(f"[vlm1] 429 budget exhausted after {attempt} "
                          f"attempts: honest ERROR", file=sys.stderr)
                    break
                print(f"[vlm1] attempt {attempt} rate-limited (429): waiting "
                      f"({rate_waits}/{args.rate_retries})", file=sys.stderr)
                time.sleep(min(30 + 10 * rate_waits, 120))
                continue
            print(f"[vlm1] attempt {attempt} failed: {last_err}", file=sys.stderr)
            if attempt >= args.retries:
                break
            time.sleep(min(2 ** attempt * 10, 240))
    out.write_text(json.dumps({"error": "vlm call failed after retries",
                               "detail": last_err}, indent=1) + "\n")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
