#!/usr/bin/env python3
"""Double-fork daemonize: launch a command detached from the tool shell.

Usage: daemonize.py <logfile> <cmd> [args...]

The sandbox reaps tool-shell children, so services must survive their
launching shell: fork -> setsid -> fork -> exec, both intermediates exit,
the grandchild is reparented to init with stdio on the logfile.
"""
import os
import sys


def main() -> int:
    logfile, cmd = sys.argv[1], sys.argv[2:]
    if not cmd:
        print("usage: daemonize.py <logfile> <cmd> [args...]", file=sys.stderr)
        return 2
    pid = os.fork()
    if pid == 0:  # child
        os.setsid()
        pid2 = os.fork()
        if pid2 == 0:  # grandchild: detached session leader -> exec target
            with open(logfile, "ab", 0) as lf:
                os.dup2(lf.fileno(), 1)
                os.dup2(lf.fileno(), 2)
                os.close(0)
            try:
                os.execvp(cmd[0], cmd)
            except Exception as exc:  # noqa: BLE001
                print(f"daemonize exec failed: {exc!r}", file=sys.stderr)
                os._exit(127)
        os._exit(0)  # child exits, grandchild orphaned to init
    _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    raise SystemExit(main())
