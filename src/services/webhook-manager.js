/**
 * webhook-manager.js - บริการจัดการ Telegram Webhook
 * รวมการตั้งค่า, ตรวจสอบ, และรีเซ็ต webhook ในที่เดียว
 */

const { botLog, LOG_LEVELS, logError } = require('../../logger')

/**
 * สถานะ Webhook ที่เป็นไปได้
 */
const WEBHOOK_STATUS = {
  NOT_SET: 'not_set',
  CONFIGURED: 'configured', 
  MISMATCH: 'mismatch',
  ERROR: 'error',
  PENDING: 'pending'
}

/**
 * ประเภทของการตรวจสอบ Webhook
 */
const VALIDATION_TYPES = {
  URL: 'url',
  SECRET: 'secret',
  CONNECTIVITY: 'connectivity',
  CONFIGURATION: 'configuration'
}

class WebhookManager {
  constructor() {
    this.status = WEBHOOK_STATUS.NOT_SET
    this.lastCheck = null
    this.webhookInfo = null
    this.validationResults = {}
    this.bot = null
    this.config = null
  }

  /**
   * เริ่มต้น Webhook Manager
   * @param {Object} bot - Telegram Bot instance
   * @param {Object} config - Configuration object
   */
  initialize(bot, config) {
    if (!bot || !config) {
      throw new Error('Bot และ config จำเป็นสำหรับ WebhookManager')
    }

    this.bot = bot
    this.config = config
    
    botLog(LOG_LEVELS.INFO, "WebhookManager", "Webhook Manager เริ่มต้นแล้ว")
  }

  /**
   * ตั้งค่า Webhook ใหม่
   * @param {string} webhookUrl - URL สำหรับ webhook
   * @param {Object} options - ตัวเลือกเพิ่มเติม
   */
  async setupWebhook(webhookUrl, options = {}) {
    try {
      this.status = WEBHOOK_STATUS.PENDING
      
      botLog(LOG_LEVELS.INFO, "WebhookManager", "กำลังตั้งค่า webhook ใหม่")
      
      // ตรวจสอบ URL format
      const urlValidation = this.validateWebhookUrl(webhookUrl)
      if (!urlValidation.valid) {
        throw new Error(`URL ไม่ถูกต้อง: ${urlValidation.error}`)
      }

      // ลบ webhook เดิม
      await this.deleteWebhook()
      
      // ตั้งค่า webhook options
      const webhookOptions = {
        allowed_updates: options.allowedUpdates || ['message', 'callback_query', 'chat_member', 'my_chat_member'],
        drop_pending_updates: options.dropPendingUpdates !== false, // default true
        max_connections: options.maxConnections || 40
      }
      
      // เพิ่ม secret token ถ้ามี
      if (this.config.telegramWebhookSecret) {
        webhookOptions.secret_token = this.config.telegramWebhookSecret
        botLog(LOG_LEVELS.DEBUG, "WebhookManager", "Secret token ถูกเพิ่มใน webhook options")
      }
      
      // ตั้งค่า webhook
      const result = await this.bot.setWebHook(webhookUrl, webhookOptions)
      
      if (!result) {
        throw new Error('ไม่สามารถตั้งค่า webhook ได้')
      }
      
      // ตรวจสอบการตั้งค่า
      await this.verifyWebhook(webhookUrl)
      
      this.status = WEBHOOK_STATUS.CONFIGURED
      botLog(LOG_LEVELS.INFO, "WebhookManager", "ตั้งค่า webhook สำเร็จ")
      
      return {
        success: true,
        status: this.status,
        url: this.maskUrl(webhookUrl)
      }
      
    } catch (error) {
      this.status = WEBHOOK_STATUS.ERROR
      logError("WebhookManager.setupWebhook", error)
      
      return {
        success: false,
        status: this.status,
        error: error.message
      }
    }
  }

  /**
   * ลบ webhook
   */
  async deleteWebhook() {
    try {
      botLog(LOG_LEVELS.INFO, "WebhookManager", "กำลังลบ webhook เดิม")
      
      await this.bot.deleteWebHook()
      this.status = WEBHOOK_STATUS.NOT_SET
      this.webhookInfo = null
      
      botLog(LOG_LEVELS.INFO, "WebhookManager", "ลบ webhook เดิมสำเร็จ")
      
      return { success: true }
      
    } catch (error) {
      logError("WebhookManager.deleteWebhook", error)
      return { success: false, error: error.message }
    }
  }

  /**
   * ตรวจสอบสถานะ webhook
   */
  async checkWebhookStatus() {
    try {
      this.lastCheck = new Date().toISOString()
      
      const webhookInfo = await this.bot.getWebhookInfo()
      this.webhookInfo = webhookInfo
      
      if (!webhookInfo.url) {
        this.status = WEBHOOK_STATUS.NOT_SET
      } else {
        this.status = WEBHOOK_STATUS.CONFIGURED
      }
      
      botLog(LOG_LEVELS.DEBUG, "WebhookManager", 
        `Webhook status: ${this.status}`, 
        {
          url: webhookInfo.url ? this.maskUrl(webhookInfo.url) : 'none',
          pending_updates: webhookInfo.pending_update_count || 0,
          last_error: webhookInfo.last_error_date ? new Date(webhookInfo.last_error_date * 1000).toISOString() : null
        }
      )
      
      return {
        status: this.status,
        info: {
          url: webhookInfo.url ? this.maskUrl(webhookInfo.url) : null,
          has_custom_certificate: webhookInfo.has_custom_certificate,
          pending_update_count: webhookInfo.pending_update_count,
          max_connections: webhookInfo.max_connections,
          allowed_updates: webhookInfo.allowed_updates,
          last_error_date: webhookInfo.last_error_date,
          last_error_message: webhookInfo.last_error_message
        },
        lastCheck: this.lastCheck
      }
      
    } catch (error) {
      this.status = WEBHOOK_STATUS.ERROR
      logError("WebhookManager.checkWebhookStatus", error)
      
      return {
        status: this.status,
        error: error.message,
        lastCheck: this.lastCheck
      }
    }
  }

  /**
   * ตรวจสอบความถูกต้องของ webhook หลังตั้งค่า
   * @param {string} expectedUrl - URL ที่คาดหวัง
   */
  async verifyWebhook(expectedUrl) {
    try {
      botLog(LOG_LEVELS.DEBUG, "WebhookManager", "กำลังตรวจสอบการตั้งค่า webhook")
      
      const webhookInfo = await this.bot.getWebhookInfo()
      this.webhookInfo = webhookInfo
      
      // ตรวจสอบ URL
      if (webhookInfo.url !== expectedUrl) {
        this.status = WEBHOOK_STATUS.MISMATCH
        botLog(LOG_LEVELS.WARN, "WebhookManager", "Webhook URL ไม่ตรงกับที่คาดหวัง", {
          expected: this.maskUrl(expectedUrl),
          actual: webhookInfo.url ? this.maskUrl(webhookInfo.url) : 'none'
        })
        return false
      }
      
      // ตรวจสอบข้อผิดพลาด
      if (webhookInfo.last_error_message) {
        botLog(LOG_LEVELS.WARN, "WebhookManager", 
          `Webhook มีข้อผิดพลาดล่าสุด: ${webhookInfo.last_error_message}`)
      }
      
      botLog(LOG_LEVELS.INFO, "WebhookManager", "ตรวจสอบ webhook สำเร็จ")
      return true
      
    } catch (error) {
      logError("WebhookManager.verifyWebhook", error)
      return false
    }
  }

  /**
   * รีเซ็ต webhook (สำหรับแอดมิน)
   * @param {string} newUrl - URL ใหม่
   */
  async resetWebhook(newUrl) {
    try {
      botLog(LOG_LEVELS.INFO, "WebhookManager", "กำลังรีเซ็ต webhook")
      
      const result = await this.setupWebhook(newUrl)
      
      if (result.success) {
        botLog(LOG_LEVELS.INFO, "WebhookManager", "รีเซ็ต webhook สำเร็จ")
      } else {
        botLog(LOG_LEVELS.ERROR, "WebhookManager", `รีเซ็ต webhook ล้มเหลว: ${result.error}`)
      }
      
      return result
      
    } catch (error) {
      logError("WebhookManager.resetWebhook", error)
      return {
        success: false,
        error: error.message
      }
    }
  }

  /**
   * ตรวจสอบความถูกต้องของ URL
   * @param {string} url - URL ที่จะตรวจสอบ
   */
  validateWebhookUrl(url) {
    const validation = {
      valid: true,
      errors: []
    }

    if (!url) {
      validation.valid = false
      validation.errors.push('URL จำเป็นต้องระบุ')
      return { valid: false, error: validation.errors.join(', ') }
    }

    // ตรวจสอบ HTTPS
    if (!url.startsWith('https://')) {
      validation.valid = false
      validation.errors.push('URL ต้องใช้ HTTPS')
    }

    // ตรวจสอบรูปแบบ URL
    try {
      new URL(url)
    } catch {
      validation.valid = false
      validation.errors.push('รูปแบบ URL ไม่ถูกต้อง')
    }

    // ตรวจสอบความยาว
    if (url.length > 512) {
      validation.valid = false
      validation.errors.push('URL ยาวเกินกำหนด (สูงสุด 512 ตัวอักษร)')
    }

    return {
      valid: validation.valid,
      error: validation.errors.join(', ')
    }
  }

  /**
   * ซ่อน URL สำหรับการแสดงใน log
   * @param {string} url - URL ที่จะซ่อน
   */
  maskUrl(url) {
    if (!url) return 'none'
    
    try {
      const urlObj = new URL(url)
      const path = urlObj.pathname
      
      if (path.length > 20) {
        return `${urlObj.protocol}//${urlObj.host}${path.substring(0, 20)}***MASKED***`
      }
      
      return `${urlObj.protocol}//${urlObj.host}${path.substring(0, 10)}***MASKED***`
      
    } catch {
      // ถ้าแปลง URL ไม่ได้ ให้ซ่อนแบบง่าย
      return url.length > 30 ? `${url.substring(0, 30)}***MASKED***` : url
    }
  }

  /**
   * สร้างรายงานสถานะ webhook
   */
  async generateStatusReport() {
    const status = await this.checkWebhookStatus()
    
    return {
      manager: {
        initialized: !!this.bot && !!this.config,
        lastCheck: this.lastCheck
      },
      webhook: status,
      configuration: {
        hasSecret: !!this.config?.telegramWebhookSecret,
        appUrl: this.config?.appUrl ? this.maskUrl(this.config.appUrl) : 'not_configured'
      },
      validations: this.validationResults
    }
  }

  /**
   * ได้รับสถานะปัจจุบัน
   */
  getCurrentStatus() {
    return {
      status: this.status,
      lastCheck: this.lastCheck,
      hasBot: !!this.bot,
      hasConfig: !!this.config
    }
  }
}

// ส่งออก singleton instance
const webhookManager = new WebhookManager()

module.exports = {
  WebhookManager,
  webhookManager,
  WEBHOOK_STATUS,
  VALIDATION_TYPES
}