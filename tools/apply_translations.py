"""
Writes the Hebrew prompts into the gallery: every question's prompts.he from tools/translations_he.json (tagged English
prompt -> tagged Hebrew prompt). A question's second prompt is its first one's Hebrew with only the changed regions'
spans taken from its own translation, so the two Hebrew prompts differ only where the English ones do. Fails, naming the prompt, when a translation is missing or its <rN> tags differ from
the English ones. With --missing, writes the English prompts that have no translation yet to a JSON file instead.

    python3 tools/apply_translations.py
    python3 tools/apply_translations.py --missing tools/untranslated.json
"""
import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TAG = re.compile(r"<(/?)r(\d+)>")


def tags(text):
    return Counter(TAG.findall(text))


def check(english, hebrew):
    """None when hebrew carries the same tags as english, each region opened and closed once; else the problem."""
    if tags(english) != tags(hebrew):
        return f"tags differ: {sorted(tags(english).items())} vs {sorted(tags(hebrew).items())}"
    if any(count != 1 for count in tags(hebrew).values()):
        return "a tag appears more than once"
    for match in re.finditer(r"<r(\d+)>(.*?)</r\1>", hebrew):
        if "<" in match.group(2):
            return "nested tags"
    if len(re.findall(r"<r(\d+)>.*?</r\1>", hebrew)) != len(tags(hebrew)) // 2:
        return "unbalanced tags"
    return None


def harmonized(first, second, changed):
    """`first` with the spans of the `changed` regions taken from `second`."""
    spans = {int(m.group(1)): m.group(0) for m in re.finditer(r"<r(\d+)>.*?</r\1>", second)}
    return re.sub(r"<r(\d+)>.*?</r\1>", lambda m: spans[int(m.group(1))] if int(m.group(1)) in changed else m.group(0),
                  first)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gallery", type=Path, default=ROOT / "gallery")
    parser.add_argument("--translations", type=Path, default=ROOT / "tools" / "translations_he.json")
    parser.add_argument("--missing", type=Path, help="write the untranslated prompts here and stop")
    args = parser.parse_args()
    translations = json.loads(args.translations.read_text()) if args.translations.is_file() else {}
    paths = sorted(args.gallery.glob("*/question.json"))
    if args.missing:
        missing = sorted({p for path in paths for p in json.loads(path.read_text())["prompts"]["en"]} - set(translations))
        args.missing.write_text(json.dumps(missing, ensure_ascii=False, indent=1))
        print(f"{len(missing)} prompts without a translation -> {args.missing}")
        return 0
    problems = []
    for path in paths:
        question = json.loads(path.read_text())
        hebrew = []
        for english in question["prompts"]["en"]:
            if english not in translations:
                problems.append(f"{path.parent.name}: no translation for {english!r}")
                continue
            if problem := check(english, translations[english]):
                problems.append(f"{path.parent.name}: {problem} in {english!r}")
            hebrew.append(translations[english])
        if len(hebrew) == len(question["prompts"]["en"]):
            hebrew[1:] = [harmonized(hebrew[0], other, question["changed"]) for other in hebrew[1:]]
            question["prompts"]["he"] = hebrew
            path.write_text(json.dumps(question, indent=1, ensure_ascii=False))
    if problems:
        print("\n".join(problems))
        return 1
    print(f"Hebrew prompts written to {len(paths)} questions")
    return 0


if __name__ == "__main__":
    sys.exit(main())
