/**
 * ตัวอย่างการเชื่อมต่อ TiDB Cloud Serverless สำหรับบอท Telegram
 * ไฟล์นี้แสดงวิธีการสร้างการเชื่อมต่อและฟังก์ชันพื้นฐานในการจัดการข้อมูลผู้ใช้
 * ปรับปรุงเพื่อแก้ไขปัญหา PID ใหม่โผล่ไม่รู้จบ
 */
const { LOG_LEVELS, botLog, logError } = require("./logger.js")
const mysql = require("mysql2/promise")
const dotenv = require("dotenv")
const fs = require("fs")
const path = require("path")

// tidb-connection.js - เพิ่มการนำเข้า dayjs
const dayjs = require("dayjs")
const utc = require("dayjs/plugin/utc")
const timezone = require("dayjs/plugin/timezone")

// ตั้งค่า Day.js
dayjs.extend(utc)
dayjs.extend(timezone)
const THAI_TIMEZONE = "Asia/Bangkok"

dotenv.config()

// เพิ่มตัวแปรสถานะเพื่อติดตามว่าฐานข้อมูลได้รับการเริ่มต้นแล้วหรือไม่
let databaseInitialized = false
let initializationInProgress = false
let connectionPool = null

/**
 * สร้างการเชื่อมต่อใหม่กับฐานข้อมูล
 * (ใช้ในกรณีที่ต้องการ connection แยก ไม่ได้มาจาก pool)
 */
async function getConnection() {
  try {
    // ตรวจสอบว่าได้เริ่มต้นฐานข้อมูลแล้วหรือไม่
    if (!databaseInitialized) {
      botLog(
        LOG_LEVELS.WARN,
        "getConnection",
        "ฐานข้อมูลยังไม่ได้รับการเริ่มต้น กำลังเริ่มต้น..."
      )
      await initializeDatabase()
    }

    const options = {
      host: process.env.TIDB_HOST || "127.0.0.1",
      port: parseInt(process.env.TIDB_PORT || "4000"),
      user: process.env.TIDB_USER || "root",
      password: process.env.TIDB_PASSWORD || "",
      database: process.env.TIDB_DATABASE || "telegram_bot",
      ssl: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
      supportBigNumbers: true,
      enableKeepAlive: true,
      dateStrings: true,
      connectionLimit: 10,
      timezone: "+07:00", // ตั้งค่า timezone เป็น GMT+7 (ประเทศไทย)
    }

    botLog(LOG_LEVELS.INFO, "database", "🔄 กำลังเชื่อมต่อกับ TiDB Cloud...")
    const conn = await mysql.createConnection(options)
    botLog(LOG_LEVELS.INFO, "database", "🔌 เชื่อมต่อกับ TiDB Cloud สำเร็จ!")

    // ตรวจสอบเวอร์ชันของ TiDB
    const [rows] = await conn.query("SELECT VERSION() AS version;")
    botLog(LOG_LEVELS.INFO, "database", `📊 เวอร์ชัน TiDB: ${rows[0].version}`)

    return conn
  } catch (error) {
    logError("database-connect", error)
    throw error
  }
}

/**
 * ดึง connection จาก pool เพื่อใช้งาน
 * ใช้ connection pool แทนการสร้าง connection ใหม่ทุกครั้ง
 * @returns {Promise<mysql.Connection>} database connection
 */
async function getPoolConnection() {
  if (!connectionPool) {
    throw new Error(
      "Connection pool ยังไม่ถูกสร้าง กรุณาเรียก initializeDatabase ก่อน"
    )
  }

  try {
    return await connectionPool.getConnection()
  } catch (error) {
    logError("getPoolConnection", error)
    throw error
  }
}

/**
 * เริ่มต้นฐานข้อมูลและตารางที่จำเป็น
 * ปรับปรุงเพื่อป้องกันการเรียกใช้ซ้ำที่เกิดจากการเริ่มต้นหลาย PID
 * @returns {Promise<boolean>} สถานะความสำเร็จของการเริ่มต้น
 */
async function initializeDatabase() {
  // ป้องกันการเรียกซ้ำหากฐานข้อมูลได้รับการเริ่มต้นแล้ว
  if (databaseInitialized) {
    botLog(
      LOG_LEVELS.INFO,
      "initializeDatabase",
      "ฐานข้อมูลได้รับการเริ่มต้นแล้ว"
    )
    return true
  }

  // ป้องกันการเรียกซ้ำหากกำลังอยู่ในขั้นตอนการเริ่มต้น
  if (initializationInProgress) {
    botLog(
      LOG_LEVELS.INFO,
      "initializeDatabase",
      "กำลังอยู่ในขั้นตอนการเริ่มต้นฐานข้อมูล กรุณารอสักครู่"
    )

    // รอให้การเริ่มต้นเสร็จสิ้น (ไม่เกิน 30 วินาที)
    let retryCount = 0
    const maxRetries = 30
    while (initializationInProgress && retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000)) // รอ 1 วินาที
      retryCount++
    }

    // ตรวจสอบสถานะหลังจากรอ
    if (databaseInitialized) {
      return true
    } else if (retryCount >= maxRetries) {
      throw new Error("รอการเริ่มต้นฐานข้อมูลนานเกินไป ยกเลิกการทำงาน")
    }
  }

  // ตั้งค่าสถานะว่ากำลังเริ่มต้น
  initializationInProgress = true

  let conn
  let retries = 3 // จำนวนครั้งที่จะลองเชื่อมต่อใหม่

  try {
    botLog(
      LOG_LEVELS.INFO,
      "initializeDatabase",
      "กำลังเริ่มต้นการเชื่อมต่อฐานข้อมูล (PID: " + process.pid + ")"
    )

    while (retries > 0) {
      try {
        const rootOptions = {
          host: process.env.TIDB_HOST || "127.0.0.1",
          port: parseInt(process.env.TIDB_PORT || "4000"),
          user: process.env.TIDB_USER || "root",
          password: process.env.TIDB_PASSWORD || "",
          ssl: {
            minVersion: "TLSv1.2",
            rejectUnauthorized: true,
          },
          supportBigNumbers: true,
          enableKeepAlive: true,
          dateStrings: true,
          connectionLimit: 10,
          timezone: "+07:00", // ตั้งค่า timezone เป็น GMT+7 (ประเทศไทย)
        }

        conn = await mysql.createConnection(rootOptions)

        botLog(
          LOG_LEVELS.INFO,
          "initializeDatabase",
          "เชื่อมต่อสำเร็จ กำลังสร้างฐานข้อมูล"
        )
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`telegram_bot\`;`)
        await conn.query(`USE \`telegram_bot\`;`)

        // สร้างตาราง users
        await conn.query(`
          CREATE TABLE IF NOT EXISTS users (
            chat_id VARCHAR(50) PRIMARY KEY,
            username VARCHAR(100),
            first_name VARCHAR(100),
            last_name VARCHAR(100),
            date_added DATETIME DEFAULT CURRENT_TIMESTAMP,
            is_subscribed BOOLEAN DEFAULT TRUE
          );
        `)

        // สร้างตาราง holidays
        await conn.query(`
          CREATE TABLE IF NOT EXISTS holidays (
            holiday_date DATE PRIMARY KEY,
            holiday_name VARCHAR(255) NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          );
        `)

        // เตรียม connection pool สำหรับการใช้งานต่อไป
        if (!connectionPool) {
          const poolOptions = {
            ...rootOptions,
            database: "telegram_bot",
            connectionLimit: 20,
            waitForConnections: true,
            queueLimit: 0,
          }

          connectionPool = mysql.createPool(poolOptions)
          botLog(
            LOG_LEVELS.INFO,
            "initializeDatabase",
            "สร้าง connection pool สำเร็จ"
          )
        }

        // ตั้งค่าสถานะว่าได้เริ่มต้นเรียบร้อยแล้ว
        databaseInitialized = true
        initializationInProgress = false

        botLog(
          LOG_LEVELS.INFO,
          "initializeDatabase",
          "ตรวจสอบและสร้างฐานข้อมูลและตารางเรียบร้อย"
        )
        return true
      } catch (error) {
        retries--
        botLog(
          LOG_LEVELS.ERROR,
          "initializeDatabase",
          `พยายามเชื่อมต่อไม่สำเร็จ (เหลือ ${retries} ครั้ง)`,
          error
        )

        if (retries === 0) {
          botLog(
            LOG_LEVELS.ERROR,
            "initializeDatabase",
            "ไม่สามารถเชื่อมต่อฐานข้อมูลได้หลังจากพยายามหลายครั้ง",
            error
          )
          initializationInProgress = false
          throw error
        }

        // รอก่อนลองใหม่
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
    }
    return false
  } catch (error) {
    initializationInProgress = false
    logError("initializeDatabase", error)
    throw error
  } finally {
    if (conn) {
      try {
        await conn.end()
      } catch (endError) {
        logError("initializeDatabase-connection-end", endError)
      }
    }
  }
}

// ดึงข้อมูลผู้ใช้ที่สมัครรับการแจ้งเตือน
async function getSubscribedUsers() {
  let conn
  try {
    conn = await getConnection()
    const [rows] = await conn.query(`
      SELECT 
        chat_id as chatId, 
        username, 
        first_name as firstName, 
        last_name as lastName, 
        date_added as dateAdded 
      FROM users 
      WHERE is_subscribed = TRUE
    `)

    botLog(
      LOG_LEVELS.INFO,
      "getSubscribedUsers",
      `📋 ดึงข้อมูลผู้ใช้ที่สมัครรับการแจ้งเตือนจำนวน ${rows.length} คน`
    )
    return rows
  } catch (error) {
    logError("getSubscribedUsers", error)
    return []
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

// เพิ่มหรืออัปเดตข้อมูลผู้ใช้
async function updateUserSubscription(user, isSubscribed) {
  let conn
  try {
    conn = await getConnection()

    // เพิ่มการตรวจสอบพารามิเตอร์ที่ดีขึ้น
    if (!user) {
      botLog(LOG_LEVELS.ERROR, "updateUserSubscription", "ไม่พบข้อมูลผู้ใช้")
      return false
    }

    if (user.chatId === undefined || user.chatId === null) {
      botLog(
        LOG_LEVELS.ERROR,
        "updateUserSubscription",
        "ไม่พบข้อมูล chatId ที่จำเป็น"
      )
      return false
    }

    // เพิ่มการล็อกข้อมูลที่ได้รับ
    botLog(
      LOG_LEVELS.DEBUG,
      "updateUserSubscription",
      "updateUserSubscription called with:",
      {
        user: {
          chatId: user.chatId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
        },
        isSubscribed: isSubscribed,
      }
    )

    // แปลง chatId เป็น String อย่างชัดเจน
    const chatIdStr = String(user.chatId)

    // แปลง isSubscribed เป็น 0 หรือ 1 เพื่อความชัดเจน
    const boolSubscribed = isSubscribed ? 1 : 0

    // ตรวจสอบว่ามีผู้ใช้นี้อยู่แล้วหรือไม่
    const [existingUsers] = await conn.query(
      "SELECT * FROM users WHERE chat_id = ?",
      [chatIdStr]
    )

    if (existingUsers.length > 0) {
      // อัปเดตข้อมูลผู้ใช้ที่มีอยู่
      const [result] = await conn.query(
        "UPDATE users SET username = ?, first_name = ?, last_name = ?, is_subscribed = ? WHERE chat_id = ?",
        [
          user.username || "",
          user.firstName || "",
          user.lastName || "",
          boolSubscribed,
          chatIdStr,
        ]
      )
      botLog(
        LOG_LEVELS.INFO,
        "updateUserSubscription",
        `✏️ อัปเดตข้อมูลผู้ใช้ ${chatIdStr} สำเร็จ (แถวที่ได้รับผลกระทบ: ${result.affectedRows})`
      )
    } else {
      // เพิ่มผู้ใช้ใหม่
      const thaiTime = dayjs().tz(THAI_TIMEZONE).format("YYYY-MM-DD HH:mm:ss")

      const [result] = await conn.query(
        "INSERT INTO users (chat_id, username, first_name, last_name, date_added, is_subscribed) VALUES (?, ?, ?, ?, ?, ?)",
        [
          chatIdStr,
          user.username || "",
          user.firstName || "",
          user.lastName || "",
          thaiTime, // เพิ่มเวลาไทยโดยตรง
          boolSubscribed,
        ]
      )
      botLog(
        LOG_LEVELS.INFO,
        "updateUserSubscription",
        `➕ เพิ่มผู้ใช้ใหม่ ${chatIdStr} สำเร็จ`
      )
    }

    return true
  } catch (error) {
    logError("updateUserSubscription", error)
    return false
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

// ดึงข้อมูลผู้ใช้ตาม chat ID
async function getUserByChatId(chatId) {
  let conn
  try {
    conn = await getConnection()

    // แปลง chatId เป็น String อย่างชัดเจน
    const chatIdStr = String(chatId)
    botLog(
      LOG_LEVELS.DEBUG,
      "getUserByChatId",
      `🔍 กำลังค้นหาผู้ใช้ chat_id: ${chatIdStr}`
    )

    const [rows] = await conn.query("SELECT * FROM users WHERE chat_id = ?", [
      chatIdStr,
    ])

    if (rows.length > 0) {
      botLog(
        LOG_LEVELS.DEBUG,
        "getUserByChatId",
        `🔍 พบข้อมูลผู้ใช้ ${chatIdStr}`
      )
      return rows[0]
    } else {
      botLog(
        LOG_LEVELS.DEBUG,
        "getUserByChatId",
        `🔍 ไม่พบข้อมูลผู้ใช้ ${chatIdStr}`
      )
      return null
    }
  } catch (error) {
    logError("getUserByChatId", error)
    return null
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

// ตรวจสอบว่าผู้ใช้สมัครรับการแจ้งเตือนหรือไม่
async function isUserSubscribed(chatId) {
  let conn
  try {
    conn = await getConnection()

    // แปลง chatId เป็น String อย่างชัดเจน
    const chatIdStr = String(chatId)

    const [rows] = await conn.query(
      "SELECT is_subscribed FROM users WHERE chat_id = ?",
      [chatIdStr]
    )

    if (rows.length > 0) {
      return !!rows[0].is_subscribed // แปลงเป็น boolean
    } else {
      return false // ถ้าไม่พบผู้ใช้ ถือว่าไม่ได้สมัคร
    }
  } catch (error) {
    logError("isUserSubscribed", error)
    return false
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

// เพิ่มฟังก์ชันนำเข้าข้อมูลจาก JSON
async function importHolidaysFromJson() {
  let conn
  try {
    const HOLIDAYS_FILE = path.join(__dirname, "holidays.json")
    if (fs.existsSync(HOLIDAYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(HOLIDAYS_FILE, "utf8"))

      // ตรวจสอบว่ามีข้อมูลในตารางหรือไม่
      conn = await getConnection()
      const [count] = await conn.query("SELECT COUNT(*) as count FROM holidays")
      if (count[0].count > 0) {
        botLog(
          LOG_LEVELS.INFO,
          "importHolidays",
          "มีข้อมูลวันหยุดในฐานข้อมูลแล้ว ข้ามการนำเข้า"
        )
        return false
      }

      // นำเข้าข้อมูล
      let importCount = 0
      for (const date of data.holidays) {
        const holidayName = data.holidayDetails[date] || "วันหยุดพิเศษ"
        await conn.query(
          "INSERT INTO holidays (holiday_date, holiday_name) VALUES (?, ?)",
          [date, holidayName]
        )
        importCount++
      }

      botLog(
        LOG_LEVELS.INFO,
        "importHolidays",
        `นำเข้าวันหยุดจำนวน ${importCount} วันเรียบร้อยแล้ว`
      )
      return true
    } else {
      botLog(LOG_LEVELS.ERROR, "importHolidays", "ไม่พบไฟล์ holidays.json")
      return false
    }
  } catch (error) {
    logError("importHolidays", error)
    return false
  } finally {
    if (conn) {
      await conn.end()
    }
  }
}

// เพิ่มฟังก์ชัน
async function getAllHolidays() {
  let conn
  try {
    conn = await getConnection()
    const [rows] = await conn.query(
      "SELECT * FROM holidays ORDER BY holiday_date"
    )
    botLog(
      LOG_LEVELS.INFO,
      "getAllHolidays",
      `ดึงข้อมูลวันหยุดทั้งหมด ${rows.length} รายการ`
    )
    return rows
  } catch (error) {
    logError("getAllHolidays", error)
    return []
  } finally {
    if (conn) await conn.end()
  }
}

async function addHoliday(date, name) {
  let conn
  try {
    conn = await getConnection()
    await conn.query(
      "INSERT INTO holidays (holiday_date, holiday_name) VALUES (?, ?) ON DUPLICATE KEY UPDATE holiday_name = ?",
      [date, name, name]
    )
    botLog(
      LOG_LEVELS.INFO,
      "addHoliday",
      `เพิ่มวันหยุด ${date} (${name}) สำเร็จ`
    )
    return true
  } catch (error) {
    logError("addHoliday", error)
    return false
  } finally {
    if (conn) await conn.end()
  }
}

async function deleteHoliday(date) {
  let conn
  try {
    conn = await getConnection()
    const [result] = await conn.query(
      "DELETE FROM holidays WHERE holiday_date = ?",
      [date]
    )
    const success = result.affectedRows > 0
    if (success) {
      botLog(LOG_LEVELS.INFO, "deleteHoliday", `ลบวันหยุด ${date} สำเร็จ`)
    } else {
      botLog(
        LOG_LEVELS.WARN,
        "deleteHoliday",
        `ไม่พบวันหยุด ${date} ในฐานข้อมูล`
      )
    }
    return success
  } catch (error) {
    logError("deleteHoliday", error)
    return false
  } finally {
    if (conn) await conn.end()
  }
}

// เพิ่มฟังก์ชันค้นหาวันหยุดใน tidb-connection.js
async function searchHolidays(keyword) {
  let conn
  try {
    conn = await getConnection()
    const [rows] = await conn.query(
      "SELECT * FROM holidays WHERE holiday_name LIKE ? ORDER BY holiday_date",
      [`%${keyword}%`]
    )
    botLog(
      LOG_LEVELS.INFO,
      "searchHolidays",
      `ค้นหาวันหยุดด้วยคำว่า "${keyword}" พบ ${rows.length} รายการ`
    )
    return rows
  } catch (error) {
    logError("searchHolidays", error)
    return []
  } finally {
    if (conn) await conn.end()
  }
}

// ส่งออกฟังก์ชันเพื่อใช้ในไฟล์อื่น
module.exports = {
  getConnection,
  getPoolConnection,
  initializeDatabase,
  getSubscribedUsers,
  updateUserSubscription,
  getUserByChatId,
  isUserSubscribed,
  importHolidaysFromJson,
  getAllHolidays,
  addHoliday,
  deleteHoliday,
  searchHolidays,
}
