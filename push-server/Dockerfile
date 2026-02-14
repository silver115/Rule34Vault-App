FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js ./

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 4829

CMD ["node", "server.js"]
