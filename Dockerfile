FROM node:22-alpine
WORKDIR /app
COPY server ./server
COPY www ./www
ENV PORT=3000 DB_PATH=/data/bizcontrol.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server/server.js"]
