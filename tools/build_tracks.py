#!/usr/bin/env python3
"""Convert dense GPX tracks to lightweight GeoJSON for the Aurora website.

The source GPX is never modified. Each track segment is simplified using
Ramer-Douglas-Peucker with a tolerance expressed in metres.
"""

from __future__ import annotations

import argparse
import json
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
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
    time: str | None = None


def haversine_m(a: Point, b: Point) -> float:
    lat1, lat2 = math.radians(a.lat), math.radians(b.lat)
    dlat = lat2 - lat1
    dlon = math.radians(b.lon - a.lon)
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def planar_xy(point: Point, lat0_rad: float) -> tuple[float, float]:
    x = EARTH_RADIUS_M * math.radians(point.lon) * math.cos(lat0_rad)
    y = EARTH_RADIUS_M * math.radians(point.lat)
    return x, y


def point_segment_distance_m(point: Point, start: Point, end: Point, lat0_rad: float) -> float:
    px, py = planar_xy(point, lat0_rad)
    ax, ay = planar_xy(start, lat0_rad)
    bx, by = planar_xy(end, lat0_rad)
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def rdp(points: list[Point], tolerance_m: float) -> list[Point]:
    if len(points) <= 2 or tolerance_m <= 0:
        return points[:]
    lat0 = math.radians(sum(p.lat for p in points) / len(points))

    keep = {0, len(points) - 1}
    stack = [(0, len(points) - 1)]
    while stack:
        start_idx, end_idx = stack.pop()
        start, end = points[start_idx], points[end_idx]
        max_distance = -1.0
        max_idx = None
        for idx in range(start_idx + 1, end_idx):
            distance = point_segment_distance_m(points[idx], start, end, lat0)
            if distance > max_distance:
                max_distance = distance
                max_idx = idx
        if max_idx is not None and max_distance > tolerance_m:
            keep.add(max_idx)
            stack.append((start_idx, max_idx))
            stack.append((max_idx, end_idx))
    return [points[idx] for idx in sorted(keep)]


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_gpx(path: Path) -> list[tuple[str, list[Point]]]:
    root = ET.parse(path).getroot()
    tracks: list[tuple[str, list[Point]]] = []

    for trk_index, trk in enumerate((el for el in root.iter() if local_name(el.tag) == "trk"), start=1):
        name = next((el.text.strip() for el in trk if local_name(el.tag) == "name" and el.text), None)
        base_name = name or path.stem.replace("_", " ").replace("-", " ").title()
        segments = [el for el in trk if local_name(el.tag) == "trkseg"]
        for seg_index, segment in enumerate(segments, start=1):
            points = []
            for trkpt in segment:
                if local_name(trkpt.tag) != "trkpt":
                    continue
                time = next((el.text.strip() for el in trkpt if local_name(el.tag) == "time" and el.text), None)
                points.append(Point(float(trkpt.attrib["lat"]), float(trkpt.attrib["lon"]), time))
            if points:
                suffix = f" · segment {seg_index}" if len(segments) > 1 else ""
                tracks.append((base_name + suffix, points))

    if not tracks:
        for rte_index, rte in enumerate((el for el in root.iter() if local_name(el.tag) == "rte"), start=1):
            name = next((el.text.strip() for el in rte if local_name(el.tag) == "name" and el.text), None)
            points = []
            for rtept in rte:
                if local_name(rtept.tag) != "rtept":
                    continue
                time = next((el.text.strip() for el in rtept if local_name(el.tag) == "time" and el.text), None)
                points.append(Point(float(rtept.attrib["lat"]), float(rtept.attrib["lon"]), time))
            if points:
                tracks.append((name or f"{path.stem} route {rte_index}", points))
    return tracks


def parse_time(value: str | None) -> str | None:
    if not value:
        return None
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    except ValueError:
        return value


def build_feature(name: str, points: list[Point], tolerance_m: float, source: Path) -> dict:
    simplified = rdp(points, tolerance_m)
    distance_m = sum(haversine_m(a, b) for a, b in zip(points, points[1:]))
    timed = [p.time for p in points if p.time]
    return {
        "type": "Feature",
        "properties": {
            "name": name,
            "source": source.name,
            "start": parse_time(timed[0]) if timed else None,
            "end": parse_time(timed[-1]) if timed else None,
            "distance_nm": round(distance_m / NM_M, 2),
            "original_points": len(points),
            "simplified_points": len(simplified),
            "tolerance_m": tolerance_m,
        },
        "geometry": {
            "type": "LineString",
            "coordinates": [[round(p.lon, 6), round(p.lat, 6)] for p in simplified],
        },
    }


def gpx_files(paths: Iterable[str]) -> list[Path]:
    explicit = [Path(p).expanduser().resolve() for p in paths]
    if explicit:
        return explicit
    return sorted(SOURCE.glob("*.gpx"))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", help="Optional GPX files; defaults to tracks/source/*.gpx")
    parser.add_argument("--tolerance", type=float, default=20.0, help="RDP simplification tolerance in metres (default: 20)")
    args = parser.parse_args()

    features = []
    for path in gpx_files(args.files):
        if not path.exists():
            raise SystemExit(f"Missing GPX file: {path}")
        for name, points in parse_gpx(path):
            features.append(build_feature(name, points, max(0.0, args.tolerance), path))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    original = sum(f["properties"]["original_points"] for f in features)
    simplified = sum(f["properties"]["simplified_points"] for f in features)
    print(f"Wrote {len(features)} track segments to {OUTPUT.relative_to(ROOT)}: {original} points -> {simplified} points")


if __name__ == "__main__":
    main()
