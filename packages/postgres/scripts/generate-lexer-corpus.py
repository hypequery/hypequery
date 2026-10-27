"""Generate the raw-SQL lexer corpus with Postgres's own scanner as the oracle.

    uv run --with 'pglast>=7' python -I packages/postgres/scripts/generate-lexer-corpus.py

pglast embeds libpg_query, which is Postgres's own `scan.l`. For each generated
expression the corpus records, per character, how Postgres reads it: `l`
inside a string constant or quoted identifier, `k` inside a comment, `c` code
(a `;` is code). An expression Postgres can't scan is recorded as `null`.
`strip-literals.test.ts` holds `stripPostgresLiterals` to it: whatever the
lexer accepts must be read the same way by Postgres, character for character.

Generation is seeded, so the corpus only changes when this script does.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

from pglast import parser

SEED = 20261027
#: Random expressions Postgres can scan, and at most this many it can't.
SCANNABLE_CASES = 2500
UNSCANNABLE_CASES = 400
OUT = Path(__file__).resolve().parent.parent / "src" / "tests" / "lexer-corpus.json"

# Pieces chosen for where Postgres lexers disagree: quote forms and prefixes,
# escapes, terminators and comments, continuations, `$`, non-ASCII, numbers.
PIECES = [
    "'", "''", '"', '""', "E'", "e'", "U&'", 'U&"', "B'", "X'", "N'",
    "\\", "\\'", "\\\\", ";", "--", "/*", "*/", "\n", " ", "\t", "\r", "\f",
    "a", "x", "E", "e", "1", "1.", "0x", "_", "ä", "é", "$", "$$", "$a$", "$1",
    ".", "(", ")", "||", "-", "/", "*", ",", "=",
]

# Hand-written cases that must stay in the corpus whatever the seed draws.
FIXED = [
    "upper(region)", "'a;b' || x", "'it''s; fine'", "E'a\\';b'", "x || E'a\\';b'",
    "1.E'a\\';b'", '"weird;name"', "\"ä\" || 'ü;'", "$$ ; -- $$ || x", "$tag$ ; $tag$",
    "x = $1", "ä$x$ ; $x$", "1E'\\' ' ; SELECT 1 --'", "äE'\\' ; --'",
    "E'a'\n'\\' '; --'", "'a'\n'b;'", "'a' \n -- c\n'b'", "U&'d\\0061t'",
    "B'01''1'", "X'1F'", "N'n;'", "date'2026-01-01'", "1; DROP TABLE t",
    "x -- comment", "x /* c */", "'a\\'; DROP TABLE t", "'open", "$q$ open",
    "x /* /* nested */ */", "'\\'", "E'\\\\'", "E'\\\\' ; '", "e'\\''",
]

LITERAL_TOKENS = {"SCONST", "USCONST", "BCONST", "XCONST"}
COMMENT_TOKENS = {"SQL_COMMENT", "C_COMMENT"}


def classify(sql: str) -> str | None:
    """Per character: `l` literal, `k` comment, `c` code or whitespace; None if unscannable."""

    try:
        tokens = parser.scan(sql)
    except Exception:  # noqa: BLE001 - any scanner error means Postgres refuses it
        return None
    marks = ["c"] * len(sql)
    for token in tokens:
        # pglast reports character offsets, `end` inclusive.
        first, last = token.start, token.end
        text = sql[first : last + 1]
        if token.name in COMMENT_TOKENS:
            mark = "k"
        elif token.name in LITERAL_TOKENS or (
            token.name in ("IDENT", "UIDENT") and text.lstrip("Uu&").startswith('"')
        ):
            # The literal starts at its opening quote; a prefix (E, U&, B…) is code.
            opening = min(i for i in (text.find("'"), text.find('"'), text.find("$")) if i >= 0)
            mark, first = "l", first + opening
        else:
            continue
        for index in range(first, last + 1):
            marks[index] = mark
    return "".join(marks)


def main() -> None:
    rng = random.Random(SEED)
    cases: dict[str, str | None] = {sql: classify(sql) for sql in FIXED}
    scannable = unscannable = 0
    while scannable < SCANNABLE_CASES:
        sql = "".join(rng.choice(PIECES) for _ in range(rng.randint(1, 10)))
        if sql in cases:
            continue
        marks = classify(sql)
        if marks is None:
            if unscannable == UNSCANNABLE_CASES:
                continue
            unscannable += 1
        else:
            scannable += 1
        cases[sql] = marks
    header = {"postgres": ".".join(map(str, parser.get_postgresql_version())), "seed": SEED}
    # One case per line, so a regenerated corpus diffs readably.
    lines = [
        json.dumps({"sql": sql, "postgres": marks}, ensure_ascii=False) for sql, marks in cases.items()
    ]
    head = json.dumps(header)[:-1]
    OUT.write_text(f'{head}, "cases": [\n' + ",\n".join(lines) + "\n]}\n")
    print(f"wrote {len(cases)} cases to {OUT}", file=sys.stderr)


if __name__ == "__main__":
    main()
