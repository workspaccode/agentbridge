FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 AGENTBRIDGE_RELAY_DATA=/data
WORKDIR /app
COPY src/identity.mjs src/lan.mjs ./src/
COPY relay/server.mjs ./relay/
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "relay/server.mjs"]
