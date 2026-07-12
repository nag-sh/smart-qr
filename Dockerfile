# syntax=docker/dockerfile:1

# ---------- Build the client ----------
FROM node:22-slim AS build
WORKDIR /app
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
RUN cd client && npm run build

# ---------- Runtime ----------
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5005
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/index.js server/db.js ./
COPY --from=build /app/client/dist ./client/dist
EXPOSE 5005
CMD ["node", "index.js"]
