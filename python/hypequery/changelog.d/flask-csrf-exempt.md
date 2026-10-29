- `hypequery.contrib.flask.blueprint(api, csrf=csrf)` takes Flask-WTF's
  `CSRFProtect`: an API reading a header credential (bearer, API key, JWT) is
  exempted from its check, as the Django adapter's views are, so Flask-WTF's
  own `400 The CSRF token is missing` no longer answers every `POST` below the
  prefix before the API runs. An API authenticated by the app's own login
  (`flask_session`) stays checked, alongside the core's same-origin check.
