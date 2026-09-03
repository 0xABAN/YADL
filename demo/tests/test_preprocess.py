import numpy as np
import pytest

from backend.train.preprocess import canonicalize


def _hand() -> np.ndarray:
    hand = np.zeros((21, 3), dtype=np.float32)
    hand[5] = (-0.5, 1.0, 0.1)
    hand[9] = (0.0, 1.2, 0.2)
    hand[13] = (0.4, 1.0, 0.1)
    hand[17] = (0.8, 0.7, 0.0)
    hand[4] = (-1.0, 0.2, -0.2)
    return hand


def test_canonicalize_is_invariant_to_translation_scale_rotation_and_handedness() -> None:
    right = _hand()
    angle = 0.73
    rotation = np.array(
        [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]],
        dtype=np.float32,
    )
    transformed = right.copy()
    transformed[:, :2] = transformed[:, :2] @ rotation.T
    transformed *= 3.7
    transformed += (12.0, -9.0, 4.0)
    left = transformed.copy()
    left[:, 0] = 24.0 - left[:, 0]

    expected = canonicalize(right, handedness="Right")
    actual = canonicalize(left, handedness="Left")

    np.testing.assert_allclose(actual[:-2], expected[:-2], atol=1e-5)


@pytest.mark.parametrize(
    "landmarks",
    [
        np.zeros((20, 3), dtype=np.float32),
        np.full((21, 3), np.nan, dtype=np.float32),
        np.zeros((21, 3), dtype=np.float32),
    ],
)
def test_canonicalize_rejects_invalid_hands(landmarks: np.ndarray) -> None:
    with pytest.raises(ValueError, match="landmarks"):
        canonicalize(landmarks, handedness="Right")


def test_canonicalize_retains_palm_orientation_after_rotating_landmarks() -> None:
    upright = _hand()
    upside_down = upright.copy()
    upside_down[:, :2] *= -1

    upright_features = canonicalize(upright, handedness="Right")
    down_features = canonicalize(upside_down, handedness="Right")

    np.testing.assert_allclose(upright_features[:-2], down_features[:-2], atol=1e-5)
    assert upright_features.shape == (65,)
    assert not np.allclose(upright_features[-2:], down_features[-2:])


def test_canonicalize_does_not_change_when_handedness_metadata_flickers() -> None:
    hand = _hand()

    as_left = canonicalize(hand, handedness="Left")
    as_right = canonicalize(hand, handedness="Right")

    np.testing.assert_allclose(as_left, as_right)
