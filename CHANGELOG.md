## [0.1.9] - 2026-05-13

### ⚙️ Miscellaneous Tasks

- Switch to develop branch after release
## [0.1.8] - 2026-05-13

### ⚙️ Miscellaneous Tasks

- Update version to 0.1.7 in README, CLAUDE, and OpenAPI files; enhance documentation in CHANGELOG
- *(release)* Bump README, CLAUDE.md, and openapi.yaml version on release
## [0.1.7] - 2026-05-13

### ⚙️ Miscellaneous Tasks

- Update version number to 0.1.6 in README and add new documentation entries in CHANGELOG
## [0.1.5] - 2026-05-13

### 🚀 Features

- Add comprehensive documentation for AiKlao Bot, including project overview, architecture, database schema, key business rules, environment variables, npm scripts, testing guidelines, and deployment instructions

### ⚙️ Miscellaneous Tasks

- Clean up versioning comments and improve code readability across multiple service files
## [0.1.4] - 2026-05-13

### 🐛 Bug Fixes

- *(taskfile)* Prevent concurrent is-branch-clean execution

### ⚙️ Miscellaneous Tasks

- Improve release workflow
## [0.1.3] - 2026-05-11

### 🐛 Bug Fixes

- *(groupBreak)* Add null safety check in isGroupOnBreak
## [0.1.2] - 2026-05-10

### 🐛 Bug Fixes

- Update deployment branch from develop to main
## [0.1.1] - 2026-05-10

### 🚀 Features

- Initial MVP LINE trip tracker
- Add full backend project
- Add database connection and server setup
- Migrate from SQLite to PostgreSQL and update database schema
- Refactor server.js to enhance trip and member management features
- Enhance database interaction with compatibility wrappers and update queries
- Add docker-compose configuration for API and PostgreSQL services
- Add health check endpoint for server status monitoring
- Add build script to package.json for consistency
- Add formatLeaderboard function for scheduler push notifications
- Implement formatLeaderboard function for scheduler push notifications
- *(3.6.2)* Auto-track on LIFF open
- Add design and documentation files
- Add Taskfile for release management and versioning

### 🐛 Bug Fixes

- Bind API service to localhost for enhanced security
- Update health check response status to include language code
- Update health check response status for clarity
- Update health check response status for clarity
- Add .github directory to .gitignore
- Update health check response status to include version
- Update database connection details and script references
- Update main entry point to server-connect.js
- Update command to run server-connect.js in Dockerfile
- Update server port configuration to 80 in .env, Dockerfile, ecosystem.config.js, and server.js
- Set server port to 80 in server.js
- Change health check endpoint from '/' to '/health'
- Update server port configuration to 3000 in .env, Dockerfile, ecosystem.config.js, and server.js
- Correct DATABASE_URL in .env to use valid credentials
- Ensure PORT is treated as a number when starting the server
- Ensure PORT is treated as a number when starting the server
- Update .gitignore to include .claude and add build script in package.json
- Update DATABASE_URL to use valid credentials for PostgreSQL connection
- Update health check endpoint from /healthz to /health
- Remove .github from .gitignore
- Update DATABASE_URL for PostgreSQL connection
- Change NODE_ENV from development to production
- Update DATABASE_URL to use localhost for local development
- Update deployment branch from main to develop
- Add DATABASE_URL to ecosystem configuration for PostgreSQL connection
- Remove build script
- Resolve merge conflict in package.json
- *(4.0)* Move /api/watch/:token to app-level to bypass router auth
- *(4.0)* Use /share/:token (outside /api/* namespace)
- Remove *.md from .gitignore

### 💼 Other

- Before push to develop

### 🚜 Refactor

- Update MONTHLY_PUSH_LIMIT parsing and use at() for array access in formatLeaderboard
- Reorganize project into standard directory structure

### ⚙️ Miscellaneous Tasks

- Add ecosystem.config.js for pm2 management
