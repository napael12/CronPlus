from django.urls import re_path
from .consumers import RunLogConsumer, ProjectStatusConsumer, GlobalStatusConsumer

websocket_urlpatterns = [
    re_path(r"^ws/runs/(?P<run_id>\d+)/$", RunLogConsumer.as_asgi()),
    re_path(r"^ws/projects/(?P<project_id>\d+)/status/$", ProjectStatusConsumer.as_asgi()),
    re_path(r"^ws/status/$", GlobalStatusConsumer.as_asgi()),
]
