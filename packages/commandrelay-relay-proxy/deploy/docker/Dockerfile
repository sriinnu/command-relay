FROM node:22-alpine

WORKDIR /opt/commandrelay-relay-proxy

RUN npm install -g @commandrelay/relay-proxy@0.1.0

COPY docker-entrypoint.sh /usr/local/bin/relay-proxy-entrypoint.sh
RUN chmod +x /usr/local/bin/relay-proxy-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 8788
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - "http://127.0.0.1:8788/health" | grep -q '"status"' || exit 1

ENTRYPOINT ["/usr/local/bin/relay-proxy-entrypoint.sh"]
