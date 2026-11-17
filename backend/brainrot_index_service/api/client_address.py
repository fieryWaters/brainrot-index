"""The address of the person making a request.

nginx works the address out and sends it as X-Real-IP, replacing whatever the
client sent: on the tunnel port it is Cloudflare's CF-Connecting-IP, on the
private port it is the address Caddy wrote into X-Forwarded-For. Gunicorn is
reachable only from nginx and from spark itself.
"""


def client_ip(request):
    return request.META.get('HTTP_X_REAL_IP') or request.META.get('REMOTE_ADDR')
