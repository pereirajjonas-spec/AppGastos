FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN chmod +x /app/docker-entrypoint.sh && chown -R node:node /app
# Banco (com as fotos das notas) fica em /data: monte um disco persistente nesse caminho.
ENV NODE_ENV=production PORT=3100 DB_PATH=/data/gastos.db
VOLUME /data
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# O entrypoint começa como root só para ajustar /data e então executa o app como "node".
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
