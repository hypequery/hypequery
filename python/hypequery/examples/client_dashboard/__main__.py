"""Run from python/hypequery: python -m examples.client_dashboard."""

from hypequery.serve import start_server

from .api import create_application

start_server(create_application())
