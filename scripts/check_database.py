import json
import os
import sqlite3
import sys
from pathlib import Path


def main() -> int:
    database_path = Path(
        os.environ.get(
            "RECOVERY_DB_PATH",
            Path(__file__).resolve().parents[1] / "data" / "recovery-store.sqlite",
        )
    )
    if not database_path.is_file():
        print(f"Database not found: {database_path}", file=sys.stderr)
        return 1

    try:
        connection = sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)
        try:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise ValueError(f"SQLite integrity check failed: {integrity}")

            columns = {
                row[1] for row in connection.execute("PRAGMA table_info(recovery_state)")
            }
            if not {"id", "payload"}.issubset(columns):
                raise ValueError("recovery_state table is missing required columns")

            row = connection.execute(
                "SELECT payload FROM recovery_state WHERE id = 1"
            ).fetchone()
            if row is None:
                raise ValueError("recovery_state is missing its state row")
            state = json.loads(row[0])
            if not isinstance(state, dict):
                raise ValueError("Recovery state must be a JSON object")
            if not isinstance(state.get("auditLog"), list):
                raise ValueError("Recovery state auditLog must be a list")
            if not isinstance(state.get("promises"), list):
                raise ValueError("Recovery state promises must be a list")
            metrics = state.get("metrics")
            if not isinstance(metrics, dict) or not isinstance(metrics.get("byLossType"), dict):
                raise ValueError("Recovery state metrics are missing or invalid")
            if not all(isinstance(item, dict) for item in state["auditLog"] + state["promises"]):
                raise ValueError("Audit and promise records must be JSON objects")
        finally:
            connection.close()
    except (sqlite3.Error, OSError, ValueError, json.JSONDecodeError) as error:
        print(f"Database check failed: {error}", file=sys.stderr)
        return 1

    print(
        f"Database OK: {database_path} "
        f"({len(state['auditLog'])} audit records, {len(state['promises'])} promises)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
