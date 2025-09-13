/**
 * scheduler-coordinator.js - บริการประสานงานระบบ Scheduler
 * ป้องกันการทำงานซ้ำซ้อนระหว่าง GitHub Actions และ internal cron
 */

const { botLog, LOG_LEVELS } = require('../../logger')

/**
 * ประเภทของ Scheduler ที่รองรับ
 */
const SCHEDULER_TYPES = {
  EXTERNAL: 'external',    // GitHub Actions
  INTERNAL: 'internal',    // node-cron
  DISABLED: 'disabled'     // ปิดการใช้งาน
}

/**
 * เวลาที่อนุญาตสำหรับการแจ้งเตือน (เวลาไทย)
 */
const ALLOWED_TIMES = [
  "07:25", "08:25", "09:25",  // ช่วงเช้า
  "15:30", "16:30", "17:30"   // ช่วงบ่าย/เย็น
]

/**
 * การแมป type กับช่วงเวลา
 */
const TIME_TYPE_MAPPING = {
  morning: ["07:25", "08:25", "09:25"],
  afternoon: ["15:30", "16:30"],
  evening: ["17:30"]
}

class SchedulerCoordinator {
  constructor() {
    this.mode = process.env.CRON_MODE || SCHEDULER_TYPES.EXTERNAL
    this.initialized = false
    this.activeSchedulers = new Set()
  }

  /**
   * เริ่มต้นระบบประสานงาน Scheduler
   */
  initialize() {
    if (this.initialized) {
      botLog(LOG_LEVELS.WARN, "SchedulerCoordinator", "Scheduler coordinator ได้รับการเริ่มต้นแล้ว")
      return
    }

    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", `เริ่มต้น Scheduler Coordinator (โหมด: ${this.mode})`)

    // ตรวจสอบการกำหนดค่า
    this.validateConfiguration()

    // ลงทะเบียน scheduler ตามโหมด
    this.registerScheduler()

    this.initialized = true
    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", "Scheduler Coordinator เริ่มต้นสำเร็จ")
  }

  /**
   * ตรวจสอบการกำหนดค่า Scheduler
   */
  validateConfiguration() {
    // ตรวจสอบโหมด Scheduler
    if (!Object.values(SCHEDULER_TYPES).includes(this.mode)) {
      botLog(LOG_LEVELS.WARN, "SchedulerCoordinator", 
        `โหมด Scheduler ไม่ถูกต้อง: ${this.mode}, ใช้ค่าเริ่มต้น: ${SCHEDULER_TYPES.EXTERNAL}`)
      this.mode = SCHEDULER_TYPES.EXTERNAL
    }

    // ตรวจสอบการกำหนดค่าตามโหมด
    switch (this.mode) {
      case SCHEDULER_TYPES.EXTERNAL:
        this.validateExternalScheduler()
        break
      case SCHEDULER_TYPES.INTERNAL:
        this.validateInternalScheduler()
        break
      case SCHEDULER_TYPES.DISABLED:
        botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", "Scheduler ถูกปิดการใช้งาน")
        break
    }
  }

  /**
   * ตรวจสอบการกำหนดค่า External Scheduler (GitHub Actions)
   */
  validateExternalScheduler() {
    const requiredVars = [
      'CLOUD_RUN_URL',
      'CRON_SECRET'
    ]

    const missing = requiredVars.filter(varName => !process.env[varName])
    
    if (missing.length > 0) {
      botLog(LOG_LEVELS.WARN, "SchedulerCoordinator", 
        `ตัวแปรสำหรับ External Scheduler หายไป: ${missing.join(', ')}`)
    } else {
      botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
        "การกำหนดค่า External Scheduler ถูกต้อง")
    }
  }

  /**
   * ตรวจสอบการกำหนดค่า Internal Scheduler (node-cron)
   */
  validateInternalScheduler() {
    // ตรวจสอบว่ามี node-cron หรือไม่
    try {
      require('node-cron')
      botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
        "การกำหนดค่า Internal Scheduler ถูกต้อง")
    } catch (error) {
      botLog(LOG_LEVELS.ERROR, "SchedulerCoordinator", 
        `ไม่พบ node-cron สำหรับ Internal Scheduler: ${error.message}`)
    }
  }

  /**
   * ลงทะเบียน Scheduler ตามโหมดที่เลือก
   */
  registerScheduler() {
    switch (this.mode) {
      case SCHEDULER_TYPES.EXTERNAL:
        this.registerExternalScheduler()
        break
      case SCHEDULER_TYPES.INTERNAL:
        this.registerInternalScheduler()
        break
      case SCHEDULER_TYPES.DISABLED:
        botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", "ไม่มี Scheduler ที่ลงทะเบียน")
        break
    }
  }

  /**
   * ลงทะเบียน External Scheduler (GitHub Actions)
   */
  registerExternalScheduler() {
    this.activeSchedulers.add('github-actions')
    
    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
      "ลงทะเบียน External Scheduler (GitHub Actions) สำเร็จ")
    
    // บันทึกรายการเวลาที่คาดหวัง
    const scheduledTimes = ALLOWED_TIMES.map(time => {
      const type = this.getTimeType(time)
      return `${time} (${type})`
    }).join(', ')
    
    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
      `เวลาแจ้งเตือนที่คาดหวังจาก GitHub Actions: ${scheduledTimes}`)
  }

  /**
   * ลงทะเบียน Internal Scheduler (node-cron)
   */
  registerInternalScheduler() {
    this.activeSchedulers.add('node-cron')
    
    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
      "ลงทะเบียน Internal Scheduler (node-cron) สำเร็จ")
    
    // บันทึกรายการเวลาที่จะตั้งค่า
    const cronJobs = this.generateCronExpressions()
    botLog(LOG_LEVELS.INFO, "SchedulerCoordinator", 
      `กำหนดการ cron jobs: ${cronJobs.length} รายการ`)
  }

  /**
   * สร้าง cron expressions สำหรับเวลาที่กำหนด
   */
  generateCronExpressions() {
    return ALLOWED_TIMES.map(time => {
      const [hour, minute] = time.split(':')
      const utcHour = (parseInt(hour) - 7 + 24) % 24 // แปลงเป็น UTC
      
      return {
        time: time,
        expression: `${minute} ${utcHour} * * 1-5`,
        timezone: 'Asia/Bangkok',
        type: this.getTimeType(time)
      }
    })
  }

  /**
   * กำหนดประเภทของเวลา (morning, afternoon, evening)
   */
  getTimeType(time) {
    for (const [type, times] of Object.entries(TIME_TYPE_MAPPING)) {
      if (times.includes(time)) {
        return type
      }
    }
    return 'unknown'
  }

  /**
   * ตรวจสอบว่าเวลาที่ระบุได้รับอนุญาตหรือไม่
   */
  isTimeAllowed(time) {
    return ALLOWED_TIMES.includes(time)
  }

  /**
   * ตรวจสอบสถานะ Scheduler
   */
  getStatus() {
    return {
      mode: this.mode,
      initialized: this.initialized,
      activeSchedulers: Array.from(this.activeSchedulers),
      allowedTimes: ALLOWED_TIMES,
      timeTypeMapping: TIME_TYPE_MAPPING
    }
  }

  /**
   * บันทึกการทำงานของ Scheduler
   */
  logSchedulerActivity(source, time, type, success = true) {
    const status = success ? 'สำเร็จ' : 'ล้มเหลว'
    const message = `Scheduler [${source}] ประเภท ${type} เวลา ${time}: ${status}`
    
    botLog(success ? LOG_LEVELS.INFO : LOG_LEVELS.ERROR, 
      "SchedulerCoordinator", message)
  }

  /**
   * ตรวจสอบการทำงานซ้ำซ้อน
   */
  detectDuplicateExecution(time, type) {
    const key = `${time}-${type}`
    const now = Date.now()
    
    // เก็บประวัติการทำงาน 5 นาทีล่าสุด
    if (!this.executionHistory) {
      this.executionHistory = new Map()
    }
    
    // ลบประวัติเก่า
    for (const [historyKey, timestamp] of this.executionHistory.entries()) {
      if (now - timestamp > 5 * 60 * 1000) { // 5 นาที
        this.executionHistory.delete(historyKey)
      }
    }
    
    // ตรวจสอบการทำงานซ้ำ
    if (this.executionHistory.has(key)) {
      const lastExecution = this.executionHistory.get(key)
      const timeDiff = (now - lastExecution) / 1000
      
      botLog(LOG_LEVELS.WARN, "SchedulerCoordinator", 
        `ตรวจพบการทำงานซ้ำซ้อน: ${time} ${type} (ห่างกัน ${timeDiff} วินาที)`)
      
      return true
    }
    
    // บันทึกการทำงาน
    this.executionHistory.set(key, now)
    return false
  }
}

// ส่งออก singleton instance
const schedulerCoordinator = new SchedulerCoordinator()

module.exports = {
  SchedulerCoordinator,
  schedulerCoordinator,
  SCHEDULER_TYPES,
  ALLOWED_TIMES,
  TIME_TYPE_MAPPING
}