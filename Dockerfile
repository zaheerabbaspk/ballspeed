# Use a stable Node.js image
FROM node:18-bullseye

# Install FFmpeg and clean up to keep image small
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Expose the port (Render will override this with PORT env anyway)
EXPOSE 3000

# Start the server
CMD [ "npm", "start" ]
