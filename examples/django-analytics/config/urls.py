from django.urls import path

from analytics import views

urlpatterns = [
    path("health", views.health),
    path("api/overview", views.overview),
    path("api/timeseries", views.timeseries),
    path("api/breakdown/<str:dimension>", views.breakdown),
]
