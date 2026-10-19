"""Export endpoints: CSV, Excel workbook, backup zip and restore."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core import export as exporter
from app.db import get_db

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/trades.csv")
def export_trades(db: Session = Depends(get_db)):
    return Response(
        exporter.trades_csv(db),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=trades.csv"},
    )


@router.get("/executions.csv")
def export_executions(db: Session = Depends(get_db)):
    return Response(
        exporter.executions_csv(db),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=executions.csv"},
    )


@router.get("/workbook.xlsx")
def export_workbook(db: Session = Depends(get_db)):
    return Response(
        exporter.workbook_xlsx(db),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=trade_journal.xlsx"},
    )


@router.get("/backup.zip")
def export_backup(db: Session = Depends(get_db)):
    return Response(
        exporter.backup_zip(db),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={exporter.backup_filename()}"},
    )


@router.post("/restore")
async def restore(file: UploadFile = File(...)):
    content = await file.read()
    return exporter.restore_zip(content)
