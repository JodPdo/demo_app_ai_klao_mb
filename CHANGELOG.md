## [0.1.25] - 2026-06-05

### 🐛 Bug Fixes

- *(security)* Batch SEC-001/002/003/004
## [0.1.24] - 2026-06-05

### 🚀 Features

- *(phase-6.5-A)* Per-member arrival detection + SOS auto-clear
## [0.1.23] - 2026-06-05

### 🚀 Features

- *(phase-6.2-A)* SOS endpoints + sos_events table + LINE Push
## [0.1.22] - 2026-06-04

### 🐛 Bug Fixes

- *(line)* Remove unsupported custom URI scheme from Flex Message
## [0.1.21] - 2026-06-04

### 🚀 Features

- *(line)* Phase 5.6 Session B+ — LINE Bot Push endpoint
## [0.1.20] - 2026-06-04

### 🚀 Features

- *(liff)* Phase 5.6 Session B — dualAuth + LIFF session endpoints
## [0.1.19] - 2026-06-03

### 🚀 Features

- *(trips)* Phase 5.4 Session B — Trip Detail backend (v0.1.19)
## [0.1.18] - 2026-06-01

### ⚙️ Miscellaneous Tasks

- *(cleanup)* Untrack nested aiklao-mobile + docs subfolders
- *(cleanup)* Remove dead v3.0 files and unused deps
## [0.1.17] - 2026-05-31

### 🧪 Testing

- *(mobile-trips)* Assert accuracy_m forwarded to location INSERT
## [0.1.16] - 2026-05-26

### 🚀 Features

- *(trips)* Add 5 mobile trip endpoints (Phase 5.2)
## [0.1.15] - 2026-05-26

### 🐛 Bug Fixes

- *(server)* Export { app } for test compatibility (post-merge follow-up)
- *(deps)* Add pino-http (and others if needed) for v0.1.14 scaffold

### 💼 Other

- V0.1.14
## [0.1.14] - 2026-05-26

### 🚀 Features

- *(mobile)* Add OAuth callback bridge and /me endpoint

### 🐛 Bug Fixes

- *(ecosystem)* Add aiklao_mb PM2 entry, remove stale aiklao_be copy
- *(ci)* Point aiklao_mb workflow at aiklao_mb deploy script (was pointing at aiklao_be)
## [0.1.12] - 2026-05-19

### 🚀 Features

- *(mobile)* Add /me endpoint (JWT-protected user profile)

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
