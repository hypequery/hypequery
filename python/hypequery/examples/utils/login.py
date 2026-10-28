"""Login CSRF for the examples' stand-in sign-in forms.

A sign-in a different site's page can submit swaps the victim's session for
the attacker's account, so the sign-in view checks where the post came from,
by the same rule as the API's same-origin check.
"""

from __future__ import annotations


def same_origin_form(sec_fetch_site: str | None, origin: str | None, own_origin: str) -> bool:
    """Whether a form post came from the app's own pages.

    A browser with Fetch Metadata says so in ``Sec-Fetch-Site``: ``same-origin``,
    or ``none`` for the user's own action. One without it still sends
    ``Origin`` on a post, which must be the app's own (*own_origin*,
    ``scheme://host[:port]``). A post with neither is refused: nothing shows
    where it came from.
    """

    if sec_fetch_site is not None:
        return sec_fetch_site in ("same-origin", "none")
    return origin is not None and origin == own_origin
