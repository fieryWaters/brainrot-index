"""Request body validation for the email/password auth endpoints."""

from rest_framework import serializers


class EmailPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()


class SignupSerializer(EmailPasswordSerializer):
    invite_code = serializers.CharField(required=False, allow_blank=True, default='')


class EmailOnlySerializer(serializers.Serializer):
    email = serializers.EmailField()


class TokenOnlySerializer(serializers.Serializer):
    token = serializers.CharField()


class ResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField()
