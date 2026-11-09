# NodeCat: imagen mínima con Node.js 22 (SQLite integrado, sin dependencias externas)
FROM node:22-alpine

ENV NODE_ENV=production \
    PUERTO=8080 \
    DATA_DIR=/data \
    TZ=America/Caracas

RUN apk add --no-cache tzdata su-exec \
 && mkdir -p /data && chown node:node /data

WORKDIR /app
COPY --chown=node:node servidor/ ./

# Arranca como root solo para dar la carpeta de datos al usuario node, y sigue sin privilegios
RUN printf '#!/bin/sh\nchown -R node:node /data 2>/dev/null\nexec su-exec node "$@"\n' > /usr/local/bin/entrada && chmod +x /usr/local/bin/entrada
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/salud || exit 1

ENTRYPOINT ["/usr/local/bin/entrada"]
CMD ["node", "nodecat.js"]
