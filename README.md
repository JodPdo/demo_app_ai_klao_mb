AiKlao Mobile 📱

Mobile application for the AiKlao trip management system built with Expo + React Native.

✨ Features
🔐 Authentication screen
🏠 Home dashboard
🧭 Trips management
⚙️ Settings screen
🎨 Custom theme system
📱 Cross-platform (Android / iOS)
🛠️ Tech Stack
React Native
Expo
TypeScript
React Navigation
TailwindCSS / NativeWind
Axios
📂 Project Structure
aiklao-mobile/
├── app/
├── components/
├── screens/
├── services/
├── theme/
├── assets/
├── package.json
├── app.json
├── tsconfig.json
└── babel.config.js
🚀 Getting Started
1. Clone repository
git clone <your-repo-url>
cd aiklao-mobile
2. Install dependencies
npm install

or

yarn install
3. Start development server
npx expo start
📱 Run on Device
Android

Install:

Android Studio
Android Emulator

Then:

npx expo start

Press:

a

to open Android emulator.

iOS

Requires:

macOS
Xcode

Then:

npx expo start

Press:

i

to open iOS simulator.

🎨 Theme

Main color:

Forest Green #0E7C66

Typography and spacing are centralized in the theme system.

📡 API Connection

Backend API:

https://api.aiklaotrip.com

Example:

GET /api/me/trips
GET /api/trip/:id
🧪 Development Status

Current phase:

Phase 5.0 — Mobile Foundation

Implemented:

Base project setup
Navigation
Theme system
Shared UI components
Initial screens

Planned:

Authentication integration
Real API connection
Live trip tracking
Map integration
Push notifications
📦 Build
Android APK
eas build -p android
iOS
eas build -p ios
👨‍💻 Developer

Created by Jod 🚀
