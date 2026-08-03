FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p src/data
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]
