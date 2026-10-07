"""Read and atomically replace generated definitions without partial writes."""

from __future__ import annotations

import ast
import os
import stat
import tempfile
from contextlib import suppress
from pathlib import Path

from ..errors import CliError


def has_tenant_configuration(source: str) -> bool:
    """Inspect authored definitions without executing their code."""
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        raise CliError(
            "Cannot verify existing definitions; repair their Python syntax first."
        ) from exc
    return any(
        isinstance(node, ast.keyword)
        and node.arg == "tenant_key"
        and not (isinstance(node.value, ast.Constant) and node.value.value is None)
        for node in ast.walk(tree)
    )


class GeneratedFile:
    def __init__(self, path: Path) -> None:
        self.path = path.absolute()

    def preflight(self) -> None:
        for ancestor in (self.path, *self.path.parents):
            if ancestor.is_symlink():
                raise CliError("The output and its parents must not be symlinks.")
        if self.path.exists() and not self.path.is_file():
            raise CliError("The output must be a regular file.")
        for parent in self.path.parents:
            if parent.exists() and not parent.is_dir():
                raise CliError("Output parents must be directories.")

    def read(self) -> str | None:
        self.preflight()
        try:
            return self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError) as exc:
            raise CliError(
                "Cannot read dataset definitions; check encoding and permissions."
            ) from exc

    def write(self, contents: str, *, overwrite: bool) -> None:
        self.preflight()
        temporary: Path | None = None
        created_directories: list[Path] = []
        try:
            missing = []
            for directory in self.path.parents:
                if directory.exists():
                    break
                missing.append(directory)
            for directory in reversed(missing):
                directory.mkdir()
                created_directories.append(directory)
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=self.path.parent,
                prefix=f".{self.path.name}.",
                suffix=".tmp",
                delete=False,
            ) as output:
                temporary = Path(output.name)
                output.write(contents)
                output.flush()
                os.fsync(output.fileno())
            self.preflight()
            if overwrite:
                # Keep temporary and replacement files private; never widen an
                # existing file's permissions, including executable bits.
                mode = stat.S_IMODE(self.path.stat().st_mode) if self.path.exists() else 0o600
                temporary.chmod(mode & 0o600)
                os.replace(temporary, self.path)
            else:
                # Linking is an exclusive create even if a competing process
                # wrote the destination after discovery or the preflight read.
                os.link(temporary, self.path)
        except FileExistsError as exc:
            raise CliError(
                "Refusing to overwrite existing definitions; use --diff or --force."
            ) from exc
        except OSError as exc:
            raise CliError("Cannot write definitions; check output permissions.") from exc
        finally:
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink(missing_ok=True)
            for directory in reversed(created_directories):
                with suppress(OSError):
                    directory.rmdir()
