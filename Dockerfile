FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME /data
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:${PORT:-3000}/healthz || exit 1
USER node
CMD ["node", "server.js"]
