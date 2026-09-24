#!/usr/bin/env python3
"""Local plain-HTTP CONNECT relay -> gost HTTPS proxy (a996d235.acsnet.co:443).

ffmpeg cannot speak to an HTTPS-only proxy directly, but it CAN use a plain
http_proxy for https:// input URLs (CONNECT tunnel + TLS inside). This relay
accepts plain HTTP CONNECT on 127.0.0.1:8128 and forwards the tunnel through
TLS to the gost proxy with Basic auth.
"""
import base64
import socket
import ssl
import sys
import threading

LISTEN_HOST, LISTEN_PORT = '127.0.0.1', 8128
REMOTE_HOST, REMOTE_PORT = 'a996d235.acsnet.co', 443
AUTH = base64.b64encode(b'testuser1:e4b72b531a2d10900519').decode()

log = lambda msg: print(f'[relay] {msg}', file=sys.stderr, flush=True)


def pump(a, b):
    try:
        while True:
            data = a.recv(65536)
            if not data:
                break
            b.sendall(data)
    except Exception:
        pass
    try:
        b.shutdown(socket.SHUT_WR)
    except Exception:
        pass


def handle(client: socket.socket):
    try:
        client.settimeout(90)
        data = b''
        while b'\r\n\r\n' not in data:
            chunk = client.recv(4096)
            if not chunk:
                return
            data += chunk
        first = data.split(b'\r\n')[0].decode('latin-1')
        parts = first.split()
        if len(parts) < 2 or parts[0].upper() != 'CONNECT':
            client.sendall(b'HTTP/1.1 405 Method Not Allowed\r\n\r\n')
            return
        target = parts[1]

        ctx = ssl.create_default_context()
        upstream = socket.create_connection((REMOTE_HOST, REMOTE_PORT), timeout=30)
        tls = ctx.wrap_socket(upstream, server_hostname=REMOTE_HOST)
        tls.settimeout(90)
        req = (
            f'CONNECT {target} HTTP/1.1\r\n'
            f'Host: {target}\r\n'
            f'Proxy-Authorization: Basic {AUTH}\r\n'
            f'Proxy-Connection: keep-alive\r\n\r\n'
        )
        tls.sendall(req.encode())
        resp = b''
        while b'\r\n\r\n' not in resp:
            chunk = tls.recv(4096)
            if not chunk:
                break
            resp += chunk
        status_line = resp.split(b'\r\n')[0]
        if b' 200 ' not in status_line:
            log(f'upstream CONNECT failed for {target}: {status_line!r}')
            client.sendall(resp or b'HTTP/1.1 502 Bad Gateway\r\n\r\n')
            return
        client.sendall(b'HTTP/1.1 200 Connection established\r\n\r\n')
        client.settimeout(None)
        t = threading.Thread(target=pump, args=(tls, client), daemon=True)
        t.start()
        pump(client, tls)
        t.join(timeout=2)
        tls.close()
    except Exception as exc:  # noqa: BLE001
        log(f'error: {exc!r}')
    finally:
        try:
            client.close()
        except Exception:
            pass


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind((LISTEN_HOST, LISTEN_PORT))
    srv.listen(64)
    log(f'listening on {LISTEN_HOST}:{LISTEN_PORT} -> tls://{REMOTE_HOST}:{REMOTE_PORT}')
    while True:
        client, _addr = srv.accept()
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == '__main__':
    main()
