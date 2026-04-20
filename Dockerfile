FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY package.json server.mjs server.ps1 ./
COPY public ./public
COPY scripts ./scripts
EXPOSE 8080
USER node
CMD ["node", "server.mjs"]
