from fastapi import APIRouter
from fastapi.responses import Response

from .. import reports, services

router = APIRouter()


@router.get("/api/reports/finance")
def report_finance(start: str = None, end: str = None, period: str = "week"):
    return reports.finance(start, end, period)


@router.get("/api/reports/prices")
def report_prices():
    return reports.price_trends()


@router.get("/api/reports/nutrition")
def report_nutrition(start: str = None, end: str = None):
    return reports.nutrition(start, end)


@router.get("/api/reports/periods")
def report_periods():
    return reports.periods()


@router.get("/api/reports/period/{list_id}")
def report_period(list_id: int):
    return reports.period_report(list_id)


@router.get("/api/export.xlsx")
def export_xlsx():
    return Response(
        reports.export_xlsx(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="pantry-' + services.today().isoformat() + '.xlsx"'},
    )


@router.get("/api/export/{name}.csv")
def export_csv(name: str):
    return Response(
        reports.export_csv(name),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="pantry-' + name + "-" + services.today().isoformat() + '.csv"'},
    )
