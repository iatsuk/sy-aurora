#!/usr/bin/env python3
"""Validate camera originals and build privacy-safe Aurora gallery assets."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageCms, ImageOps
except ImportError as exc:  # pragma: no cover - user-facing dependency guard
    raise SystemExit(
        "Missing Pillow. Install gallery dependencies with: "
        "python3 -m pip install -r tools/gallery-requirements.txt"
    ) from exc

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = ROOT / "media" / "gallery-source"
OUTPUT_ROOT = ROOT / "media" / "gallery"
MANIFEST_PATH = ROOT / "data" / "gallery-data.js"

CATEGORIES = [
    ("01-overview", "Overview"),
    ("02-underway", "Underway"),
    ("03-deck-cockpit", "Deck and cockpit"),
    ("04-rig-sails", "Rig and sails"),
    ("05-interior", "Interior"),
    ("06-storage-service-spaces", "Storage and service spaces"),
    ("07-machinery-systems", "Machinery and systems"),
    ("08-hull-underwater", "Hull and underwater"),
]
CATEGORY_LABELS = dict(CATEGORIES)
CATEGORY_ORDER = {folder: index for index, (folder, _) in enumerate(CATEGORIES, start=1)}

RASTER_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}
HEIF_EXTENSIONS = {".heic", ".heif", ".hif"}
RAW_EXTENSIONS = {".arw", ".cr2", ".cr3", ".dng", ".nef", ".orf", ".raf", ".rw2"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".ogv"}
SUPPORTED_EXTENSIONS = RASTER_EXTENSIONS | HEIF_EXTENSIONS | RAW_EXTENSIONS | VIDEO_EXTENSIONS
CAMERA_NAME = re.compile(r"^(?:_?dsc|img|image|p|pxl|r|sam)[-_ ]?\d+", re.IGNORECASE)
LEADING_DATE = re.compile(r"^\d{4}[.-]\d{2}[.-]\d{2}[\s_-]*")
NON_WORD = re.compile(r"[^a-zA-Z0-9]+")
NATURAL_PARTS = re.compile(r"(\d+)")


class GalleryError(RuntimeError):
    pass


def natural_key(value: str | Path) -> list[object]:
    text = value.name if isinstance(value, Path) else value
    return [int(part) if part.isdigit() else part.casefold() for part in NATURAL_PARTS.split(text)]


def humanize(value: str) -> str:
    value = LEADING_DATE.sub("", value)
    value = re.sub(r"[-_]+", " ", value).strip()
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    return NON_WORD.sub("-", value).strip("-").lower() or "photo"


def load_optional_dependencies(paths: list[Path]) -> None:
    if any(path.suffix.lower() in HEIF_EXTENSIONS for path in paths):
        try:
            from pillow_heif import register_heif_opener
        except ImportError as exc:
            raise GalleryError(
                "HEIC/HEIF files found, but pillow-heif is not installed. Run: "
                "python3 -m pip install -r tools/gallery-requirements.txt"
            ) from exc
        register_heif_opener(thumbnails=False)

    if any(path.suffix.lower() in RAW_EXTENSIONS for path in paths):
        try:
            import rawpy  # noqa: F401
        except ImportError as exc:
            raise GalleryError(
                "RAW files found, but rawpy is not installed. Run: "
                "python3 -m pip install -r tools/gallery-requirements.txt"
            ) from exc


def source_files() -> list[Path]:
    SOURCE_ROOT.mkdir(parents=True, exist_ok=True)
    files = []
    for path in SOURCE_ROOT.rglob("*"):
        if not path.is_file() or path.name.startswith(".") or path.name.lower() == "readme.md":
            continue
        files.append(path)
    return sorted(
        files,
        key=lambda path: [natural_key(part) for part in path.relative_to(SOURCE_ROOT).parts],
    )


def category_for(path: Path) -> tuple[str, str]:
    relative = path.relative_to(SOURCE_ROOT)
    if len(relative.parts) < 2:
        raise GalleryError(f"{relative}: put each file inside one of the numbered category folders")
    folder = relative.parts[0]
    if folder not in CATEGORY_LABELS:
        valid = ", ".join(folder for folder, _ in CATEGORIES)
        raise GalleryError(f"{relative}: unknown category '{folder}'. Expected one of: {valid}")
    return folder, CATEGORY_LABELS[folder]


def album_for(path: Path) -> str | None:
    relative = path.relative_to(SOURCE_ROOT)
    nested = relative.parts[1:-1]
    return " / ".join(humanize(part) for part in nested) if nested else None


def title_for(path: Path, category_label: str, position: int) -> str:
    clean = humanize(path.stem)
    if not clean or CAMERA_NAME.match(clean):
        return f"{category_label} {position}"
    return clean


def read_raw(path: Path) -> Image.Image:
    import rawpy

    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(
            use_camera_wb=True,
            no_auto_bright=False,
            output_bps=8,
        )
    return Image.fromarray(rgb, mode="RGB")


def convert_to_srgb(image: Image.Image, icc_profile: bytes | None) -> Image.Image:
    if image.mode not in {"RGB", "RGBA"}:
        image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

    if image.mode == "RGBA":
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.getchannel("A"))
        image = background

    if not icc_profile:
        return image.convert("RGB")

    try:
        source_profile = ImageCms.ImageCmsProfile(BytesIO(icc_profile))
        target_profile = ImageCms.createProfile("sRGB")
        return ImageCms.profileToProfile(image, source_profile, target_profile, outputMode="RGB")
    except (OSError, ValueError):
        return image.convert("RGB")


def load_image(path: Path) -> Image.Image:
    if path.suffix.lower() in RAW_EXTENSIONS:
        return read_raw(path)

    with Image.open(path) as opened:
        opened.seek(0)
        icc_profile = opened.info.get("icc_profile")
        transposed = ImageOps.exif_transpose(opened)
        transposed.load()
        return convert_to_srgb(transposed, icc_profile)


def resize(image: Image.Image, max_edge: int) -> Image.Image:
    resized = image.copy()
    resized.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return resized


def public_stem(path: Path, position: int) -> str:
    relative = path.relative_to(SOURCE_ROOT).as_posix()
    folder, _ = category_for(path)
    digest = hashlib.sha1(relative.encode("utf-8")).hexdigest()[:8]
    return f"{CATEGORY_ORDER[folder]:02d}-{position:03d}-{slugify(path.stem)}-{digest}"


def inspect_sources(paths: list[Path]) -> list[dict[str, object]]:
    load_optional_dependencies(paths)
    reports = []
    errors = []
    unsupported = []
    category_positions: dict[str, int] = {folder: 0 for folder, _ in CATEGORIES}

    for path in paths:
        suffix = path.suffix.lower()
        relative = path.relative_to(SOURCE_ROOT)
        if suffix not in SUPPORTED_EXTENSIONS:
            unsupported.append(str(relative))
            continue
        try:
            folder, label = category_for(path)
            category_positions[folder] += 1
            position = category_positions[folder]
            album = album_for(path)
            if suffix in VIDEO_EXTENSIONS:
                reports.append({
                    "path": path,
                    "category_folder": folder,
                    "category": label,
                    "album": album,
                    "position": position,
                    "type": "video",
                    "title": title_for(path, label, position),
                })
                continue

            image = load_image(path)
            width, height = image.size
            reports.append({
                "path": path,
                "category_folder": folder,
                "category": label,
                "album": album,
                "position": position,
                "type": "image",
                "title": title_for(path, label, position),
                "width": width,
                "height": height,
                "small": max(width, height) < 1600,
            })
            image.close()
        except Exception as exc:  # noqa: BLE001 - aggregate per-file validation errors
            errors.append(f"{relative}: {exc}")

    if unsupported:
        errors.append("Unsupported files: " + ", ".join(unsupported))
    if errors:
        raise GalleryError("\n".join(errors))
    return reports


def print_check(reports: list[dict[str, object]]) -> None:
    if not reports:
        print("No gallery source files found.")
        return
    print(f"Validated {len(reports)} gallery source file(s):")
    for report in reports:
        relative = report["path"].relative_to(SOURCE_ROOT)
        album = f" · {report['album']}" if report.get("album") else ""
        if report["type"] == "video":
            print(f"  OK  {relative} → {report['category']}{album} · browser-ready video copied as-is")
            continue
        warning = " · WARNING: below 1600 px on the long edge" if report.get("small") else ""
        print(
            f"  OK  {relative} → {report['category']}{album} · "
            f"{report['width']}×{report['height']}{warning}"
        )
    print("Published images will be converted to sRGB WebP and saved without EXIF/GPS metadata.")


def clear_generated() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for path in OUTPUT_ROOT.iterdir():
        if path.name.lower() == "readme.md":
            continue
        if path.is_dir():
            shutil.rmtree(path)
        else:
            path.unlink()


def save_webp(image: Image.Image, path: Path, max_edge: int, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    resized = resize(image, max_edge)
    resized.save(path, "WEBP", quality=quality, method=6)
    resized.close()


def build(
    reports: list[dict[str, object]],
    thumb_edge: int,
    full_edge: int,
    thumb_quality: int,
    full_quality: int,
) -> list[dict[str, object]]:
    clear_generated()
    manifest = []

    for report in reports:
        source = report["path"]
        folder = report["category_folder"]
        position = int(report["position"])
        output_dir = OUTPUT_ROOT / folder
        output_dir.mkdir(parents=True, exist_ok=True)
        stem = public_stem(source, position)

        if report["type"] == "video":
            output = output_dir / f"{stem}{source.suffix.lower()}"
            shutil.copy2(source, output)
            manifest.append({
                "id": stem,
                "type": "video",
                "file": output.relative_to(ROOT).as_posix(),
                "category": report["category"],
                "album": report.get("album"),
                "title": report["title"],
                "alt": f"Aurora — {report['title']}",
            })
            continue

        image = load_image(source)
        thumb = output_dir / f"{stem}-thumb.webp"
        full = output_dir / f"{stem}-full.webp"
        save_webp(image, thumb, thumb_edge, thumb_quality)
        save_webp(image, full, full_edge, full_quality)
        width, height = image.size
        image.close()

        manifest.append({
            "id": stem,
            "type": "image",
            "thumbnail": thumb.relative_to(ROOT).as_posix(),
            "full": full.relative_to(ROOT).as_posix(),
            "file": full.relative_to(ROOT).as_posix(),
            "category": report["category"],
            "album": report.get("album"),
            "title": report["title"],
            "alt": f"Aurora — {report['title']}",
            "width": width,
            "height": height,
            "portrait": height > width,
        })

    return manifest


def write_manifest(items: list[dict[str, object]]) -> None:
    payload = json.dumps(items, ensure_ascii=False, indent=2)
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(
        "// Generated by tools/build_gallery.py. Keep this file committed for GitHub Pages.\n"
        f"window.AURORA_MEDIA = {payload};\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Validate source files without changing generated assets")
    parser.add_argument("--thumb-edge", type=int, default=900, help="Maximum thumbnail edge in pixels (default: 900)")
    parser.add_argument("--full-edge", type=int, default=2200, help="Maximum fullscreen edge in pixels (default: 2200)")
    parser.add_argument("--thumb-quality", type=int, default=80, help="Thumbnail WebP quality (default: 80)")
    parser.add_argument("--full-quality", type=int, default=86, help="Fullscreen WebP quality (default: 86)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    paths = source_files()
    if not paths:
        print("No private gallery source files found; existing published gallery was left unchanged.")
        return

    try:
        reports = inspect_sources(paths)
    except GalleryError as exc:
        print(f"Gallery validation failed:\n{exc}", file=sys.stderr)
        raise SystemExit(2) from exc

    print_check(reports)
    if args.check:
        return

    if args.thumb_edge < 320 or args.full_edge < args.thumb_edge:
        raise SystemExit("Invalid dimensions: full edge must be >= thumb edge, and thumb edge must be >= 320 px")
    if not (1 <= args.thumb_quality <= 100 and 1 <= args.full_quality <= 100):
        raise SystemExit("WebP quality values must be between 1 and 100")

    items = build(reports, args.thumb_edge, args.full_edge, args.thumb_quality, args.full_quality)
    write_manifest(items)
    print(f"Built {len(items)} gallery item(s) into {OUTPUT_ROOT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
