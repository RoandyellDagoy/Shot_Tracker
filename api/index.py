import sys
from pathlib import Path

# Ensure project root is on sys.path in Vercel serverless environment
ROOT_DIR = str(Path(__file__).resolve().parent.parent)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from backend.main import app
