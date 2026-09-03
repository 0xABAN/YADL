from backend.serve.decision import (
    DecisionEngine,
    DecisionPolicy,
    GestureEvent,
    Observation,
)


def test_fist_emits_one_press_for_a_long_hold_and_one_release() -> None:
    engine = DecisionEngine(
        {"fist": "hold"},
        DecisionPolicy(
            enter_ms=120,
            release_ms=100,
            stale_ms=200,
            minimum_observations=3,
            enter_confidence=0.98,
            enter_margin=0.35,
            sustain_confidence=0.70,
        ),
    )
    fist = Observation("fist", confidence=0.99, margin=0.80)
    open_hand = Observation("open", confidence=0.99, margin=0.80)

    assert engine.update(0, fist) == ()
    assert engine.update(60, fist) == ()
    assert engine.update(120, fist) == (GestureEvent("press", "fist"),)
    assert engine.update(1_000, fist) == ()
    assert engine.update(1_100, open_hand) == ()
    assert engine.update(1_200, open_hand) == (GestureEvent("release", "fist"),)


def test_brief_detection_loss_does_not_interrupt_an_active_hold() -> None:
    engine = DecisionEngine(
        {"fist": "hold"},
        DecisionPolicy(enter_ms=100, release_ms=100, minimum_observations=2),
    )
    fist = Observation("fist", 0.99, 0.80)

    assert engine.update(0, fist) == ()
    assert engine.update(100, fist) == (GestureEvent("press", "fist"),)
    assert engine.update(150, None) == ()
    assert engine.update(220, fist) == ()


def test_watchdog_releases_when_vision_results_stop() -> None:
    engine = DecisionEngine(
        {"fist": "hold"},
        DecisionPolicy(enter_ms=100, stale_ms=200, minimum_observations=2),
    )
    fist = Observation("fist", 0.99, 0.80)
    engine.update(0, fist)
    assert engine.update(100, fist) == (GestureEvent("press", "fist"),)

    assert engine.tick(299) == ()
    assert engine.tick(300) == (GestureEvent("release", "fist"),)


def test_tap_fires_once_and_rearms_after_gesture_exit() -> None:
    engine = DecisionEngine(
        {"open": "tap"},
        DecisionPolicy(enter_ms=100, release_ms=100, minimum_observations=2),
    )
    opened = Observation("open", 0.99, 0.80)

    assert engine.update(0, opened) == ()
    assert engine.update(100, opened) == (GestureEvent("tap", "open"),)
    assert engine.update(300, opened) == ()
    assert engine.update(350, None) == ()
    assert engine.update(450, None) == ()
    assert engine.update(500, opened) == ()
    assert engine.update(600, opened) == (GestureEvent("tap", "open"),)
