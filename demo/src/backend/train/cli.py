from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .data import load_landmark_sessions, load_project_samples, merge_datasets
from .trainer import TrainingConfig, train_classifier


def main(argv: list[str] | None = None) -> int:
    demo_root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Train a YADL hand-sign classifier")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--env-file", type=Path, default=demo_root.parent / ".env")
    parser.add_argument(
        "--output", type=Path, default=demo_root / "artifacts" / "hand-sign.pt"
    )
    parser.add_argument("--device", choices=("auto", "mps", "cuda"), default="auto")
    parser.add_argument("--epochs", type=int, default=TrainingConfig.epochs)
    parser.add_argument(
        "--target-per-class", type=int, default=TrainingConfig.target_per_class
    )
    parser.add_argument("--seed", type=int, default=TrainingConfig.seed)
    parser.add_argument(
        "--supplement",
        action="append",
        type=Path,
        default=[],
        help="landmark-only JSONL capture to merge into training",
    )
    args = parser.parse_args(argv)

    dataset = load_project_samples(args.project_id, env_file=args.env_file)
    if args.supplement:
        dataset = merge_datasets(dataset, load_landmark_sessions(args.supplement))
    result = train_classifier(
        dataset,
        args.output,
        config=TrainingConfig(
            epochs=args.epochs,
            target_per_class=args.target_per_class,
            seed=args.seed,
        ),
        device_name=args.device,
    )
    print(json.dumps(asdict(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
