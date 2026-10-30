- Docs: `django_user`'s page must set Django's `csrftoken` cookie
  (`ensure_csrf_cookie`, or a template using `{% csrf_token %}`), or Django
  answers its own HTML `403` before hypequery runs. The `django_user` and
  `urls` docstrings and the `--framework django` scaffold's README now say so.
