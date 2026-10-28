FROM node:24-alpine
ENV NODE_ENV=production PORT=80 FITORA_DATA_DIR=/data
WORKDIR /app
COPY index.html app.css app.js enhancements.js fitora-plus.js fitora-full.js native-health.js privacy-policy.html privacypolicy.html manifest.webmanifest sw.js icon.svg icon-192.png icon-512.png server.js ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

