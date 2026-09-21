# S/Y Aurora

Static GitHub Pages site for **S/Y Aurora**, a 1972 Great Dane 28, hull and sail no. **165**.

The site is a long-term boat archive rather than a sale page. It prioritises the living record of the yacht — current position, ownership, refit work, voyages and media — while keeping the Great Dane 28 design history and comparisons as reference material lower on the page.

## Site sections

1. live / latest known position (AIS first, Garmin inReach as an offshore alternative)
2. Aurora hull 165 ownership history and current equipment
3. maintenance and refit timeline
4. interactive voyage map built from GPX tracks
5. image/video gallery
6. transition from the previous Ohlson 29 Rassvet
7. Great Dane 28 origins, philosophy, specifications and Scandinavian comparisons
8. curated historical sources and useful links

The site uses plain HTML, CSS and JavaScript. There is no application server, database, build framework or analytics dependency.

## Preview locally

Serve the repository over HTTP because the voyage archive is loaded with `fetch()`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Add photographs and videos

Camera originals live locally under `media/gallery-source/` and are ignored by
Git. The generated public WebP assets live under `media/gallery/` and are
committed.

The gallery uses one classification rule: **the category describes what the
photo documents**. Voyage/time context can be represented by an optional nested
album folder instead of becoming a second category.

```text
media/gallery-source/
  01-overview/
  02-underway/
    2026-skagerrak/
  03-deck-cockpit/
  04-rig-sails/
  05-interior/
  06-storage-service-spaces/
  07-machinery-systems/
  08-hull-underwater/
```

Install the image dependencies once:

```bash
python3 -m pip install -r tools/gallery-requirements.txt
```

Check camera originals before generating anything:

```bash
python3 tools/build_gallery.py --check
```

Then build:

```bash
python3 tools/build_gallery.py
```

The builder supports common JPEG/PNG/TIFF/HEIC and RAW camera files, applies
EXIF orientation, converts to sRGB and removes EXIF/GPS metadata from published
images. It generates a 900 px WebP thumbnail and a 2200 px WebP fullscreen
asset for each photo, then writes `data/gallery-data.js`. Generated gallery
assets and the manifest should be committed; camera originals should not.

Browser-ready MP4/WebM/OGV files can also be staged in the same category tree
and are copied as-is. See `media/gallery-source/README.md` for category
definitions and examples.

## Add GPX voyages

Keep original GPX files under `tracks/source/`. A flat directory still works, but grouping passages by year and voyage gives the website a much better archive structure:

```text
tracks/source/
  2026/
    denmark-delivery/
      Kiel - Sønderborg.gpx
      Sønderborg - Marstal.gpx
    skagerrak/
      Grenaa - Læsø.gpx
      Læsø - Malmön.gpx
```

Install the offline timezone lookup dependency once:

```bash
python3 -m pip install -r tools/track-requirements.txt
```

Generate the lighter web representation with:

```bash
python3 tools/build_tracks.py --tolerance 20
```

The script calculates distance from the original geometry, preserves separate GPX segments rather than drawing false lines across recording gaps, keeps available start/end times, duration and daily noon marks, stores the IANA timezone at both the start and finish coordinates (`start_timezone` / `end_timezone`), and simplifies only the published geometry with Ramer-Douglas-Peucker. Folder names become voyage groups in the map, while years become filters. A tolerance around `15–30 m` is a useful starting point for dense Navionics tracks. The source GPX is never modified.

If no private GPX source files are present, the builder leaves the existing published GeoJSON unchanged rather than replacing it with an empty archive.

### Export a voyage image

A small share/export icon at the end of each leg's metadata line opens
`voyage-card.html`. The exporter reads the same committed
`data/tracks.geojson` as the main atlas; rendered PNG files are never stored in
the repository.

The exporter can render three scopes:

- **Leg** — the selected GPX leg only.
- **Range** — a contiguous range of neighbouring legs within the same voyage.
- **Whole voyage** — every leg with the same `voyage_id`.

The format buttons are ordered portrait-first:

- **1200 × 1500** portrait
- **1600 × 1000** article landscape
- **1920 × 1080** widescreen

The card includes the selected route geometry, start and finish, available
12:00 UTC marks, direction arrows, the date range, **local start time at the departure
position**, recorded distance, recorded duration and average speed. For a range or whole voyage,
distance and recorded durations are summed across the selected legs; average
speed is calculated from those recorded durations, so time spent between GPX
legs is not counted as underway time.

Local time is formatted from the IANA `start_timezone` stored in GeoJSON, so
historical daylight-saving rules are applied by the browser instead of using the
viewer's current timezone or a fixed UTC offset. Existing Aurora delivery legs
are tagged with `Europe/Copenhagen` or `Europe/Berlin` as appropriate.

The route overlay is drawn into a dedicated canvas above the Leaflet tiles and
the same card DOM is used for both preview and PNG capture. This avoids the
SVG-transform offset that can occur when html2canvas captures Leaflet vector
paths. The export page intentionally does not apply a CSS colour filter to map
tiles, so the browser preview and downloaded image use the same map styling.

Run the site through an HTTP server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/voyage-card.html` or use the share/export icon
in the voyage atlas.

## Live position

The page currently uses a VesselFinder AIS embed for MMSI `218032280` and links to MarineTraffic as a second public AIS source. Garmin MapShare remains available at `https://share.garmin.com/AS424` for satellite tracking when AIS coverage is absent.

Current identifiers:

- Call sign: `DJ2996`
- MMSI: `218032280`
- ATIS: `9211102996`

During the radio-licence transfer, external AIS databases may temporarily continue to show the previous vessel name.

## Hull 165 ownership record used on the site

- **1972 – June 2022:** `Katinka II`, Lene & John Mathiesen, Copenhagen, Denmark
- **June 2022 – July 2026:** `Aurora`, Jørn & Alena Kragh, Copenhagen, Denmark
- **July 2026 – present:** `Aurora`, Andrei Iatsuk, Kiel, Germany

## Historical data policy

Surviving Great Dane 28 sources are useful but not perfectly consistent. The site therefore uses approximate language where appropriate — for example **about 4 t** displacement — and keeps a small curated source list rather than presenting every secondary database as equally useful.

## Deployment

The repository is intended for GitHub Pages from the root of `main`. No custom `CNAME` is included yet.
