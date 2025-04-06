/**
 * logger.js - ระบบบันทึกล็อกสำหรับบอท Telegram
 * ปรับปรุงเพื่อให้สอดคล้องกับการแก้ไขปัญหา PID ใหม่
 */
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")
const timezone = require("dayjs/plugin/timezone")
const fs = require("fs")
const path = require("path")

// ตั้งค่า Day.js
dayjs.extend(utc)
dayjs.extend(timezone)
const THAI_TIMEZONE = "Asia/Bangkok"

// กำหนดระดับความสำคัญของล็อก
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
}

// กำหนดระดับล็อกจาก environment
const CURRENT_LOG_LEVEL =
  process.env.NODE_ENV === "production" ? LOG_LEVELS.INFO : LOG_LEVELS.DEBUG

// พาธสำหรับบันทึกไฟล์ล็อก
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, "logs")
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

// ตรวจสอบว่าควรเขียนล็อกลงไฟล์หรือไม่
const WRITE_TO_FILE = process.env.LOG_TO_FILE === "true"

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

    // เพิ่ม PID ในข้อความล็อก
    let logMessage = `[${timestamp}] [PID:${process.pid}] [${levelStr}] [${context}] ${message}`

    // เพิ่มข้อมูลเพิ่มเติม (ถ้ามี)
    let dataStr = ""
    if (data !== null) {
      try {
        if (typeof data === "object") {
          dataStr = " " + JSON.stringify(data)
        } else {
          dataStr = " " + String(data)
        }
      } catch (err) {
        dataStr = " [ข้อมูลไม่สามารถแปลงเป็น JSON ได้]"
      }
    }

    // ล็อกไปที่คอนโซล
    switch (level) {
      case LOG_LEVELS.DEBUG:
        data && console.debug(logMessage, data)
        !data && console.debug(logMessage)
        break
      case LOG_LEVELS.INFO:
        data && console.log(logMessage, data)
        !data && console.log(logMessage)
        break
      case LOG_LEVELS.WARN:
        data && console.warn(logMessage, data)
        !data && console.warn(logMessage)
        break
      case LOG_LEVELS.ERROR:
        data && console.error(logMessage, data)
        !data && console.error(logMessage)
        break
    }

    // ล็อกลงไฟล์ถ้าต้องการ
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

/**
 * ฟังก์ชันล็อกข้อผิดพลาดให้เป็นรูปแบบเดียวกัน
 * @param {string} context - บริบทของข้อผิดพลาด (ชื่อฟังก์ชัน, โมดูล, ฯลฯ)
 * @param {Error} error - ข้อผิดพลาดที่เกิดขึ้น
 */
function logError(context, error) {
  botLog(LOG_LEVELS.ERROR, context, `${error.message}`)

  // ล็อกสแตกเทรซเพิ่มเติมสำหรับการดีบัก
  if (
    process.env.NODE_ENV === "development" ||
    process.env.LOG_STACK_TRACE === "true"
  ) {
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