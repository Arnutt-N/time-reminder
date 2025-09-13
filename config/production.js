/**
 * production.js - การกำหนดค่าเฉพาะสำหรับสภาพแวดล้อม Production
 * ไม่ต้องพึ่งพาไฟล์ .env และใช้ Secret Manager แทน
 */

/**
 * ตรวจสอบตัวแปรสภาพแวดล้อมที่จำเป็นสำหรับ Production
 * @param {string} name - ชื่อตัวแปรสภาพแวดล้อม
 * @param {boolean} required - จำเป็นหรือไม่ (default: true)
 * @returns {string|null} ค่าของตัวแปร หรือ null ถ้าไม่พบ
 */
function getEnvVar(name, required = true) {
  const value = process.env[name]
  
  if (!value && required) {
    console.warn(`⚠️ Missing required environment variable: ${name}`)
    return null
  }
  
  return value || null
}

/**
 * ตรวจสอบความปลอดภัยของ secret
 * @param {string} value - ค่า secret ที่ต้องตรวจ
 * @param {number} minLength - ความยาวขั้นต่ำ
 * @returns {boolean} ผ่านการตรวจสอบหรือไม่
 */
function validateSecret(value, minLength) {
  if (!value) return false
  return value.length >= minLength
}

// การกำหนดค่าสำหรับ Production
const productionConfig = {
  // ข้อมูลพื้นฐาน
  env: 'production',
  isProduction: true,
  isDevelopment: false,
  isTest: false,
  
  // Port และ URL สำหรับ Cloud Run
  port: parseInt(process.env.PORT) || 8080,
  appUrl: getEnvVar('APP_URL'),
  
  // Telegram Bot Configuration
  telegramBotToken: getEnvVar('TELEGRAM_BOT_TOKEN'),
  telegramChatId: getEnvVar('TELEGRAM_CHAT_ID'),
  adminChatId: getEnvVar('ADMIN_CHAT_ID'),
  telegramWebhookSecret: getEnvVar('TELEGRAM_WEBHOOK_SECRET', false), // Optional
  
  // Security
  cronSecret: getEnvVar('CRON_SECRET'),
  
  // เขตเวลาไทย
  timezone: 'Asia/Bangkok',
  
  // Cloud Run Metadata
  cloudRun: {
    isCloudRun: !!process.env.K_SERVICE,
    service: process.env.K_SERVICE || null,
    revision: process.env.K_REVISION || null,
    region: process.env.GOOGLE_CLOUD_REGION || 'us-central1'
  },
  
  // Database Configuration (TiDB Cloud Serverless)
  database: {
    host: getEnvVar('TIDB_HOST'),
    port: parseInt(process.env.TIDB_PORT) || 4000,
    user: getEnvVar('TIDB_USER'),
    password: getEnvVar('TIDB_PASSWORD'),
    database: process.env.TIDB_DATABASE || 'telegram_bot',
    ssl: (process.env.TIDB_ENABLE_SSL || 'true') === 'true', // Default true in production
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
    timezone: '+07:00', // Thai timezone
    supportBigNumbers: true,
    enableKeepAlive: true,
    dateStrings: true,
  },
  
  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'INFO',
    toFile: (process.env.LOG_TO_FILE || 'false') === 'true',
    stackTrace: (process.env.LOG_STACK_TRACE || 'false') === 'true',
    retentionDays: parseInt(process.env.LOG_RETENTION_DAYS) || 7,
  },
  
  // Production-specific settings
  production: {
    // ปิดการจำลอง /start ตอนบูต
    simulateStartOnBoot: (process.env.SIMULATE_START_ON_BOOT || 'false') === 'true',
    
    // โหมด Scheduler (external = GitHub Actions, internal = node-cron)
    cronMode: process.env.CRON_MODE || 'external',
    
    // การตั้งค่าความปลอดภัย
    security: {
      requireHttps: true,
      validateWebhookSecret: true,
      maskSecretsInLogs: true,
    }
  }
}

// ตรวจสอบความถูกต้องของการกำหนดค่า
function validateProductionConfig() {
  console.log('🔍 Validating production configuration...')
  
  const errors = []
  const warnings = []
  
  // ตรวจสอบ Telegram Bot Token
  if (!productionConfig.telegramBotToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required')
  } else if (!validateSecret(productionConfig.telegramBotToken, 40)) {
    warnings.push('TELEGRAM_BOT_TOKEN appears to be too short')
  }
  
  // ตรวจสอบ Cron Secret
  if (!productionConfig.cronSecret) {
    errors.push('CRON_SECRET is required')
  } else if (!validateSecret(productionConfig.cronSecret, 16)) {
    warnings.push('CRON_SECRET should be at least 16 characters')
  }
  
  // ตรวจสอบ APP_URL
  if (!productionConfig.appUrl) {
    errors.push('APP_URL is required')
  } else if (!productionConfig.appUrl.startsWith('https://')) {
    warnings.push('APP_URL should use HTTPS in production')
  }
  
  // ตรวจสอบการกำหนดค่าฐานข้อมูล
  if (!productionConfig.database.host) {
    errors.push('TIDB_HOST is required')
  }
  if (!productionConfig.database.user) {
    errors.push('TIDB_USER is required')
  }
  if (!productionConfig.database.password) {
    errors.push('TIDB_PASSWORD is required')
  }
  
  // รายงานผลการตรวจสอบ
  if (errors.length > 0) {
    console.error('❌ Configuration validation errors:')
    errors.forEach(error => console.error(`   - ${error}`))
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️  Configuration validation warnings:')
    warnings.forEach(warning => console.warn(`   - ${warning}`))
  }
  
  if (errors.length === 0) {
    console.log('✅ Production configuration validation passed')
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  }
}

// ตรวจสอบการกำหนดค่าเมื่อโหลดโมดูล
const validation = validateProductionConfig()

// ส่งออกการกำหนดค่าและผลการตรวจสอบ
module.exports = {
  ...productionConfig,
  _validation: validation
}