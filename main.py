"""
Main application entry point for Uvicorn / Gunicorn server.
Re-exports FastAPI application instance from app.py.
"""
import os
from app import app

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
