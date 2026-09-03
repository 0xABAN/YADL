import json
from pathlib import Path

from backend.train import cli
from backend.train.data import HandDataset
from backend.train.trainer import TrainingResult


def test_cli_trains_project_and_reports_machine_readable_result(
    monkeypatch, capsys, tmp_path: Path
) -> None:
    dataset = HandDataset(("fist", "open"), ())
    captured = {}
    monkeypatch.setattr(cli, "load_project_samples", lambda project_id, env_file: dataset)

    def fake_train(got_dataset, output, *, config, device_name):
        captured.update(dataset=got_dataset, output=output, config=config, device=device_name)
        return TrainingResult("mps", 4, 16, 2, ("fist",), ("open",), 1.0, 0.5, 0.4, True)

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
        ]
    )

    report = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert report["device"] == "mps"
    assert report["accelerator_verified"] is True
    assert captured["dataset"] is dataset
    assert captured["output"] == output
    assert captured["config"].epochs == 12
    assert captured["device"] == "mps"
