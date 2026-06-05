"""
Router: Projektstand als ZIP exportieren und importieren.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.config import settings
from app.services.project_archive_service import ProjectArchiveService

router = APIRouter()
_archive_svc = ProjectArchiveService()


@router.post("/videos/{video_id}/export-project")
async def export_project(video_id: str) -> dict:
    try:
        return _archive_svc.export_project(video_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/videos/{video_id}/project/{filename}")
async def download_project(video_id: str, filename: str) -> FileResponse:
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ungueltiger Dateiname")
    path = settings.render_output_dir / video_id / filename
    if not path.exists() or path.suffix.lower() != ".zip" or not filename.startswith("project_"):
        raise HTTPException(status_code=404, detail="Projekt-ZIP nicht gefunden")
    return FileResponse(str(path), media_type="application/zip", filename=filename)


@router.post("/projects/import")
async def import_project_zip(
    file: UploadFile = File(...),
    restore_mode: str = Form(default="new_id"),
) -> dict:
    suffix = Path(file.filename or "project.zip").suffix.lower()
    if suffix != ".zip":
        raise HTTPException(status_code=415, detail="Nur ZIP-Dateien sind erlaubt.")
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
            tmp_path = Path(tmp.name)
            while chunk := await file.read(1024 * 1024):
                tmp.write(chunk)
        try:
            return _archive_svc.import_project(tmp_path, restore_mode)
        finally:
            tmp_path.unlink(missing_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
