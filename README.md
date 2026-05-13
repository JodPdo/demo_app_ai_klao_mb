# demo_app_ai_klao

# 🚗 AiKlao Bot — LINE Trip Tracker

LINE Bot สำหรับติดตามตำแหน่งของสมาชิกในทริปแบบ real-time
ช่วยให้รู้ว่าแต่ละคนอยู่ห่างจากจุดหมายเท่าไหร่

---

## 📌 Features

* 📍 ส่งตำแหน่งผ่าน LINE
* 🎯 ตั้งปลายทาง (เฉพาะหัวหน้า)
* 📏 คำนวณระยะทางแบบ real-time
* 👥 ดูสถานะสมาชิกทั้งหมด
* 🤖 Auto-register สมาชิก (ไม่ต้องสมัครเอง)

---

## 🏗️ Tech Stack

* Node.js + Express 
* LINE Messaging API
* SQLite (better-sqlite3)
* OpenStreetMap (Geocoding)

---

## 📂 Project Structure

```
.
├── server.js        # main server (LINE webhook)
├── db.js            # database + schema
├── seed.js          # create initial data
├── check-db.js      # debug database
├── utils/
│   ├── geocode.js   # แปลงชื่อสถานที่ → lat/lng
│   └── distance.js  # คำนวณระยะทาง
├── .env             # config (secret)
├── package.json
```

---

## ⚙️ Setup

### 1. Clone project

```bash
git clone https://github.com/torpeerapolthi/demo_app_ai_klao_be.git
cd demo_app_ai_klao_be
```

---

### 2. Install dependencies

```bash
npm install
```

---

### 3. Setup environment

สร้างไฟล์ `.env`

```env
CHANNEL_SECRET=your_secret
CHANNEL_ACCESS_TOKEN=your_token
PORT=3000
```

(ดูตัวอย่างจากไฟล์ )

---

### 4. Seed database

```bash
npm run seed
```

จะสร้าง:

* 1 trip
* 1 leader (หัวหน้าทริป)

---

### 5. Run server

```bash
npm start
```

---

### 6. Expose webhook (ใช้ ngrok)

```bash
ngrok http 3000
```

เอา URL ไปใส่ใน LINE Developer

```
https://xxxx.ngrok-free.app/webhook
```

---

## 🧠 How It Works

### 🧱 Database

มี 3 ตารางหลัก 

* `trips` → ข้อมูลทริป
* `members` → สมาชิก (มี role leader)
* `locations` → ประวัติตำแหน่ง

---

### 🤖 Flow การทำงาน

1. User add bot → auto register
2. Leader ตั้งปลายทาง
3. Member ส่ง location
4. ระบบคำนวณระยะทาง (Haversine) 
5. แสดงผลใน LINE

---

## 💬 Commands (User)

| คำสั่ง        | ความหมาย      |
| ------------- | ------------- |
| 📍 ส่งตำแหน่ง | แชร์ location |
| สถานะ         | ดูทุกคน       |
| ระยะ          | ดูระยะตัวเอง  |
| ช่วย          | ดูวิธีใช้     |

---

## 👑 Commands (Leader Only)

| คำสั่ง              | ความหมาย          |
| ------------------- | ----------------- |
| ตั้งปลายทาง เขาใหญ่ | กำหนด destination |

ระบบใช้ geocoding จาก OpenStreetMap 

---

## 🧪 Debug

ดูข้อมูลใน database:

```bash
npm run check
```

จะแสดง:

* trips
* members
* locations

(จากไฟล์ )

---

## ⚠️ Notes

* คนแรกที่ใช้ bot = leader อัตโนมัติ
* ถ้ายังไม่ตั้งปลายทาง → จะยังคำนวณระยะไม่ได้
* รองรับเฉพาะประเทศไทย (optimize geocode)

---

## 🚀 Future Improvements

* 🔔 แจ้งเตือนเมื่อใกล้ถึง
* 🗺️ แสดง map UI
* 📱 ทำ mobile app
* 👥 รองรับหลาย trip

---

## 👨‍💻 Author

* Jod (Backend Developer)

---

## 💡 Concept

> “เพื่อนอยู่ไหน ใกล้ถึงยัง — รู้ได้ทันที”

---
