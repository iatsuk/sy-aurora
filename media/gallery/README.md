# Aurora gallery media

Place public photos and videos here, preferably in category folders such as:

- `01-under-sail/`
- `02-exterior/`
- `03-deck-cockpit/`
- `04-interior/`
- `05-engine-systems/`
- `06-rig-sails/`
- `07-underwater-hull/`
- `08-voyages/`

Then run:

```bash
python3 tools/build_gallery.py
```

The script writes `data/gallery-data.js`, which is loaded by the static site.

Supported browser-friendly formats: JPG/JPEG, PNG, WebP, AVIF, MP4, WebM and OGV. Convert HEIC/HIF camera originals before publishing them; this intentionally keeps the site build dependency-free.
