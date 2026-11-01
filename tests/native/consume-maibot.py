"""Consume a generated TOML fragment with unmodified upstream MaiBot classes."""

from __future__ import annotations

import json
from pathlib import Path

import tomlkit
from src.config.config_base import AttributeData
from src.config.official_configs import PersonalityConfig


def main() -> None:
    work = Path("/work")
    document = tomlkit.parse((work / "maibot.toml").read_text(encoding="utf-8"))
    native = PersonalityConfig.from_dict(AttributeData(), document["personality"])
    fields = {
        "personality": native.personality,
        "reply_style": native.reply_style,
        "behavior_style": native.behavior_style,
    }
    expected = json.loads((work / "maibot-expected.json").read_text(encoding="utf-8"))
    if fields != expected:
        raise ValueError("MaiBot native configuration changed persona text")
    # Round trip via upstream's TOML library and config class, not our serializer.
    native_toml = tomlkit.dumps({"personality": fields})
    (work / "maibot-native.toml").write_text(native_toml, encoding="utf-8")
    rewritten = tomlkit.parse(native_toml)
    restored = PersonalityConfig.from_dict(AttributeData(), rewritten["personality"])
    if restored.personality != native.personality:
        raise ValueError("MaiBot native TOML round trip changed persona text")
    (work / "maibot-result.json").write_text(
        json.dumps({"nativeConfigConsumption": "passed", "fields": fields}, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
