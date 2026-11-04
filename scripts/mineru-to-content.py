"""Export MinerU 4.1's local structured PDF result for the reader."""
import json
import sys
from pathlib import Path


def main():
    from mineru.parser import parse
    from mineru.render import RenderFormat, render

    source, target, tier = sys.argv[1:4]
    page_range = sys.argv[4] if len(sys.argv) > 4 else None
    result = parse(source, tier=tier, ocr_mode="txt" if tier == "flash" else "auto", page_range=page_range)
    blocks = render(result.middle_json, RenderFormat.CONTENT_LIST)
    Path(target).write_text(json.dumps(blocks, ensure_ascii=False), encoding="utf-8")


# DocVortex starts PDF render workers with multiprocessing spawn on Windows.
# The child imports this file and must not start a second parse.
if __name__ == "__main__":
    main()
