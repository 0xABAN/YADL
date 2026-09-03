from pathlib import Path

import pytest

from backend.train.data import load_project_samples


@pytest.mark.integration
def test_loads_the_52_committed_demo_frames_from_yadl() -> None:
    dataset = load_project_samples(
        "a397a808-14ef-4528-b822-9a92bfac7c3e",
        env_file=Path(__file__).parents[2] / ".env",
    )

    assert dataset.classes == (
        "thumbs_up",
        "thumbs_down",
        "point",
        "fist",
        "open",
        "rock",
    )
    reference_samples = [sample for sample in dataset.samples if sample.image.startswith("frame-")]
    assert len(reference_samples) == 52
    assert len(dataset.samples) >= len(reference_samples)
    assert all(sample.landmarks.shape == (21, 3) for sample in dataset.samples)
