#!/bin/bash
# Parallel ranged download of the itag-140-5 audio through the relay.
# Long-lived single connections are throttled ~4KB/s after the first burst;
# fresh ranged CONNECTs burst at ~500KB/s. 8 workers x 2MiB chunks.
cd /home/z/spr-w3c-work
URL=$(cat url-140.txt)
TOTAL=106666323
CHUNK=2097152
NCHUNKS=$(( (TOTAL + CHUNK - 1) / CHUNK ))
mkdir -p .audio-parts
fetch_chunk() {
  i=$1
  start=$(( i * CHUNK ))
  end=$(( start + CHUNK - 1 ))
  if [ $end -ge $TOTAL ]; then end=$(( TOTAL - 1 )); fi
  want=$(( end - start + 1 ))
  f=.audio-parts/part_$(printf "%05d" $i).bin
  for try in 1 2 3 4 5 6; do
    sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
    [ "$sz" = "$want" ] && return 0
    rm -f "$f"
    curl -s -m 300 -x http://127.0.0.1:8128 -r "$start-$end" -o "$f" "$URL"
    sleep 1
  done
  sz=$(stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$sz" = "$want" ] && return 0
  echo "chunk $i FAILED (got $sz want $want)" >> .audio-parts/failures
  return 1
}
export -f fetch_chunk
export URL TOTAL CHUNK
seq 0 $(( NCHUNKS - 1 )) | xargs -P 8 -I{} bash -c 'fetch_chunk {}'
if [ -f .audio-parts/failures ]; then echo "FAILURES PRESENT" > audio-140-5.done; exit 1; fi
cat .audio-parts/part_*.bin > audio-140-5.m4a
sz=$(stat -c%s audio-140-5.m4a)
if [ "$sz" = "$TOTAL" ]; then
  rm -rf .audio-parts
  echo "size=$sz" > audio-140-5.done
  sha256sum audio-140-5.m4a >> audio-140-5.done
else
  echo "size=$sz expected=$TOTAL" > audio-140-5.done
fi
