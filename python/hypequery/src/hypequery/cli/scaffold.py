"""Safe creation of the packaged Python project scaffold."""

from __future__ import annotations

from pathlib import Path

from .errors import CliError
from .utils.templates import load_templates


class Scaffold:
    def __init__(self, destination: Path) -> None:
        # Do not resolve symlinks: reject them before touching the destination.
        self.destination = destination.absolute()

    def create(self) -> Path:
        templates = load_templates()
        written: list[Path] = []
        try:
            self._preflight(list(templates))
            self.destination.mkdir(parents=True, exist_ok=True)
            for name, content in templates.items():
                path = self.destination / name
                with path.open("x", encoding="utf-8") as output:
                    written.append(path)
                    output.write(content)
        except OSError as exc:
            # Only remove files this invocation exclusively created.
            for path in written:
                path.unlink(missing_ok=True)
            raise CliError(
                "Cannot create the project; check destination permissions and existing files."
            ) from exc
        return self.destination

    def _preflight(self, names: list[str]) -> None:
        for ancestor in (self.destination, *self.destination.parents):
            if ancestor.is_symlink():
                raise CliError("The destination and its parents must not be symlinks.")
        if self.destination.exists() and not self.destination.is_dir():
            raise CliError("The destination must be a directory.")
        collisions = [
            name
            for name in names
            if (self.destination / name).exists() or (self.destination / name).is_symlink()
        ]
        if collisions:
            raise CliError(f"Refusing to overwrite existing paths: {', '.join(collisions)}")
