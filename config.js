/**
 * config.js - ไฟล์กำหนดค่าคอนฟิกสำหรับแอปพลิเคชัน
 * แยกการตั้งค่าสำหรับสภาพแวดล้อมต่างๆ เช่น development, production
 * ปรับปรุงให้ใช้งานกับ dotenv-flow
 */
const path = require("path")
const dotenvFlow = require("dotenv-flow")

// โหลดไฟล์ .env ตามสภาพแวดล้อม
const envResult = dotenvFlow.config({
  // เลือกโฟลเดอร์ที่มีไฟล์ .env (ถ้าอยู่ในโฟลเดอร์อื่น)
  path: path.resolve(process.cwd(), 'env'), // เปลี่ยนเป็นโฟลเดอร์ที่คุณต้องการ
  // การตั้งค่าเพิ่มเติม (ถ้าจำเป็น)
  // default_node_env: 'development',
  // silent: true,
})

if (envResult.error) {
  console.error("Error loading .env files:", envResult.error)
} else {
  console.log(`Environment loaded: ${process.env.NODE_ENV || "development"}`)
  // แสดงข้อมูลเพิ่มเติมในโหมด development
  if (process.env.NODE_ENV === "development") {
    console.log(`Using database: ${process.env.TIDB_DATABASE}`)
    console.log(`Log level: ${process.env.LOG_LEVEL}`)
  }
}

// กำหนดค่าเริ่มต้นสำหรับทุกสภาพแวดล้อม
const defaultConfig = {
  // ค่าทั่วไป - Cloud Run uses PORT=8080 by default
  port: process.env.PORT || 8080,
  
  // Auto-generate appUrl for Cloud Run or use provided
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 8080}`,

  // Telegram Bot
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  adminChatId: process.env.ADMIN_CHAT_ID,

  // ตั้งค่าเวลา
  timezone: "Asia/Bangkok",

  // Cloud Run metadata
  cloudRun: {
    isCloudRun: !!process.env.K_SERVICE,
    service: process.env.K_SERVICE,
    revision: process.env.K_REVISION,
    region: process.env.GOOGLE_CLOUD_REGION || 'us-central1'
  },

  // ตั้งค่าไฟล์และพาธ
  holidaysFile: path.join(__dirname, "holidays.json"),
  logDir: process.env.LOG_DIR || path.join(__dirname, "logs"),

  // ฐานข้อมูล TiDB - ไม่ใช้ default value สำหรับ production
  database: {
    host: process.env.TIDB_HOST || (process.env.NODE_ENV === 'production' ? null : "127.0.0.1"),
    port: parseInt(process.env.TIDB_PORT || "4000"),
    user: process.env.TIDB_USER || (process.env.NODE_ENV === 'production' ? null : "root"),
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
      connectionLimit: 5, // ลดจำนวน connection สำหรับ development
    },
    logging: {
      level: "DEBUG",
    },
  },

  production: {
    database: {
      connectionLimit: 20, // เพิ่ม connection limit สำหรับ production
    },
    logging: {
      level: "INFO",
    },
  },

  test: {
    database: {
      connectionLimit: 2, // จำกัด connection สำหรับ test
    },
    logging: {
      toFile: false, // ไม่บันทึกล็อกลงไฟล์ในโหมด test
    },
  },
}

// ดึงสภาพแวดล้อมปัจจุบัน
const currentEnv = process.env.NODE_ENV || "development"

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

// ตรวจสอบตัวแปรสำคัญในโหมด production
if (config.isProduction) {
  console.log("Running in PRODUCTION mode")

  const requiredVars = [
    "TELEGRAM_BOT_TOKEN",
    "APP_URL",
    "TIDB_HOST",
    "TIDB_USER",
    "TIDB_PASSWORD",
  ]

  const missing = requiredVars.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(
      `❌ Error: Missing required environment variables: ${missing.join(
        ", "
      )}`
    )
    console.error("Application cannot start without these variables.")
    process.exit(1)
  }

  // ตรวจสอบค่า database config
  if (!config.database.host) {
    console.error("❌ Error: Database host is not configured")
    process.exit(1)
  }
}

module.exports = config
