"""WSGI entry point for PythonAnywhere and standard WSGI servers (Gunicorn/uWSGI)."""

from pathlib import Path
import sys

PROJECT_DIR = Path(__file__).resolve().parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from server import create_app

application = create_app()
