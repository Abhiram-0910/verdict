FROM node:22-bookworm-slim

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci

# Install Playwright Chromium & OS dependencies
# This is explicitly required because Chromium is not bundled in the npm package
RUN npx playwright install --with-deps chromium

# Copy application source
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose dynamic port (Render injects PORT)
EXPOSE 3001

# Start the compiled server
CMD ["node", "dist/server.js"]
