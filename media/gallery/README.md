# Generated Aurora gallery media

This directory contains **public generated assets** used by GitHub Pages.

Do not put camera originals here. Keep originals locally under
`media/gallery-source/`, then run:

```bash
python3 tools/build_gallery.py --check
python3 tools/build_gallery.py
```

For each source image the builder creates:

- a WebP thumbnail, maximum 900 px on the long edge;
- a WebP fullscreen image, maximum 2200 px on the long edge.

These generated files and `data/gallery-data.js` should be committed. Camera
originals under `media/gallery-source/` are intentionally ignored by Git.
