"""Demo-only sign-in: `X-Demo-User: ada` authenticates as the user "ada".

Django's RemoteUserMiddleware reads a username a trusted proxy puts in a
header; here the client sends it so the demo needs no login form. Remove both
classes from settings.py and your session login sets request.user as usual.
Never deploy this: any caller can name any user.
"""

from django.contrib.auth.backends import RemoteUserBackend
from django.contrib.auth.middleware import RemoteUserMiddleware


class DemoUserHeaderMiddleware(RemoteUserMiddleware):
    header = "HTTP_X_DEMO_USER"


class DemoUserBackend(RemoteUserBackend):
    create_unknown_user = False  # only users that exist in the ORM
