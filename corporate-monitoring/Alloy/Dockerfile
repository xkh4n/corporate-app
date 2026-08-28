FROM grafana/alloy:v1.18.0

LABEL org.opencontainers.image.authors="osvaldorojasg@gmail.com"
LABEL maintainer="Osvaldo Rojas G."

# Config estática con sys.env() para lo poco que varía por ambiente (LOKI_HOST,
# SUFFIX): Alloy soporta variables de entorno nativamente en su lenguaje de
# configuración, a diferencia de Prometheus -no hace falta wrapper ni sed/
# envsubst acá, ver config.alloy-.
COPY config.alloy /etc/alloy/config.alloy

# ENTRYPOINT/CMD de la imagen base ya son
# ["/bin/alloy"] ["run", "/etc/alloy/config.alloy", "--storage.path=/var/lib/alloy/data"]:
# no hace falta redefinirlos, solo pisar el archivo de config default.

# La imagen base corre como root por defecto -necesario SOLO cuando Alloy
# monta /var/run/docker.sock directo, para poder leerlo/escribirlo-. Ahora que
# habla con el socket por red a través de dockerproxydev (ver config.alloy y
# el hallazgo crítico de auditoría en compose.dev.yml), ya no hace falta root:
# la imagen ya trae un usuario dedicado "alloy" (uid 473) con ownership
# correcto de /etc/alloy y /var/lib/alloy, así que alcanza con seleccionarlo.
USER alloy

# UI de debug de Alloy (no se publica al host: solo NGINX publica puertos en
# este proyecto). Útil para inspeccionar el pipeline con "docker exec"/port-
# forward manual si hace falta debuggear.
EXPOSE 12345
