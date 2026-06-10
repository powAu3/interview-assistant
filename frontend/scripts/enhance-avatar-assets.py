from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
AVATAR_DIR = ROOT / "public" / "avatars" / "generated"
SOURCES = {
    "interviewer-calm.png": "interviewer-calm-hq.png",
    "interviewer-supportive.png": "interviewer-supportive-hq.png",
    "interviewer-pressure.png": "interviewer-pressure-hq.png",
}


def enhance_avatar(source: Path, target: Path) -> None:
    with Image.open(source) as image:
        image = image.convert("RGB")
        upscaled = image.resize((image.width * 2, image.height * 2), Image.Resampling.LANCZOS)
        upscaled = ImageEnhance.Contrast(upscaled).enhance(1.025)
        upscaled = ImageEnhance.Sharpness(upscaled).enhance(1.08)
        upscaled = upscaled.filter(ImageFilter.UnsharpMask(radius=1.15, percent=110, threshold=4))
        upscaled.save(target, optimize=True)


def main() -> None:
    for source_name, target_name in SOURCES.items():
        source = AVATAR_DIR / source_name
        target = AVATAR_DIR / target_name
        enhance_avatar(source, target)
        print(f"{source_name} -> {target_name}")


if __name__ == "__main__":
    main()
