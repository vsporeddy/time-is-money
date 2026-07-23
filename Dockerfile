# Builds and runs just the "server" workspace. The client is built separately
# and shipped to itch.io as a static bundle — it does not run in this image.
FROM node:20-slim
WORKDIR /app

COPY . .
RUN npm ci

EXPOSE 8080
ENV PORT=8080
CMD ["npm", "run", "start", "--workspace=server"]
