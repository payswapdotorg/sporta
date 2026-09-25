#!/bin/bash
cd /home/z/spr-w3c-work
URL=$(cat url-140.txt)
for i in $(seq 1 40); do
  curl -s -C - -m 3600 -x http://127.0.0.1:8128 -o audio-140-5.m4a "$URL" && break
  sleep 3
done
echo "size=$(stat -c%s audio-140-5.m4a 2>/dev/null)" > audio-140-5.done
sha256sum audio-140-5.m4a >> audio-140-5.done
