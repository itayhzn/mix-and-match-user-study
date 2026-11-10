"""
Writes tools/translation_review.html: every prompt in English and in Hebrew side by side, the tagged variants in
matching colors, for the author to review before launch. Not deployed.

    python3 tools/make_review.py
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COLORS = ["#ffe58a", "#bfe3ff", "#c9f2c7", "#ffd0e0", "#e2d4ff", "#ffdcb8", "#d7e0e6"]


def marked(text):
    def span(match):
        color = COLORS[int(match.group(1)) % len(COLORS)]
        return f'<span style="background:{color}">{html.escape(match.group(2))}</span>'
    parts, last = [], 0
    for match in re.finditer(r"<r(\d+)>(.*?)</r\1>", text):
        parts += [html.escape(text[last:match.start()]), span(match)]
        last = match.end()
    return "".join(parts + [html.escape(text[last:])])


translations = json.loads((ROOT / "tools" / "translations_he.json").read_text())
rows = "\n".join(f"<tr><td>{n}</td><td>{marked(en)}</td><td dir='rtl'>{marked(he)}</td></tr>"
                 for n, (en, he) in enumerate(sorted(translations.items()), 1))
(ROOT / "tools" / "translation_review.html").write_text(f"""<!doctype html><meta charset="utf-8">
<title>Translation review</title>
<style>body{{font:15px/1.5 system-ui,sans-serif;margin:20px}}table{{border-collapse:collapse}}
td{{border-bottom:1px solid #ddd;padding:6px 10px;vertical-align:top}}td:first-child{{color:#888}}</style>
<h1>Hebrew prompts: {len(translations)}</h1><table>{rows}</table>""")
print(f"wrote tools/translation_review.html ({len(translations)} prompts)")
