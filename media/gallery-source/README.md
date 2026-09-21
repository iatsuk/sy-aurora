# Private gallery source

This directory is the local staging area for camera originals. Everything here
except this README is ignored by Git and must be backed up somewhere else.

Use exactly one of these top-level categories:

1. `01-overview/` — whole-boat views: profile, berth, anchor, hauled out.
2. `02-underway/` — Aurora moving under sail or engine, sea-going activity.
3. `03-deck-cockpit/` — deck, cockpit, helm and general deck layout.
4. `04-rig-sails/` — mast, boom, standing/running rigging, furling and sails.
5. `05-interior/` — saloon, berths, galley and the living interior.
6. `06-storage-service-spaces/` — lockers, lazarette, bilge, anchor locker,
   spaces below sole boards and behind access panels.
7. `07-machinery-systems/` — engine, fuel, batteries, electrical, pumps,
   plumbing, electronics and other installed equipment.
8. `08-hull-underwater/` — hull below the waterline, keel, rudder, propeller,
   shaft, through-hulls and antifouling.

Classify a photo by **what it documents**, not everything visible in the frame.
For example, an open anchor locker belongs in Storage and service spaces; a
close-up of the anchor/chain/windlass as equipment belongs in Machinery and
systems; a general foredeck view belongs in Deck and cockpit.

Optional subfolders below a category are treated as album/voyage context:

```text
media/gallery-source/
  02-underway/
    2026-skagerrak/
      DSC01234.ARW
      DSC01235.JPG
```

The category remains `Underway`; `2026-skagerrak` is preserved in the
manifest as album metadata instead of becoming a competing gallery category.

Install dependencies once:

```bash
python3 -m pip install -r tools/gallery-requirements.txt
```

Validate originals without touching published files:

```bash
python3 tools/build_gallery.py --check
```

Build the public gallery:

```bash
python3 tools/build_gallery.py
```

The builder supports JPEG/PNG/WebP/TIFF, HEIC/HEIF/HIF and common RAW formats
(ARW, CR2, CR3, DNG, NEF, ORF, RAF, RW2). Images are EXIF-oriented, converted
to sRGB and published as WebP thumbnails (900 px long edge) plus fullscreen
images (2200 px long edge). Published image files do not retain EXIF/GPS
metadata.

Browser-ready MP4/WebM/OGV videos may also be placed in the category folders;
they are copied as-is and are not transcoded.
