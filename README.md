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

Put browser-friendly media under `media/gallery/`, preferably grouped by category:

```text
media/gallery/
  01-under-sail/
  02-exterior/
  03-deck-cockpit/
  04-interior/
  05-engine-systems/
  06-rig-sails/
  07-underwater-hull/
  08-voyages/
```

Then run:

```bash
python3 tools/build_gallery.py
```

The script writes `data/gallery-data.js`, which drives gallery filters and the full-screen viewer.

## Add GPX voyages

Keep original GPX files in `tracks/source/` and generate a lighter web representation:

```bash
python3 tools/build_tracks.py --tolerance 20
```

The script calculates distance and elapsed time from the original geometry, derives a position for 12:00 UTC on every recorded day, and simplifies only the published line with Ramer-Douglas-Peucker. A tolerance around `15–30 m` is a useful starting point for dense Navionics tracks. The source GPX is never modified.

When timestamps are available, the voyage list shows the date range, distance and elapsed time. Selecting a voyage reveals its start, finish, UTC noon positions and a small number of direction arrows. These marks are derived only from the GPX; the site does not infer weather, engine use, sail use or the reasons behind course changes.

Each published voyage also links to `voyage-card.html`, an export view that uses the same GeoJSON. Choose an article (`1600×1000`), portrait (`1200×1500`) or widescreen (`1920×1080`) format and download a PNG for a blog post or preview image. The export runs entirely in the browser; keep the page open until the map tiles have loaded.

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
