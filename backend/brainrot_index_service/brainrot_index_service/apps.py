from django.contrib.admin.apps import AdminConfig


class OwnerAdminConfig(AdminConfig):
    """Django's admin, with OwnerAdminSite as admin.site."""

    default_site = 'brainrot_index_service.admin_site.OwnerAdminSite'
