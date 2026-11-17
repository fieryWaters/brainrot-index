from django.urls import path
from . import account_views, auth_views
from .views import auth_google, health

urlpatterns = [
    path('health/', health.health_check, name='health_check'),

    # Auth
    path('auth/csrf/', auth_views.csrf_bootstrap, name='auth_csrf'),
    path('auth/google/', auth_google.authenticate_with_google, name='authenticate_with_google'),
    path('auth/me/', auth_google.current_session, name='current_session'),
    path('auth/signup/', auth_views.signup, name='auth_signup'),
    path('auth/login/', auth_views.login_view, name='auth_login'),
    path('auth/logout/', auth_views.logout_view, name='auth_logout'),
    path('auth/verify-email/', auth_views.verify_email, name='auth_verify_email'),
    path('auth/resend-verification/', auth_views.resend_verification, name='auth_resend_verification'),
    path('auth/password-reset/request/', auth_views.password_reset_request, name='auth_password_reset_request'),
    path('auth/password-reset/confirm/', auth_views.password_reset_confirm, name='auth_password_reset_confirm'),

    # The signed-in person's own account
    path('account/change-password/', account_views.change_password, name='account_change_password'),
    path('account/sign-out-everywhere/', account_views.sign_out_everywhere, name='account_sign_out_everywhere'),
    path('account/export/', account_views.export_account_data, name='account_export'),
    path('account/delete/', account_views.delete_account, name='account_delete'),
]
