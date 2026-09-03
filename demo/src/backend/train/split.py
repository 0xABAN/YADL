from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .data import HandSample


@dataclass(frozen=True)
class EpisodeSplit:
    train_indices: tuple[int, ...]
    validation_indices: tuple[int, ...]
    validated_classes: tuple[str, ...]
    unvalidated_classes: tuple[str, ...]
    episode_count: int


def split_by_episode(
    samples: Sequence[HandSample], *, classes: Sequence[str]
) -> EpisodeSplit:
    episodes: list[tuple[str, list[int]]] = []
    explicit: dict[str, int] = {}
    last_implicit: int | None = None
    for index, sample in enumerate(samples):
        if sample.partition == "validation":
            last_implicit = None
            continue
        if sample.episode is not None:
            last_implicit = None
            existing = explicit.get(sample.episode)
            if existing is None:
                explicit[sample.episode] = len(episodes)
                episodes.append((sample.label, [index]))
            else:
                label, indices = episodes[existing]
                if label != sample.label:
                    raise ValueError("one episode cannot contain multiple labels")
                indices.append(index)
        elif last_implicit is None or episodes[last_implicit][0] != sample.label:
            episodes.append((sample.label, []))
            last_implicit = len(episodes) - 1
            episodes[last_implicit][1].append(index)
        else:
            episodes[last_implicit][1].append(index)

    by_class: dict[str, list[int]] = {label: [] for label in classes}
    for episode_id, (label, _) in enumerate(episodes):
        if label in by_class:
            by_class[label].append(episode_id)
    forced_validation = {
        index
        for index, sample in enumerate(samples)
        if sample.partition == "validation"
    }
    forced_labels = {samples[index].label for index in forced_validation}
    validation_episodes = {
        episode_ids[-1]
        for label, episode_ids in by_class.items()
        if label not in forced_labels and len(episode_ids) >= 2
    }
    held_out = {
        index
        for episode_id, (_, indices) in enumerate(episodes)
        if episode_id in validation_episodes
        for index in indices
    }
    validation_set = forced_validation | held_out
    validation = tuple(
        index for index in range(len(samples)) if index in validation_set
    )
    train = tuple(index for index in range(len(samples)) if index not in validation_set)
    train_labels = {samples[index].label for index in train}
    validation_labels = {samples[index].label for index in validation}
    validated = tuple(
        label
        for label in classes
        if label in train_labels and label in validation_labels
    )
    unvalidated = tuple(label for label in classes if label not in validated)
    validation_episode_names = {
        samples[index].episode or f"validation:{index}" for index in forced_validation
    }
    return EpisodeSplit(
        train,
        validation,
        validated,
        unvalidated,
        len(episodes) + len(validation_episode_names),
    )
