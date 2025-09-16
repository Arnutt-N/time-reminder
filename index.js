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
const rateLimit = require("express-rate-limit")
const crypto = require("crypto")
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")
const timezone = require("dayjs/plugin/timezone")
const config = require("./config") // นำเข้า config
const { deduplicateRecipients } = require("./src/utils/message-deduplicator") // นำเข้า message deduplicator

// ตั้งค่า Day.js
dayjs.extend(utc)
dayjs.extend(timezone)
const THAI_TIMEZONE = "Asia/Bangkok"

// กำหนดตัวแปรสำคัญจาก config - จะถูกตั้งค่าหลัง loadProductionSecrets()
let token, chatId, appUrl, port, HOLIDAYS_FILE, WEBHOOK_SECRET

// ตัวแปรสถานะการเริ่มต้น
let botInitialized = false
let holidaysData = {}
let appInitialized = false
let eventHandlersInitialized = false
let webhookEndpointRegistered = false
let handlersRegistrationTimestamp = null
let cronJobsInitialized = false
let hasStarted = false
let isTestCronRunning = false
let testCron = null
let databaseInitialized = false

// สร้าง Express app
const app = express()

// Security enhancements: JSON body limits to prevent DoS attacks
app.use(express.json({ limit: "256kb" }))

// Rate limiting for API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
    retry_after: "15 minutes",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

const cronLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 requests per minute for cron endpoint
  message: {
    error: "Too many cron requests, please try again later.",
    retry_after: "1 minute",
  },
  standardHeaders: true,
  legacyHeaders: false,
})

// Apply rate limiting to specific endpoints
app.use("/api/cron", cronLimiter)
app.use("/api", apiLimiter)

// root เพื่อกัน 404 เวลา health/manual open
app.get("/", (_req, res) => {
  res.status(200).send("OK - Telegram Reminder Bot")
})

// Bot instance จะถูกสร้างหลังจาก server เริ่มทำงานแล้ว
let bot = null

// ===== move this helper ABOVE any usage =====
const verifyCronSecret = (req, res, next) => {
  const expectedRaw = process.env.CRON_SECRET
  const expected = typeof expectedRaw === "string" ? expectedRaw.trim() : ""
  const authHeader = req.headers.authorization || ""
  const provided = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : ""
  if (!expected) return res.status(500).send("Server configuration error.")
  if (!provided) return res.status(401).send("Unauthorized: Missing Authorization header.")
  try {
    const a = Buffer.from(provided, "utf8")
    const b = Buffer.from(expected, "utf8")
    if (a.length !== b.length) return res.status(403).send("Forbidden: Invalid secret.")
    if (crypto.timingSafeEqual(a, b)) return next()
    return res.status(403).send("Forbidden: Invalid secret.")
  } catch {
    return res.status(403).send("Forbidden: Invalid secret.")
  }
}

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
    databaseInitialized = true
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

    // เริ่ม server "ให้ได้ก่อน" แล้วค่อยทำงานเสี่ยงภายหลัง (fail-soft)
    const host = "0.0.0.0"
    const effectivePort = Number(process.env.PORT) || Number(port) || 8080
    return new Promise((resolve) => {
      app
        .listen(effectivePort, host, async () => {
          try {
            // ค่อย ๆ ทำงานหนักภายหลังแบบไม่ kill โปรเซส
            holidaysData = loadHolidays()
            try {
              await initializeDatabase()
            } catch (e) {
              logError("initializeDatabase", e)
            }

            // สร้าง bot instance หลังจาก server ฟังพอร์ตแล้ว (ป้องกัน Cloud Run startup failure)
            try {
              botLog(
                LOG_LEVELS.INFO,
                "initializeApp",
                "กำลังสร้าง Telegram Bot instance"
              )
              bot = new TelegramBot(token, { polling: false })
              botLog(
                LOG_LEVELS.INFO,
                "initializeApp",
                "สร้าง Telegram Bot instance สำเร็จ"
              )
            } catch (botError) {
              botLog(
                LOG_LEVELS.ERROR,
                "initializeApp",
                `ไม่สามารถสร้าง Telegram Bot: ${botError.message}`
              )
              // ไม่ยกเลิกการทำงาน - ให้ server ทำงานต่อเพื่อ health checks
              resolve(false) // ส่งคืนสำเร็จแต่ไม่มี bot
              return
            }

            // ENHANCED webhook configuration with validation and verification
            botLog(LOG_LEVELS.INFO, "initializeApp", "กำลังลบ webhook เดิม (ถ้ามี)")
            try {
              await bot.deleteWebHook()
            } catch (e) {
              logError("deleteWebHook", e)
            }

            const _url = `${appUrl}/bot${token}`
            const maskedUrl = `${appUrl}/bot${token.substring(
              0,
              10
            )}***MASKED***`

            // ตั้ง webhook แบบ fail-soft (ข้ามถ้า APP_URL ไม่ได้เป็น https)
            if (!appUrl || !appUrl.startsWith("https://")) {
              botLog(LOG_LEVELS.WARN, "initializeApp", "APP_URL missing/not https → skip webhook")
            } else {
              botLog(LOG_LEVELS.INFO, "initializeApp", `กำลังตั้งค่า webhook ใหม่: ${maskedUrl}`)
              const webhookOptions = {
                allowed_updates: [
                  "message",
                  "callback_query",
                  "chat_member",
                  "my_chat_member",
                ],
                drop_pending_updates: true,
                max_connections: 40,
              }
              if (WEBHOOK_SECRET) {
                webhookOptions.secret_token = WEBHOOK_SECRET
                botLog(LOG_LEVELS.DEBUG, "initializeApp", "Webhook secret token configured")
              }
              try {
                const webhookResult = await bot.setWebHook(_url, webhookOptions)
                if (!webhookResult) botLog(LOG_LEVELS.WARN, "initializeApp", "setWebHook returned falsy (continue)")
                try {
                  const webhookInfo = await bot.getWebhookInfo()
                  if (webhookInfo.url !== _url) {
                    botLog(LOG_LEVELS.WARN, "initializeApp", "Webhook URL mismatch", {
                      expected: maskedUrl,
                      actual: webhookInfo.url ? `${webhookInfo.url.substring(0, 20)}***MASKED***` : "none",
                    })
                  } else {
                    botLog(LOG_LEVELS.INFO, "initializeApp", "Webhook verification successful")
                  }
                } catch (verifyError) {
                  botLog(LOG_LEVELS.WARN, "initializeApp", "Webhook verification failed", verifyError.message)
                }
              } catch (hookErr) {
                logError("setWebHook", hookErr)
              }
            }

            botInitialized = true
            botLog(LOG_LEVELS.INFO, "initializeApp", `เซิร์ฟเวอร์ทำงานที่ ${host}:${effectivePort}`)
            const maskedWebhookUrl = `${appUrl}/bot${token.substring(
              0,
              10
            )}***MASKED***`
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              `ตั้งค่า webhook: ${maskedWebhookUrl}`
            )

            // ตั้งค่า event handlers
            setupEventHandlers()
            botLog(
              LOG_LEVELS.INFO,
              "initializeApp",
              "ตั้งค่า event handlers สำเร็จ"
            )

            // ตั้งค่า cron jobs (เฉพาะโหมด internal)
            const cronMode = process.env.CRON_MODE || "external"
            if (cronMode === "internal") {
              setupCronJobs()
              botLog(
                LOG_LEVELS.INFO,
                "initializeApp",
                "ตั้งค่า internal cron jobs สำเร็จ"
              )
            } else {
              botLog(
                LOG_LEVELS.INFO,
                "initializeApp",
                `ใช้ external scheduler (${cronMode}) - ข้าม internal cron jobs`
              )
            }

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

                // สั่งจำลองคำสั่ง /start ให้กับแอดมิน (เฉพาะใน development)
                if (process.env.SIMULATE_START_ON_BOOT === "true") {
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
                    LOG_LEVELS.INFO,
                    "initializeApp",
                    `ข้าม startup simulation (SIMULATE_START_ON_BOOT=${
                      process.env.SIMULATE_START_ON_BOOT || "false"
                    })`
                  )
                }
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
            logError("initializeApp-after-listen", error)
            // อย่าล้มบูต ให้ตอบ health ได้
            resolve(false)
          }
        })
        .on("error", (error) => {
          logError("initializeApp-server", error)
          // ให้ Cloud Run จัดการรีสตาร์ทเอง
          resolve(false)
        })
    })
  } catch (err) {
    console.error("เกิดข้อผิดพลาดในการเริ่มต้นแอปพลิเคชัน:", err)
    logError("initializeApp", err)
    return false
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

    // CRITICAL: Load production secrets before accessing config values
    botLog(
      LOG_LEVELS.INFO,
      "startApplication",
      "🔐 Loading production secrets..."
    )
    await config.loadProductionSecrets()

    // Initialize config variables after secrets are loaded
    token = config.telegramBotToken
    chatId = config.telegramChatId
    appUrl = config.appUrl
    port = config.port
    HOLIDAYS_FILE = config.holidaysFile
    WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ""

    botLog(
      LOG_LEVELS.INFO,
      "startApplication",
      "✅ Configuration initialized with secrets"
    )

    // Validate configuration after secrets are loaded
    if (!chatId) {
      botLog(
        LOG_LEVELS.WARN,
        "startApplication",
        "TELEGRAM_CHAT_ID is not set. Messages will only be sent to individual subscribers."
      )
    }

    // Auto-generate APP_URL for Cloud Run if not provided
    if (!process.env.APP_URL) {
      const region = process.env.GOOGLE_CLOUD_REGION || "us-central1"
      const projectId = process.env.GOOGLE_CLOUD_PROJECT
      const serviceName = process.env.K_SERVICE || "telegram-reminder-bot"

      if (projectId && region) {
        const generatedUrl = `https://${serviceName}-${projectId}.${region}.run.app`
        process.env.APP_URL = generatedUrl
        appUrl = generatedUrl

        botLog(
          LOG_LEVELS.INFO,
          "startApplication",
          `🔗 Auto-generated APP_URL: ${generatedUrl}`
        )
      } else {
        botLog(
          LOG_LEVELS.WARN,
          "startApplication",
          "Cannot auto-generate APP_URL: missing project info"
        )
      }
    } else {
      botLog(
        LOG_LEVELS.INFO,
        "startApplication",
        `📍 Using provided APP_URL: ${appUrl}`
      )
    }

    // Register webhook endpoint AFTER token is loaded
    if (token && !webhookEndpointRegistered) {
      const webhookPath = `/bot${token}`
      app.post(webhookPath, (req, res) => {
        try {
          // ตรวจ header ถ้าตั้งค่าไว้
          if (WEBHOOK_SECRET) {
            const header = req.get("X-Telegram-Bot-Api-Secret-Token")
            if (!header || header !== WEBHOOK_SECRET) {
              botLog(
                LOG_LEVELS.WARN,
                "webhook",
                "Unauthorized webhook (secret mismatch)"
              )
              return res.sendStatus(401)
            }
          }

          botLog(LOG_LEVELS.DEBUG, "webhook", "Received update from Telegram", {
            updateId: req.body.update_id,
            chatId: req.body.message?.chat?.id,
          })

          if (!bot) {
            botLog(LOG_LEVELS.ERROR, "webhook", "Bot instance not initialized")
            return res.sendStatus(503)
          }

          bot.processUpdate(req.body)
          res.sendStatus(200)
        } catch (error) {
          logError("webhook", error)
          // ต้องส่ง 200 กลับไปเสมอเพื่อป้องกัน Telegram ส่งข้อมูลเดิมซ้ำ
          res.sendStatus(200)
        }
      })

      webhookEndpointRegistered = true
      botLog(
        LOG_LEVELS.INFO,
        "startApplication",
        `🔗 Webhook endpoint registered: ${webhookPath}`
      )
    }

    // Critical environment variable validation
    function validateCriticalEnvironment() {
      const required = ["TELEGRAM_BOT_TOKEN", "APP_URL"]
      const missing = required.filter((key) => !process.env[key])

      if (missing.length > 0) {
        const errorMsg = `Missing critical environment variables: ${missing.join(
          ", "
        )}`
        botLog(LOG_LEVELS.ERROR, "startApplication", errorMsg)
        throw new Error(errorMsg)
      }

      botLog(
        LOG_LEVELS.INFO,
        "startApplication",
        "✅ All critical environment variables validated"
      )
    }

    // Validate critical environment variables
    try {
      validateCriticalEnvironment()
    } catch (error) {
      botLog(
        LOG_LEVELS.ERROR,
        "startApplication",
        `❌ Environment validation failed: ${error.message}`
      )
      throw error
    }

    // ปิดระบบไฟล์ล็อกบน Cloud Run (ใช้เฉพาะ dev/local)
    const runningOnCloudRun = !!process.env.K_SERVICE
    if (!runningOnCloudRun && fs.existsSync("bot.lock")) {
      const pid = parseInt(fs.readFileSync("bot.lock", "utf8"), 10)
      try {
        process.kill(pid, 0) // ตรวจสอบว่าโปรเซสยังมีชีวิต
        botLog(
          LOG_LEVELS.ERROR,
          "startApplication",
          `บอทกำลังทำงานอยู่แล้ว (PID: ${pid}) กำลังปิดโปรแกรม...`
        )
        return
      } catch (e) {
        botLog(
          LOG_LEVELS.WARN,
          "startApplication",
          `พบไฟล์ล็อกเก่า (PID: ${pid}) แต่ไม่มีกระบวนการทำงาน ลบไฟล์ล็อก...`
        )
        fs.unlinkSync("bot.lock")
      }
    }

    // เขียนไฟล์ล็อกใหม่ (เฉพาะ non-Cloud Run)
    if (!runningOnCloudRun) {
      fs.writeFileSync("bot.lock", process.pid.toString())
      botLog(
        LOG_LEVELS.INFO,
        "startApplication",
        `เขียนไฟล์ล็อกสำเร็จ (PID: ${process.pid})`
      )
    }

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
    process.on("SIGINT", () => { cleanup() })
    process.on("uncaughtException", (err) => { logError("uncaughtException", err); cleanup() })

    // เริ่มต้นแอปพลิเคชัน (เรียกครั้งเดียว)
    await initializeApp()
    botLog(
      LOG_LEVELS.INFO,
      "startApplication",
      "บอทพร้อมทำงานและตอบสนองคำสั่งแล้ว"
    )

    // Comprehensive startup validation
    async function validateStartupSequence() {
      const checks = [
        { name: "Config module loaded", check: () => !!config },
        {
          name: "Production secrets loaded",
          check: () => !!process.env.TELEGRAM_BOT_TOKEN,
        },
        { name: "Bot token assigned", check: () => !!token },
        { name: "App URL configured", check: () => !!appUrl },
        { name: "Bot instance created", check: () => !!bot },
        { name: "Database initialized", check: () => databaseInitialized },
        { name: "Event handlers setup", check: () => eventHandlersInitialized },
        {
          name: "Webhook configured",
          check: async () => {
            if (!bot) return false
            try {
              const info = await bot.getWebhookInfo()
              return !!info.url && info.url.includes(token)
            } catch (error) {
              return false
            }
          },
        },
      ]

      botLog(
        LOG_LEVELS.INFO,
        "startup-validation",
        "🔍 Starting comprehensive startup validation..."
      )

      const results = []
      for (const test of checks) {
        try {
          const result =
            typeof test.check === "function" ? await test.check() : test.check
          const status = result ? "✅" : "❌"
          const message = `${status} ${test.name}: ${result}`

          botLog(LOG_LEVELS.INFO, "startup-validation", message)
          results.push({ name: test.name, passed: result, status })
        } catch (error) {
          const message = `❌ ${test.name}: ERROR - ${error.message}`
          botLog(LOG_LEVELS.ERROR, "startup-validation", message)
          results.push({
            name: test.name,
            passed: false,
            error: error.message,
            status: "❌",
          })
        }
      }

      const passed = results.filter((r) => r.passed).length
      const total = results.length
      const successRate = Math.round((passed / total) * 100)

      if (successRate === 100) {
        botLog(
          LOG_LEVELS.INFO,
          "startup-validation",
          `🎉 All startup checks passed (${passed}/${total})`
        )
      } else {
        botLog(
          LOG_LEVELS.WARN,
          "startup-validation",
          `⚠️ Startup validation: ${passed}/${total} passed (${successRate}%)`
        )
      }

      return { results, passed, total, successRate }
    }

    // Run startup validation after complete initialization
    try {
      await validateStartupSequence()
    } catch (error) {
      logError("startup-validation", error)
    }

    // ตั้งค่าสถานะว่าได้เริ่มต้นแล้ว
    hasStarted = true
  } catch (err) {
    logError("startApplication", err)
    // Do not force-exit; allow platform to manage restarts
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

// MarkdownV2 utility functions for safe message formatting
function escapeMarkdownV2(text) {
  if (typeof text !== "string") {
    return String(text)
  }

  // MarkdownV2 special characters that need to be escaped
  const specialChars = [
    "_",
    "*",
    "[",
    "]",
    "(",
    ")",
    "~",
    "`",
    ">",
    "#",
    "+",
    "-",
    "=",
    "|",
    "{",
    "}",
    ".",
    "!",
  ]

  let escaped = text
  for (const char of specialChars) {
    const regex = new RegExp(
      "\\" + char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "g"
    )
    escaped = escaped.replace(regex, "\\" + char)
  }

  return escaped
}

function formatMarkdownV2Bold(text) {
  return `*${escapeMarkdownV2(text)}*`
}

function formatMarkdownV2Italic(text) {
  return `_${escapeMarkdownV2(text)}_`
}

function formatMarkdownV2Code(text) {
  return `\`${text.replace(/`/g, "\\`")}\``
}

// เพิ่ม endpoints สำหรับ health check
app.get("/ping", (req, res) => {
  botLog(LOG_LEVELS.DEBUG, "ping", "Health check received")
  res.status(200).send("pong")
})

// Cloud Run readiness probe endpoint - fast response (<100ms)
app.get("/readiness", (req, res) => {
  // Simple check - server can accept traffic
  res.status(200).json({
    ready: true,
    timestamp: new Date().toISOString(),
    service: process.env.K_SERVICE || "telegram-reminder-bot",
  })
})

app.get("/health", async (req, res) => {
  try {
    const serverTimeInfo = getServerTimeInfo()

    // Test database connection
    let databaseStatus = "disconnected"
    try {
      const dbConnection = await getConnection()
      await dbConnection.query("SELECT 1")
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

    // ENHANCED webhook status detection
    let webhookStatus = "inactive"
    let webhookDetails = {}

    try {
      const webhookInfo = await bot.getWebhookInfo()
      const expectedUrl = `${appUrl}/bot${token}`

      if (webhookInfo.url) {
        // Check if webhook URL matches current configuration
        if (webhookInfo.url === expectedUrl) {
          // Check if webhook has received updates recently (last 5 minutes)
          const lastErrorDate = webhookInfo.last_error_date
            ? new Date(webhookInfo.last_error_date * 1000)
            : null
          const now = new Date()
          const timeDiff = lastErrorDate
            ? (now - lastErrorDate) / 1000
            : Infinity

          if (!webhookInfo.last_error_message || timeDiff > 300) {
            webhookStatus = "ok"
          } else {
            webhookStatus = "error"
            webhookDetails.error = webhookInfo.last_error_message
            webhookDetails.lastErrorDate = lastErrorDate.toISOString()
          }
        } else {
          webhookStatus = "misconfigured"
          webhookDetails.expected = expectedUrl
          webhookDetails.actual = webhookInfo.url
        }

        // Add webhook details for monitoring
        webhookDetails.pendingUpdates = webhookInfo.pending_update_count || 0
        webhookDetails.maxConnections = webhookInfo.max_connections || 0
        webhookDetails.allowedUpdates = webhookInfo.allowed_updates || []
      } else {
        webhookStatus = "inactive"
      }
    } catch (webhookError) {
      webhookStatus = "failed"
      webhookDetails.error = webhookError.message
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
        webhook_details: webhookDetails,
        cron_jobs: cronJobsInitialized || false,
        timezone: dayjs().tz(THAI_TIMEZONE).format(),
      },
      server_time: {
        utc: serverTimeInfo.utcTime,
        thai: serverTimeInfo.thaiTime,
        offset: serverTimeInfo.offset,
      },
    }

    // Structured logging for Cloud Run (single line payload)
    console.log(
      JSON.stringify({
        severity: "INFO",
        component: "health-check",
        ...healthData,
      })
    )
    res.status(200).json(healthData)
  } catch (error) {
    logError("health", error)

    const errorData = {
      status: "error",
      platform: "google-cloud-run",
      service: process.env.K_SERVICE,
      error: error.message,
      timestamp: new Date().toISOString(),
    }

    // Structured error logging for Cloud Run
    if (config.cloudRun.isCloudRun) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          severity: "ERROR",
          component: "health-check",
          message: "Health check failed",
          error: error.message,
          service: process.env.K_SERVICE,
        })
      )
    }

    res.status(500).json(errorData)
  }
})

// Enhanced Health Monitoring Endpoints

// Webhook status monitoring endpoint
app.get("/webhook-status", async (req, res) => {
  try {
    if (!bot) {
      return res.status(503).json({
        status: "error",
        message: "Bot instance not initialized",
      })
    }

    const webhookInfo = await bot.getWebhookInfo()
    const expectedUrl = `${appUrl}/bot${token}`

    const status = {
      status: "ok",
      webhook: {
        configured: !!webhookInfo.url,
        urlMatch: webhookInfo.url === expectedUrl,
        expectedUrl: expectedUrl,
        actualUrl: webhookInfo.url,
        pendingUpdates: webhookInfo.pending_update_count,
        lastError: webhookInfo.last_error_message || null,
      },
      timestamp: new Date().toISOString(),
    }

    // Return error status if webhook not properly configured
    if (!status.webhook.configured || !status.webhook.urlMatch) {
      status.status = "error"
    }

    res.json(status)
  } catch (error) {
    logError("webhook-status", error)
    res.status(503).json({
      status: "error",
      message: error.message,
    })
  }
})

// Bot instance health check
app.get("/bot-health", async (req, res) => {
  try {
    const checks = {
      botInstance: !!bot,
      token: !!token,
      appUrl: !!appUrl,
      webhookSecret: !!WEBHOOK_SECRET,
      eventHandlers: eventHandlersInitialized,
    }

    let status = "ok"
    let issues = []

    if (!checks.botInstance) {
      status = "error"
      issues.push("Bot instance not created")
    }

    if (!checks.token) {
      status = "error"
      issues.push("Bot token not loaded")
    }

    // Test bot API connection if bot exists
    let botInfo = null
    if (bot) {
      try {
        botInfo = await bot.getMe()
      } catch (error) {
        status = "error"
        issues.push("Bot API connection failed")
      }
    }

    res.json({
      status,
      checks,
      issues,
      botInfo,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    logError("bot-health", error)
    res.status(503).json({
      status: "error",
      message: error.message,
    })
  }
})

// Development-only environment debugging endpoint
app.get("/debug/env", (req, res) => {
  try {
    // Security: Only allow in development environment
    if (process.env.NODE_ENV !== "development") {
      botLog(
        LOG_LEVELS.WARN,
        "debug-env",
        `Unauthorized access attempt from ${req.ip}`
      )
      return res.status(404).send("Not Found")
    }

    // Safe environment variable status (no actual values)
    const debugInfo = {
      nodeEnv: process.env.NODE_ENV,
      hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
      hasAppUrl: !!process.env.APP_URL,
      hasChatId: !!process.env.TELEGRAM_CHAT_ID,
      hasAdminChatId: !!process.env.ADMIN_CHAT_ID,
      hasWebhookSecret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      hasCronSecret: !!process.env.CRON_SECRET,
      appUrl: process.env.APP_URL, // Safe to show URL in development
      port: process.env.PORT,
      region: process.env.GOOGLE_CLOUD_REGION,
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      serviceName: process.env.K_SERVICE,
      timestamp: new Date().toISOString(),
    }

    botLog(LOG_LEVELS.INFO, "debug-env", "Environment debug info requested")
    res.json(debugInfo)
  } catch (error) {
    logError("debug-env", error)
    res.status(500).json({ error: "Debug endpoint failed" })
  }
})

// Webhook endpoint will be registered dynamically after token is loaded

// เส้นทางสำหรับการตั้งค่า webhook
app.get("/webhook-info", async (req, res) => {
  try {
    if (!bot) return res.status(503).json({ error: "Bot not initialized" })
    const info = await bot.getWebhookInfo()
    console.log("Current webhook info:", info)
    res.json(info)
  } catch (error) {
    console.error("Error getting webhook info:", error)
    res.status(500).json({ error: error.message })
  }
})

// รีเซ็ต webhook (ต้องมี Authorization: Bearer <CRON_SECRET>)
app.post("/reset-webhook", async (req, res) => {
  try {
    const auth = req.headers.authorization || ""
    const expected = `Bearer ${process.env.CRON_SECRET || ""}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return res.status(401).json({ error: "Unauthorized" })
    }

    botLog(LOG_LEVELS.INFO, "resetWebhook", "Deleting webhook...")
    await bot.deleteWebHook()

    const maskedResetUrl = `${appUrl}/bot${token.substring(0, 10)}***MASKED***`
    botLog(
      LOG_LEVELS.INFO,
      "resetWebhook",
      `Setting new webhook to: ${maskedResetUrl}`
    )
    const result = await bot.setWebHook(
      `${appUrl}/bot${token}`,
      WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : undefined
    )

    botLog(LOG_LEVELS.INFO, "resetWebhook", "Webhook reset result:", result)
    res.json({ ok: true, result })
  } catch (error) {
    logError("resetWebhook", error)
    res.status(500).send(`Error: ${error.message}`)
  }
})

// External Cron Endpoint for GitHub Actions
app.post("/api/cron", verifyCronSecret, async (req, res) => {
  try {
    const { type, time } = req.body

    const allowedTypes = ["morning", "afternoon", "evening"]
    const allowedTimes = ["07:25", "08:25", "09:25", "15:30", "16:30", "17:30"]

    if (!allowedTypes.includes(type) || !allowedTimes.includes(time)) {
      return res.status(400).json({ error: "Invalid type or time" })
    }

    // log ให้รู้ว่า authorized แล้ว
    console.log(`✅ Authorized cron trigger: type=${type}, time=${time}`)

    if (type === "morning") {
      await sendMorningReminder(time)
    } else if (type === "afternoon") {
      await sendAfternoonReminder(time)
    } else if (type === "evening") {
      await sendEveningReminder(time)
    }

    return res.status(200).json({ status: "ok", type, time })
  } catch (err) {
    console.error("cron-endpoint error:", err)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Helper functions for external cron triggers
async function sendMorningReminder() {
  try {
    // Check for holidays
    if (await isHoliday()) {
      botLog(
        LOG_LEVELS.INFO,
        "sendMorningReminder",
        "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน"
      )
      return
    }

    botLog(
      LOG_LEVELS.INFO,
      "sendMorningReminder",
      "กำลังส่งข้อความแจ้งเตือนตอนเช้า"
    )

    const morningMessage =
      getMorningMessage() + "\n\n" + getCheckInReminderMessage()

    // Send to group/channel and individual subscribers (with deduplication)
    const subscribers = await getSubscribedUsers()
    const subscriberIds = subscribers.map((user) => user.chatId)
    const adminIds = chatId ? [chatId] : []

    // ลดความซ้ำซ้อนของผู้รับ
    const deduplicationResult = deduplicateRecipients(
      subscriberIds,
      adminIds,
      "sendMorningReminder"
    )
    const uniqueRecipients = deduplicationResult.uniqueRecipients

    botLog(
      LOG_LEVELS.INFO,
      "sendMorningReminder",
      `กำลังส่งข้อความไปยัง ${uniqueRecipients.length} คน (จากต้นฉบับ ${deduplicationResult.originalCount} คน)`
    )

    // ส่งข้อความไปยังผู้รับที่ไม่ซ้ำ
    for (const recipientId of uniqueRecipients) {
      try {
        await bot.sendMessage(recipientId, morningMessage)
        botLog(
          LOG_LEVELS.DEBUG,
          "sendMorningReminder",
          `ส่งข้อความเช้าให้ ${recipientId} สำเร็จ`
        )
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
      botLog(
        LOG_LEVELS.INFO,
        "sendAfternoonReminder",
        "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน"
      )
      return
    }

    botLog(
      LOG_LEVELS.INFO,
      "sendAfternoonReminder",
      "กำลังส่งข้อความแจ้งเตือนตอนบ่าย"
    )

    const afternoonMessage =
      getMorningMessage() + "\n\n" + getCheckInReminderMessage()

    // Send to group/channel and individual subscribers (with deduplication)
    const subscribers = await getSubscribedUsers()
    const subscriberIds = subscribers.map((user) => user.chatId)
    const adminIds = chatId ? [chatId] : []

    // ลดความซ้ำซ้อนของผู้รับ
    const deduplicationResult = deduplicateRecipients(
      subscriberIds,
      adminIds,
      "sendAfternoonReminder"
    )
    const uniqueRecipients = deduplicationResult.uniqueRecipients

    botLog(
      LOG_LEVELS.INFO,
      "sendAfternoonReminder",
      `กำลังส่งข้อความไปยัง ${uniqueRecipients.length} คน (จากต้นฉบับ ${deduplicationResult.originalCount} คน)`
    )

    // ส่งข้อความไปยังผู้รับที่ไม่ซ้ำ
    for (const recipientId of uniqueRecipients) {
      try {
        await bot.sendMessage(recipientId, afternoonMessage)
        botLog(
          LOG_LEVELS.DEBUG,
          "sendAfternoonReminder",
          `ส่งข้อความบ่ายให้ ${recipientId} สำเร็จ`
        )
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
      botLog(
        LOG_LEVELS.INFO,
        "sendEveningReminder",
        "วันนี้เป็นวันหยุด ข้ามการส่งข้อความเตือน"
      )
      return
    }

    botLog(
      LOG_LEVELS.INFO,
      "sendEveningReminder",
      "กำลังส่งข้อความแจ้งเตือนตอนเย็น"
    )

    const eveningMessage =
      getEveningMessage() + "\n\n" + getCheckOutReminderMessage()

    // Send to group/channel and individual subscribers (with deduplication)
    const subscribers = await getSubscribedUsers()
    const subscriberIds = subscribers.map((user) => user.chatId)
    const adminIds = chatId ? [chatId] : []

    // ลดความซ้ำซ้อนของผู้รับ
    const deduplicationResult = deduplicateRecipients(
      subscriberIds,
      adminIds,
      "sendEveningReminder"
    )
    const uniqueRecipients = deduplicationResult.uniqueRecipients

    botLog(
      LOG_LEVELS.INFO,
      "sendEveningReminder",
      `กำลังส่งข้อความไปยัง ${uniqueRecipients.length} คน (จากต้นฉบับ ${deduplicationResult.originalCount} คน)`
    )

    // ส่งข้อความไปยังผู้รับที่ไม่ซ้ำ
    for (const recipientId of uniqueRecipients) {
      try {
        await bot.sendMessage(recipientId, eveningMessage)
        botLog(
          LOG_LEVELS.DEBUG,
          "sendEveningReminder",
          `ส่งข้อความเย็นให้ ${recipientId} สำเร็จ`
        )
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
      const tasks = cron.getTasks?.()
      if (tasks && typeof tasks.forEach === "function") {
        tasks.forEach((job) => job.stop())
      }
    } catch (_) {}

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

    const morningMessageJob = cron.schedule("25 1 * * 1-5", async () => {
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

    // เวลาไทย 9:25 น. = UTC 02:25 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job ข้อความตอนเช้าครั้งที่ 3 9:25 น. (02:25 UTC) - เฉพาะวันทำงาน"
    )

    const thirdMorningMessage = cron.schedule("25 2 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "thirdMorningMessage",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "thirdMorningMessage",
          `กำลังส่งข้อความตอนเช้าครั้งที่ 3 (9:25 น.) ${new Date().toISOString()}`
        )

        const morningMessage3 =
          getMorningMessage() + "\n\n" + getCheckInReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, morningMessage3)
            botLog(
              LOG_LEVELS.INFO,
              "thirdMorningMessage",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("thirdMorningMessage-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "thirdMorningMessage",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, morningMessage3)
            botLog(
              LOG_LEVELS.DEBUG,
              "thirdMorningMessage",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("thirdMorningMessage-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "thirdMorningMessage",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "thirdMorningMessage",
          "ส่งข้อความตอนเช้า 9:25 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("thirdMorningMessage", err)
      }
    })

    // เวลาไทย 15:30 น. = UTC 08:30 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job แจ้งเตือนออกงาน 15:30 น. (08:30 UTC) - เฉพาะวันทำงาน"
    )

    const eveningReminder = cron.schedule("30 8 * * 1-5", async () => {
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
          `กำลังส่งข้อความแจ้งเตือนลงเวลาออกงาน (15:30 น.) ${new Date().toISOString()}`
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
          "ส่งข้อความแจ้งเตือน 15:30 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("eveningReminder", err)
      }
    })

    // เวลาไทย 16:30 น. = UTC 09:30 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job ข้อความตอนเย็น 16:30 น. (09:30 UTC) - เฉพาะวันทำงาน"
    )

    const eveningMessageJob = cron.schedule("30 9 * * 1-5", async () => {
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
          `กำลังส่งข้อความตอนเย็น (16:30 น.) ${new Date().toISOString()}`
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
          "ส่งข้อความตอนเย็น 16:30 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("eveningMessage", err)
      }
    })

    // เวลาไทย 17:30 น. = UTC 10:30 น. (จันทร์-ศุกร์)
    botLog(
      LOG_LEVELS.INFO,
      "setupCronJobs",
      "ตั้งค่า cron job ข้อความปิดงาน 17:30 น. (10:30 UTC) - เฉพาะวันทำงาน"
    )

    const lateEveningMessage = cron.schedule("30 10 * * 1-5", async () => {
      try {
        if (await isHoliday()) {
          botLog(
            LOG_LEVELS.INFO,
            "lateEveningMessage",
            "วันนี้เป็นวันหยุด ข้ามการส่งข้อความ"
          )
          return
        }

        botLog(
          LOG_LEVELS.INFO,
          "lateEveningMessage",
          `กำลังส่งข้อความแจ้งเตือนปิดงาน (17:30 น.) ${new Date().toISOString()}`
        )

        const lateEveningMsg =
          getEveningMessage() + "\n\n" + getCheckOutReminderMessage()

        // ส่งข้อความไปยังกลุ่ม/ช่อง
        if (chatId) {
          try {
            await bot.sendMessage(chatId, lateEveningMsg)
            botLog(
              LOG_LEVELS.INFO,
              "lateEveningMessage",
              "ส่งข้อความไปยังกลุ่ม/ช่องสำเร็จ"
            )
          } catch (err) {
            logError("lateEveningMessage-group", err)
          }
        }

        // ส่งข้อความไปยังผู้ใช้แต่ละคน
        const subscribers = await getSubscribedUsers()
        botLog(
          LOG_LEVELS.INFO,
          "lateEveningMessage",
          `กำลังส่งข้อความไปยังผู้ใช้ ${subscribers.length} คน`
        )

        for (const user of subscribers) {
          try {
            await bot.sendMessage(user.chatId, lateEveningMsg)
            botLog(
              LOG_LEVELS.DEBUG,
              "lateEveningMessage",
              `ส่งข้อความไปยังผู้ใช้ ${
                user.username || user.firstName || user.chatId
              } สำเร็จ`
            )
          } catch (err) {
            logError("lateEveningMessage-user", err)
            botLog(
              LOG_LEVELS.ERROR,
              "lateEveningMessage",
              `ไม่สามารถส่งข้อความไปยังผู้ใช้ ${user.chatId} ได้`
            )
          }
        }

        botLog(
          LOG_LEVELS.INFO,
          "lateEveningMessage",
          "ส่งข้อความปิดงาน 17:30 น. เสร็จสิ้น"
        )
      } catch (err) {
        logError("lateEveningMessage", err)
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
      morningMessage: morningMessageJob,
      eveningReminder,
      eveningMessage: eveningMessageJob,
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
    // ENHANCED handler registration protection
    if (eventHandlersInitialized) {
      const timeSinceRegistration = handlersRegistrationTimestamp
        ? Date.now() - handlersRegistrationTimestamp
        : 0
      botLog(
        LOG_LEVELS.INFO,
        "setupEventHandlers",
        `Event handlers ได้รับการตั้งค่าแล้ว (${Math.round(
          timeSinceRegistration / 1000
        )}s ago)`
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
        const userId = msg.from?.id
        const username = msg.from?.username || "unknown"
        const isAdminUser = await isAdmin(chatId)

        // ENHANCED: Detailed logging for debugging
        botLog(
          LOG_LEVELS.INFO,
          "command-debug",
          `📥 Received /start from user ${userId} (${username}) in chat ${chatId} [Admin: ${isAdminUser}]`
        )

        let welcomeMessage = `
สวัสดีครับ/ค่ะ! 👋
บอทนี้จะส่งข้อความแจ้งเตือนทุกวันในเวลา:

🌅 **ช่วงเช้า**
- ⏰ 7:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)
- 🌞 8:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)
- ☀️ 9:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)

🌆 **ช่วงบ่าย-เย็น**
- 🕒 15:30 น. (ข้อความบ่าย + แจ้งเตือนลงเวลาออกจากงาน)
- 🌇 16:30 น. (ข้อความเย็น + แจ้งเตือนลงเวลาออกจากงาน)
- 🌃 17:30 น. (ข้อความปิดงาน + แจ้งเตือนลงเวลาออกจากงาน)

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

        // ENHANCED: Success logging
        botLog(
          LOG_LEVELS.INFO,
          "command-debug",
          `✅ Successfully sent /start response to ${userId} (${welcomeMessage.length} chars)`
        )
      } catch (error) {
        // ENHANCED: Improved error handling
        const errorInfo = {
          userId: msg.from?.id,
          chatId: msg.chat.id,
          username: msg.from?.username,
          error: error.message,
        }

        logError("command-start-error", error, errorInfo)

        try {
          // Send Thai language error response
          await bot.sendMessage(
            msg.chat.id,
            "❌ เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง"
          )
          botLog(
            LOG_LEVELS.INFO,
            "command-debug",
            `📤 Sent error response to ${msg.chat.id}`
          )
        } catch (sendError) {
          logError("command-start-sendError", sendError, errorInfo)
        }
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

    // ตั้งค่าสถานะว่าได้เริ่มต้นแล้ว พร้อมเก็บ timestamp
    eventHandlersInitialized = true
    handlersRegistrationTimestamp = Date.now()

    botLog(
      LOG_LEVELS.DEBUG,
      "setupEventHandlers",
      `Handler registration completed at ${new Date(
        handlersRegistrationTimestamp
      ).toISOString()}`
    )

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

  const result = await bot.setWebHook(
    `${appUrl}/bot${token}`,
    WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : undefined
  )
  const maskedCommandUrl = `${appUrl}/bot${token.substring(0, 10)}***MASKED***`
  botLog(
    LOG_LEVELS.INFO,
    "command-reset_webhook",
    `ตั้งค่า webhook ใหม่: ${maskedCommandUrl} ผลลัพธ์: ${result}`
  )

  await bot.sendMessage(
    chatId,
    `✅ รีเซ็ต webhook สำเร็จ\nWebhook URL: ${maskedCommandUrl}`
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
  const chatId = msg.chat.id
  const hours = parseInt(match[1])
  const minutes = parseInt(match[2])

  // ตรวจสอบความถูกต้องของเวลาที่รับเข้ามา
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    await bot.sendMessage(
      chatId,
      "⚠️ รูปแบบเวลาไม่ถูกต้อง กรุณาใช้ HH.mm (00.00 - 23.59)"
    )
    return
  }

  // แปลงเวลาไทย (UTC+7) เป็น UTC สำหรับตั้ง cron job
  let utcHours = hours - 7
  if (utcHours < 0) utcHours += 24

  // สร้าง cron expression
  const cronExpression = `${minutes} ${utcHours} * * *`

  // แสดงข้อมูลการตั้ง cron
  const thaiTime = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")} น. (UTC+7)`
  const utcTime = `${utcHours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")} (UTC)`

  await bot.sendMessage(
    chatId,
    `🕒 กำลังตั้ง cron job ที่เวลา ${thaiTime}\n` +
      `⏱️ เทียบเท่ากับเวลา ${utcTime}\n` +
      `📋 Cron expression: ${cronExpression}\n\n` +
      `รอสักครู่... ระบบจะส่งข้อความแจ้งเตือนเมื่อถึงเวลา`
  )

  // คำนวณเวลาที่จะทำงาน
  let scheduledTime = new Date()
  scheduledTime.setHours(hours)
  scheduledTime.setMinutes(minutes)
  scheduledTime.setSeconds(0)

  // ถ้าเวลาที่กำหนดผ่านไปแล้วในวันนี้ ให้ใช้เวลาของวันพรุ่งนี้แทน
  const now = new Date()
  if (scheduledTime < now) {
    scheduledTime.setDate(scheduledTime.getDate() + 1)
  }

  const timeUntilExecution = scheduledTime.getTime() - now.getTime()
  const minutesUntil = Math.round(timeUntilExecution / 60000)

  await bot.sendMessage(
    chatId,
    `⏳ การแจ้งเตือนจะทำงานในอีกประมาณ ${minutesUntil} นาที ` +
      `(${scheduledTime.toLocaleTimeString("th-TH", {
        timeZone: "Asia/Bangkok",
      })})`
  )

  // สร้าง cron job แบบใช้ครั้งเดียว
  const testCronJob = cron.schedule(
    cronExpression,
    async () => {
      try {
        // ส่งข้อความแจ้งเตือน
        await bot.sendMessage(
          chatId,
          `🔔 แจ้งเตือน! ถึงเวลาที่คุณกำหนดไว้แล้ว: ${thaiTime}\n` +
            `สำเร็จ! นี่คือการทดสอบการทำงานของ cron job ด้วยคำสั่ง /cron_job ${hours}.${minutes
              .toString()
              .padStart(2, "0")}`
        )

        botLog(
          LOG_LEVELS.INFO,
          "testCronJob",
          `ส่งข้อความแจ้งเตือนการทดสอบ cron ไปยัง ${chatId} สำเร็จ (เวลา: ${thaiTime})`
        )

        // หยุด cron job หลังจากทำงานเสร็จ
        testCronJob.stop()
      } catch (error) {
        logError("testCronJob", error)
        try {
          await bot.sendMessage(
            chatId,
            "❌ เกิดข้อผิดพลาดในการส่งข้อความแจ้งเตือน กรุณาลองอีกครั้ง"
          )
        } catch (sendError) {
          logError("testCronJob-sendError", sendError)
        }
        testCronJob.stop()
      }
    },
    {
      scheduled: true,
      timezone: "UTC", // ต้องกำหนดเป็น UTC เพราะเราได้แปลงเวลาเป็น UTC แล้ว
    }
  )

  botLog(
    LOG_LEVELS.INFO,
    "command-cron_job",
    `แอดมิน ${chatId} ตั้ง cron job ทดสอบที่เวลา ${thaiTime} (${cronExpression})`
  )
}

// เพิ่มเส้นทางสำหรับทดสอบส่งข้อความ
app.get("/test-message/:chatId", async (req, res) => {
  try {
    if (!bot) return res.status(503).send("Bot not initialized")
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
async function startTest(msg) {
  try {
    const chatId = msg.chat.id

    // ตรวจสอบสิทธิ์แอดมิน
    if (!(await isAdmin(chatId))) {
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
async function stopTest(msg) {
  try {
    const chatId = msg.chat.id

    // ตรวจสอบสิทธิ์แอดมิน
    if (!(await isAdmin(chatId))) {
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
if (!hasStarted) startApplication()

// (moved verifyCronSecret to top of file; keep only one copy)
