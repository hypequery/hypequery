"""Terminal questions for guided commands, using only the standard library.

Each question shows its default in brackets; pressing Enter accepts it.
Reading and writing go through injectable callables so tests can script a
whole conversation, and an interrupted or closed input ends the command as
"Setup cancelled" rather than with a traceback.
"""

from __future__ import annotations

import getpass
import sys
from collections.abc import Callable, Sequence
from typing import TextIO, TypeVar

T = TypeVar("T")


class SetupCancelledError(Exception):
    """The person stopped answering: Ctrl-C, or end of input."""


class Prompter:
    def __init__(
        self,
        read: Callable[[str], str] = input,
        read_secret: Callable[[str], str] = getpass.getpass,
        output: TextIO | None = None,
    ) -> None:
        self._read = read
        self._read_secret = read_secret
        self._output = output

    @property
    def output(self) -> TextIO:
        return sys.stdout if self._output is None else self._output

    def say(self, text: str = "") -> None:
        print(text, file=self.output)

    def text(self, question: str, default: str = "") -> str:
        """Free text; Enter gives *default*."""

        suffix = f" [{default}]" if default else ""
        answer = self._ask(self._read, f"{question}{suffix}: ").strip()
        return answer or default

    def secret(self, question: str) -> str:
        """Hidden input, never echoed; Enter gives an empty string."""

        return self._ask(self._read_secret, f"{question}: ")

    def confirm(self, question: str, default: bool = True) -> bool:
        hint = "Y/n" if default else "y/N"
        while True:
            answer = self._ask(self._read, f"{question} [{hint}]: ").strip().lower()
            if not answer:
                return default
            if answer in ("y", "yes"):
                return True
            if answer in ("n", "no"):
                return False
            self.say("Please answer y or n.")

    def choose(self, question: str, choices: Sequence[tuple[T, str]], default: int = 0) -> T:
        """One of *choices*, by number; Enter gives the choice at index *default*."""

        self.say(question)
        for index, (_, label) in enumerate(choices, start=1):
            marker = "  (default)" if index - 1 == default else ""
            self.say(f"  {index}) {label}{marker}")
        while True:
            answer = self._ask(self._read, f"Choose 1-{len(choices)} [{default + 1}]: ").strip()
            if not answer:
                return choices[default][0]
            if answer.isdigit() and 1 <= int(answer) <= len(choices):
                return choices[int(answer) - 1][0]
            self.say(f"Please enter a number from 1 to {len(choices)}.")

    def _ask(self, read: Callable[[str], str], prompt: str) -> str:
        try:
            return read(prompt)
        except (EOFError, KeyboardInterrupt):
            raise SetupCancelledError from None
