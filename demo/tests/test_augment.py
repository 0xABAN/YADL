import numpy as np

from backend.train.augment import balance_with_jitter


def test_balance_with_jitter_is_seeded_and_balances_every_class() -> None:
    features = np.arange(4 * 63, dtype=np.float32).reshape(4, 63)
    labels = np.array([0, 0, 0, 1], dtype=np.int64)

    first_x, first_y = balance_with_jitter(
        features, labels, target_per_class=4, seed=17
    )
    second_x, second_y = balance_with_jitter(
        features, labels, target_per_class=4, seed=17
    )

    np.testing.assert_array_equal(first_x, second_x)
    np.testing.assert_array_equal(first_y, second_y)
    assert np.bincount(first_y).tolist() == [4, 4]
    np.testing.assert_array_equal(first_x[:4], features)
