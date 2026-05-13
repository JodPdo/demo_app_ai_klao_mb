-- เพิ่ม picture_url สำหรับแสดง avatar ใน LIFF map
-- รันได้ปลอดภัย idempotent

ALTER TABLE members ADD COLUMN IF NOT EXISTS picture_url TEXT;