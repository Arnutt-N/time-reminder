// index.js - ปรับปรุงเพื่อแก้ไขปัญหา PID ใหม่โผล่ขึ้นมาไม่รู้จบ
const {
  initializeDatabase,
  getUserByChatId,
  getSubscribedUsers,
  updateUserSubscription,
  getAllHolidays,
  searchHolidays,
  getConnection,
  addHoliday,
  deleteHoliday,
  importHolidaysFromJson,
} = require("./tidb-connection.js")
const { LOG_LEVELS, botLog, logError } = require("./logger.js")
const TelegramBot = require("node-telegram-bot-api")
const cron = require("node-cron")
const fs = require("fs")
const path = require("path")
const express = require("express")
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")
const timezone = require("dayjs/plugin/timezone")
const config = require("./config") // นำเข้า config

// ตั้งค่า Day.js
dayjs.extend(utc)
dayjs.extend(timezone)
const THAI_TIMEZONE = "Asia/Bangkok"

// กำหนดตัวแปรสำคัญจาก config
const token = config.telegramBotToken;
const chatId = config.telegramChatId;
const appUrl = config.appUrl;
const port = config.port;
const HOLIDAYS_FILE = config.holidaysFile;

// ตัวแปรสถานะการเริ่มต้น
let botInitialized = false
let holidaysData = {}
let appInitialized = false
let eventHandlersInitialized = false
let cronJobsInitialized = false
let hasStarted = false
let isTestCronRunning = false
let testCron = null

// ตรวจสอบว่ามี TELEGRAM_CHAT_ID หรือไม่
if (!chatId) {
  console.warn(
    "TELEGRAM_CHAT_ID is not set. Messages will only be sent to individual subscribers."
  )
}

// สร้าง Express app
const app = express()
app.use(express.json())

// สร้าง instance ของ bot โดยไม่ใช้ polling
const bot = new TelegramBot(token, { polling: false })

// ปรับปรุงฟังก์ชัน initializeApp ให้มีการป้องกันการเรียกซ้ำ
async function initializeApp() {
  try {
    // ป้องกันการเรียกซ้ำ
    if (appInitialized) {
      botLog(
        LOG_LEVELS.INFO,
        "initializeApp",
        "แอปพลิเคชันได้รับการเริ่มต้นแล้ว"
      )
      return true
    }

    botLog(LOG_LEVELS.INFO, "initializeApp", "เริ่มต้นการทำงานของแอปพลิเคชัน")

    // โหลดข้อมูลวันหยุด
    holidaysData = loadHolidays()
    botLog(LOG_LEVELS.DEBUG, "initializeApp", "กำลังโหลดข้อมูลวันหยุด...")
    botLog(
      LOG_LEVELS.INFO,
      "initializeApp",
      `โหลดข้อมูลวันหยุดพิเศษจำนวน ${holidaysData.holidays.length} วันจากไฟล์`
    )

    // เริ่มต้นฐานข้อมูล
    botLog(LOG_LEVELS.INFO, "initializeApp", "กำลังเริ่มต้นฐานข้อมูล...")
    await initializeDatabase()
    botLog(LOG_LEVELS.INFO, "initializeApp", "เริ่มต้นฐานข้อมูลสำเร็จ")

    // แสดงข้อมูลเวลาปัจจุบันของระบบ
    const timeInfo = getServerTimeInfo()
    botLog(
      LOG_LEVELS.INFO,
      "initializeApp",
      `บอทกำลังทำงาน... เวลา UTC: ${timeInfo.utcTime}, เวลาไทย: ${timeInfo.thaiTime}`
    )
    botLog(
      LOG_LEVELS.INFO,
      "initializeApp",
      `ค่า Timezone offset: ${timeInfo.offset} ชั่วโมง`
    )

    // เริ่ม server และตั้งค่า webhook
    return new Promise((resolve, reject) => {
      app
        .listen(port, async () => {
          try {
             // ค่อย ๆ ทำงานหนักภายหลังแบบไม่ kill โปรเซส
+     holidaysData = loadHolidays();
+     try { await initializeDatabase(); } catch(e){ logError('initializeDatabase', e); }
            // ล้าง webhook เดิม
            botLog(LOG_LEVELS.INFO, "initializeApp", "กำลังลบ webhook เดิม")
            await bot.deleteWebHook()

            // ตั้งค่า webhook ใหม่
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              `กำลังตั้งค่า webhook ใหม่: ${appUrl}/bot${token}`
            )
            const webhookResult = await bot.setWebHook(`${appUrl}/bot${token}`)

            if (!webhookResult) {
              const errorMsg = "ไม่สามารถตั้งค่า webhook ได้"
              botLog(LOG_LEVELS.ERROR, "initializeApp", errorMsg)
              return reject(new Error(errorMsg))
            }

            botInitialized = true
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              `เซิร์ฟเวอร์ทำงานที่พอร์ต ${port}`
            )
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              `ตั้งค่า webhook: ${appUrl}/bot${token}`
            )

            // ตั้งค่า event handlers
            setupEventHandlers()
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              "ตั้งค่า event handlers สำเร็จ"
            )

            // ตั้งค่า cron jobs
            setupCronJobs()
            botLog(LOG_LEVELS.INFO, "initializeApp", "ตั้งค่า cron jobs สำเร็จ")

            // ส่งข้อความแจ้งเตือนไปยังแอดมินว่าบอทเริ่มทำงานแล้ว
            try {
              if (process.env.ADMIN_CHAT_ID) {
                const adminChatId = process.env.ADMIN_CHAT_ID
                botLog(
                  LOG_LEVELS.INFO,
                  "initializeApp",
                  `กำลังส่งข้อความแจ้งเตือนไปยังแอดมิน ${adminChatId}`
                )

                const startupMessage = `🤖 *บอทเริ่มทำงานแล้ว!*\n\nเวลาเริ่มต้น: ${timeInfo.thaiTime}\nเซิร์ฟเวอร์: ${appUrl}\n\nเรียกใช้คำสั่ง /start เพื่อดูคำสั่งทั้งหมด`

                await bot.sendMessage(adminChatId, startupMessage, {
                  parse_mode: "Markdown",
                })
                botLog(
                  LOG_LEVELS.INFO,
                  "initializeApp",
                  `ส่งข้อความแจ้งเตือนไปยังแอดมินสำเร็จ`
                )

                // สั่งจำลองคำสั่ง /start ให้กับแอดมิน
                const simulatedMessage = {
                  message_id: Date.now(),
                  from: {
                    id: adminChatId,
                    first_name: "Admin",
                    is_bot: false,
                  },
                  chat: {
                    id: adminChatId,
                    type: "private",
                  },
                  date: Math.floor(Date.now() / 1000),
                  text: "/start",
                }

                // เรียกใช้ processUpdate เพื่อจำลองการส่งคำสั่ง /start
                await bot.processUpdate({ message: simulatedMessage })
                botLog(
                  LOG_LEVELS.INFO,
                  "initializeApp",
                  `จำลองการเรียกใช้คำสั่ง /start สำหรับแอดมินสำเร็จ`
                )
              } else {
                botLog(
                  LOG_LEVELS.WARN,
                  "initializeApp",
                  `ไม่พบ ADMIN_CHAT_ID ในสภาพแวดล้อม ไม่สามารถส่งข้อความแจ้งเตือนได้`
                )
              }
            } catch (notifyError) {
              logError("initializeApp-admin-notify", notifyError)
              botLog(
                LOG_LEVELS.ERROR,
                "initializeApp",
                `ไม่สามารถส่งข้อความแจ้งเตือนไปยังแอดมินได้ แต่บอทยังคงทำงานปกติ`
              )
            }

            // ตั้งค่าสถานะว่าได้เริ่มต้นแล้ว
            appInitialized = true
            resolve(true)
          } catch (error) {
            logError("initializeApp-webhook", error)
            reject(error)
          }
        })
        .on("error", (error) => {
          logError("initializeApp-server", error)
          reject(error)
        })
    })
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในการเริ่มต้นแอปพลิเคชัน:", err)
    logError("initializeApp", err)
    process.exit(1)
  }
}

// ฟังก์ชันหลักเริ่มต้นโปรแกรม - ปรับปรุงเพื่อป้องกันการเรียกซ้ำ
async function startApplication() {
  // ป้องกันการเรียกซ้ำ
  if (hasStarted) {
    botLog(LOG_LEVELS.INFO, "startApplication", "โปรแกรมได้เริ่มต้นไปแล้ว")
    return
  }

  try {
    botLog(LOG_LEVELS.INFO, "startApplication", "เริ่มต้นการทำงานของโปรแกรม")

    // ตรวจสอบและจัดการไฟล์ล็อก
    if (fs.existsSync("bot.lock")) {
      const pid = parseInt(fs.readFileSync("bot.lock", "utf8"), 10)
      try {
        process.kill(pid, 0) // ตรวจสอบว่าโปรเซสยังมีชีวิต
        botLog(
          LOG_LEVELS.ERROR,
          "startApplication",
          `บอทกำลังทำงานอยู่แล้ว (PID: ${pid}) กำลังปิดโปรแกรม...`
        )
        process.exit(1)
      } catch (e) {
        botLog(
          LOG_LEVELS.WARN,
          "startApplication",
          `พบไฟล์ล็อกเก่า (PID: ${pid}) แต่ไม่มีกระบวนการทำงาน ลบไฟล์ล็อก...`
        )
        fs.unlinkSync("bot.lock")
      }
    }

    // เขียนไฟล์ล็อกใหม่
    fs.writeFileSync("bot.lock", process.pid.toString())
    botLog(
      LOG_LEVELS.INFO,
      "startApplication",
      `เขียนไฟล์ล็อกสำเร็จ (PID: ${process.pid})`
    )

    // จัดการเมื่อโปรแกรมปิด
    const cleanup = () => {
      try {
        if (fs.existsSync("bot.lock")) {
          fs.unlinkSync("bot.lock")
          botLog(
            LOG_LEVELS.INFO,
            "startApplication",
            "ลบไฟล์ล็อกเมื่อโปรแกรมปิดสำเร็จ"
          )
        }
      } catch (err) {
        logError("startApplication-cleanup", err)
      }
    }

    // ลบการจัดการสัญญาณเดิมก่อนเพิ่มใหม่ เพื่อป้องกันการซ้ำซ้อน
    process.removeAllListeners("exit")
    process.removeAllListeners("SIGINT")
    process.removeAllListeners("uncaughtException")

    // เพิ่มการจัดการสัญญาณใหม่
    process.on("exit", cleanup)
    process.on("SIGINT", () => {
      cleanup()
      process.exit(0)
    })
    process.on("uncaughtException", (err) => {
      logError("uncaughtException", err)
      cleanup()
      process.exit(1)
    })

    // เริ่มต้นแอปพลิเคชัน (เรียกครั้งเดียว)
    await initializeApp()
    botLog(
      LOG_LEVELS.INFO,
      "startApplication",
      "บอทพร้อมทำงานและตอบสนองคำสั่งแล้ว"
    )

    // ตั้งค่าสถานะว่าได้เริ่มต้นแล้ว
    hasStarted = true
  } catch (err) {
    logError("startApplication", err)
    process.exit(1)
  }
}

// ใช้ dayjs ทั้งหมดแทน Date สำหรับการจัดการเวลา
function getServerTimeInfo() {
  const utcNow = dayjs().utc()
  const thaiNow = utcNow.tz(THAI_TIMEZONE)

  // คำนวณ timezone offset แยกชั่วโมงและนาที
  const offsetMinutes = thaiNow.utcOffset()
  const offsetHours = Math.floor(offsetMinutes / 60)
  const offsetMins = offsetMinutes % 60

  return {
    utcTime: utcNow.format(`DD/MM/${utcNow.year() + 543} - HH:mm น. (UTC)`),
    thaiTime: thaiNow.format(
      `DD/MM/${thaiNow.year() + 543} - HH:mm น. (UTC+7)`
    ),
    thaiDate: thaiNow.format(`DD/MM/${thaiNow.year() + 543}`),
    offset: offsetHours,
    offsetMinutes: offsetMins,
    isWeekend: isWeekend(thaiNow),
  }
}

// ฟังก์ชันการจัดการวันหยุด
function loadHolidays() {
  try {
    if (fs.existsSync(HOLIDAYS_FILE)) {
      const data = fs.readFileSync(HOLIDAYS_FILE, "utf8")
      return JSON.parse(data)
    }
  } catch (err) {
    console.error("Error loading holidays:", err)
  }
  // ถ้าไม่มีไฟล์หรือเกิดข้อผิดพลาด ให้สร้างข้อมูลเริ่มต้น
  return {
    holidays: [], // เก็บข้อมูลวันหยุดแบบเดิม (เฉพาะวันที่)
    holidayDetails: {}, // เก็บข้อมูลวันหยุดพร้อมชื่อ
    lastUpdated: new Date().toISOString(),
  }
}

function saveHolidays() {
  try {
    fs.writeFileSync(
      HOLIDAYS_FILE,
      JSON.stringify(holidaysData, null, 2),
      "utf8"
    )
    return true
  } catch (err) {
    console.error("Error saving holidays:", err)
    return false
  }
}

// ปรับปรุงฟังก์ชันแปลงวันที่ให้รองรับทั้งรูปแบบ dd/mm/yyyy และ d/m/yyyy
function thaiDateToIsoDate(thaiDate) {
  try {
    // รองรับทั้ง dd/mm/yyyy และ d/m/yyyy
    const datePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
    const match = thaiDate.match(datePattern)

    if (!match) {
      botLog(
        LOG_LEVELS.WARN,
        "thaiDateToIsoDate",
        `รูปแบบวันที่ไม่ถูกต้อง: ${thaiDate}`
      )
      return null
    }

    const day = match[1].padStart(2, "0")
    const month = match[2].padStart(2, "0")
    const yearBE = parseInt(match[3], 10)
    const yearCE = yearBE - 543 // แปลงจาก พ.ศ. เป็น ค.ศ.

    const result = `${yearCE}-${month}-${day}`

    // ตรวจสอบความถูกต้องของวันที่
    if (!dayjs(result).isValid()) {
      botLog(
        LOG_LEVELS.WARN,
        "thaiDateToIsoDate",
        `วันที่ไม่ถูกต้องหลังจากแปลง: ${result}`
      )
      return null
    }

    return result
  } catch (error) {
    logError("thaiDateToIsoDate", error)
    return null
  }
}

// เพิ่มฟังก์ชันแปลงวันที่จาก ISO เป็นไทยที่รองรับเดือนแบบภาษาไทย
function isoDateToThaiDateFull(isoDateStr) {
  try {
    const date = dayjs(isoDateStr)
    if (!date.isValid()) {
      botLog(
        LOG_LEVELS.WARN,
        "isoDateToThaiDateFull",
        `วันที่ไม่ถูกต้อง: ${isoDateStr}`
      )
      return "ไม่ระบุ"
    }

    const thaiMonths = [
      "มกราคม",
      "กุมภาพันธ์",
      "มีนาคม",
      "เมษายน",
      "พฤษภาคม",
      "มิถุนายน",
      "กรกฎาคม",
      "สิงหาคม",
      "กันยายน",
      "ตุลาคม",
      "พฤศจิกายน",
      "ธันวาคม",
    ]

    const result = `${date.date()} ${thaiMonths[date.month()]} ${
      date.year() + 543
    }`
    return result
  } catch (error) {
    logError("isoDateToThaiDateFull", error)
    return "ไม่ระบุ"
  }
}

// เพิ่มฟังก์ชันตรวจสอบความถูกต้องของวันที่
function isValidThaiDate(thaiDate) {
  // ตรวจสอบรูปแบบ dd/mm/yyyy
  const datePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  const match = thaiDate.match(datePattern)

  if (!match) return false

  const day = parseInt(match[1], 10)
  const month = parseInt(match[2], 10)
  const yearBE = parseInt(match[3], 10)

  // ตรวจสอบช่วงของค่า
  if (day < 1 || day > 31) return false
  if (month < 1 || month > 12) return false
  if (yearBE < 2500 || yearBE > 2600) return false // ตรวจสอบว่าเป็น พ.ศ. ที่สมเหตุสมผล

  const yearCE = yearBE - 543
  const date = dayjs(`${yearCE}-${month}-${day}`)

  // ตรวจสอบว่าเป็นวันที่ถูกต้อง (เช่น ไม่ใช่ 31/04/2568)
  return date.isValid() && date.date() === day
}

function isoUTCToThaiDateTime(isoDateStr, includeSeconds = true) {
  const date = dayjs(isoDateStr).utc()
  if (!date.isValid()) return "ไม่ระบุ"
  return date.format(
    `DD/MM/${date.year() + 543} HH:mm${includeSeconds ? ":ss" : ""}`
  )
}

function getThaiDate() {
  const date = dayjs().tz(THAI_TIMEZONE)
  return date.format(`DD/MM/${date.year() + 543}`)
}

// ฟังก์ชันตรวจสอบว่าวันนี้เป็นวันหยุดหรือไม่ - ปรับปรุงให้มีกลไกป้องกันการล้มเหลว
async function isHoliday() {
  try {
    const now = dayjs().tz(THAI_TIMEZONE)
    const day = now.day() // 0 = อาทิตย์, 1 = จันทร์, ..., 6 = เสาร์
    const today = now.format("YYYY-MM-DD")

    botLog(
      LOG_LEVELS.DEBUG,
      "isHoliday",
      `ตรวจสอบวันหยุด: ${today}, วัน: ${day}`
    )

    // ตรวจสอบวันเสาร์-อาทิตย์
    if (day === 0 || day === 6) {
      botLog(LOG_LEVELS.INFO, "isHoliday", `${today} เป็นวันหยุดสุดสัปดาห์`)
      return true
    }

    // ตรวจสอบวันหยุดพิเศษจากฐานข้อมูล
    try {
      const { getConnection } = require("./tidb-connection.js") // นำเข้าแบบมีเงื่อนไข
      let conn = await getConnection()
      const [rows] = await conn.query(
        "SELECT * FROM holidays WHERE holiday_date = ?",
        [today]
      )
      await conn.end()

      if (rows.length > 0) {
        botLog(
          LOG_LEVELS.INFO,
          "isHoliday",
          `${today} เป็นวันหยุดพิเศษ: ${rows[0].holiday_name}`
        )
        return true
      }

      botLog(LOG_LEVELS.DEBUG, "isHoliday", `${today} ไม่เป็นวันหยุด`)
      return false
    } catch (dbError) {
      logError("isHoliday-db", dbError)

      // ถ้าเกิดข้อผิดพลาดในการตรวจสอบฐานข้อมูล ให้เช็คจาก JSON แทน (เผื่อกรณีฉุกเฉิน)
      botLog(
        LOG_LEVELS.WARN,
        "isHoliday",
        `เกิดข้อผิดพลาดในการตรวจสอบฐานข้อมูล ใช้ข้อมูลจาก JSON แทน`
      )
      return holidaysData.holidays.includes(today)
    }
  } catch (error) {
    logError("isHoliday", error)
    // ถ้าเกิดข้อผิดพลาดอื่นๆ ให้คืนค่า false (ถือว่าไม่ใช่วันหยุด) เพื่อให้บอทยังทำงานต่อไปได้
    return false
  }
}

// แยกฟังก์ชันตรวจสอบวันหยุดสุดสัปดาห์
function isWeekend(date) {
  const day = date.day() // 0 = อาทิตย์, 1 = จันทร์, ..., 6 = เสาร์
  return day === 0 || day === 6
}

// ฟังก์ชันข้อความแจ้งเตือน
function getCheckInReminderMessage() {
  return `⏰ อย่าลืมลงเวลาเข้างาน! วันที่ ${getThaiDate()}`
}

function getCheckOutReminderMessage() {
  return `⏰ อย่าลืมลงเวลาออกจากงาน! วันที่ ${getThaiDate()}`
}

function getMorningMessage() {
  return `🌞 สวัสดีตอนเช้า! วันที่ ${getThaiDate()} \nขอให้มีวันที่ดีนะครับ/คะ 👍`
}

function getEveningMessage() {
  return `🌆 สวัสดีตอนเย็น! วันที่ ${getThaiDate()} \nขอบคุณสำหรับความทุ่มเทในวันนี้นะครับ/คะ 🙏`
}

// เพิ่ม endpoints สำหรับ health check
app.get("/ping", (req, res) => {
  botLog(LOG_LEVELS.DEBUG, "ping", "Health check received")
  res.status(200).send("pong")
})

app.get("/health", async (req, res) => {
  try {
    const serverTimeInfo = getServerTimeInfo()
    
    // Test database connection
    let databaseStatus = "disconnected"
    try {
      const dbConnection = await getConnection()
      await dbConnection.query('SELECT 1')
      await dbConnection.end()
      databaseStatus = "connected"
    } catch (dbError) {
      databaseStatus = "failed"
    }
    
    // Test Telegram API
    let telegramApiStatus = "disconnected"
    try {
      const botInfo = await bot.getMe()
      telegramApiStatus = botInfo ? "connected" : "failed"
    } catch (telegramError) {
      telegramApiStatus = "failed"
    }
    
    // Check webhook status  
    let webhookStatus = "inactive"
    try {
      const webhookInfo = await bot.getWebhookInfo()
      webhookStatus = webhookInfo.url ? "active" : "inactive"
    } catch (webhookError) {
      webhookStatus = "failed"
    }

    const healthData = {
      status: "ok",
      platform: "google-cloud-run",
      service: process.env.K_SERVICE,
      revision: process.env.K_REVISION,
      region: process.env.GOOGLE_CLOUD_REGION,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      memory_limit: process.env.MEMORY_LIMIT || "256Mi",
      cpu_limit: process.env.CPU_LIMIT || "0.25",
      checks: {
        bot_initialized: botInitialized,
        database: databaseStatus,
        telegram_api: telegramApiStatus,
        webhook: webhookStatus,
        cron_jobs: cronJobsInitialized || false,
        timezone: dayjs().tz(THAI_TIMEZONE).format()
      },
      server_time: {
        utc: serverTimeInfo.utcTime,
        thai: serverTimeInfo.thaiTime,
        offset: serverTimeInfo.offset,
      },
    }
    
    // Structured logging for Cloud Run
    if (config.cloudRun.isCloudRun) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: 'INFO',
        component: 'health-check',
        message: 'Health check successful',
        service: process.env.K_SERVICE,
        revision: process.env.K_REVISION,
        checks: healthData.checks
      }))
    } else {
      botLog(LOG_LEVELS.DEBUG, "health", "Health check response", healthData)
    }
    
    res.status(200).json(healthData)
  } catch (error) {
    logError("health", error)
    
    const errorData = {
      status: "error",
      platform: "google-cloud-run",
      service: process.env.K_SERVICE,
      error: error.message,
      timestamp: new Date().toISOString()
    }
    
    // Structured error logging for Cloud Run
    if (config.cloudRun.isCloudRun) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: 'ERROR',
        component: 'health-check', 
        message: 'Health check failed',
        error: error.message,
        service: process.env.K_SERVICE
      }))
    }
    
    res.status(500).json(errorData)
  }
})

// ตั้งค่า webhook สำหรับ Telegram
app.post(`/bot${token}`, (req, res) => {
  try {
    botLog(LOG_LEVELS.DEBUG, "webhook", "Received update from Telegram", {
      updateId: req.body.update_id,
      chatId: req.body.message?.chat?.id,
    })

    bot.processUpdate(req.body)
    res.sendStatus(200)
  } catch (error) {
    logError("webhook", error)
    // ต้องส่ง 200 กลับไปเสมอเพื่อป้องกัน Telegram ส่งข้อมูลเดิมซ้ำ
    res.sendStatus(200)
  }
})

// เส้นทางสำหรับการตั้งค่า webhook
app.get("/webhook-info", async (req, res) => {
  try {
    const info = await bot.getWebHookInfo()
    console.log("Current webhook info:", info)
    res.json(info)
  } catch (error) {
    console.error("Error getting webhook info:", error)
    res.status(500).json({ error: error.message })
  }
})

// เส้นทางรีเซ็ต webhook
app.get("/reset-webhook", async (req, res) => {
  try {
    botLog(LOG_LEVELS.INFO, "resetWebhook", "Deleting webhook...")
    await bot.deleteWebHook()

    botLog(
      LOG_LEVELS.INFO,
      "resetWebhook",
      `Setting new webhook to: ${appUrl}/bot${token}`
    )
    const result = await bot.setWebHook(`${appUrl}/bot${token}`)

    botLog(LOG_LEVELS.INFO, "resetWebhook", "Webhook reset result:", result)
    res.send(`Webhook reset successfully: ${result}`)
  } catch (error) {
    logError("resetWebhook", error)
    res.status(500).send(`Error: ${error.message}`)
  }
})

// External Cron Endpoint for GitHub Actions
app.post("/api/cron", async (req, res) => {
  try {
    // Verify authorization to prevent unauthorized triggers
    const authHeader = req.headers.authorization
    if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      botLog(LOG_LEVELS.WARN, "cron-endpoint", "Unauthorized cron request", {
        ip: req.ip,
        userAgent: req.get('user-agent')
      })
      return res.status(401).json({error: "Unauthorized"})
    }
    
    const { type, time } = req.body
    
    // Validate request body
    if (!type || !time) {
      return res.status(400).json({error: "Missing required fields: type, time"})
    }
    
    if (!['morning', 'afternoon', 'evening'].includes(type)) {
      return res.status(400).json({error: "Invalid cron type. Must be: morning, afternoon, or evening"})
    }
    
    botLog(LOG_LEVELS.INFO, "cron-trigger", `Received ${type} reminder trigger for ${time}`)
    
    // Route to appropriate reminder function
    switch(type) {
      case 'morning':
        await sendMorningReminder()
        break
      case 'afternoon':
        await sendAfternoonReminder()  
        break
      case 'evening':
        await sendEveningReminder()
        break
      default:
        return res.status(400).json({error: "Invalid cron type"})
    }
    
    res.status(200).json({
      success: true,
      type: type,
      time: time,
      executed_at: new Date().toISOString(),
      platform: "google-cloud-run"
    })
    
  } catch (error) {
    logError("cron-endpoint", error)
    res.status(500).json({error: error.message})
  }
})

// Helper functions for external cron triggers
async function sendMorningReminder() {
  try {
    // Check for holidays
    if (await isHoliday()) {
      botLog(LOG_LEVELS.INFO, "sendMorningReminder", "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน")
      return
    }
    
    botLog(LOG_LEVELS.INFO, "sendMorningReminder", "กำลังส่งข้อความแจ้งเตือนตอนเช้า")
    
    const morningMessage = getMorningMessage() + "\n\n" + getCheckInReminderMessage()
    
    // Send to group/channel if configured
    if (chatId) {
      try {
        await bot.sendMessage(chatId, morningMessage)
        botLog(LOG_LEVELS.INFO, "sendMorningReminder", "ส่งข้อความไปยังกลุ่มสำเร็จ")
      } catch (err) {
        logError("sendMorningReminder-group", err)
      }
    }
    
    // Send to individual subscribers
    const subscribers = await getSubscribedUsers()
    botLog(LOG_LEVELS.INFO, "sendMorningReminder", `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`)
    
    for (const user of subscribers) {
      try {
        await bot.sendMessage(user.chatId, morningMessage)
        botLog(LOG_LEVELS.DEBUG, "sendMorningReminder", `ส่งข้อความเช้าให้ ${user.chatId} สำเร็จ`)
      } catch (error) {
        logError("sendMorningReminder-user", error)
      }
    }
  } catch (error) {
    logError("sendMorningReminder", error)
    throw error
  }
}

async function sendAfternoonReminder() {
  try {
    // Check for holidays  
    if (await isHoliday()) {
      botLog(LOG_LEVELS.INFO, "sendAfternoonReminder", "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน")
      return
    }
    
    botLog(LOG_LEVELS.INFO, "sendAfternoonReminder", "กำลังส่งข้อความแจ้งเตือนตอนบ่าย")
    
    const afternoonMessage = getMorningMessage() + "\n\n" + getCheckInReminderMessage()
    
    // Send to group/channel if configured
    if (chatId) {
      try {
        await bot.sendMessage(chatId, afternoonMessage)
        botLog(LOG_LEVELS.INFO, "sendAfternoonReminder", "ส่งข้อความไปยังกลุ่มสำเร็จ")
      } catch (err) {
        logError("sendAfternoonReminder-group", err)
      }
    }
    
    // Send to individual subscribers
    const subscribers = await getSubscribedUsers()
    botLog(LOG_LEVELS.INFO, "sendAfternoonReminder", `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`)
    
    for (const user of subscribers) {
      try {
        await bot.sendMessage(user.chatId, afternoonMessage)
        botLog(LOG_LEVELS.DEBUG, "sendAfternoonReminder", `ส่งข้อความบ่ายให้ ${user.chatId} สำเร็จ`)
      } catch (error) {
        logError("sendAfternoonReminder-user", error)
      }
    }
  } catch (error) {
    logError("sendAfternoonReminder", error)
    throw error
  }
}

async function sendEveningReminder() {
  try {
    // Check for holidays
    if (await isHoliday()) {
      botLog(LOG_LEVELS.INFO, "sendEveningReminder", "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน")
      return
    }
    
    botLog(LOG_LEVELS.INFO, "sendEveningReminder", "กำลังส่งข้อความแจ้งเตือนตอนเย็น")
    
    const eveningMessage = getEveningMessage() + "\n\n" + getCheckOutReminderMessage()
    
    // Send to group/channel if configured
    if (chatId) {
      try {
        await bot.sendMessage(chatId, eveningMessage)
        botLog(LOG_LEVELS.INFO, "sendEveningReminder", "ส่งข้อความไปยังกลุ่มสำเร็จ")
      } catch (err) {
        logError("sendEveningReminder-group", err)
      }
    }
    
    // Send to individual subscribers
    const subscribers = await getSubscribedUsers()
    botLog(LOG_LEVELS.INFO, "sendEveningReminder", `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`)
    
    for (const user of subscribers) {
      try {
        await bot.sendMessage(user.chatId, eveningMessage)
        botLog(LOG_LEVELS.DEBUG, "sendEveningReminder", `ส่งข้อความเย็นให้ ${user.chatId} สำเร็จ`)
      } catch (error) {
        logError("sendEveningReminder-user", error)
      }
    }
  } catch (error) {
    logError("sendEveningReminder", error)
    throw error
  }
}

// ตั้งค่า cron jobs - ปรับปรุงให้ป้องกันการตั้งค่าซ้ำซ้อน
function setupCronJobs() {
  try {
    // ป้องกันการเรียกซ้ำ
    if (cronJobsInitialized) {
      botLog(LOG_LEVELS.INFO, "setupCronJobs", "Cron jobs ได้รับการตั้งค่าแล้ว")
      return
    }

    // ล้างทุก cron job ก่อนที่จะสร้างใหม่ (ป้องกันการซ้ำซ้อน)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "กำลังล้าง cron jobs เดิมและตั้งค่าใหม่"
    )
    try {
      for (const job of Object.values(cron.getTasks())) {
        job.stop()
      }
    } catch (error) {
      botLog(
        LOG_LEVELS.INFO,
        "setupCronJobs",
        "ไม่มี cron jobs เดิมที่ต้องล้าง"
      )
    }

    // เวลาไทย 7:25 น. = UTC 00:25 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job แจ้งเตือนเข้างาน 7:25 น. (00:25 UTC) - เฉพาะวันทำงาน"
    )

    const morningReminder = cron.schedule("25 0 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "morningReminder",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "morningReminder",
          `กำลังส่งข้อความแจ้งเตือนลงเวลาเข้างาน (7:25 น.) ${new Date().toISOString()}`
        )

        const morningCheckinMessage =
          getMorningMessage() + "\n\n" + getCheckInReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, morningCheckinMessage)
            botLog(
              LOG_LEVELS.INFO,
              "morningReminder",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("morningReminder-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "morningReminder",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, morningCheckinMessage)
            botLog(
              LOG_LEVELS.DEBUG,
              "morningReminder",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("morningReminder-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "morningReminder",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "morningReminder",
          "ส่งข้อความแจ้งเตือน 7:25 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("morningReminder", err)
      }
    })

    // เวลาไทย 8:25 น. = UTC 01:25 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job ข้อความตอนเช้า 8:25 น. (01:25 UTC) - เฉพาะวันทำงาน"
    )

    const morningMessage = cron.schedule("25 1 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "morningMessage",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "morningMessage",
          `กำลังส่งข้อความตอนเช้า (8:25 น.) ${new Date().toISOString()}`
        )

        const morningFullMessage =
          getMorningMessage() + "\n\n" + getCheckInReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, morningFullMessage)
            botLog(
              LOG_LEVELS.INFO,
              "morningMessage",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("morningMessage-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "morningMessage",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, morningFullMessage)
            botLog(
              LOG_LEVELS.DEBUG,
              "morningMessage",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("morningMessage-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "morningMessage",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "morningMessage",
          "ส่งข้อความตอนเช้า 8:25 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("morningMessage", err)
      }
    })

    // เวลาไทย 15:25 น. = UTC 08:25 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job แจ้งเตือนออกงาน 15:25 น. (08:25 UTC) - เฉพาะวันทำงาน"
    )

    const eveningReminder = cron.schedule("25 8 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "eveningReminder",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "eveningReminder",
          `กำลังส่งข้อความแจ้งเตือนลงเวลาออกงาน (15:25 น.) ${new Date().toISOString()}`
        )

        const eveningCheckoutMessage =
          getEveningMessage() + "\n\n" + getCheckOutReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, eveningCheckoutMessage)
            botLog(
              LOG_LEVELS.INFO,
              "eveningReminder",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("eveningReminder-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "eveningReminder",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, eveningCheckoutMessage)
            botLog(
              LOG_LEVELS.DEBUG,
              "eveningReminder",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("eveningReminder-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "eveningReminder",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "eveningReminder",
          "ส่งข้อความแจ้งเตือน 15:25 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("eveningReminder", err)
      }
    })

    // เวลาไทย 16:25 น. = UTC 09:25 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job ข้อความตอนเย็น 16:25 น. (09:25 UTC) - เฉพาะวันทำงาน"
    )

    const eveningMessage = cron.schedule("25 9 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "eveningMessage",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "eveningMessage",
          `กำลังส่งข้อความตอนเย็น (16:25 น.) ${new Date().toISOString()}`
        )

        const eveningFullMessage =
          getEveningMessage() + "\n\n" + getCheckOutReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, eveningFullMessage)
            botLog(
              LOG_LEVELS.INFO,
              "eveningMessage",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("eveningMessage-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "eveningMessage",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, eveningFullMessage)
            botLog(
              LOG_LEVELS.DEBUG,
              "eveningMessage",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("eveningMessage-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "eveningMessage",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "eveningMessage",
          "ส่งข้อความตอนเย็น 16:25 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("eveningMessage", err)
      }
    })

    botLog(LOG_LEVELS.INFO, "setupCronJobs", "ตั้งค่า cron jobs เสร็จสิ้น")

    // ตั้งค่า testCron แต่ยังไม่เริ่มทำงาน
    testCron = cron.schedule(
      "*/2 * * * *",
      async () => {
        try {
          if (!process.env.TELEGRAM_CHAT_ID) {
            botLog(
              LOG_LEVELS.ERROR,
              "testCron",
              "ไม่ได้ตั้งค่า TELEGRAM_CHAT_ID ไม่สามารถส่งข้อความทดสอบได้"
            )
            return
          }

          // เช็ควันหยุดเพื่อทดสอบฟังก์ชัน isHoliday
          const holidayToday = await isHoliday()
          const holidayStatus = holidayToday ? "เป็นวันหยุด" : "ไม่ใช่วันหยุด"

          const now = dayjs().utc() // เวลา UTC
          const thaiNow = now.tz(THAI_TIMEZONE) // เวลาไทย (UTC+7)
          botLog(
            LOG_LEVELS.INFO,
            "testCron",
            `ทำงานตามกำหนดเวลาที่ ${now.toISOString()}`
          )

          // แปลงเวลาเซิร์ฟเวอร์ (UTC)
          const serverTime = now.format(
            `DD/MM/${now.year() + 543} - HH:mm น. (UTC)`
          )
          // แปลงเวลาไทย (UTC+7)
          const thaiTime = thaiNow.format(
            `DD/MM/${thaiNow.year() + 543} - HH:mm น. (UTC+7)`
          )
          // คำนวณ timezone offset
          const offsetMinutesTotal = now.utcOffset() // UTC offset (0)
          const thaiOffsetMinutes = thaiNow.utcOffset() // UTC+7 offset (420)
          const offsetDiff = Math.abs(thaiOffsetMinutes - offsetMinutesTotal)
          const offsetHours = Math.floor(offsetDiff / 60)
          const offsetMinutes = offsetDiff % 60

          const message = `
🔔 ทดสอบการแจ้งเตือนทุก 2 นาที - สำเร็จ!

เวลาเซิร์ฟเวอร์: ${serverTime}
เวลาของไทย: ${thaiTime}
Timezone offset: ${offsetHours} hours ${offsetMinutes} mins
สถานะวันหยุด: ${holidayStatus}
          `

          try {
            await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message.trim())
            botLog(
              LOG_LEVELS.INFO,
              "testCron",
              `ส่งข้อความทดสอบไปยัง ${process.env.TELEGRAM_CHAT_ID} สำเร็จ`
            )
          } catch (sendError) {
            logError("testCron-send", sendError)
          }
        } catch (err) {
          logError("testCron", err)
        }
      },
      {
        scheduled: false, // ไม่ให้เริ่มอัตโนมัติ
        timezone: "UTC",
      }
    )

    // เก็บ references ไว้
    cronJobsInitialized = true
    return {
      morningReminder,
      morningMessage,
      eveningReminder,
      eveningMessage,
      testCron,
    }
  } catch (error) {
    logError("setupCronJobs", error)
    return null
  }
}

// ฟังก์ชันตรวจสอบแอดมินจากฐานข้อมูล
async function isAdmin(chatId) {
  try {
    // ตรวจสอบจากค่า ADMIN_CHAT_ID ในไฟล์ .env ก่อน (สำหรับกรณีฉุกเฉิน)
    if (String(chatId) === process.env.ADMIN_CHAT_ID) {
      return true
    }

    // ตรวจสอบจากฐานข้อมูล
    const userInfo = await getUserByChatId(chatId)
    return userInfo && userInfo.role === "admin"
  } catch (error) {
    logError("isAdmin", error)
    // กรณีเกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล ให้ใช้ค่าจาก .env แทน
    return String(chatId) === process.env.ADMIN_CHAT_ID
  }
}

// การจัดการ handlers ของบอท
// กำหนดคำสั่งและสิทธิ์
const COMMAND_PERMISSIONS = {
  // คำสั่งสำหรับผู้ใช้ทั่วไป
  myinfo: {
    permission: "user",
    description: "ดูข้อมูลของคุณในระบบ",
    regex: /^\/myinfo$/,
  },
  subscribe: {
    permission: "user",
    description: "สมัครรับการแจ้งเตือน",
    regex: /^\/subscribe$/,
  },
  unsubscribe: {
    permission: "user",
    description: "ยกเลิกรับการแจ้งเตือน",
    regex: /^\/unsubscribe$/,
  },
  status: {
    permission: "user",
    description: "ตรวจสอบสถานะของบอท",
    regex: /^\/status$/,
  },
  list_holidays: {
    permission: "user",
    description: "แสดงรายการวันหยุดพิเศษทั้งหมด",
    regex: /^\/list_holidays$/,
  },
  search_holiday: {
    permission: "user",
    description: "ค้นหาวันหยุด เช่น /\u200Bsearch_holiday วันปีใหม่",
    regex: /^\/search_holiday\s+(.+)$/,
  },

  // คำสั่งสำหรับแอดมิน
  // เพิ่มคำสั่งใน COMMAND_PERMISSIONS

  servertime: {
    permission: "admin",
    description: "ตรวจสอบเวลาของเซิร์ฟเวอร์",
    regex: /^\/servertime$/,
  },
  dbstatus: {
    permission: "admin",
    description: "ดูสถานะฐานข้อมูลและจำนวนผู้ใช้" + "\n",
    regex: /^\/dbstatus$/,
  },
  checkin: {
    permission: "admin",
    description: "ดูข้อความแจ้งเตือนลงเวลาเข้างาน",
    regex: /^\/checkin$/,
  },
  checkout: {
    permission: "admin",
    description: "ดูข้อความแจ้งเตือนลงเวลาออกจากงาน",
    regex: /^\/checkout$/,
  },
  morning: {
    permission: "admin",
    description: "ดูข้อความตอนเช้า",
    regex: /^\/morning$/,
  },
  evening: {
    permission: "admin",
    description: "ดูข้อความตอนเย็น",
    regex: /^\/evening$/,
  },
  morning_full: {
    permission: "admin",
    description: "ดูข้อความเต็มของเวลา 7:25 และ 8:25 (เช้า+เข้างาน)",
    regex: /^\/morning_full$/,
  },
  evening_full: {
    permission: "admin",
    description: "ดูข้อความเต็มของเวลา 15:25 และ 16:25 (เย็น+ออกงาน)" + "\n",
    regex: /^\/evening_full$/,
  },
  add_holiday: {
    permission: "admin",
    description:
      "เพิ่มวันหยุดพิเศษ เช่น /\u200Badd... 01/01/2568 วันขึ้นปีใหม่",
    regex: /^\/add_holiday\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(.+))?$/,
  },
  delete_holiday: {
    permission: "admin",
    description: "ลบวันหยุดพิเศษ เช่น /\u200Bdel... 01/01/2568",
    regex: /^\/delete_holiday\s+(\d{1,2}\/\d{1,2}\/\d{4})$/,
  },
  reload_holidays: {
    permission: "admin",
    description: "โหลดข้อมูลวันหยุดจากไฟล์ใหม่",
    regex: /^\/reload_holidays$/,
  },
  import_holidays: {
    permission: "admin",
    description: "นำเข้าข้อมูลวันหยุดจาก JSON (ถ้ายังไม่มีข้อมูลในฐานข้อมูล)",
    regex: /^\/import_holidays$/,
  },
  force_import_holidays: {
    permission: "admin",
    description:
      "บังคับนำเข้าข้อมูลวันหยุดจาก JSON (ลบข้อมูลเดิมทั้งหมด)" + "\n",
    regex: /^\/force_import_holidays$/,
  },
  add_admin: {
    permission: "admin",
    description: "เพิ่มแอดมินใหม่ เช่น /\u200Badd... 1234567890",
    regex: /^\/add_admin\s+(\d+)$/,
  },
  remove_admin: {
    permission: "admin",
    description: "ลบสิทธิ์แอดมิน เช่น /\u200Brem... 1234567890",
    regex: /^\/remove_admin\s+(\d+)$/,
  },
  list_admins: {
    permission: "admin",
    description: "แสดงรายการแอดมินทั้งหมด" + "\n",
    regex: /^\/list_admins$/,
  },
  start_test: {
    permission: "admin",
    description: "เริ่มการทดสอบส่งข้อความทุก 2 นาที",
    regex: /^\/start_test$/,
  },
  stop_test: {
    permission: "admin",
    description: "หยุดการทดสอบ",
    regex: /^\/stop_test$/,
  },
  cron_job: {
    permission: "admin",
    description: "ทดสอบ cron job ในเวลาที่กำหนด เช่น /\u200Bcron... HH.mm",
    regex: /^\/cron_job\s+(\d{1,2})\.(\d{2})$/,
  },
  reset_webhook: {
    permission: "admin",
    description: "รีเซ็ต webhook (ใช้เมื่อบอทไม่ตอบสนอง)",
    regex: /^\/reset_webhook$/,
  },

  // คำสั่งพิเศษ
  start: {
    permission: "all", // ทุกคนสามารถใช้คำสั่ง /start ได้
    description: "เริ่มต้นการใช้งานบอท - ข้อความช่วยเหลือ",
    regex: /^\/(start|help)$/,
  },
}

// สร้างอาร์เรย์คำสั่งสำหรับการแสดงในข้อความ
function buildCommandLists() {
  const USER_COMMANDS = Object.entries(COMMAND_PERMISSIONS)
    .filter(([_, cmd]) => cmd.permission === "user" || cmd.permission === "all")
    .map(([cmdName, cmd]) => `/${cmdName} - ${cmd.description}`)

  const ADMIN_COMMANDS = Object.entries(COMMAND_PERMISSIONS)
    .filter(([_, cmd]) => cmd.permission === "admin")
    .map(([cmdName, cmd]) => `/${cmdName} - ${cmd.description}`)

  return { USER_COMMANDS, ADMIN_COMMANDS }
}

// ฟังก์ชันตรวจสอบสิทธิ์และส่งข้อความแจ้งเตือนถ้าไม่มีสิทธิ์
async function checkPermission(chatId, permission) {
  // ถ้าเป็นคำสั่งสำหรับทุกคน
  if (permission === "all") return true

  // ถ้าเป็นคำสั่งสำหรับแอดมิน ตรวจสอบว่าเป็นแอดมินหรือไม่
  if (permission === "admin" && !(await isAdmin(chatId))) {
    await bot.sendMessage(
      chatId,
      "⛔ คำสั่งนี้สงวนไว้สำหรับผู้ดูแลระบบเท่านั้น"
    )
    botLog(
      LOG_LEVELS.WARN,
      "permission-check",
      `ผู้ใช้ ${chatId} พยายามเรียกใช้คำสั่งแอดมิน`
    )
    return false
  }

  return true
}

// ฟังก์ชันตั้งค่า event handlers
function setupEventHandlers() {
  try {
    // ป้องกันการเรียกซ้ำ
    if (eventHandlersInitialized) {
      botLog(
        LOG_LEVELS.INFO,
        "setupEventHandlers",
        "Event handlers ได้รับการตั้งค่าแล้ว"
      )
      return
    }

    // ล้าง event listeners เดิมทั้งหมดก่อนเพิ่มใหม่
    botLog(
      LOG_LEVELS.INFO,
      "setupEventHandlers",
      "กำลังตั้งค่า event handlers ใหม่"
    )
    bot.removeAllListeners()

    // เก็บ references ของทุก event handlers เพื่อป้องกันการซ้ำซ้อน
    const handlers = {}

    // สร้างรายการคำสั่งสำหรับแสดงใน /start
    const { USER_COMMANDS, ADMIN_COMMANDS } = buildCommandLists()

    // รับคำสั่งพื้นฐาน /start
    handlers.start = bot.onText(/^\/(start|help)$/, async (msg) => {
      try {
        const chatId = msg.chat.id
        const isAdminUser = await isAdmin(chatId)
        botLog(
          LOG_LEVELS.INFO,
          "command-start",
          `ผู้ใช้ ${chatId} เรียกใช้คำสั่ง /start (Admin: ${isAdminUser})`
        )

        let welcomeMessage = `
สวัสดีครับ/ค่ะ! 👋
บอทนี้จะส่งข้อความแจ้งเตือนทุกวันในเวลา:

- ⏰ 7:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)
- 🌞 8:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)
- ⏰ 15:25 น. (ข้อความตอนเย็น + แจ้งเตือนลงเวลาออกจากงาน)
- 🌆 16:25 น. (ข้อความตอนเย็น + แจ้งเตือนลงเวลาออกจากงาน)

หมายเหตุ: บอทจะไม่ส่งข้อความในวันเสาร์-อาทิตย์ และวันหยุดพิเศษ

คำสั่งพื้นฐาน:
${USER_COMMANDS.join("\n")}
`

        if (isAdminUser) {
          // เพิ่มคำสั่งสำหรับแอดมิน
          welcomeMessage += `
  
🔑 คำสั่งสำหรับผู้ดูแลระบบ:
${ADMIN_COMMANDS.join("\n")}
`
        }

        await bot.sendMessage(chatId, welcomeMessage)
        botLog(
          LOG_LEVELS.INFO,
          "command-start",
          `ส่งข้อความต้อนรับให้ ${
            isAdminUser ? "แอดมิน" : "ผู้ใช้"
          }: ${chatId} สำเร็จ`
        )
      } catch (error) {
        logError("command-start", error)
      }
    })

    // ลงทะเบียนคำสั่งทั้งหมด (ยกเว้น /start ที่ลงทะเบียนไปแล้ว)
    for (const [cmdName, cmdConfig] of Object.entries(COMMAND_PERMISSIONS)) {
      if (cmdName === "start") continue // ข้ามการลงทะเบียน /start เพราะได้ลงทะเบียนไปแล้ว

      handlers[cmdName] = bot.onText(cmdConfig.regex, async (msg, match) => {
        try {
          const chatId = msg.chat.id
          const username = msg.from?.username || ""
          const firstName = msg.from?.first_name || ""

          botLog(
            LOG_LEVELS.INFO,
            `command-${cmdName}`,
            `ผู้ใช้ ${
              username || firstName || chatId
            } เรียกใช้คำสั่ง /${cmdName}`
          )

          // ตรวจสอบสิทธิ์
          if (!(await checkPermission(chatId, cmdConfig.permission))) {
            return
          }

          // ดำเนินการตามคำสั่ง
          await handleCommand(cmdName, msg, match)
        } catch (error) {
          logError(`command-${cmdName}`, error)
          try {
            await bot.sendMessage(
              msg.chat.id,
              `❌ เกิดข้อผิดพลาดในการใช้คำสั่ง /${cmdName} โปรดลองอีกครั้ง`
            )
          } catch (sendError) {
            logError(`command-${cmdName}-sendError`, sendError)
          }
        }
      })
    }

    botLog(
      LOG_LEVELS.INFO,
      "setupEventHandlers",
      "ตั้งค่า event handlers เสร็จสิ้น"
    )

    // ตั้งค่าสถานะว่าได้เริ่มต้นแล้ว
    eventHandlersInitialized = true
    return handlers
  } catch (error) {
    logError("setupEventHandlers", error)
    return {}
  }
}

// ฟังก์ชันจัดการคำสั่งที่แยกต่างหาก
async function handleCommand(cmdName, msg, match) {
  const chatId = msg.chat.id
  const username = msg.from?.username || ""
  const firstName = msg.from?.first_name || ""

  switch (cmdName) {
    case "servertime":
      await handleServertime(msg)
      break

    case "status":
      await bot.sendMessage(
        chatId,
        "✅ บอทกำลังทำงานปกติ และพร้อมส่งข้อความแจ้งเตือนตามเวลาที่กำหนด!"
      )
      botLog(
        LOG_LEVELS.INFO,
        "command-status",
        `ส่งข้อมูลสถานะให้ผู้ใช้ ${chatId} สำเร็จ`
      )
      break

    case "subscribe":
      await handleSubscribe(msg)
      break

    case "unsubscribe":
      await handleUnsubscribe(msg)
      break

    case "myinfo":
      await handleMyInfo(msg)
      break

    case "checkin":
      await bot.sendMessage(chatId, getCheckInReminderMessage())
      botLog(
        LOG_LEVELS.INFO,
        "command-checkin",
        `ส่งข้อความแจ้งเตือนลงเวลาเข้างานให้ ${
          username || firstName || chatId
        } สำเร็จ`
      )
      break

    case "checkout":
      await bot.sendMessage(chatId, getCheckOutReminderMessage())
      botLog(
        LOG_LEVELS.INFO,
        "command-checkout",
        `ส่งข้อความแจ้งเตือนลงเวลาออกงานให้ ${
          username || firstName || chatId
        } สำเร็จ`
      )
      break

    case "morning":
      await bot.sendMessage(chatId, getMorningMessage())
      botLog(
        LOG_LEVELS.INFO,
        "command-morning",
        `ส่งข้อความตอนเช้าให้ ${username || firstName || chatId} สำเร็จ`
      )
      break

    case "evening":
      await bot.sendMessage(chatId, getEveningMessage())
      botLog(
        LOG_LEVELS.INFO,
        "command-evening",
        `ส่งข้อความตอนเย็นให้ ${username || firstName || chatId} สำเร็จ`
      )
      break

    case "morning_full":
      const morningFullMessage =
        getMorningMessage() + "\n\n" + getCheckInReminderMessage()
      await bot.sendMessage(chatId, morningFullMessage)
      botLog(
        LOG_LEVELS.INFO,
        "command-morning_full",
        `ส่งข้อความเต็มตอนเช้าให้ ${username || firstName || chatId} สำเร็จ`
      )
      break

    case "evening_full":
      const eveningFullMessage =
        getEveningMessage() + "\n\n" + getCheckOutReminderMessage()
      await bot.sendMessage(chatId, eveningFullMessage)
      botLog(
        LOG_LEVELS.INFO,
        "command-evening_full",
        `ส่งข้อความเต็มตอนเย็นให้ ${username || firstName || chatId} สำเร็จ`
      )
      break

    case "add_holiday":
      await handleAddHoliday(msg, match)
      break

    case "delete_holiday":
      await handleDeleteHoliday(msg, match)
      break

    case "list_holidays":
      await handleListHolidays(msg)
      break

    case "search_holiday":
      await handleSearchHoliday(msg, match)
      break

    case "reload_holidays":
      holidaysData = loadHolidays()
      await bot.sendMessage(
        chatId,
        `✅ โหลดข้อมูลวันหยุดใหม่สำเร็จ\nมีวันหยุดทั้งหมด ${holidaysData.holidays.length} วัน`
      )
      botLog(
        LOG_LEVELS.INFO,
        "command-reload_holidays",
        `แอดมิน ${chatId} โหลดข้อมูลวันหยุด ${holidaysData.holidays.length} รายการสำเร็จ`
      )
      break

    case "import_holidays":
      await handleImportHolidays(msg)
      break

    case "force_import_holidays":
      await handleForceImportHolidays(msg)
      break

    case "dbstatus":
      await handleDbStatus(msg)
      break

    case "start_test":
      await handleStartTest(msg)
      break

    case "stop_test":
      await handleStopTest(msg)
      break

    case "reset_webhook":
      await handleResetWebhook(msg)
      break

    // เพิ่มใน switch-case ของฟังก์ชัน handleCommand
    case "add_admin":
      await handleAddAdmin(msg, match)
      break

    case "remove_admin":
      await handleRemoveAdmin(msg, match)
      break

    case "list_admins":
      await handleListAdmins(msg)
      break

    case "cron_job":
      await handleCronJob(msg, match)
      break

    default:
      await bot.sendMessage(chatId, "คำสั่งไม่ถูกต้องหรือยังไม่ได้กำหนด")
  }
}

// ฟังก์ชันย่อยสำหรับแต่ละคำสั่ง
async function handleServertime(msg) {
  const chatId = msg.chat.id
  const timeInfo = getServerTimeInfo()

  // ตรวจสอบว่าวันนี้เป็นวันหยุดพิเศษหรือไม่
  let holidayStatus = "ไม่ใช่วันหยุด"

  // ตรวจสอบวันหยุดสุดสัปดาห์ก่อน
  if (timeInfo.isWeekend) {
    holidayStatus = "เป็นวันหยุดสุดสัปดาห์"
  } else {
    // ตรวจสอบวันหยุดพิเศษจากฐานข้อมูล
    try {
      const isSpecialHoliday = await isHoliday()
      if (isSpecialHoliday) {
        holidayStatus = "เป็นวันหยุดพิเศษ"
      }
    } catch (error) {
      logError("handleServertime-holiday-check", error)
      // ถ้าเกิดข้อผิดพลาดในการตรวจสอบวันหยุดพิเศษ ให้แสดงสถานะตามวันหยุดสุดสัปดาห์แทน
      botLog(
        LOG_LEVELS.WARN,
        "handleServertime",
        "เกิดข้อผิดพลาดในการตรวจสอบวันหยุดพิเศษ ใช้การตรวจสอบวันหยุดสุดสัปดาห์แทน"
      )
    }
  }

  const serverTimeMessage = `
⏰ เวลาของเซิร์ฟเวอร์:

- เวลา UTC: ${timeInfo.utcTime}
- เวลาของไทย: ${timeInfo.thaiTime}
- Timezone offset: ${timeInfo.offset} ชั่วโมง ${timeInfo.offsetMinutes} นาที
- สถานะวันหยุด: ${holidayStatus}
`

  await bot.sendMessage(chatId, serverTimeMessage)
  botLog(
    LOG_LEVELS.INFO,
    "command-servertime",
    `ส่งข้อมูลเวลาเซิร์ฟเวอร์ให้ผู้ใช้ ${chatId} สำเร็จ`
  )
}

async function handleSubscribe(msg) {
  const chatId = msg.chat.id
  const username = msg.from.username || ""
  const firstName = msg.from.first_name || ""
  const lastName = msg.from.last_name || ""

  // ตรวจสอบว่าผู้ใช้มีอยู่แล้วและสมัครรับการแจ้งเตือนอยู่หรือไม่
  const userInfo = await getUserByChatId(chatId)

  if (userInfo && userInfo.is_subscribed) {
    // กรณีผู้ใช้สมัครอยู่แล้ว
    await bot.sendMessage(
      chatId,
      "ℹ️ คุณมีข้อมูลสมัครรับการแจ้งเตือนในระบบแล้ว ระบบจะส่งข้อความแจ้งเตือนตามเวลาที่กำหนด"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-subscribe",
      `ผู้ใช้ ${username || firstName || chatId} สมัครรับการแจ้งเตือนในระบบแล้ว`
    )
    return
  }

  // สมัครหรืออัปเดตการสมัคร
  await updateUserSubscription(
    {
      chatId: chatId,
      username: username,
      firstName: firstName,
      lastName: lastName,
    },
    true
  )

  // กรณีเป็นผู้ใช้ใหม่หรือผู้ใช้ที่เคยยกเลิกแล้วกลับมาสมัครใหม่
  if (!userInfo) {
    await bot.sendMessage(
      chatId,
      "✅ คุณสมัครรับการแจ้งเตือนเรียบร้อยแล้ว! เราจะส่งข้อความแจ้งเตือนตามเวลาที่กำหนด"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-subscribe",
      `ผู้ใช้ใหม่ ${username || firstName || chatId} สมัครรับการแจ้งเตือนสำเร็จ`
    )
  } else {
    await bot.sendMessage(
      chatId,
      "✅ คุณได้เปิดรับการแจ้งเตือนอีกครั้ง! เราจะส่งข้อความแจ้งเตือนตามเวลาที่กำหนด"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-subscribe",
      `ผู้ใช้เก่า ${
        username || firstName || chatId
      } กลับมาสมัครรับการแจ้งเตือนอีกครั้ง`
    )
  }
}

async function handleUnsubscribe(msg) {
  const chatId = msg.chat.id
  const username = msg.from.username || ""
  const firstName = msg.from.first_name || ""

  // แก้ไขโดยใช้ updateUserSubscription แทนการ DELETE
  const success = await updateUserSubscription(
    {
      chatId: chatId,
      username: msg.from.username || "",
      firstName: msg.from.first_name || "",
      lastName: msg.from.last_name || "",
    },
    false // ตั้งค่า is_subscribed เป็น false แทนการลบทิ้ง
  )

  if (success) {
    await bot.sendMessage(chatId, "✅ คุณยกเลิกรับการแจ้งเตือนเรียบร้อยแล้ว!")
    botLog(
      LOG_LEVELS.INFO,
      "command-unsubscribe",
      `ผู้ใช้ ${username || firstName || chatId} ยกเลิกรับการแจ้งเตือนสำเร็จ`
    )
  } else {
    await bot.sendMessage(
      chatId,
      "⚠️ ไม่สามารถยกเลิกรับการแจ้งเตือนได้ โปรดลองอีกครั้ง"
    )
    botLog(
      LOG_LEVELS.WARN,
      "command-unsubscribe",
      `ไม่สามารถยกเลิกรับการแจ้งเตือนของผู้ใช้ ${
        username || firstName || chatId
      } ได้`
    )
  }
}

async function handleMyInfo(msg) {
  const chatId = msg.chat.id
  const username = msg.from.username || ""
  const firstName = msg.from.first_name || ""

  const userInfo = await getUserByChatId(chatId)
  if (userInfo) {
    const statusText = userInfo.is_subscribed
      ? "✅ สมัครรับข้อความแจ้งเตือน"
      : "❌ ไม่ได้สมัครรับข้อความแจ้งเตือน"

    let registrationDate = userInfo.date_added || "ไม่ระบุ"
    if (registrationDate !== "ไม่ระบุ") {
      const date = dayjs(userInfo.date_added).tz(THAI_TIMEZONE)
      registrationDate = date.format(`DD/MM/${date.year() + 543} - HH:mm น.`)
    }

    const fullName =
      [userInfo.first_name, userInfo.last_name].filter(Boolean).join(" ") ||
      "ไม่ระบุ"
    const message = `
📋 *ข้อมูลของคุณในระบบ*:

- *ชื่อ-สกุล*: ${fullName}
- *Username*: ${userInfo.username ? "@" + userInfo.username : "ไม่ได้ตั้งค่า"}
- *วันที่ลงทะเบียน*: ${registrationDate}
- *สถานะการรับข้อความ*: ${statusText}

${
  userInfo.is_subscribed
    ? "🚫 หากต้องการยกเลิกรับการแจ้งเตือน คลิก /unsubscribe"
    : "📝 หากต้องการสมัครรับการแจ้งเตือน คลิก /subscribe"
}
        `
    await bot.sendMessage(chatId, message, { parse_mode: "Markdown" })
    botLog(
      LOG_LEVELS.INFO,
      "command-myinfo",
      `ส่งข้อมูลผู้ใช้ให้ ${username || firstName || chatId} สำเร็จ`
    )
  } else {
    await bot.sendMessage(
      chatId,
      "ไม่พบข้อมูลของคุณในระบบ หากต้องการสมัคร คลิก /subscribe เพื่อลงทะเบียน"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-myinfo",
      `ไม่พบข้อมูลผู้ใช้ ${username || firstName || chatId} ในระบบ`
    )
  }
}

async function handleListHolidays(msg) {
  const chatId = msg.chat.id
  const username = msg.from.username || ""
  const firstName = msg.from.first_name || ""

  const holidays = await getAllHolidays()
  if (holidays.length === 0) {
    await bot.sendMessage(chatId, "ไม่มีวันหยุดพิเศษที่กำหนดไว้")
    botLog(LOG_LEVELS.INFO, "command-list_holidays", `ไม่พบข้อมูลวันหยุดในระบบ`)
    return
  }

  let holidayList = "📅 รายการวันหยุดพิเศษ:\n\n"
  holidays.forEach((holiday) => {
    const date = dayjs(holiday.holiday_date)
    const thaiDate = date.format(`DD/MM/${date.year() + 543}`) // แสดงในรูปแบบไทย
    holidayList += `${thaiDate} - ${holiday.holiday_name}\n`
  })

  await bot.sendMessage(chatId, holidayList)
  botLog(
    LOG_LEVELS.INFO,
    "command-list_holidays",
    `ส่งรายการวันหยุด ${holidays.length} รายการให้ผู้ใช้ ${
      username || firstName || chatId
    } สำเร็จ`
  )
}

async function handleSearchHoliday(msg, match) {
  const chatId = msg.chat.id
  const keyword = match[1]
  const username = msg.from.username || ""
  const firstName = msg.from.first_name || ""

  const holidays = await searchHolidays(keyword)
  if (holidays.length === 0) {
    await bot.sendMessage(chatId, `ไม่พบวันหยุดที่มีคำว่า "${keyword}"`)
    botLog(
      LOG_LEVELS.INFO,
      "command-search_holiday",
      `ไม่พบวันหยุดที่มีคำว่า "${keyword}"`
    )
    return
  }

  let resultList = `🔍 ผลการค้นหาวันหยุด "${keyword}":\n\n`
  holidays.forEach((holiday) => {
    const date = dayjs(holiday.holiday_date)
    const thaiDate = date.format(`DD/MM/${date.year() + 543}`)
    resultList += `${thaiDate} - ${holiday.holiday_name}\n`
  })

  await bot.sendMessage(chatId, resultList)
  botLog(
    LOG_LEVELS.INFO,
    "command-search_holiday",
    `ส่งผลการค้นหาวันหยุด ${holidays.length} รายการให้ผู้ใช้ ${
      username || firstName || chatId
    } สำเร็จ`
  )
}

async function handleAddHoliday(msg, match) {
  const chatId = msg.chat.id
  const thaiDate = match[1]
  const description = match[2] || "วันหยุดพิเศษ"

  // แปลงวันที่จากรูปแบบไทยเป็น ISO
  const isoDate = thaiDateToIsoDate(thaiDate)
  if (!isoDate) {
    await bot.sendMessage(
      chatId,
      "❌ รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ วัน/เดือน/ปี(พ.ศ.) เช่น 01/01/2568"
    )
    botLog(
      LOG_LEVELS.WARN,
      "command-add_holiday",
      `แอดมิน ${chatId} ใส่รูปแบบวันที่ไม่ถูกต้อง: ${thaiDate}`
    )
    return
  }

  const success = await addHoliday(isoDate, description)
  if (success) {
    await bot.sendMessage(
      chatId,
      `✅ เพิ่มวันหยุด ${thaiDate} (${description}) เรียบร้อยแล้ว`
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-add_holiday",
      `แอดมิน ${chatId} เพิ่มวันหยุด ${thaiDate} (${description}) สำเร็จ`
    )
  } else {
    await bot.sendMessage(chatId, "❌ เกิดข้อผิดพลาดในการบันทึกวันหยุด")
    botLog(
      LOG_LEVELS.ERROR,
      "command-add_holiday",
      `แอดมิน ${chatId} ไม่สามารถเพิ่มวันหยุด ${thaiDate} (${description}) ได้`
    )
  }
}

async function handleDeleteHoliday(msg, match) {
  const chatId = msg.chat.id
  const thaiDate = match[1]

  // แปลงวันที่จากรูปแบบไทยเป็น ISO
  const isoDate = thaiDateToIsoDate(thaiDate)
  if (!isoDate) {
    await bot.sendMessage(
      chatId,
      "❌ รูปแบบวันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ วัน/เดือน/ปี(พ.ศ.) เช่น 01/01/2568"
    )
    botLog(
      LOG_LEVELS.WARN,
      "command-delete_holiday",
      `แอดมิน ${chatId} ใส่รูปแบบวันที่ไม่ถูกต้อง: ${thaiDate}`
    )
    return
  }

  const success = await deleteHoliday(isoDate)
  if (success) {
    await bot.sendMessage(chatId, `✅ ลบวันหยุด ${thaiDate} เรียบร้อยแล้ว`)
    botLog(
      LOG_LEVELS.INFO,
      "command-delete_holiday",
      `แอดมิน ${chatId} ลบวันหยุด ${thaiDate} สำเร็จ`
    )
  } else {
    await bot.sendMessage(
      chatId,
      `❌ ไม่พบวันหยุด ${thaiDate} หรือเกิดข้อผิดพลาดในการลบ`
    )
    botLog(
      LOG_LEVELS.WARN,
      "command-delete_holiday",
      `แอดมิน ${chatId} ไม่สามารถลบวันหยุด ${thaiDate} ได้`
    )
  }
}

async function handleImportHolidays(msg) {
  const chatId = msg.chat.id

  const result = await importHolidaysFromJson()
  if (result) {
    await bot.sendMessage(
      chatId,
      "✅ นำเข้าข้อมูลวันหยุดจาก JSON เรียบร้อยแล้ว"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-import_holidays",
      `แอดมิน ${chatId} นำเข้าข้อมูลวันหยุดจาก JSON สำเร็จ`
    )
  } else {
    await bot.sendMessage(
      chatId,
      "ℹ️ มีข้อมูลในฐานข้อมูลแล้ว ข้ามการนำเข้า หากต้องการนำเข้าซ้ำ กรุณาใช้คำสั่ง /force_import_holidays"
    )
    botLog(
      LOG_LEVELS.INFO,
      "command-import_holidays",
      `มีข้อมูลในฐานข้อมูลแล้ว ข้ามการนำเข้า`
    )
  }
}

async function handleForceImportHolidays(msg) {
  const chatId = msg.chat.id

  try {
    let conn = await getConnection()
    // ลบข้อมูลวันหยุดทั้งหมด
    await conn.query("TRUNCATE TABLE holidays")
    await conn.end()

    botLog(
      LOG_LEVELS.INFO,
      "command-force_import_holidays",
      `ลบข้อมูลวันหยุดเดิมทั้งหมดสำเร็จ`
    )

    // นำเข้าข้อมูลใหม่
    const result = await importHolidaysFromJson()
    if (result) {
      await bot.sendMessage(
        chatId,
        "✅ บังคับนำเข้าข้อมูลวันหยุดจาก JSON เรียบร้อยแล้ว"
      )
      botLog(
        LOG_LEVELS.INFO,
        "command-force_import_holidays",
        `แอดมิน ${chatId} บังคับนำเข้าข้อมูลวันหยุดจาก JSON สำเร็จ`
      )
    } else {
      await bot.sendMessage(chatId, "❌ ไม่สามารถนำเข้าข้อมูลวันหยุดได้")
      botLog(
        LOG_LEVELS.ERROR,
        "command-force_import_holidays",
        `แอดมิน ${chatId} ไม่สามารถนำเข้าข้อมูลวันหยุดได้`
      )
    }
  } catch (dbError) {
    logError("command-force_import_holidays-db", dbError)
    await bot.sendMessage(
      chatId,
      "❌ เกิดข้อผิดพลาดในการทำงานกับฐานข้อมูล: " + dbError.message
    )
  }
}

async function handleDbStatus(msg) {
  const chatId = msg.chat.id

  const subscribers = await getSubscribedUsers()
  const conn = await getConnection()

  // ดึงจำนวนผู้ใช้ทั้งหมด
  const [totalUsers] = await conn.query("SELECT COUNT(*) as count FROM users")
  await conn.end()

  const message = `
📊 สถานะฐานข้อมูล:

- จำนวนผู้ใช้ทั้งหมด: ${totalUsers[0].count} คน
- จำนวนผู้สมัครรับข้อความ: ${subscribers.length} คน
      `

  await bot.sendMessage(chatId, message)
  botLog(
    LOG_LEVELS.INFO,
    "command-dbstatus",
    `ส่งข้อมูลสถานะฐานข้อมูลให้แอดมิน ${chatId} สำเร็จ`
  )
}

async function handleStartTest(msg) {
  const chatId = msg.chat.id

  if (isTestCronRunning) {
    await bot.sendMessage(chatId, "⚠️ การทดสอบกำลังทำงานอยู่แล้ว!")
    botLog(LOG_LEVELS.WARN, "command-start_test", `การทดสอบกำลังทำงานอยู่แล้ว`)
    return
  }

  if (testCron) {
    testCron.start()
    isTestCronRunning = true
    await bot.sendMessage(chatId, "✅ เริ่มการทดสอบแล้ว! แจ้งเตือนทุก 2 นาที")
    botLog(
      LOG_LEVELS.INFO,
      "command-start_test",
      `แอดมิน ${chatId} เริ่มการทดสอบส่งข้อความทุก 2 นาทีสำเร็จ`
    )
  } else {
    await bot.sendMessage(chatId, "❌ ไม่สามารถเริ่มการทดสอบได้ ไม่พบ cron job")
    botLog(
      LOG_LEVELS.ERROR,
      "command-start_test",
      `ไม่สามารถเริ่ม testCron เนื่องจากไม่มีการสร้าง`
    )
  }
}

async function handleStopTest(msg) {
  const chatId = msg.chat.id

  if (!isTestCronRunning || !testCron) {
    await bot.sendMessage(chatId, "⚠️ ไม่มีการทดสอบที่กำลังทำงานอยู่!")
    botLog(
      LOG_LEVELS.WARN,
      "command-stop_test",
      `ไม่มีการทดสอบที่กำลังทำงานอยู่`
    )
    return
  }

  testCron.stop()
  isTestCronRunning = false
  await bot.sendMessage(chatId, "✅ หยุดการทดสอบเรียบร้อยแล้ว!")
  botLog(
    LOG_LEVELS.INFO,
    "command-stop_test",
    `แอดมิน ${chatId} หยุดการทดสอบสำเร็จ`
  )
}

async function handleResetWebhook(msg) {
  const chatId = msg.chat.id

  await bot.deleteWebHook()
  botLog(LOG_LEVELS.INFO, "command-reset_webhook", `ลบ webhook เดิมสำเร็จ`)

  const result = await bot.setWebHook(`${appUrl}/bot${token}`)
  botLog(
    LOG_LEVELS.INFO,
    "command-reset_webhook",
    `ตั้งค่า webhook ใหม่: ${appUrl}/bot${token} ผลลัพธ์: ${result}`
  )

  await bot.sendMessage(
    chatId,
    `✅ รีเซ็ต webhook สำเร็จ\nWebhook URL: ${appUrl}/bot${token}`
  )
}

async function handleAddAdmin(msg, match) {
  const adminChatId = msg.chat.id
  const targetChatId = match[1]

  // ตรวจสอบว่ามีผู้ใช้นี้ในระบบหรือไม่
  const userInfo = await getUserByChatId(targetChatId)

  if (!userInfo) {
    await bot.sendMessage(
      adminChatId,
      "❌ ไม่พบผู้ใช้นี้ในระบบ ผู้ใช้ต้องเคยใช้คำสั่ง /start กับบอทก่อน"
    )
    return
  }

  if (userInfo.role === "admin") {
    await bot.sendMessage(adminChatId, "ℹ️ ผู้ใช้นี้เป็นแอดมินอยู่แล้ว")
    return
  }

  // อัปเดตสิทธิ์เป็นแอดมิน
  try {
    const conn = await getConnection()
    await conn.query("UPDATE users SET role = 'admin' WHERE chat_id = ?", [
      targetChatId,
    ])
    await conn.end()

    await bot.sendMessage(
      adminChatId,
      `✅ เพิ่ม ${targetChatId} เป็นแอดมินสำเร็จ`
    )

    // แจ้งเตือนผู้ใช้ที่ได้รับสิทธิ์
    await bot.sendMessage(
      targetChatId,
      "🎉 คุณได้รับสิทธิ์เป็นแอดมินของบอทแล้ว!"
    )

    botLog(
      LOG_LEVELS.INFO,
      "admin-management",
      `แอดมิน ${adminChatId} เพิ่ม ${targetChatId} เป็นแอดมินสำเร็จ`
    )
  } catch (error) {
    logError("add-admin", error)
    await bot.sendMessage(adminChatId, "❌ เกิดข้อผิดพลาดในการเพิ่มแอดมิน")
  }
}

async function handleRemoveAdmin(msg, match) {
  const adminChatId = msg.chat.id
  const targetChatId = match[1]

  // ป้องกันการลบสิทธิ์ของตัวเอง
  if (String(targetChatId) === String(adminChatId)) {
    await bot.sendMessage(adminChatId, "⚠️ ไม่สามารถลบสิทธิ์ของตัวเองได้")
    return
  }

  // ป้องกันการลบสิทธิ์ของ super admin (จาก .env)
  if (String(targetChatId) === process.env.ADMIN_CHAT_ID) {
    await bot.sendMessage(
      adminChatId,
      "⚠️ ไม่สามารถลบสิทธิ์ของ Super Admin ได้"
    )
    return
  }

  // ตรวจสอบว่ามีผู้ใช้นี้ในระบบหรือไม่
  const userInfo = await getUserByChatId(targetChatId)

  if (!userInfo) {
    await bot.sendMessage(adminChatId, "❌ ไม่พบผู้ใช้นี้ในระบบ")
    return
  }

  if (userInfo.role !== "admin") {
    await bot.sendMessage(adminChatId, "ℹ️ ผู้ใช้นี้ไม่ได้เป็นแอดมิน")
    return
  }

  // อัปเดตสิทธิ์เป็นผู้ใช้ปกติ
  try {
    const conn = await getConnection()
    await conn.query("UPDATE users SET role = 'user' WHERE chat_id = ?", [
      targetChatId,
    ])
    await conn.end()

    await bot.sendMessage(
      adminChatId,
      `✅ ลบสิทธิ์แอดมิน ${targetChatId} สำเร็จ`
    )

    // แจ้งเตือนผู้ใช้ที่ถูกลบสิทธิ์
    await bot.sendMessage(targetChatId, "ℹ️ สิทธิ์แอดมินของคุณได้ถูกยกเลิกแล้ว")

    botLog(
      LOG_LEVELS.INFO,
      "admin-management",
      `แอดมิน ${adminChatId} ลบสิทธิ์แอดมิน ${targetChatId} สำเร็จ`
    )
  } catch (error) {
    logError("remove-admin", error)
    await bot.sendMessage(adminChatId, "❌ เกิดข้อผิดพลาดในการลบสิทธิ์แอดมิน")
  }
}

async function handleListAdmins(msg) {
  const chatId = msg.chat.id

  try {
    const conn = await getConnection()
    const [admins] = await conn.query(
      "SELECT chat_id, username, first_name, last_name FROM users WHERE role = 'admin'"
    )
    await conn.end()

    if (admins.length === 0) {
      await bot.sendMessage(
        chatId,
        "ไม่พบแอดมินในระบบ (ไม่รวม Super Admin จาก .env)"
      )
      return
    }

    let message = "👑 รายชื่อแอดมินทั้งหมด:\n\n"

    admins.forEach((admin, index) => {
      const name =
        [admin.first_name, admin.last_name].filter(Boolean).join(" ") ||
        "ไม่ระบุ"
      const username = admin.username ? `@${admin.username}` : "ไม่ระบุ"

      message += `${index + 1}. ${name} (${username})\n`
      message += `   ID: ${admin.chat_id}\n`

      if (String(admin.chat_id) === process.env.ADMIN_CHAT_ID) {
        message += "   🔱 Super Admin\n"
      }

      message += "\n"
    })

    await bot.sendMessage(chatId, message)
    botLog(
      LOG_LEVELS.INFO,
      "command-list_admins",
      `แอดมิน ${chatId} ดูรายชื่อแอดมินทั้งหมด ${admins.length} คน`
    )
  } catch (error) {
    logError("list-admins", error)
    await bot.sendMessage(chatId, "❌ เกิดข้อผิดพลาดในการดึงรายชื่อแอดมิน")
  }
}

// เพิ่มฟังก์ชันจัดการคำสั่ง cron_job
async function handleCronJob(msg, match) {
  const chatId = msg.chat.id;
  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  
  // ตรวจสอบความถูกต้องของเวลาที่รับเข้ามา
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    await bot.sendMessage(chatId, "⚠️ รูปแบบเวลาไม่ถูกต้อง กรุณาใช้ HH.mm (00.00 - 23.59)");
    return;
  }
  
  // แปลงเวลาไทย (UTC+7) เป็น UTC สำหรับตั้ง cron job
  let utcHours = hours - 7;
  if (utcHours < 0) utcHours += 24;
  
  // สร้าง cron expression
  const cronExpression = `${minutes} ${utcHours} * * *`;
  
  // แสดงข้อมูลการตั้ง cron
  const thaiTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} น. (UTC+7)`;
  const utcTime = `${utcHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} (UTC)`;
  
  await bot.sendMessage(
    chatId, 
    `🕒 กำลังตั้ง cron job ที่เวลา ${thaiTime}\n` +
    `⏱️ เทียบเท่ากับเวลา ${utcTime}\n` +
    `📋 Cron expression: ${cronExpression}\n\n` +
    `รอสักครู่... ระบบจะส่งข้อความแจ้งเตือนเมื่อถึงเวลา`
  );
  
  // คำนวณเวลาที่จะทำงาน
  let scheduledTime = new Date();
  scheduledTime.setHours(hours);
  scheduledTime.setMinutes(minutes);
  scheduledTime.setSeconds(0);
  
  // ถ้าเวลาที่กำหนดผ่านไปแล้วในวันนี้ ให้ใช้เวลาของวันพรุ่งนี้แทน
  const now = new Date();
  if (scheduledTime < now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1);
  }
  
  const timeUntilExecution = scheduledTime.getTime() - now.getTime();
  const minutesUntil = Math.round(timeUntilExecution / 60000);
  
  await bot.sendMessage(
    chatId,
    `⏳ การแจ้งเตือนจะทำงานในอีกประมาณ ${minutesUntil} นาที ` +
    `(${scheduledTime.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })})`
  );
  
  // สร้าง cron job แบบใช้ครั้งเดียว
  const testCronJob = cron.schedule(cronExpression, async () => {
    try {
      // ส่งข้อความแจ้งเตือน
      await bot.sendMessage(
        chatId,
        `🔔 แจ้งเตือน! ถึงเวลาที่คุณกำหนดไว้แล้ว: ${thaiTime}\n` +
        `สำเร็จ! นี่คือการทดสอบการทำงานของ cron job ด้วยคำสั่ง /cron_job ${hours}.${minutes.toString().padStart(2, '0')}`
      );
      
      botLog(
        LOG_LEVELS.INFO,
        "testCronJob",
        `ส่งข้อความแจ้งเตือนการทดสอบ cron ไปยัง ${chatId} สำเร็จ (เวลา: ${thaiTime})`
      );
      
      // หยุด cron job หลังจากทำงานเสร็จ
      testCronJob.stop();
    } catch (error) {
      logError("testCronJob", error);
      try {
        await bot.sendMessage(
          chatId,
          "❌ เกิดข้อผิดพลาดในการส่งข้อความแจ้งเตือน กรุณาลองอีกครั้ง"
        );
      } catch (sendError) {
        logError("testCronJob-sendError", sendError);
      }
      testCronJob.stop();
    }
  }, {
    scheduled: true,
    timezone: "UTC" // ต้องกำหนดเป็น UTC เพราะเราได้แปลงเวลาเป็น UTC แล้ว
  });
  
  botLog(
    LOG_LEVELS.INFO,
    "command-cron_job",
    `แอดมิน ${chatId} ตั้ง cron job ทดสอบที่เวลา ${thaiTime} (${cronExpression})`
  );
}

// เพิ่มเส้นทางสำหรับทดสอบส่งข้อความ
app.get("/test-message/:chatId", async (req, res) => {
  try {
    const chatId = req.params.chatId
    console.log(`Sending test message to chat ID: ${chatId}`)
    const result = await bot.sendMessage(chatId, "นี่คือข้อความทดสอบจากบอท! 🤖")
    console.log("Message sent result:", result)
    res.send("Test message sent successfully")
  } catch (error) {
    console.error("Error sending test message:", error)
    res.status(500).send(`Error: ${error.message}`)
  }
})

// คำสั่งเริ่มการทดสอบ (สำหรับแอดมิน)
function startTest(msg) {
  try {
    const chatId = msg.chat.id

    // ตรวจสอบสิทธิ์แอดมิน
    if (!isAdmin(chatId)) {
      bot.sendMessage(chatId, "❌ เฉพาะแอดมินเท่านั้นที่ใช้คำสั่งนี้ได้!")
      botLog(
        LOG_LEVELS.WARN,
        "command-start_test",
        `ผู้ใช้ที่ไม่ใช่แอดมิน ${chatId} พยายามเรียกใช้คำสั่ง /start_test`
      )
      return
    }

    botLog(
      LOG_LEVELS.INFO,
      "command-start_test",
      `แอดมิน ${chatId} เรียกใช้คำสั่ง /start_test`
    )

    if (isTestCronRunning) {
      bot.sendMessage(chatId, "⚠️ การทดสอบกำลังทำงานอยู่แล้ว!")
      botLog(
        LOG_LEVELS.WARN,
        "command-start_test",
        `การทดสอบกำลังทำงานอยู่แล้ว`
      )
      return
    }

    if (testCron) {
      testCron.start()
      isTestCronRunning = true
      bot.sendMessage(chatId, "✅ เริ่มการทดสอบแล้ว! แจ้งเตือนทุก 2 นาที")
      botLog(
        LOG_LEVELS.INFO,
        "command-start_test",
        `แอดมิน ${chatId} เริ่มการทดสอบส่งข้อความทุก 2 นาทีสำเร็จ`
      )
    } else {
      bot.sendMessage(chatId, "❌ ไม่สามารถเริ่มการทดสอบได้ ไม่พบ cron job")
      botLog(
        LOG_LEVELS.ERROR,
        "command-start_test",
        `ไม่สามารถเริ่ม testCron เนื่องจากไม่มีการสร้าง`
      )
    }
  } catch (error) {
    logError("command-start_test", error)
    try {
      bot.sendMessage(msg.chat.id, "❌ เกิดข้อผิดพลาดในการเริ่มการทดสอบ")
    } catch (sendError) {
      logError("command-start_test-sendError", sendError)
    }
  }
}

// คำสั่งหยุดการทดสอบ (สำหรับแอดมิน)
function stopTest(msg) {
  try {
    const chatId = msg.chat.id

    // ตรวจสอบสิทธิ์แอดมิน
    if (!isAdmin(chatId)) {
      bot.sendMessage(chatId, "❌ เฉพาะแอดมินเท่านั้นที่ใช้คำสั่งนี้ได้!")
      botLog(
        LOG_LEVELS.WARN,
        "command-stop_test",
        `ผู้ใช้ที่ไม่ใช่แอดมิน ${chatId} พยายามเรียกใช้คำสั่ง /stop_test`
      )
      return
    }

    botLog(
      LOG_LEVELS.INFO,
      "command-stop_test",
      `แอดมิน ${chatId} เรียกใช้คำสั่ง /stop_test`
    )

    if (!isTestCronRunning || !testCron) {
      bot.sendMessage(chatId, "⚠️ ไม่มีการทดสอบที่กำลังทำงานอยู่!")
      botLog(
        LOG_LEVELS.WARN,
        "command-stop_test",
        `ไม่มีการทดสอบที่กำลังทำงานอยู่`
      )
      return
    }

    testCron.stop()
    isTestCronRunning = false
    bot.sendMessage(chatId, "✅ หยุดการทดสอบเรียบร้อยแล้ว!")
    botLog(
      LOG_LEVELS.INFO,
      "command-stop_test",
      `แอดมิน ${chatId} หยุดการทดสอบสำเร็จ`
    )
  } catch (error) {
    logError("command-stop_test", error)
    try {
      bot.sendMessage(msg.chat.id, "❌ เกิดข้อผิดพลาดในการหยุดการทดสอบ")
    } catch (sendError) {
      logError("command-stop_test-sendError", sendError)
    }
  }
}

// เรียกใช้แอปพลิเคชันครั้งแรก (และครั้งเดียว) หลังจากโหลดไฟล์เสร็จ
if (!hasStarted) {
  startApplication()
}
