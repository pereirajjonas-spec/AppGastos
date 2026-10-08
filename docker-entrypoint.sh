#!/bin/sh
# Discos persistentes costumam montar /data como "root". Ajusta a pasta e só então
# passa a rodar o app como usuário comum (node), sem privilégios de administrador.
set -e
mkdir -p /data
chown -R node:node /data 2>/dev/null || true
exec runuser -u node -- "$@"
