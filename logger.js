/**
 * logger.js - ระบบบันทึกล็อกสำหรับบอท Telegram
 * ปรับปรุงเพื่อใช้งานร่วมกับ config.js
 */
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")
const timezone = require("dayjs/plugin/timezone")
const fs = require("fs")
const path = require("path")
const config = require("./config") // นำเข้า config

// ตั้งค่า Day.js
dayjs.extend(utc)
dayjs.extend(timezone)
const THAI_TIMEZONE = config.timezone || "Asia/Bangkok"

// Cloud Run environment detection
const isCloudRun = !!process.env.K_SERVICE

// กำหนดระดับความสำคัญของล็อก
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// กำหนดระดับล็อกจาก config
let CURRENT_LOG_LEVEL = LOG_LEVELS.INFO // ค่าเริ่มต้น
// แปลงจาก string เป็น number
if (config.logging && config.logging.level) {
  if (LOG_LEVELS[config.logging.level] !== undefined) {
    CURRENT_LOG_LEVEL = LOG_LEVELS[config.logging.level]
  }
}

// พาธสำหรับบันทึกไฟล์ล็อกจาก config
const LOG_DIR = config.logDir || path.join(__dirname, "logs")
const ERROR_LOG_FILE = path.join(LOG_DIR, "error.log")
const GENERAL_LOG_FILE = path.join(LOG_DIR, "bot.log")

// ตรวจสอบและสร้างไดเรกทอรีสำหรับเก็บล็อกถ้ายังไม่มี
if (!fs.existsSync(LOG_DIR)) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true })
  } catch (err) {
    console.error("ไม่สามารถสร้างไดเรกทอรีสำหรับล็อกได้:", err)
  }
}

// บัฟเฟอร์สำหรับเก็บข้อความล็อกก่อนเขียนลงไฟล์
const logBuffer = {
  general: [],
  error: [],
}

// ตัวแปรบอกสถานะว่ากำลังเขียนล็อกหรือไม่
let isWritingLog = false

// เวลาล่าสุดที่เขียนล็อก
let lastLogWrite = Date.now()

// ตรวจสอบว่าควรเขียนล็อกลงไฟล์หรือไม่จาก config
const WRITE_TO_FILE =
  config.logging && config.logging.toFile !== undefined
    ? config.logging.toFile
    : true

// ฟังก์ชันสำหรับเขียนล็อกจากบัฟเฟอร์ลงไฟล์
function flushLogBuffer() {
  if (
    isWritingLog ||
    (logBuffer.general.length === 0 && logBuffer.error.length === 0)
  ) {
    return
  }

  isWritingLog = true

  try {
    // เขียนล็อกทั่วไป
    if (logBuffer.general.length > 0) {
      const generalLogs = logBuffer.general.join("\n") + "\n"
      fs.appendFileSync(GENERAL_LOG_FILE, generalLogs)
      logBuffer.general = []
    }

    // เขียนล็อกข้อผิดพลาด
    if (logBuffer.error.length > 0) {
      const errorLogs = logBuffer.error.join("\n") + "\n"
      fs.appendFileSync(ERROR_LOG_FILE, errorLogs)
      logBuffer.error = []
    }

    lastLogWrite = Date.now()
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในการเขียนล็อก:", err)
  } finally {
    isWritingLog = false
  }
}

// ตั้งเวลาเพื่อเขียนล็อกทุก 5 วินาที หรือเมื่อบัฟเฟอร์เต็ม
setInterval(() => {
  const timeSinceLastWrite = Date.now() - lastLogWrite
  // เขียนล็อกทุก 5 วินาที หรือเมื่อบัฟเฟอร์มีข้อความมากกว่า 100 รายการ
  if (
    timeSinceLastWrite >= 5000 ||
    logBuffer.general.length > 100 ||
    logBuffer.error.length > 20
  ) {
    flushLogBuffer()
  }
}, 1000)

/**
 * ENHANCED secret masking function to prevent credential exposure
 * @param {any} obj - Object or string to mask secrets from
 * @returns {any} - Object with secrets masked
 */
function maskSecrets(obj) {
  if (typeof obj === 'string') {
    return obj
      .replace(/Bearer\s+[\w\-._~+\/]+=*/gi, 'Bearer ***MASKED***')
      .replace(/token['":\s]*[\w\-._~+\/]+=*/gi, 'token: "***MASKED***"')
      .replace(/password['":\s]*[\w\-._~+\/]+=*/gi, 'password: "***MASKED***"')
      .replace(/secret['":\s]*[\w\-._~+\/]+=*/gi, 'secret: "***MASKED***"')
      .replace(/key['":\s]*[\w\-._~+\/]+=*/gi, 'key: "***MASKED***"')
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const masked = { ...obj }
    const sensitiveKeys = ['token', 'password', 'secret', 'key', 'authorization', 'auth']
    
    for (const key in masked) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        masked[key] = '***MASKED***'
      } else if (typeof masked[key] === 'object') {
        masked[key] = maskSecrets(masked[key])
      } else if (typeof masked[key] === 'string') {
        masked[key] = maskSecrets(masked[key])
      }
    }
    return masked
  }
  
  return obj
}

/**
 * ฟังก์ชันล็อกที่ปรับเปลี่ยนตามระดับความสำคัญ
 * @param {number} level - ระดับความสำคัญของล็อก (จาก LOG_LEVELS)
 * @param {string} context - บริบทของล็อก (ชื่อฟังก์ชัน, โมดูล, ฯลฯ)
 * @param {string} message - ข้อความที่ต้องการล็อก
 * @param {any} data - ข้อมูลเพิ่มเติม (optional)
 */
function botLog(level, context, message, data = null) {
  if (level >= CURRENT_LOG_LEVEL) {
    const timestamp = dayjs().tz(THAI_TIMEZONE).format("YYYY-MM-DD HH:mm:ss")
    const levelStr = Object.keys(LOG_LEVELS).find(
      (key) => LOG_LEVELS[key] === level
    )

    // ENHANCED secret masking for message and data
    const maskedMessage = maskSecrets(message)
    const maskedData = data ? maskSecrets(data) : null

    // Cloud Run structured JSON logging
    if (isCloudRun) {
      const structuredLog = {
        timestamp: dayjs().tz(THAI_TIMEZONE).toISOString(),
        severity: levelStr,
        message: maskedMessage,
        context: context,
        pid: process.pid,
        service: process.env.K_SERVICE || "telegram-reminder-bot",
        revision: process.env.K_REVISION,
        region: process.env.GOOGLE_CLOUD_REGION || "unknown",
        thai_time: timestamp,
        ...(maskedData && { data: maskedData })
      }

      // ใช้ console methods ตาม severity level สำหรับ Cloud Logging
      switch (level) {
        case LOG_LEVELS.DEBUG:
          console.debug(JSON.stringify(structuredLog))
          break
        case LOG_LEVELS.INFO:
          console.log(JSON.stringify(structuredLog))
          break
        case LOG_LEVELS.WARN:
          console.warn(JSON.stringify(structuredLog))
          break
        case LOG_LEVELS.ERROR:
          console.error(JSON.stringify(structuredLog))
          break
      }
    } else {
      // Development/Local logging format (เดิม)
      // เพิ่ม PID ในข้อความล็อก พร้อม secret masking
      let logMessage = `[${timestamp}] [PID:${process.pid}] [${levelStr}] [${context}] ${maskedMessage}`

      // เพิ่มข้อมูลเพิ่มเติม (ถ้ามี) พร้อม secret masking
      let dataStr = ""
      if (maskedData !== null) {
        try {
          if (typeof maskedData === "object") {
            dataStr = " " + JSON.stringify(maskedData)
          } else {
            dataStr = " " + String(maskedData)
          }
        } catch (err) {
          dataStr = " [ข้อมูลไม่สามารถแปลงเป็น JSON ได้]"
        }
      }

      // ล็อกไปที่คอนโซล พร้อม secret masking
      switch (level) {
        case LOG_LEVELS.DEBUG:
          maskedData && console.debug(logMessage, maskedData)
          !maskedData && console.debug(logMessage)
          break
        case LOG_LEVELS.INFO:
          maskedData && console.log(logMessage, maskedData)
          !maskedData && console.log(logMessage)
          break
        case LOG_LEVELS.WARN:
          maskedData && console.warn(logMessage, maskedData)
          !maskedData && console.warn(logMessage)
          break
        case LOG_LEVELS.ERROR:
          maskedData && console.error(logMessage, maskedData)
          !maskedData && console.error(logMessage)
          break
      }

      // ล็อกลงไฟล์ถ้าต้องการ (เฉพาะ development/local)
      if (WRITE_TO_FILE) {
        const fullLogMessage = logMessage + dataStr

        if (level === LOG_LEVELS.ERROR) {
          // เก็บล็อกข้อผิดพลาดในบัฟเฟอร์แยกต่างหาก
          logBuffer.error.push(fullLogMessage)
        }

        // เก็บล็อกทั่วไปในบัฟเฟอร์
        logBuffer.general.push(fullLogMessage)

        // เขียนล็อกทันทีถ้าเป็นข้อผิดพลาดร้ายแรง
        if (level === LOG_LEVELS.ERROR && dataStr.includes("Error: EADDRINUSE")) {
          flushLogBuffer()
        }
        // เขียนล็อกทันทีถ้าบัฟเฟอร์เต็ม
        else if (logBuffer.general.length > 200 || logBuffer.error.length > 50) {
          flushLogBuffer()
        }
      }
    }
  }
}

/**
 * ฟังก์ชันล็อกข้อผิดพลาดให้เป็นรูปแบบเดียวกัน
 * @param {string} context - บริบทของข้อผิดพลาด (ชื่อฟังก์ชัน, โมดูล, ฯลฯ)
 * @param {Error} error - ข้อผิดพลาดที่เกิดขึ้น
 */
function logError(context, error) {
  botLog(LOG_LEVELS.ERROR, context, `${error.message}`)

  // ล็อกสแตกเทรซเพิ่มเติมสำหรับการดีบัก (ตรวจสอบจาก config)
  const showStackTrace =
    config.logging && config.logging.stackTrace !== undefined
      ? config.logging.stackTrace
      : process.env.NODE_ENV === "development"

  if (showStackTrace) {
    console.error(error.stack)

    // บันทึกสแตกเทรซลงในไฟล์ด้วย
    if (WRITE_TO_FILE) {
      logBuffer.error.push(`[STACK TRACE] [${context}] ${error.stack}`)
      flushLogBuffer() // เขียนล็อกทันทีสำหรับสแตกเทรซ
    }
  }
}

/**
 * ฟังก์ชันจัดการการออกจากโปรแกรม ให้แน่ใจว่าล็อกทั้งหมดถูกเขียนลงไฟล์
 */
function cleanupLogs() {
  flushLogBuffer()
}

// ลงทะเบียนฟังก์ชันทำความสะอาดเมื่อโปรแกรมปิด
process.on("exit", cleanupLogs)
process.on("SIGINT", () => {
  cleanupLogs()
  process.exit(0)
})

// ส่งออกฟังก์ชันและค่าคงที่
module.exports = {
  LOG_LEVELS,
  CURRENT_LOG_LEVEL,
  botLog,
  logError,
  cleanupLogs,
}