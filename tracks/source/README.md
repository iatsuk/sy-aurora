# Source GPX tracks

Put original Navionics or other GPX track files in this folder. The originals are never modified.

Build the web map with:

```bash
python3 tools/build_tracks.py --tolerance 20
```

`--tolerance` is the Ramer-Douglas-Peucker simplification tolerance in metres. A value around 15–30 m is usually a good starting point for dense Navionics tracks viewed at passage scale.

The generated `data/tracks.geojson` contains simplified geometry plus distance, dates and point counts and should be committed with the GPX additions.
