FROM node:22-alpine AS deps
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend ./
EXPOSE 4000
CMD ["npm", "run", "start"]
