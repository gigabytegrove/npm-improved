# Backend development configuration

Files in this directory are development-time backend configuration assets.

They are not intended to be copied directly into a production NPM Improved deployment unless a specific build or test path explicitly consumes them.

Production runtime configuration is assembled by the Docker image, persisted state under `/data`, environment variables, and generated Nginx configuration.
