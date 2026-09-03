import sys

import pytest

from backend.serve.actions import (
    ActionBinding,
    ActionController,
    DryRunKeyEmitter,
    QuartzKeyEmitter,
    Shortcut,
    accessibility_trusted,
)
from backend.serve.decision import GestureEvent


class Emitter:
    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []

    def key_down(self, key: str) -> None:
        self.events.append(("down", key))

    def key_up(self, key: str) -> None:
        self.events.append(("up", key))


def test_hold_is_pressed_once_and_released_in_safe_order() -> None:
    emitter = Emitter()
    controller = ActionController(
        {"fist": ActionBinding("hold", Shortcut.parse("ctrl+shift+d"))},
        emitter,
    )

    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("release", "fist"))

    assert emitter.events == [
        ("down", "control"),
        ("down", "shift"),
        ("down", "d"),
        ("up", "d"),
        ("up", "shift"),
        ("up", "control"),
    ]


def test_bare_fn_hold_emits_one_down_and_one_up_without_repeats() -> None:
    emitter = Emitter()
    shortcut = Shortcut.parse("fn")
    controller = ActionController(
        {"fist": ActionBinding("hold", shortcut)},
        emitter,
    )

    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("release", "fist"))

    assert shortcut.modifiers == ("fn",)
    assert shortcut.key is None
    assert str(shortcut) == "fn"
    assert emitter.events == [("down", "fn"), ("up", "fn")]


def test_failed_fn_press_attempts_immediate_release() -> None:
    class FailingFnEmitter(Emitter):
        def key_down(self, key: str) -> None:
            self.events.append(("down", key))
            raise RuntimeError("post failed")

    emitter = FailingFnEmitter()
    controller = ActionController(
        {"fist": ActionBinding("hold", Shortcut.parse("fn"))},
        emitter,
    )

    with pytest.raises(RuntimeError, match="post failed"):
        controller.handle(GestureEvent("press", "fist"))

    assert emitter.events == [("down", "fn"), ("up", "fn")]


def test_release_all_cleans_up_every_held_binding() -> None:
    emitter = Emitter()
    controller = ActionController(
        {
            "fist": ActionBinding("hold", Shortcut.parse("ctrl+d")),
            "rock": ActionBinding("hold", Shortcut.parse("option+r")),
        },
        emitter,
    )
    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("press", "rock"))

    controller.release_all()
    controller.release_all()

    assert emitter.events[-4:] == [
        ("up", "d"),
        ("up", "control"),
        ("up", "r"),
        ("up", "option"),
    ]


def test_tap_emits_a_complete_shortcut_without_retaining_keys() -> None:
    emitter = Emitter()
    controller = ActionController(
        {"open": ActionBinding("tap", Shortcut.parse("command+return"))}, emitter
    )

    controller.handle(GestureEvent("tap", "open"))
    controller.release_all()

    assert emitter.events == [
        ("down", "command"),
        ("down", "return"),
        ("up", "return"),
        ("up", "command"),
    ]


def test_point_taps_return_once() -> None:
    emitter = Emitter()
    controller = ActionController(
        {"point": ActionBinding("tap", Shortcut.parse("return"))}, emitter
    )

    controller.handle(GestureEvent("tap", "point"))

    assert emitter.events == [("down", "return"), ("up", "return")]


def test_text_action_types_fast_command_and_submits() -> None:
    factory = getattr(ActionBinding, "type_and_submit", None)
    assert factory is not None
    emitter = Emitter()
    controller = ActionController({"rock": factory("/fast")}, emitter)

    controller.handle(GestureEvent("tap", "rock"))

    assert emitter.events == [
        ("down", "/"),
        ("up", "/"),
        ("down", "f"),
        ("up", "f"),
        ("down", "a"),
        ("up", "a"),
        ("down", "s"),
        ("up", "s"),
        ("down", "t"),
        ("up", "t"),
        ("down", "return"),
        ("up", "return"),
    ]


@pytest.mark.parametrize("value", ["", "shift", "a+b", "ctrl+not-a-key"])
def test_shortcut_rejects_ambiguous_or_unsupported_chords(value: str) -> None:
    with pytest.raises(ValueError, match="shortcut"):
        Shortcut.parse(value)


class FakeQuartz:
    kCGHIDEventTap = 7
    kCGEventFlagMaskControl = 1
    kCGEventFlagMaskShift = 2
    kCGEventFlagMaskAlternate = 4
    kCGEventFlagMaskCommand = 8
    kCGEventFlagMaskSecondaryFn = 16

    def __init__(self) -> None:
        self.posted: list[tuple[int, bool, int]] = []

    @staticmethod
    def CGEventCreateKeyboardEvent(source: None, key_code: int, down: bool) -> dict:
        return {"key_code": key_code, "down": down, "flags": 0}

    @staticmethod
    def CGEventSetFlags(event: dict, flags: int) -> None:
        event["flags"] = flags

    def CGEventPost(self, tap: int, event: dict) -> None:
        assert tap == self.kCGHIDEventTap
        self.posted.append((event["key_code"], event["down"], event["flags"]))


def test_quartz_emitter_attaches_active_modifier_flags() -> None:
    quartz = FakeQuartz()
    emitter = QuartzKeyEmitter(quartz)

    emitter.key_down("control")
    emitter.key_down("d")
    emitter.key_up("d")
    emitter.key_up("control")

    assert quartz.posted == [
        (59, True, 1),
        (2, True, 1),
        (2, False, 1),
        (59, False, 0),
    ]


def test_quartz_emitter_posts_freeflow_function_modifier() -> None:
    quartz = FakeQuartz()
    emitter = QuartzKeyEmitter(quartz)

    emitter.key_down("fn")
    emitter.key_up("fn")

    assert quartz.posted == [(63, True, 16), (63, False, 0)]


def test_accessibility_check_passes_prompt_preference_to_macos() -> None:
    class AccessibilityQuartz:
        kAXTrustedCheckOptionPrompt = "prompt"

        @staticmethod
        def AXIsProcessTrustedWithOptions(options) -> bool:
            return options == {"prompt": True}

    assert accessibility_trusted(prompt=True, services_module=AccessibilityQuartz)


def test_accessibility_check_imports_application_services(monkeypatch) -> None:
    class ApplicationServices:
        kAXTrustedCheckOptionPrompt = "prompt"

        @staticmethod
        def AXIsProcessTrustedWithOptions(options) -> bool:
            return options == {"prompt": False}

    monkeypatch.setitem(sys.modules, "ApplicationServices", ApplicationServices)

    assert accessibility_trusted(prompt=False)


def test_dry_run_emitter_reports_without_sending_keys() -> None:
    messages: list[str] = []
    emitter = DryRunKeyEmitter(messages.append)

    emitter.key_down("control")
    emitter.key_up("control")

    assert messages == ["key down: control", "key up: control"]


def test_partial_key_press_failure_releases_every_attempted_key() -> None:
    class FailingEmitter(Emitter):
        def key_down(self, key: str) -> None:
            if key == "d":
                raise RuntimeError("event failure")
            super().key_down(key)

    emitter = FailingEmitter()
    controller = ActionController(
        {"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))}, emitter
    )

    with pytest.raises(RuntimeError, match="event failure"):
        controller.handle(GestureEvent("press", "fist"))

    assert emitter.events == [
        ("down", "control"),
        ("up", "d"),
        ("up", "control"),
    ]


def test_key_release_failure_still_attempts_every_modifier_release() -> None:
    class FailingReleaseEmitter(Emitter):
        def key_up(self, key: str) -> None:
            self.events.append(("up", key))
            if key == "d":
                raise RuntimeError("release failure")

    emitter = FailingReleaseEmitter()
    controller = ActionController(
        {"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))}, emitter
    )
    controller.handle(GestureEvent("press", "fist"))

    with pytest.raises(RuntimeError, match="release failure"):
        controller.handle(GestureEvent("release", "fist"))

    assert emitter.events[-2:] == [("up", "d"), ("up", "control")]


def test_failed_gesture_release_is_retried_by_release_all() -> None:
    class TransientReleaseEmitter(Emitter):
        failed = False

        def key_up(self, key: str) -> None:
            self.events.append(("up", key))
            if key == "d" and not self.failed:
                self.failed = True
                raise RuntimeError("release failure")

    emitter = TransientReleaseEmitter()
    controller = ActionController(
        {"fist": ActionBinding("hold", Shortcut.parse("ctrl+d"))}, emitter
    )
    controller.handle(GestureEvent("press", "fist"))

    with pytest.raises(RuntimeError, match="release failure"):
        controller.handle(GestureEvent("release", "fist"))
    controller.release_all()

    assert emitter.events[-4:] == [
        ("up", "d"),
        ("up", "control"),
        ("up", "d"),
        ("up", "control"),
    ]


def test_release_all_continues_after_one_shortcut_fails() -> None:
    class FailingReleaseEmitter(Emitter):
        def key_up(self, key: str) -> None:
            self.events.append(("up", key))
            if key == "d":
                raise RuntimeError("release failure")

    emitter = FailingReleaseEmitter()
    controller = ActionController(
        {
            "fist": ActionBinding("hold", Shortcut.parse("ctrl+d")),
            "rock": ActionBinding("hold", Shortcut.parse("option+r")),
        },
        emitter,
    )
    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("press", "rock"))

    with pytest.raises(RuntimeError, match="release failure"):
        controller.release_all()

    assert emitter.events[-4:] == [
        ("up", "d"),
        ("up", "control"),
        ("up", "r"),
        ("up", "option"),
    ]


def test_release_all_retries_only_shortcuts_that_failed() -> None:
    class TransientReleaseEmitter(Emitter):
        failed = False

        def key_up(self, key: str) -> None:
            self.events.append(("up", key))
            if key == "d" and not self.failed:
                self.failed = True
                raise RuntimeError("release failure")

    emitter = TransientReleaseEmitter()
    controller = ActionController(
        {
            "fist": ActionBinding("hold", Shortcut.parse("ctrl+d")),
            "rock": ActionBinding("hold", Shortcut.parse("option+r")),
        },
        emitter,
    )
    controller.handle(GestureEvent("press", "fist"))
    controller.handle(GestureEvent("press", "rock"))

    with pytest.raises(RuntimeError, match="release failure"):
        controller.release_all()
    prior_count = len(emitter.events)
    controller.release_all()

    assert emitter.events[prior_count:] == [("up", "d"), ("up", "control")]
