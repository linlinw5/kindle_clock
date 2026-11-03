"""Rebuild the Kindle font subset, including every configured city name."""

from pathlib import Path
from io import BytesIO
import re

from fontTools import subset
from fontTools.ttLib import TTFont


tool_dir = Path(__file__).resolve().parent
root = tool_dir.parent
chars_path = tool_dir / "chars.txt"
source_path = tool_dir / "Alibaba-PuHuiTi-Heavy.ttf"
output_path = root / "css" / "PuHuiTiMin.ttf"

config = (root / "config.js").read_text(encoding="utf-8")
city_block = re.search(r"var\s+cityNameDB\s*=\s*\{(.*?)\};", config, re.S)
if not city_block:
    raise ValueError("cityNameDB was not found in config.js")
city_names = re.findall(r':\s*"([^"\n]*)"', city_block.group(1))
if not city_names:
    raise ValueError("No city names were found")

original_chars = chars_path.read_text(encoding="utf-8")
# Include all Chinese status messages, including network failure/retry states.
network_source = (root / "network.js").read_text(encoding="utf-8")
status_chars = "".join(re.findall(r"[\u3400-\u9fff\u3000-\u303f\uff00-\uffef·]", network_source))
required = {ord(char) for char in original_chars + "".join(city_names) + status_chars + "设置城市℃℉" if not char.isspace()}
# Preserve all characters supported by the previous deployed font.
with TTFont(output_path) as previous:
    required.update(previous.getBestCmap())

with TTFont(source_path) as source:
    missing = required - source.getBestCmap().keys()
    if missing:
        raise ValueError("Source font is missing: " + ", ".join(f"U+{code:04X}" for code in sorted(missing)))
    options = subset.Options()
    options.layout_features = ["*"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=required)
    subsetter.subset(source)
    font_bytes = BytesIO()
    source.save(font_bytes)

generated_bytes = font_bytes.getvalue()
with TTFont(BytesIO(generated_bytes)) as generated:
    missing = required - generated.getBestCmap().keys()
    if missing:
        raise ValueError(f"Generated font is missing {len(missing)} required characters")

added = "".join(chr(code) for code in sorted(required - {ord(char) for char in original_chars}))
if added:
    chars_path.write_text(original_chars.rstrip() + "\n\n" + added + "\n", encoding="utf-8")
output_path.write_bytes(generated_bytes)
print(f"Verified {len(city_names)} city mappings and {len(required)} characters.")
print(f"Added {len(added)} characters to chars.txt.")
print(f"Updated css/PuHuiTiMin.ttf ({output_path.stat().st_size} bytes).")
