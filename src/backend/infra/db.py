import os
from pathlib import Path

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# backend/infra/db.py → repo root
ROOT = Path(__file__).resolve().parents[3]


def load_env() -> None:
    p = ROOT / ".env"
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        s = line.strip()
        if s.startswith("export "):
            s = s[7:].strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        os.environ.setdefault(k, v)


load_env()

_pool: ConnectionPool | None = None


def pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        url = os.environ.get("DATABASE_URL")
        if not url:
            raise RuntimeError("DATABASE_URL missing (.env at repo root)")
        _pool = ConnectionPool(url, kwargs={"row_factory": dict_row}, min_size=1, max_size=8)
    return _pool


def fetch(sql: str, params: tuple = ()):
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall()


def fetchone(sql: str, params: tuple = ()):
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()


def execute(sql: str, params: tuple = ()):
    with pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)


def iterate(sql: str, params: tuple = (), *, batch_size: int = 200):
    """Yield rows from a server-side cursor without buffering the result set."""
    with pool().connection() as conn:
        with conn.cursor(name=f"yadl_stream_{os.urandom(6).hex()}") as cur:
            cur.itersize = batch_size
            cur.execute(sql, params)
            yield from cur


def apply_schema() -> None:
    sql = (ROOT / "schema.sql").read_text()
    with pool().connection() as conn:
        with conn.cursor() as cur:
            for stmt in sql.split(";"):
                s = stmt.strip()
                if s:
                    cur.execute(s)
