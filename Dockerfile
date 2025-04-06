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

# ตั้งค่า port ที่ใช้งาน
ENV PORT=3000
ENV NODE_ENV=production

# เปิด port
EXPOSE 3000

# ตั้งค่าพื้นที่เก็บข้อมูลสำหรับวันหยุด
RUN mkdir -p /app/data
VOLUME [ "/app/data" ]

# สร้าง healthcheck เพื่อตรวจสอบว่าแอปทำงานอยู่
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT} || exit 1

# รันแอปพลิเคชัน
CMD ["node", "index.js"]