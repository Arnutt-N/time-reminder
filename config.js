/**
 * config.js - ไฟล์กำหนดค่าคอนฟิกสำหรับแอปพลิเคชัน
 * แยกการตั้งค่าสำหรับสภาพแวดล้อมต่างๆ เช่น development, production
 */
require("dotenv").config()
const path = require("path")

// กำหนดค่าเริ่มต้นสำหรับทุกสภาพแวดล้อม
const defaultConfig = {
  // ค่าทั่วไป
  port: process.env.PORT || 3000,
  appUrl: process.env.APP_URL || "http://localhost:3000",

  // Telegram Bot
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  adminChatId: process.env.ADMIN_CHAT_ID,

  // ตั้งค่าเวลา
  timezone: "Asia/Bangkok",

  // ตั้งค่าไฟล์และพาธ
  holidaysFile: path.join(__dirname, "holidays.json"),
  logDir: process.env.LOG_DIR || path.join(__dirname, "logs"),

  // ฐานข้อมูล TiDB
  database: {
    host: process.env.TIDB_HOST || "127.0.0.1",
    port: parseInt(process.env.TIDB_PORT || "4000"),
    user: process.env.TIDB_USER || "root",
    password: process.env.TIDB_PASSWORD || "",
    database: process.env.TIDB_DATABASE || "telegram_bot",
    ssl: process.env.TIDB_ENABLE_SSL === "true",
    connectionLimit: 10,
    timezone: "+07:00",
    supportBigNumbers: true,
    enableKeepAlive: true,
    dateStrings: true,
  },

  // ตั้งค่าล็อก
  logging: {
    level: process.env.LOG_LEVEL || "INFO",
    toFile: process.env.LOG_TO_FILE === "true",
    stackTrace: process.env.LOG_STACK_TRACE === "true",
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS || "7"),
  },
}

// กำหนดค่าเฉพาะสำหรับแต่ละสภาพแวดล้อม
const environments = {
  development: {
    database: {
      database: process.env.TIDB_DATABASE || "test", // ใช้ฐานข้อมูล test สำหรับ development
    },
    logging: {
      level: "DEBUG",
      toFile: true,
      stackTrace: true,
    },
  },

  production: {
    database: {
      database: process.env.TIDB_DATABASE || "telegram_bot", // ใช้ฐานข้อมูลจริงสำหรับ production
      connectionLimit: 20, // เพิ่ม connection limit สำหรับ production
    },
    logging: {
      level: "INFO",
      toFile: process.env.LOG_TO_FILE !== "false", // เปิดใช้งานบันทึกล็อกโดยค่าเริ่มต้น ยกเว้นระบุเป็น false
      stackTrace: false,
    },
  },

  test: {
    database: {
      database: "test",
    },
    logging: {
      level: "DEBUG",
      toFile: false,
    },
  },
}

// ดึงสภาพแวดล้อมปัจจุบัน
const currentEnv = process.env.NODE_ENV || "development"
console.log(`กำลังโหลดการตั้งค่าสำหรับสภาพแวดล้อม: ${currentEnv}`)

// รวมค่าตั้งต้นกับค่าเฉพาะตามสภาพแวดล้อม
const envConfig = environments[currentEnv] || environments.development

// รวม config ทั้งหมดด้วย deep merge
const deepMerge = (target, source) => {
  const output = { ...target }

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] })
        } else {
          output[key] = deepMerge(target[key], source[key])
        }
      } else {
        Object.assign(output, { [key]: source[key] })
      }
    })
  }

  return output
}

const isObject = (item) => {
  return item && typeof item === "object" && !Array.isArray(item)
}

// สร้าง config สุดท้าย
const config = deepMerge(defaultConfig, envConfig)

// เพิ่มค่าเฉพาะที่ต้องคำนวณ หรือรวบรวมจากค่าอื่น
config.isDevelopment = currentEnv === "development"
config.isProduction = currentEnv === "production"
config.isTest = currentEnv === "test"

// เพิ่มข้อมูลสภาพแวดล้อมให้ config
config.env = currentEnv

module.exports = config
