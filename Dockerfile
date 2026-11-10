FROM node:20-alpine
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3028
CMD ["node", "server.js"]
