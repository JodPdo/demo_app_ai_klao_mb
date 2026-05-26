## [0.1.14] - 2026-05-26

### 🚀 Features

- *(mobile)* Add OAuth callback bridge and /me endpoint

### 🐛 Bug Fixes

- *(ecosystem)* Add aiklao_mb PM2 entry, remove stale aiklao_be copy
- *(ci)* Point aiklao_mb workflow at aiklao_mb deploy script (was pointing at aiklao_be)
## [0.1.12] - 2026-05-19

### ⚙️ Miscellaneous Tasks

- Trigger release
## [0.1.11] - 2026-05-19

### 🐛 Bug Fixes

- Remove mobile route
## [0.1.9] - 2026-05-18

### 🚀 Features

- *(mobile)* EAS project setup + dev-client (Phase 5.1)
## [0.1.8] - 2026-05-16

### ⚙️ Miscellaneous Tasks

- Update Taskfile
## [0.1.7] - 2026-05-15

### 🐛 Bug Fixes

- *(mobile)* Phase 5.1 route order + env name (overwrite)
## [0.1.6] - 2026-05-15

### 🐛 Bug Fixes

- *(mobile)* Correct env name + route order for /api/mobile/auth
- *(test)* Export app for supertest
## [0.1.5] - 2026-05-15

### 🐛 Bug Fixes

- *(mobile)* Route /api/mobile/auth before /api catch-all
- Reorder mobile auth route before api routes
- Server module add app-test
- Package .json
## [0.1.4] - 2026-05-14

### 🚀 Features

- Add mobile auth backend

### 🐛 Bug Fixes

- Stabilize release workflow on windows
- Replace git pull with fetch+merge
- Correct shell chaining
