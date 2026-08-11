# S/Y Aurora

Static GitHub Pages site for **S/Y Aurora**, a 1972 Great Dane 28, hull and sail no. **165**.

The site is a long-term boat archive rather than a sale page. It documents the Great Dane 28 design and its Scandinavian context, the known history of hull 165, maintenance and upgrades, photographs and video, GPX voyage tracks, radio identifiers and live-position links.

## Site sections

- Great Dane 28 origins: Klaus Baess, Aage Utzon, Folkboat and Sisu/spidsgatter lineage
- design philosophy and technical specifications
- comparisons with Laurin 28, Storfidra, Vindö 32, Hallberg-Rassy Monsun and Albin Vega
- transition from the previous Ohlson 29 Rassvet
- Aurora hull 165 history (including the documented former name `Katinka`)
- maintenance and refit timeline
- interactive voyage map built from GPX tracks
- image/video gallery
- Garmin inReach MapShare embed and MarineTraffic / Telegram links
- primary historical sources and useful Great Dane links

The site uses plain HTML, CSS and JavaScript. There is no application server, database, build framework or analytics dependency.

## Preview locally

Serve the repository over HTTP because the voyage archive is loaded with `fetch()`:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Add photographs and videos

Put browser-friendly media under `media/gallery/`. Category folders are recommended:

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

Then rebuild the manifest:

```bash
python3 tools/build_gallery.py
```

This scans JPG/JPEG, PNG, WebP, AVIF, MP4, WebM and OGV files and writes `data/gallery-data.js`. The website then renders filters, thumbnails/video previews and a full-screen viewer automatically.

HEIC/HIF should be converted before publishing; keeping the public assets browser-native avoids requiring an image-processing toolchain on GitHub Pages.

## Add GPX voyages

Keep original GPX files in `tracks/source/` and generate a light web representation:

```bash
python3 tools/build_tracks.py --tolerance 20
```

The script:

1. reads GPX tracks (and routes as a fallback);
2. calculates distance from the original points;
3. keeps original start/end timestamps when present;
4. simplifies geometry with Ramer-Douglas-Peucker;
5. writes `data/tracks.geojson` for Leaflet.

The tolerance is in metres. Dense Navionics tracks normally do not need every recorded point at passage-map zoom levels; `15–30 m` is a sensible starting range. The GPX source is never changed.

## Live position

The page embeds Garmin MapShare directly:

```text
https://share.garmin.com/AS424
```

Garmin officially supports MapShare embedding in third-party pages. For a future custom map, Garmin also publishes an inReach KML feed for enabled MapShare accounts.

AIS currently links to the MarineTraffic record associated with MMSI `218032280`. During the transfer of the radio licence, external AIS databases may still show the previous vessel name until their records update.

Current identifiers shown on the site:

- Call sign: `DJ2996`
- MMSI: `218032280`
- ATIS: `9211102996`

## Historical data policy

The Great Dane 28 surviving records are valuable but not perfectly consistent. The site therefore:

- describes displacement as **about 4 t**, while noting published values around 3.85–4.2 t;
- treats the owners' register as incomplete;
- records only supported hull-165 history points rather than inventing continuous ownership;
- links the primary source pages used for the historical narrative and comparisons.

Known hull-165 points currently included:

- 1972: Great Dane 28 hull/sail no. 165;
- 2009 public record: `Katinka`, John Mathiesen, Dragør;
- later Great Dane Owners' Club register: `Aurora`, Jørn & Alena Kragh, Vallensbæk Havn;
- 2026: purchased by the present owner and the name `Aurora` retained.

## Deployment

The repository is intended for GitHub Pages from the root of `main`. No `CNAME` is included yet, so it can initially use the normal `iatsuk.github.io/sy-aurora` project URL.
