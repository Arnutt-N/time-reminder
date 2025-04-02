FROM node:18-slim

WORKDIR /app

# ติดตั้ง dependencies
COPY package*.json ./
RUN npm install

# คัดลอกโค้ดของแอปพลิเคชัน
COPY . .

# ตั้งค่า port ที่ใช้งาน
ENV PORT=3000

# เปิด port
EXPOSE 3000

# รันแอปพลิเคชัน
CMD ["node", "index.js"]