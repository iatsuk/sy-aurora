#!/usr/bin/env python3
"""Build a lightweight voyage atlas from Aurora GPX recordings.

Original GPX files are never modified. Published geometry is simplified with
Ramer-Douglas-Peucker while timing, segment gaps and useful voyage metadata are
kept in the generated GeoJSON.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tracks" / "source"
OUTPUT = ROOT / "data" / "tracks.geojson"
EARTH_RADIUS_M = 6_371_008.8
NM_M = 1852.0


@dataclass(frozen=True)
class Point:
    lat: float
    lon: float
    timestamp: str | None = None


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def haversine_m(a: Point, b: Point) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(value)))


def cumulative_distances(points: list[Point]) -> list[float]:
    distances = [0.0]
    for previous, current in zip(points, points[1:]):
        distances.append(distances[-1] + haversine_m(previous, current))
    return distances


def planar_xy(point: Point, latitude_origin: float) -> tuple[float, float]:
    return (
        EARTH_RADIUS_M * math.radians(point.lon) * math.cos(latitude_origin),
        EARTH_RADIUS_M * math.radians(point.lat),
    )


def point_segment_distance(point: Point, start: Point, end: Point, latitude_origin: float) -> float:
    px, py = planar_xy(point, latitude_origin)
    ax, ay = planar_xy(start, latitude_origin)
    bx, by = planar_xy(end, latitude_origin)
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    amount = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + amount * dx), py - (ay + amount * dy))


def simplify(points: list[Point], tolerance_m: float) -> list[Point]:
    if len(points) <= 2 or tolerance_m <= 0:
        return points[:]
    latitude_origin = math.radians(sum(point.lat for point in points) / len(points))
    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start_index, end_index = stack.pop()
        furthest_index = None
        furthest_distance = -1.0
        for index in range(start_index + 1, end_index):
            distance = point_segment_distance(points[index], points[start_index], points[end_index], latitude_origin)
            if distance > furthest_distance:
                furthest_index, furthest_distance = index, distance
        if furthest_index is not None and furthest_distance > tolerance_m:
            keep.add(furthest_index)
            stack.extend(((start_index, furthest_index), (furthest_index, end_index)))
    return [points[index] for index in sorted(keep)]


def parse_points(container: ET.Element, point_tag: str) -> list[Point]:
    points = []
    for element in container:
        if local_name(element.tag) != point_tag:
            continue
        timestamp = next(
            (child.text.strip() for child in element if local_name(child.tag) == "time" and child.text),
            None,
        )
        points.append(Point(float(element.attrib["lat"]), float(element.attrib["lon"]), timestamp))
    return points


def parse_gpx(path: Path) -> list[list[Point]]:
    """Return all recorded segments while preserving gaps between them."""
    root = ET.parse(path).getroot()
    segments = [
        points
        for segment in (element for element in root.iter() if local_name(element.tag) == "trkseg")
        if len(points := parse_points(segment, "trkpt")) >= 2
    ]
    if segments:
        return segments
    return [
        points
        for route in (element for element in root.iter() if local_name(element.tag) == "rte")
        if len(points := parse_points(route, "rtept")) >= 2
    ]


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_utc(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def timing(segments: list[list[Point]]) -> tuple[str | None, str | None, float | None, list[dict]]:
    timed: list[tuple[int, Point, datetime, float]] = []
    total_distance = 0.0
    for segment_index, points in enumerate(segments):
        distances = cumulative_distances(points)
        for point, distance in zip(points, distances):
            if parsed := parse_datetime(point.timestamp):
                timed.append((segment_index, point, parsed, total_distance + distance))
        total_distance += distances[-1]
    if not timed:
        return None, None, None, []

    start, end = timed[0][2], timed[-1][2]
    duration = round((end - start).total_seconds() / 3600, 2) if end >= start else None
    intervals = [
        (current[2] - previous[2]).total_seconds()
        for previous, current in zip(timed, timed[1:])
        if current[0] == previous[0] and current[2] > previous[2]
    ]
    maximum_gap = min(max((statistics.median(intervals) if intervals else 0) * 6, 3600), 21600)
    marks = []
    target_time = datetime.combine(start.date(), time(hour=12), tzinfo=timezone.utc)
    if target_time <= start:
        target_time += timedelta(days=1)
    while target_time < end:
        for previous, current in zip(timed, timed[1:]):
            previous_segment, previous_point, previous_time, previous_distance = previous
            current_segment, current_point, current_time, current_distance = current
            if previous_segment != current_segment or not previous_time <= target_time <= current_time:
                continue
            interval = (current_time - previous_time).total_seconds()
            if interval <= 0 or interval > maximum_gap:
                break
            fraction = (target_time - previous_time).total_seconds() / interval
            longitude_delta = (current_point.lon - previous_point.lon + 180) % 360 - 180
            marks.append({
                "time": format_utc(target_time),
                "coordinates": [
                    round((previous_point.lon + longitude_delta * fraction + 180) % 360 - 180, 6),
                    round(previous_point.lat + (current_point.lat - previous_point.lat) * fraction, 6),
                ],
                "distance_nm": round((previous_distance + fraction * (current_distance - previous_distance)) / NM_M, 2),
            })
            break
        target_time += timedelta(days=1)
    return format_utc(start), format_utc(end), duration, marks


def display_name(path: Path) -> str:
    name = re.sub(r"^\d{4}[.-]\d{2}[.-]\d{2}\s*[-–—]?\s*", "", path.stem).strip()
    name = re.sub(r"\s+", " ", name)
    name = re.sub(r"\s+[-–—]\s+", " – ", name)
    return name or path.stem


def title_from_slug(value: str) -> str:
    return re.sub(r"[-_]+", " ", value).strip().title() or "Voyages"


def build_feature(segments: list[list[Point]], tolerance_m: float, source: Path) -> dict:
    relative_source = source.relative_to(SOURCE).as_posix() if source.is_relative_to(SOURCE) else source.name
    path_parts = Path(relative_source).parts
    start, end, duration, day_marks = timing(segments)
    start_year = start[:4] if start and re.fullmatch(r"20\d{2}", start[:4]) else None
    year = path_parts[0] if path_parts and re.fullmatch(r"20\d{2}", path_parts[0]) else start_year

    voyage_slug = path_parts[1] if year and len(path_parts) > 2 else None
    voyage_id = f"{year}/{voyage_slug}" if voyage_slug else f"{year or 'undated'}/other"
    voyage_title = title_from_slug(voyage_slug) if voyage_slug else (f"{year} voyages" if year else "Other voyages")

    distance_m = sum(cumulative_distances(points)[-1] for points in segments)
    published = [simplify(points, tolerance_m) for points in segments]
    coordinates = [
        [[round(point.lon, 6), round(point.lat, 6)] for point in points]
        for points in published
    ]
    geometry = {
        "type": "LineString" if len(coordinates) == 1 else "MultiLineString",
        "coordinates": coordinates[0] if len(coordinates) == 1 else coordinates,
    }
    return {
        "type": "Feature",
        "properties": {
            "name": display_name(source),
            "source": relative_source,
            "year": year,
            "voyage_id": voyage_id,
            "voyage_title": voyage_title,
            "start": start,
            "end": end,
            "distance_nm": round(distance_m / NM_M, 2),
            "duration_hours": duration,
            "day_marks": day_marks,
            "segment_count": len(segments),
            "original_points": sum(len(points) for points in segments),
            "simplified_points": sum(len(points) for points in published),
            "tolerance_m": tolerance_m,
        },
        "geometry": geometry,
    }


def source_files(arguments: Iterable[str]) -> list[Path]:
    explicit = [Path(value).expanduser().resolve() for value in arguments]
    return explicit or sorted(SOURCE.rglob("*.gpx"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="Optional GPX files; defaults to tracks/source/**/*.gpx")
    parser.add_argument("--tolerance", type=float, default=20.0, help="Simplification tolerance in metres")
    arguments = parser.parse_args()
    paths = source_files(arguments.files)
    if not paths:
        print("No private GPX source files found; existing published GeoJSON was left unchanged.")
        return

    features = []
    for path in paths:
        if not path.exists():
            raise SystemExit(f"Missing GPX file: {path}")
        segments = parse_gpx(path)
        if not segments:
            print(f"Skipping empty GPX file: {path.relative_to(ROOT)}")
            continue
        features.append(build_feature(segments, max(0.0, arguments.tolerance), path))

    collection = {
        "type": "FeatureCollection",
        "properties": {
            "track_count": len(features),
            "voyage_count": len({feature["properties"]["voyage_id"] for feature in features}),
            "distance_nm": round(sum(feature["properties"]["distance_nm"] for feature in features), 1),
        },
        "features": features,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(collection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {len(features)} GPX legs / {collection['properties']['distance_nm']:.1f} nm "
        f"to {OUTPUT.relative_to(ROOT)}"
    )


if __name__ == "__main__":
    main()
