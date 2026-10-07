"""Read and atomically replace generated definitions without partial writes."""

from __future__ import annotations

import ast
import os
import stat
import tempfile
from contextlib import suppress
from dataclasses import dataclass
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
        and (
            # Unpacked dictionaries and dynamically computed settings cannot be
            # proved tenant-free without evaluating authored code. Fail closed.
            node.arg is None
            or (
                node.arg == "tenant_key"
                and not (isinstance(node.value, ast.Constant) and node.value.value is None)
            )
        )
        for node in ast.walk(tree)
    )


@dataclass(frozen=True)
class _Snapshot:
    contents: str
    identity: tuple[int, int, int, int, int]
    mode: int


def _file_identity(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size)


class GeneratedFile:
    def __init__(self, path: Path) -> None:
        self.path = path.absolute()
        self._snapshot: _Snapshot | None = None
        self._observed = False

    def preflight(self) -> None:
        for ancestor in (self.path, *self.path.parents):
            if ancestor.is_symlink():
                raise CliError("The output and its parents must not be symlinks.")
        if self.path.exists() and not self.path.is_file():
            raise CliError("The output must be a regular file.")
        for parent in self.path.parents:
            if parent.exists() and not parent.is_dir():
                raise CliError("Output parents must be directories.")

    def _read_snapshot(self) -> _Snapshot | None:
        self.preflight()
        try:
            with self.path.open(encoding="utf-8") as source:
                before = os.fstat(source.fileno())
                contents = source.read()
                after = os.fstat(source.fileno())
            if _file_identity(before) != _file_identity(after):
                raise CliError(
                    "Definitions changed while reading; retry after other writers finish."
                )
            return _Snapshot(
                contents,
                _file_identity(after),
                stat.S_IMODE(after.st_mode),
            )
        except FileNotFoundError:
            return None
        except (OSError, UnicodeError) as exc:
            raise CliError(
                "Cannot read dataset definitions; check encoding and permissions."
            ) from exc

    def read(self) -> str | None:
        self._snapshot = self._read_snapshot()
        self._observed = True
        return self._snapshot.contents if self._snapshot is not None else None

    def _check_unchanged(self) -> None:
        if self._read_snapshot() != self._snapshot:
            raise CliError(
                "Definitions changed since discovery began; refusing to overwrite. "
                "Review the latest file and retry."
            )

    def write(self, contents: str, *, overwrite: bool) -> None:
        if not self._observed:
            self.read()
        self.preflight()
        lock = self.path.with_name(f".{self.path.name}.lock")
        locked = False
        temporary: Path | None = None
        created_directories: list[Path] = []
        try:
            missing = []
            for directory in self.path.parents:
                if directory.exists():
                    break
                missing.append(directory)
            for directory in reversed(missing):
                try:
                    directory.mkdir()
                except FileExistsError:
                    self.preflight()
                else:
                    created_directories.append(directory)
            # A per-destination exclusive directory serializes CLI writers for
            # the validation/replacement interval, without advisory-lock APIs.
            try:
                lock.mkdir(mode=0o700)
            except FileExistsError as exc:
                raise CliError(
                    "Another generator owns the output lock. Retry after it finishes; "
                    "remove the lock directory only if that process has stopped."
                ) from exc
            locked = True
            self._check_unchanged()
            if overwrite and self._snapshot is not None:
                if has_tenant_configuration(self._snapshot.contents):
                    raise CliError(
                        "Refusing to replace tenant boundaries or indirect settings. "
                        "Generate to a separate file and merge changes manually."
                    )
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
            self._check_unchanged()
            if overwrite and self._snapshot is not None:
                # Keep temporary and replacement files private; never widen an
                # existing file's permissions, including executable bits.
                temporary.chmod(self._snapshot.mode & 0o600)
                self._check_unchanged()
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
            if locked:
                with suppress(OSError):
                    lock.rmdir()
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink(missing_ok=True)
            for directory in reversed(created_directories):
                with suppress(OSError):
                    directory.rmdir()
