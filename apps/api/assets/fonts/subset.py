#!/usr/bin/env python3
"""Regenerate NotoSansSC-Regular.ttf and NotoSansSC-Bold.ttf, the report PDF's fonts, from the
upstream static instances. Needs npm and fonttools 4.64.0: `python3 apps/api/assets/fonts/subset.py`.
"""
import hashlib
import subprocess
import tarfile
import tempfile
from pathlib import Path

import fontTools
from fontTools.subset import Options, Subsetter
from fontTools.ttLib import TTFont

PACKAGE = "@expo-google-fonts/noto-sans-sc@0.4.3"
SOURCES = {
    "NotoSansSC-Regular.ttf": ("package/400Regular/NotoSansSC_400Regular.ttf", "d45f67f0a7c0ca3f256950777ce6a61cc7ce5f9696d02900cbbaac25f8aa7d16"),
    "NotoSansSC-Bold.ttf": ("package/700Bold/NotoSansSC_700Bold.ttf", "9a38ae0ab28cd5a256f9ea8e00dedc688aac17f7915fcb000572990afa956b96"),
}
FONTTOOLS = "4.64.0"

RANGES = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x024F),  # Latin Extended-A and -B
    (0x0300, 0x036F),  # Combining Diacritical Marks, for Vietnamese
    (0x1E00, 0x1EFF),  # Latin Extended Additional, for Vietnamese
    (0x2000, 0x206F),  # General Punctuation
    (0x3000, 0x303F),  # CJK Symbols and Punctuation
    (0xFF00, 0xFFEF),  # Halfwidth and Fullwidth Forms: the fullwidth punctuation Chinese text uses
]


def gb2312_hanzi() -> list[int]:
    """The 6,763 hanzi of GB 2312, rows 16 to 87."""
    hanzi = []
    for hi in range(0xB0, 0xF8):
        for lo in range(0xA1, 0xFF):
            try:
                hanzi.append(ord(bytes([hi, lo]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    assert len(hanzi) == 6763, len(hanzi)
    return hanzi


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    assert fontTools.version == FONTTOOLS, f"fonttools {fontTools.version}; the recorded subsets were made with {FONTTOOLS}"
    unicodes = sorted({cp for lo, hi in RANGES for cp in range(lo, hi + 1)} | set(gb2312_hanzi()))
    out_dir = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory() as tmp:
        tgz = subprocess.run(["npm", "pack", PACKAGE, "--silent", "--pack-destination", tmp], check=True, capture_output=True, text=True).stdout.strip().splitlines()[-1]
        with tarfile.open(Path(tmp) / tgz) as tar:
            tar.extractall(tmp, members=[tar.getmember(src) for src, _ in SOURCES.values()], filter="data")
        for name, (src, expected) in SOURCES.items():
            source = Path(tmp) / src
            assert sha256(source) == expected, f"{src} does not match the SHA-256 in SOURCE.md"
            font = TTFont(source, recalcTimestamp=False)
            subsetter = Subsetter(Options())
            subsetter.populate(unicodes=unicodes)
            subsetter.subset(font)
            font.save(out_dir / name)
            print(f"{name}  {(out_dir / name).stat().st_size} bytes  {sha256(out_dir / name)}")


if __name__ == "__main__":
    main()
