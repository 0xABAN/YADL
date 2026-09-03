from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from .decision import GestureEvent

MODIFIERS = {"command", "control", "fn", "option", "shift"}
ALIASES = {
    "cmd": "command",
    "command": "command",
    "ctrl": "control",
    "control": "control",
    "alt": "option",
    "opt": "option",
    "option": "option",
    "shift": "shift",
    "fn": "fn",
    "function": "fn",
    "enter": "return",
    "return": "return",
    "space": "space",
    "spacebar": "space",
    "esc": "escape",
    "escape": "escape",
}
NAMED_KEYS = {
    "return",
    "space",
    "tab",
    "escape",
    "backspace",
    "delete",
    "left",
    "right",
    "up",
    "down",
}
KEY_CODES = {
    **dict(
        zip(
            "asdfhgzxcvbqwerty",
            (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 17, 16),
            strict=True,
        )
    ),
    **dict(
        zip(
            "123465=97-80",
            (18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29),
            strict=True,
        )
    ),
    "o": 31,
    "u": 32,
    "[": 33,
    "i": 34,
    "p": 35,
    "return": 36,
    "l": 37,
    "j": 38,
    "'": 39,
    "k": 40,
    ";": 41,
    "\\": 42,
    ",": 43,
    "/": 44,
    "n": 45,
    "m": 46,
    ".": 47,
    "tab": 48,
    "space": 49,
    "`": 50,
    "backspace": 51,
    "escape": 53,
    "command": 55,
    "shift": 56,
    "option": 58,
    "control": 59,
    "fn": 63,
    "left": 123,
    "right": 124,
    "down": 125,
    "up": 126,
}


class KeyEmitter(Protocol):
    def key_down(self, key: str) -> None: ...

    def key_up(self, key: str) -> None: ...


@dataclass(frozen=True)
class Shortcut:
    modifiers: tuple[str, ...]
    key: str | None

    @classmethod
    def parse(cls, value: str) -> Shortcut:
        raw = [part.strip().lower() for part in value.split("+") if part.strip()]
        keys = [ALIASES.get(part, part) for part in raw]
        modifiers = tuple(key for key in keys if key in MODIFIERS)
        primary = [key for key in keys if key not in MODIFIERS]
        supported_primary = bool(
            len(primary) == 1
            and (
                len(primary[0]) == 1
                and primary[0].isalnum()
                or primary[0] in NAMED_KEYS
            )
        )
        bare_fn = modifiers == ("fn",) and not primary
        if (
            not raw
            or len(set(keys)) != len(keys)
            or not (bare_fn or supported_primary)
        ):
            raise ValueError(f"invalid shortcut {value!r}")
        return cls(modifiers, primary[0] if primary else None)

    def __str__(self) -> str:
        return "+".join((*self.modifiers, *((self.key,) if self.key else ())))


@dataclass(frozen=True)
class ActionBinding:
    mode: Literal["hold", "tap"]
    shortcut: Shortcut | None = None
    text: str | None = None

    def __post_init__(self) -> None:
        if (self.shortcut is None) == (self.text is None):
            raise ValueError("action must define exactly one shortcut or text command")
        if self.text is not None and (
            self.mode != "tap"
            or not self.text
            or any(character not in KEY_CODES for character in self.text)
        ):
            raise ValueError("text commands must be non-empty, supported tap actions")

    @classmethod
    def type_and_submit(cls, text: str) -> ActionBinding:
        return cls("tap", text=text)

    @property
    def description(self) -> str:
        return (
            str(self.shortcut)
            if self.shortcut is not None
            else f"type {self.text} + return"
        )


class ActionController:
    def __init__(self, bindings: dict[str, ActionBinding], emitter: KeyEmitter) -> None:
        self.bindings = dict(bindings)
        self.emitter = emitter
        self._held: dict[str, Shortcut] = {}

    def handle(self, event: GestureEvent) -> None:
        binding = self.bindings.get(event.label)
        if binding is None:
            return
        if event.kind == "tap":
            shortcuts = (
                tuple(Shortcut((), key) for key in (*binding.text, "return"))
                if binding.text is not None
                else (binding.shortcut,)
            )
            for shortcut in shortcuts:
                assert shortcut is not None
                self._press(shortcut)
                self._release(shortcut)
        elif event.kind == "press" and event.label not in self._held:
            assert binding.shortcut is not None
            self._press(binding.shortcut)
            self._held[event.label] = binding.shortcut
        elif event.kind == "release":
            shortcut = self._held.get(event.label)
            if shortcut is not None:
                self._release(shortcut)
                self._held.pop(event.label, None)

    def release_all(self) -> None:
        held = tuple(self._held.items())
        first_error: BaseException | None = None
        for label, shortcut in held:
            try:
                self._release(shortcut)
            except BaseException as exc:  # noqa: BLE001 - still release every held key
                first_error = first_error or exc
            else:
                self._held.pop(label, None)
        if first_error is not None:
            raise first_error

    def _press(self, shortcut: Shortcut) -> None:
        pressed: list[str] = []
        try:
            for modifier in shortcut.modifiers:
                pressed.append(modifier)
                self.emitter.key_down(modifier)
            if shortcut.key is not None:
                pressed.append(shortcut.key)
                self.emitter.key_down(shortcut.key)
        except BaseException:
            for key in reversed(pressed):
                self.emitter.key_up(key)
            raise

    def _release(self, shortcut: Shortcut) -> None:
        first_error: BaseException | None = None
        keys = (
            *((shortcut.key,) if shortcut.key else ()),
            *reversed(shortcut.modifiers),
        )
        for key in keys:
            try:
                self.emitter.key_up(key)
            except BaseException as exc:  # noqa: BLE001 - release the full chord
                first_error = first_error or exc
        if first_error is not None:
            raise first_error


class QuartzKeyEmitter:
    """Post global macOS key events while preserving modifier state."""

    def __init__(self, quartz_module: Any | None = None) -> None:
        if quartz_module is None:
            try:
                import Quartz as quartz_module
            except ImportError as exc:  # pragma: no cover - depends on macOS package
                raise RuntimeError("Quartz bindings are unavailable") from exc
        self.quartz = quartz_module
        self._modifiers: set[str] = set()

    def key_down(self, key: str) -> None:
        if key in MODIFIERS:
            self._modifiers.add(key)
        self._post(key, True)

    def key_up(self, key: str) -> None:
        if key in MODIFIERS:
            self._modifiers.discard(key)
        self._post(key, False)

    def _post(self, key: str, down: bool) -> None:
        try:
            key_code = KEY_CODES[key]
        except KeyError as exc:
            raise ValueError(f"unsupported shortcut key {key!r}") from exc
        event = self.quartz.CGEventCreateKeyboardEvent(None, key_code, down)
        if event is None:
            raise RuntimeError("macOS refused to create a keyboard event")
        self.quartz.CGEventSetFlags(event, self._flags())
        self.quartz.CGEventPost(self.quartz.kCGHIDEventTap, event)

    def _flags(self) -> int:
        flags = 0
        names = {
            "control": "kCGEventFlagMaskControl",
            "shift": "kCGEventFlagMaskShift",
            "option": "kCGEventFlagMaskAlternate",
            "command": "kCGEventFlagMaskCommand",
            "fn": "kCGEventFlagMaskSecondaryFn",
        }
        for modifier in self._modifiers:
            flags |= int(getattr(self.quartz, names[modifier]))
        return flags


class DryRunKeyEmitter:
    def __init__(self, report: Callable[[str], None] = print) -> None:
        self._report = report

    def key_down(self, key: str) -> None:
        self._report(f"key down: {key}")

    def key_up(self, key: str) -> None:
        self._report(f"key up: {key}")


def accessibility_trusted(
    *, prompt: bool = False, services_module: Any | None = None
) -> bool:
    if services_module is None:
        try:
            import ApplicationServices as services_module
        except ImportError:
            return False
    options = {services_module.kAXTrustedCheckOptionPrompt: prompt}
    return bool(services_module.AXIsProcessTrustedWithOptions(options))
