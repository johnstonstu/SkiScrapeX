"""Checks a published features.json has the Apex resort the game expects."""

from __future__ import annotations


def feature_problems(document: dict) -> list[str]:
    """Return reasons a features file must not be published.

    The live page needs buildings and the four Apex lifts. Attribution stays
    with the file because the extract is ODbL.
    """
    if not isinstance(document, dict):
        return ["document must be an object"]
    problems = []
    counts = document.get("counts") if isinstance(document.get("counts"), dict) else {}
    buildings = counts.get("buildings")
    lifts = counts.get("lifts")
    if not isinstance(buildings, int) or isinstance(buildings, bool) or buildings <= 0:
        problems.append(f"buildings must be > 0 (got {buildings!r})")
    if lifts != 4:
        problems.append(f"lifts must be 4 (got {lifts!r})")
    source = document.get("source") if isinstance(document.get("source"), dict) else {}
    if "OpenStreetMap" not in str(source.get("attribution", "")):
        problems.append("source.attribution must credit OpenStreetMap")
    if "ODbL" not in str(source.get("license", "")):
        problems.append("source.license must name ODbL")
    return problems
