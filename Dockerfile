# ---- Stage 1: Build ----
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- Stage 2: Create Production Image ----
FROM node:18-alpine
WORKDIR /app
# Copy only prod dependencies
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]