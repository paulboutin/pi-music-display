# Use an official Node.js image
FROM node:21.4.0

# Set the working directory
WORKDIR /app

# Install SoX and the necessary format libraries
RUN apt-get update && apt-get install -y sox libsox-fmt-all && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of your application code
COPY . .

# Expose a port if your app uses one (for a web server, e.g., 3000)
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
