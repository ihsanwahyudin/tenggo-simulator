#!/bin/sh
# Mengubah denah SVG menjadi PNG memakai Chrome tanpa jendela.
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in lantai-5 lantai-4 lantai-3 lantai-2 lantai-1 lantai-0; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1.5 \
    --window-size=1108,646 --screenshot="$PWD/$f.png" "file://$PWD/$f.svg" >/dev/null 2>&1
done
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1.5 \
  --window-size=840,404 --screenshot="$PWD/potongan-gedung.png" "file://$PWD/potongan-gedung.svg" >/dev/null 2>&1
ls -la *.png
