FROM node:18-slim

# ติดตั้ง dependencies สำหรับ mysql2
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ติดตั้ง dependencies
COPY package*.json ./
RUN npm install

# คัดลอกโค้ดของแอปพลิเคชัน
COPY . .

# ตั้งค่า environment variables (ไม่กำหนด PORT ตายตัว)
ENV NODE_ENV=production

# เปิด port โดยใช้ตัวแปร PORT จาก environment
EXPOSE ${PORT:-3000}  
# Default to 3000 if PORT isn’t set (e.g., locally)

# ตั้งค่าพื้นที่เก็บข้อมูลสำหรับวันหยุด
RUN mkdir -p /app/data
VOLUME ["/app/data"]

# สร้าง healthcheck โดยใช้ PORT จาก environment
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-3000} || exit 1

# รันแอปพลิเคชัน
CMD ["node", "index.js"]