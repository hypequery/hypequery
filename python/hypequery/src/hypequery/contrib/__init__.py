"""Glue for the frameworks hypequery is commonly embedded in.

Each submodule is optional and imports its framework only when imported itself:
``hypequery.contrib.django``, ``hypequery.contrib.flask`` and
``hypequery.contrib.sqlalchemy``. Nothing here is imported by the rest of the
package.
"""

from __future__ import annotations
