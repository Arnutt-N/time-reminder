// index.js - แก้ไขปัญหาเขตเวลา
const TelegramBot = require("node-telegram-bot-api")
const cron = require("node-cron")
const http = require("http")
require("dotenv").config()

// นำ token ของ bot มาจาก environment variable
const token = process.env.TELEGRAM_BOT_TOKEN
// Chat ID ที่คุณต้องการส่งข้อความไป
const chatId = process.env.TELEGRAM_CHAT_ID

// สร้าง flag เพื่อตรวจสอบว่าเริ่มทำงานแล้วหรือยัง
let botInitialized = false

// ตรวจสอบว่ามีการรันโค้ดแล้วหรือยัง ป้องกันการรันซ้ำซ้อน
if (botInitialized) {
  console.log("Bot already initialized. Exiting duplicate instance.")
  process.exit(0)
}

// URL ของแอปบน Render (ต้องแทนที่ด้วย URL ของคุณหลังจาก deploy)
const appUrl = process.env.APP_URL || "https://your-app-name.onrender.com"

// ฟังก์ชัน Keep-Alive สำหรับป้องกันการ "หลับ" บน Render
function keepAlive() {
  console.log("Pinging self to stay awake - " + new Date().toISOString())

  http
    .get(appUrl, (res) => {
      console.log(`Ping status: ${res.statusCode}`)
    })
    .on("error", (err) => {
      console.error(`Ping failed: ${err.message}`)
    })
}

// สร้าง instance ของ bot - ตั้งค่า polling: true เพียงครั้งเดียว
const bot = new TelegramBot(token, { polling: true })
botInitialized = true

// แสดงข้อมูลเวลาปัจจุบันของระบบ
const currentServerTime = new Date()
console.log(`Bot is running... Server time: ${currentServerTime.toISOString()}`)
console.log(`Server timezone offset: ${currentServerTime.getTimezoneOffset() / -60} hours`)

// ฟังก์ชันสำหรับรูปแบบวันที่ เป็น พ.ศ.
function getThaiDate() {
  const date = new Date()
  const day = date.getDate()
  const month = date.getMonth() + 1
  const yearBE = date.getFullYear() + 543 // แปลงเป็นปี พ.ศ. โดยบวก 543
  return `${day}/${month}/${yearBE}`
}

// ข้อความแจ้งเตือน
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
  return `🌆 สวัสดีตอนเย็น! วันที่ ${getThaiDate()} \nขอบคุณสำหรับความทุ่มเทในวันนี้ 🙏`
}

// ล้างทุก cron job ก่อนที่จะสร้างใหม่ (ป้องกันการซ้ำซ้อน)
try {
  for (const job of Object.values(cron.getTasks())) {
    job.stop()
  }
} catch (error) {
  console.log("No existing cron tasks to clear")
}

// ===== แก้ไขเวลา cron jobs ให้ตรงกับเวลาประเทศไทย โดยปรับให้เป็นเวลา UTC =====
// เวลาไทย 7:25 น. = UTC 00:25 น.
console.log("Setting up check-in reminder cron job for 7:25 AM Thailand time (00:25 UTC)")
const morningReminder = cron.schedule("25 0 * * *", () => {
  console.log("Sending check-in reminder (7:25 Thai time)... " + new Date().toISOString())
  const morningCheckinMessage = getMorningMessage() + "\n\n" + getCheckInReminderMessage()
  bot
    .sendMessage(chatId, morningCheckinMessage)
    .then(() => console.log("7:25 message sent successfully"))
    .catch((err) => console.error("Error sending message:", err))
})

// เวลาไทย 8:25 น. = UTC 01:25 น.
console.log("Setting up morning message cron job for 8:25 AM Thailand time (01:25 UTC)")
const morningMessage = cron.schedule("25 1 * * *", () => {
  console.log("Sending morning message (8:25 Thai time)... " + new Date().toISOString())
  const morningFullMessage = getMorningMessage() + "\n\n" + getCheckInReminderMessage()
  bot
    .sendMessage(chatId, morningFullMessage)
    .then(() => console.log("8:25 message sent successfully"))
    .catch((err) => console.error("Error sending message:", err))
})

// เวลาไทย 15:25 น. = UTC 08:25 น.
console.log("Setting up check-out reminder cron job for 15:25 PM Thailand time (08:25 UTC)")
const eveningReminder = cron.schedule("25 8 * * *", () => {
  console.log("Sending check-out reminder (15:25 Thai time)... " + new Date().toISOString())
  const eveningCheckoutMessage = getEveningMessage() + "\n\n" + getCheckOutReminderMessage()
  bot
    .sendMessage(chatId, eveningCheckoutMessage)
    .then(() => console.log("15:25 message sent successfully"))
    .catch((err) => console.error("Error sending message:", err))
})

// เวลาไทย 16:25 น. = UTC 09:25 น.
console.log("Setting up evening message cron job for 16:25 PM Thailand time (09:25 UTC)")
const eveningMessage = cron.schedule("25 9 * * *", () => {
  console.log("Sending evening message (16:25 Thai time)... " + new Date().toISOString())
  const eveningFullMessage = getEveningMessage() + "\n\n" + getCheckOutReminderMessage()
  bot
    .sendMessage(chatId, eveningFullMessage)
    .then(() => console.log("16:25 message sent successfully"))
    .catch((err) => console.error("Error sending message:", err))
})

// สร้าง cron job ทดสอบทุก 5 นาที (สำหรับทดสอบเท่านั้น - ปิดการทำงานหลังจากทดสอบเสร็จ)
// console.log("Setting up test cron job for every 5 minutes")
// const testCron = cron.schedule("*/5 * * * *", () => {
//   const now = new Date()
//   console.log(`Test cron job running at server time: ${now.toISOString()}`)
//   bot
//     .sendMessage(chatId, `🔔 ทดสอบการแจ้งเตือน - เวลาเซิร์ฟเวอร์: ${now.toISOString()} - แปลงเป็นเวลาไทย: ${new Date(now.getTime() + (7*60*60*1000)).toISOString()}`)
//     .then(() => console.log("Test message sent successfully"))
//     .catch((err) => console.error("Error sending test message:", err))
// })

// เก็บ references ของทุก event handlers เพื่อป้องกันการซ้ำซ้อน
const handlers = {}

// ล้าง event listeners เดิมทั้งหมดก่อนเพิ่มใหม่
bot.removeAllListeners()

// รับคำสั่งพื้นฐาน
handlers.start = bot.onText(/^\/start$/, (msg) => {
  const welcomeMessage = `
สวัสดีครับ/ค่ะ! 👋
บอทนี้จะส่งข้อความแจ้งเตือนทุกวันในเวลา:
- ⏰ 7:25 น. (แจ้งเตือนลงเวลาเข้างาน + ข้อความตอนเช้า)
- 🌞 8:25 น. (ข้อความตอนเช้า + แจ้งเตือนลงเวลาเข้างาน)
- ⏰ 15:25 น. (แจ้งเตือนลงเวลาออกจากงาน + ข้อความตอนเย็น)
- 🌆 16:25 น. (ข้อความตอนเย็น + แจ้งเตือนลงเวลาออกจากงาน)

คำสั่งพื้นฐาน:
/status - ตรวจสอบสถานะของบอท
/servertime - ตรวจสอบเวลาของเซิร์ฟเวอร์
/checkin - ดูข้อความแจ้งเตือนลงเวลาเข้างาน
/checkout - ดูข้อความแจ้งเตือนลงเวลาออกจากงาน
/morning - ดูข้อความตอนเช้า
/evening - ดูข้อความตอนเย็น
/morning_full - ดูข้อความเต็มของเวลา 7:25 และ 8:25 (เช้า+เข้างาน)
/evening_full - ดูข้อความเต็มของเวลา 15:25 และ 16:25 (เย็น+ออกงาน)
  `

  bot
    .sendMessage(msg.chat.id, welcomeMessage)
    .then(() => console.log("Welcome message sent"))
    .catch((err) => console.error("Error sending welcome message:", err))
})

// ตรวจสอบเวลาของเซิร์ฟเวอร์
handlers.servertime = bot.onText(/^\/servertime$/, (msg) => {
  const now = new Date()
  const thaiTime = new Date(now.getTime() + (7*60*60*1000))
  
  const serverTimeMessage = `
⏰ เวลาของเซิร์ฟเวอร์:
- เวลา UTC: ${now.toISOString()}
- เวลาของไทย: ${thaiTime.toISOString()}
- Timezone offset: ${now.getTimezoneOffset() / -60} hours
  `
  
  bot
    .sendMessage(msg.chat.id, serverTimeMessage)
    .then(() => console.log("Server time message sent"))
    .catch((err) => console.error("Error sending server time message:", err))
})

// ตรวจสอบสถานะบอท
handlers.status = bot.onText(/^\/status$/, (msg) => {
  bot
    .sendMessage(
      msg.chat.id,
      "✅ บอทกำลังทำงานปกติ และพร้อมส่งข้อความแจ้งเตือนตามเวลาที่กำหนด!"
    )
    .then(() => console.log("Status message sent"))
    .catch((err) => console.error("Error sending status message:", err))
})

// ทดสอบข้อความแจ้งเตือนลงเวลาเข้างาน
handlers.checkin = bot.onText(/^\/checkin$/, (msg) => {
  bot
    .sendMessage(msg.chat.id, getCheckInReminderMessage())
    .then(() => console.log("Check-in reminder sent"))
    .catch((err) => console.error("Error sending check-in reminder:", err))
})

// ทดสอบข้อความแจ้งเตือนลงเวลาออกจากงาน
handlers.checkout = bot.onText(/^\/checkout$/, (msg) => {
  bot
    .sendMessage(msg.chat.id, getCheckOutReminderMessage())
    .then(() => console.log("Check-out reminder sent"))
    .catch((err) => console.error("Error sending check-out reminder:", err))
})

// ทดสอบข้อความตอนเช้า
handlers.morning = bot.onText(/^\/morning$/, (msg) => {
  bot
    .sendMessage(msg.chat.id, getMorningMessage())
    .then(() => console.log("Morning message sent"))
    .catch((err) => console.error("Error sending morning message:", err))
})

// ทดสอบข้อความตอนเย็น
handlers.evening = bot.onText(/^\/evening$/, (msg) => {
  bot
    .sendMessage(msg.chat.id, getEveningMessage())
    .then(() => console.log("Evening message sent"))
    .catch((err) => console.error("Error sending evening message:", err))
})

// ทดสอบข้อความแจ้งเตือนตอนเช้าแบบเต็ม
handlers.morningFull = bot.onText(/^\/morning_full$/, (msg) => {
  const morningFullMessage = getMorningMessage() + "\n\n" + getCheckInReminderMessage()
  console.log("Sending test morning_full message")
  bot
    .sendMessage(msg.chat.id, morningFullMessage)
    .then(() => console.log("Morning full message sent successfully"))
    .catch((err) => console.error("Error sending morning full message:", err))
})

// ทดสอบข้อความแจ้งเตือนตอนเย็นแบบเต็ม
handlers.eveningFull = bot.onText(/^\/evening_full$/, (msg) => {
  const eveningFullMessage = getEveningMessage() + "\n\n" + getCheckOutReminderMessage()
  console.log("Sending test evening_full message")
  bot
    .sendMessage(msg.chat.id, eveningFullMessage)
    .then(() => console.log("Evening full message sent successfully"))
    .catch((err) => console.error("Error sending evening full message:", err))
})

// จัดการข้อความที่ไม่รู้จัก - ข้ามคำสั่งที่ขึ้นต้นด้วย /
bot.on("message", (msg) => {
  const chatId = msg.chat.id
  const messageText = msg.text || ""
  if (messageText && !messageText.startsWith("/")) {
    bot
      .sendMessage(
        chatId,
        `ขอบคุณสำหรับข้อความของคุณ! หากต้องการดูคำสั่งที่มี พิมพ์ /start`
      )
      .then(() => console.log("Default response sent"))
      .catch((err) => console.error("Error sending default response:", err))
  }
})

// จัดการกับข้อผิดพลาด
bot.on("polling_error", (error) => {
  console.error("Polling error:", error)
})

// ปรับปรุง HTTP server สำหรับ Render และใช้ Keep-Alive
const server = http.createServer((req, res) => {
  // บันทึกรายละเอียดคำขอทั้งหมด
  console.log(`Received HTTP request: ${req.method} ${req.url} from ${req.headers['user-agent'] || 'Unknown'}`);
  
  // ทดสอบบอทเมื่อมีการเรียกใช้ HTTP server
  try {
    bot.getMe().then(botInfo => {
      console.log(`Bot is working: ${botInfo.username}`);
    }).catch(error => {
      console.error('Bot test failed:', error);
      // พยายามรีสตาร์ทบอท
      try {
        console.log('Attempting to restart bot polling...');
        bot.stopPolling();
        setTimeout(() => {
          bot.startPolling();
          console.log('Bot polling restarted successfully');
        }, 2000);
      } catch (e) {
        console.error('Failed to restart bot polling:', e);
      }
    });
  } catch (e) {
    console.error('Error in bot test:', e);
  }
  
  res.writeHead(200, { "Content-Type": "text/plain" });
  const now = new Date();
  const thaiTime = new Date(now.getTime() + (7*60*60*1000));
  res.end(`Bot is active! Server time: ${now.toISOString()}\nThai time: ${thaiTime.toISOString()}\n`);
});

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

// ฟังก์ชัน Keep-Alive สำหรับป้องกันการ "หลับ" บน Render
function keepAlive() {
  const now = new Date();
  console.log("Pinging self to stay awake - " + now.toISOString());

  // ทดสอบบอท
  try {
    bot.getMe().then(botInfo => {
      console.log(`Bot check OK: ${botInfo.username} at ${now.toISOString()}`);
    }).catch(error => {
      console.error('Bot check failed:', error);
      try {
        bot.stopPolling();
        setTimeout(() => {
          bot.startPolling();
          console.log('Bot polling restarted after failure');
        }, 2000);
      } catch (e) {
        console.error('Failed to restart bot:', e);
      }
    });
  } catch (e) {
    console.error('Error in bot check:', e);
  }

  // Ping ตัวเอง
  try {
    http
      .get(appUrl, (res) => {
        console.log(`Ping status: ${res.statusCode}`);
      })
      .on("error", (err) => {
        console.error(`Ping failed: ${err.message}`);
      });
  } catch (err) {
    console.error('Error in keepAlive function:', err);
  }
}

// ลดเวลา ping เหลือ 3 นาที
const pingInterval = setInterval(keepAlive, 3 * 60 * 1000);

// เพิ่มการจัดการข้อผิดพลาด
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // ไม่ควรจบการทำงานของบอท
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // ไม่ควรจบการทำงานของบอท
});

// จัดการการปิดโปรแกรมอย่างถูกต้อง
process.on("SIGINT", () => {
  console.log("Shutting down bot gracefully...")

  // หยุดทุก cron jobs
  morningReminder.stop()
  morningMessage.stop()
  eveningReminder.stop()
  eveningMessage.stop()

  // หยุด ping interval
  clearInterval(pingInterval)

  // หยุด bot polling
  bot.stopPolling()

  // ปิด server
  server.close()

  console.log("Shutdown complete")
  process.exit(0)
})

// แจ้งเตือนเมื่อบอทเริ่มทำงานสมบูรณ์
console.log("Bot setup complete, waiting for messages...")

// คำสั่งทดสอบการส่งข้อความแจ้งเตือนทันที
// bot.onText(/^\/test_now$/, (msg) => {
//   const chatId = msg.chat.id;
//   bot.sendMessage(chatId, "🔔 ทดสอบการแจ้งเตือนทันที - สำเร็จ!");
// });

// ทดสอบส่งข้อความทุก 2 นาที
console.log("Setting up test cron job to run every 2 minutes");
const testCron = cron.schedule("*/2 * * * *", () => {
  const now = new Date();
  const thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  console.log(`Test cron executed at ${now.toISOString()}`);
  
  bot.sendMessage(chatId, "🔔 ทดสอบการแจ้งเตือนทุก 2 นาที - สำเร็จ!" + 
    "\n\nเวลาเซิร์ฟเวอร์: " + now.toISOString() + 
    "\nเวลาของไทย: " + thaiTime.toISOString());
});
