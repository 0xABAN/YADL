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
    for index, sample in enumerate(samples):
        if not episodes or episodes[-1][0] != sample.label:
            episodes.append((sample.label, []))
        episodes[-1][1].append(index)

    by_class: dict[str, list[int]] = {label: [] for label in classes}
    for episode_id, (label, _) in enumerate(episodes):
        if label in by_class:
            by_class[label].append(episode_id)
    validation_episodes = {
        episode_ids[-1]
        for episode_ids in by_class.values()
        if len(episode_ids) >= 2
    }
    validation = tuple(
        index
        for episode_id, (_, indices) in enumerate(episodes)
        if episode_id in validation_episodes
        for index in indices
    )
    validation_set = set(validation)
    train = tuple(index for index in range(len(samples)) if index not in validation_set)
    validated = tuple(label for label in classes if len(by_class[label]) >= 2)
    unvalidated = tuple(label for label in classes if len(by_class[label]) < 2)
    return EpisodeSplit(train, validation, validated, unvalidated, len(episodes))
