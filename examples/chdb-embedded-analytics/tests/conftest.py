"""Run the suite on its own chDB directory, so a `pnpm dev` holding
analytics.chdb does not block it, and always on chDB: no server needed."""

import os
import tempfile

os.environ["CHDB_PATH"] = os.path.join(tempfile.mkdtemp(prefix="hq-chdb-"), "analytics.chdb")
os.environ.pop("ANALYTICS_BACKEND", None)
