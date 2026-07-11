from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.conf.urls.static import static
from django.http import FileResponse, HttpResponse


def spa_index(request):
    index = settings.BASE_DIR / "static" / "frontend" / "index.html"
    if not index.exists():
        return HttpResponse(
            "Frontend not built. Run: cd frontend && npm run build",
            status=503,
            content_type="text/plain",
        )
    return FileResponse(open(index, "rb"), content_type="text/html")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("api.urls")),
] + static(settings.STATIC_URL, document_root=settings.STATIC_ROOT) + [
    re_path(r"^.*$", spa_index),
]
