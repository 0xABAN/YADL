import numpy as np

from backend.train.data import HandSample
from backend.train.split import split_by_episode


def _sample(
    index: int,
    label: str,
    episode: str | None = None,
    partition: str | None = None,
) -> HandSample:
    return HandSample(
        image=f"frame-{index:04d}.jpg",
        label=label,
        landmarks=np.zeros((21, 3), dtype=np.float32),
        handedness=None,
        episode=episode,
        partition=partition,
    )


def test_split_holds_out_whole_later_episodes_without_random_frame_leakage() -> None:
    labels = ["a", "a", "b", "b", "a", "a", "c", "c", "c"]
    samples = tuple(_sample(i, label) for i, label in enumerate(labels))

    split = split_by_episode(samples, classes=("a", "b", "c"))

    assert split.train_indices == (0, 1, 2, 3, 6, 7, 8)
    assert split.validation_indices == (4, 5)
    assert split.validated_classes == ("a",)
    assert split.unvalidated_classes == ("b", "c")
    assert split.episode_count == 4


def test_split_uses_explicit_capture_episodes_instead_of_adjacency() -> None:
    samples = (
        _sample(0, "fist", "train:fist"),
        _sample(1, "neutral", "train:neutral"),
        _sample(2, "fist", "train:fist"),
        _sample(3, "fist", "validation:fist"),
        _sample(4, "neutral", "validation:neutral"),
    )

    split = split_by_episode(samples, classes=("fist", "neutral"))

    assert split.train_indices == (0, 1, 2)
    assert split.validation_indices == (3, 4)
    assert split.validated_classes == ("fist", "neutral")


def test_split_never_leaks_repeated_validation_session_episodes_into_training() -> None:
    samples = (
        _sample(0, "fist", "train:fist", "train"),
        _sample(1, "neutral", "train:neutral", "train"),
        _sample(2, "fist", "validation:fist-1", "validation"),
        _sample(3, "neutral", "validation:neutral", "validation"),
        _sample(4, "fist", "validation:fist-2", "validation"),
    )

    split = split_by_episode(samples, classes=("fist", "neutral"))

    assert split.train_indices == (0, 1)
    assert split.validation_indices == (2, 3, 4)
