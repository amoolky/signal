# Signal runs its Vite dev server in the container: the program-data / project API
# routes live in a dev-only Vite plugin (configureServer), so a production `vite build`
# would drop every /api/* route. Same interim runtime as echo.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Keep a copy of the committed demo data; the entrypoint restores it into the
# /app/output volume on first boot (see compose.yaml + docker-entrypoint.sh).
RUN cp -a output /app/output-seed && chmod +x docker-entrypoint.sh
EXPOSE 5181
ENTRYPOINT ["./docker-entrypoint.sh"]
# --host 0.0.0.0 is already set in the package.json "dev" script.
CMD ["npm", "run", "dev", "--", "--port", "5181"]
