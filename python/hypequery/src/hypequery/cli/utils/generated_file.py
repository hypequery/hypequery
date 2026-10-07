"""Read and atomically replace generated definitions without partial writes."""

from __future__ import annotations

import os
import stat
import tempfile
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from ..errors import CliError
from .tenant_settings import ensure_replaceable


@dataclass(frozen=True)
class _Snapshot:
    contents: str
    identity: tuple[int, int, int, int, int]
    mode: int


def _file_identity(info: os.stat_result) -> tuple[int, int, int, int, int]:
    return (info.st_dev, info.st_ino, info.st_mtime_ns, info.st_ctime_ns, info.st_size)


def _default_mode() -> int:
    # os.umask can only be read by setting it; the CLI is single-threaded.
    umask = os.umask(0o022)
    os.umask(umask)
    return 0o666 & ~umask


def _create_exclusive(temporary: Path, path: Path, contents: str, mode: int) -> None:
    """Create without replacing a file that appeared after the last check."""
    try:
        # Linking publishes the complete temporary file in one step.
        os.link(temporary, path)
        return
    except FileExistsError:
        raise
    except OSError:
        pass  # Some filesystems (FAT, certain network mounts) lack hard links.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            output.write(contents)
            output.flush()
            os.fsync(output.fileno())
    except BaseException:
        # This invocation created the file exclusively, so removal is safe.
        with suppress(OSError):
            path.unlink()
        raise


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

    def ensure_unchanged(self) -> None:
        """Re-read without writing; read-only checks must not trust a stale snapshot."""
        if self._read_snapshot() != self._snapshot:
            raise CliError(
                "Definitions changed since discovery began; review the latest file and retry."
            )

    def _acquire(self, lock: Path) -> None:
        # A per-destination exclusive directory serializes CLI writers for
        # the validation/replacement interval, without advisory-lock APIs.
        try:
            lock.mkdir(mode=0o700)
        except FileExistsError as exc:
            try:
                owner = f" (process {(lock / 'pid').read_text().strip()})"
            except OSError:
                owner = ""
            raise CliError(
                f"Another generator{owner} owns the output lock {lock}. Retry after it "
                "finishes; remove the lock directory only if that process has stopped."
            ) from exc
        with suppress(OSError):
            (lock / "pid").write_text(f"{os.getpid()}\n")

    @staticmethod
    def _release(lock: Path) -> None:
        with suppress(OSError):
            (lock / "pid").unlink(missing_ok=True)
        with suppress(OSError):
            lock.rmdir()

    def write(self, contents: str, *, overwrite: bool) -> None:
        if not self._observed:
            self.read()
        self.preflight()
        lock = self.path.with_name(f".{self.path.name}.lock")
        locked = False
        succeeded = False
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
            self._acquire(lock)
            locked = True
            self.ensure_unchanged()
            if overwrite and self._snapshot is not None:
                ensure_replaceable(self._snapshot.contents, self.path)
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
            self.ensure_unchanged()
            # The temporary file stays private while written; publish it with
            # the existing file's mode, or the umask default for a new file.
            mode = self._snapshot.mode if self._snapshot is not None else _default_mode()
            temporary.chmod(mode)
            if overwrite and self._snapshot is not None:
                self.ensure_unchanged()
                os.replace(temporary, self.path)
            else:
                _create_exclusive(temporary, self.path, contents, mode)
            succeeded = True
        except FileExistsError as exc:
            raise CliError(
                "Refusing to overwrite existing definitions; use --diff or --force."
            ) from exc
        except OSError as exc:
            raise CliError("Cannot write definitions; check output permissions.") from exc
        finally:
            if locked:
                self._release(lock)
            if temporary is not None:
                with suppress(OSError):
                    temporary.unlink(missing_ok=True)
            if not succeeded:
                for directory in reversed(created_directories):
                    with suppress(OSError):
                        directory.rmdir()
