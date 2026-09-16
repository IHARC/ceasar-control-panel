# Private Nginx origin for the HAProxy account edge.
# Ceasar still owns the server names and native document roots. TLS and public
# listeners are deliberately absent: only HAProxy may reach this origin.
server {
    listen 127.0.0.1:%proxy_port%;
    listen [::1]:%proxy_port%;
    server_name %domain_idn% %alias_idn%;
    set $iharc_account %user%;

    # Check the transport peer, before trusting the forwarded client address.
    if ($realip_remote_addr !~ "^(127[.]0[.]0[.]1|::1)$") { return 444; }
    # Only the public HAProxy edge writes this header. The native nft OUTPUT
    # hook also denies customer UIDs from reaching this loopback origin.
    if ($http_x_iharc_private_edge != "1") { return 444; }
    real_ip_header X-Forwarded-For;
    set_real_ip_from 127.0.0.1;
    set_real_ip_from ::1;
    real_ip_recursive off;
    proxy_connect_timeout 5s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
    send_timeout 30s;
    error_log /var/log/%web_system%/domains/%domain%.error.log error;

    location ~ /\.(?!well-known/|file) {
        deny all;
        return 404;
    }

    location / {
        proxy_pass $iharc_customer_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
    }

    location @fallback {
        proxy_pass $iharc_customer_backend;
    }

    location /error/ {
        alias %home%/%user%/web/%domain%/document_errors/;
    }
    include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
