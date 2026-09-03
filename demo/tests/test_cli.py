import json
from pathlib import Path

from backend.train import cli
from backend.train.data import HandDataset
from backend.train.trainer import TrainingResult


def test_cli_trains_project_and_reports_machine_readable_result(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    dataset = HandDataset(("fist", "open"), ())
    supplement = HandDataset(("neutral",), ())
    captured = {}
    monkeypatch.setattr(
        cli, "load_project_samples", lambda project_id, env_file: dataset
    )
    monkeypatch.setattr(cli, "load_landmark_sessions", lambda paths: supplement)

    def fake_train(got_dataset, output, *, config, device_name):
        captured.update(
            dataset=got_dataset, output=output, config=config, device=device_name
        )
        return TrainingResult(
            device="mps",
            training_samples=4,
            augmented_training_samples=16,
            validation_samples=2,
            validated_classes=("fist",),
            unvalidated_classes=("open",),
            training_accuracy=1.0,
            validation_accuracy=0.5,
            validation_macro_f1=0.4,
            validation_balanced_accuracy=0.5,
            per_class_precision={"fist": 1.0},
            per_class_recall={"fist": 0.5},
            approved=False,
            temperature=1.0,
            accelerator_verified=True,
        )

    monkeypatch.setattr(cli, "train_classifier", fake_train)
    output = tmp_path / "model.pt"

    exit_code = cli.main(
        [
            "--project-id",
            "project-id",
            "--env-file",
            str(tmp_path / ".env"),
            "--output",
            str(output),
            "--device",
            "mps",
            "--epochs",
            "12",
            "--supplement",
            str(tmp_path / "capture.jsonl"),
        ]
    )

    report = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert report["device"] == "mps"
    assert report["accelerator_verified"] is True
    assert captured["dataset"].classes == ("fist", "open", "neutral")
    assert captured["output"] == output
    assert captured["config"].epochs == 12
    assert captured["device"] == "mps"
