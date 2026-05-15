# คู่มือ Share Token — AiKlao Bot v4.0

ฟีเจอร์สำหรับหัวหน้าทริปที่ต้องการแชร์สถานะการเดินทางให้กับครอบครัว
หรือคนที่อยู่นอกกลุ่ม LINE โดยไม่ต้องเพิ่มเข้ากลุ่ม

---

## Share Token คืออะไร?

Share Token คือลิงก์สาธารณะที่ใครก็เปิดได้ ไม่ต้องมี LINE หรือเป็นสมาชิกกลุ่ม
คนที่ได้รับลิงก์จะเห็นสถานะทริปแบบ real-time ผ่านเว็บเบราว์เซอร์ทั่วไป

```
https://your-domain.com/share/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

---

## Privacy Mode

เมื่อสร้าง token หัวหน้าเลือกได้ว่าคนนอกจะเห็นข้อมูลแค่ไหน:

| ข้อมูล | full | initial-only |
|---|---|---|
| ชื่อสมาชิก | ชื่อเต็ม เช่น "สมชาย ใจดี" | อักษรตัวแรก เช่น "ส." |
| รูปโปรไฟล์ | เห็น | ซ่อน |
| ตำแหน่ง GPS | เห็น | เห็น |
| ระยะทางที่เหลือ | เห็น | เห็น |
| ETA | เห็น | เห็น |
| สถานะพัก | เห็น | เห็น |

**แนะนำ:**
- `full` — สำหรับครอบครัวสนิทที่ไว้ใจได้
- `initial-only` — สำหรับแชร์ในวงกว้าง หรือเมื่อต้องการปกป้องข้อมูลส่วนตัว

---

## วิธีสร้าง Share Token (หัวหน้าทริป)

### ผ่าน LIFF App

1. เปิด LIFF app ใน LINE
2. ไปที่เมนู **"แชร์ทริป"** หรือ **"Share Token"**
3. กด **"สร้างลิงก์ใหม่"**
4. เลือก Privacy Mode (`full` หรือ `initial-only`)
5. ใส่ชื่อ label (ไม่บังคับ) เช่น "ลิงก์สำหรับแม่"
6. กำหนดวันหมดอายุ (ไม่บังคับ)
7. กด **"สร้าง"** → คัดลอกลิงก์ → ส่งให้คนที่ต้องการ

### ผ่าน API (สำหรับ Developer)

```bash
POST /api/trip/{tripId}/share-tokens
Authorization: Bearer <liff-token>

{
  "privacy_mode": "full",
  "label": "ลิงก์สำหรับครอบครัว",
  "expires_in_hours": 24
}
```

Response:
```json
{
  "ok": true,
  "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "url": "https://your-domain.com/share/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "privacy_mode": "full",
  "expires_at": "2026-05-14T10:00:00Z"
}
```

---

## การจัดการ Token

### ดูรายการ Token ทั้งหมด

```bash
GET /api/trip/{tripId}/share-tokens
Authorization: Bearer <liff-token>
```

Response:
```json
{
  "tokens": [
    {
      "id": 1,
      "token": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "label": "ลิงก์สำหรับครอบครัว",
      "privacy_mode": "full",
      "view_count": 12,
      "created_at": "2026-05-13T08:00:00Z",
      "expires_at": null,
      "revoked_at": null
    }
  ]
}
```

### ยกเลิก Token (Revoke)

```bash
DELETE /api/trip/{tripId}/share-tokens/{tokenId}
Authorization: Bearer <liff-token>
```

หลัง revoke แล้ว ลิงก์นั้นจะใช้ไม่ได้ทันที คนที่เปิดอยู่จะเห็น 404

---

## ข้อจำกัด

| รายการ | ค่า |
|---|---|
| Token สูงสุดต่อทริป | 20 tokens |
| Token ที่ถูก revoke แล้ว | ใช้ไม่ได้ทันที |
| Token หมดอายุ | ใช้ไม่ได้หลังวันที่กำหนด |
| Token ไม่มีวันหมดอายุ | ใช้ได้ตลอดจนกว่าจะ revoke |

---

## คำแนะนำการใช้งาน

**ควร:**
- ตั้ง label ทุกครั้งเพื่อจำได้ว่าลิงก์ไหนส่งให้ใคร
- ใช้ `initial-only` เมื่อโพสต์ลิงก์ในที่สาธารณะ
- Revoke token ทันทีเมื่อทริปจบหรือไม่ต้องการแชร์อีกแล้ว
- กำหนดวันหมดอายุถ้าต้องการแชร์แค่ช่วงระหว่างทริป

**ไม่ควร:**
- สร้าง token แล้วลืม revoke หลังทริปจบ
- ส่งลิงก์ `full` mode ในกลุ่มสาธารณะ
- สร้าง token เกิน 20 อัน (จะ error)

---

## FAQ

**Q: คนที่ได้รับลิงก์ต้องมี LINE ไหม?**
A: ไม่ต้อง เปิดผ่าน browser ทั่วไปได้เลย ไม่ต้อง login

**Q: ถ้าทริปจบแล้ว ลิงก์ยังใช้ได้ไหม?**
A: ถ้ายังไม่ revoke ยังเปิดได้ แต่ข้อมูลจะเป็นสถานะล่าสุดก่อนทริปจบ

**Q: คนที่เปิดลิงก์รู้ไหมว่ามีคนอื่นเปิดด้วย?**
A: ไม่รู้ แต่หัวหน้าทริปเห็น view_count ใน LIFF app

**Q: ถ้าสร้าง token ครบ 20 แล้วต้องการสร้างใหม่ทำยังไง?**
A: Revoke token เก่าที่ไม่ใช้แล้วก่อน แล้วค่อยสร้างใหม่

**Q: สมาชิกในกลุ่มสร้าง token ได้ไหม?**
A: ได้เฉพาะหัวหน้าทริปเท่านั้น
