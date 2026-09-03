import numpy as np

from backend.train.data import HandSample
from backend.train.split import split_by_episode


def _sample(index: int, label: str) -> HandSample:
    return HandSample(
        image=f"frame-{index:04d}.jpg",
        label=label,
        landmarks=np.zeros((21, 3), dtype=np.float32),
        handedness=None,
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
