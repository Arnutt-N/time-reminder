/**
 * message-deduplicator.js - บริการลดความซ้ำซ้อนของผู้รับข้อความ
 * ป้องกันแอดมินได้รับข้อความซ้ำเมื่ออยู่ในทั้งรายการผู้ใช้และแอดมิน
 */

const { botLog, LOG_LEVELS } = require('../../logger')

/**
 * ประเภทของผู้รับข้อความ
 */
const RECIPIENT_TYPES = {
  USER: 'user',
  ADMIN: 'admin',
  ALL: 'all'
}

class MessageDeduplicator {
  constructor() {
    this.statisticsEnabled = true
    this.statistics = {
      totalCalls: 0,
      totalOriginalRecipients: 0,
      totalUniqueRecipients: 0,
      duplicatesRemoved: 0,
      lastDeduplication: null
    }
  }

  /**
   * ลดความซ้ำซ้อนของรายการผู้รับ
   * @param {Array} userIds - รายการ chat ID ของผู้ใช้ทั่วไป
   * @param {Array} adminIds - รายการ chat ID ของแอดมิน
   * @param {string} context - บริบทการส่งข้อความ (สำหรับ logging)
   * @returns {Object} ผลลัพธ์การลดความซ้ำซ้อน
   */
  deduplicateRecipients(userIds = [], adminIds = [], context = 'unknown') {
    const startTime = Date.now()
    
    // แปลงเป็น array ถ้าไม่ใช่
    const users = Array.isArray(userIds) ? userIds : []
    const admins = Array.isArray(adminIds) ? adminIds : []
    
    // ลบค่าที่ไม่ถูกต้อง (null, undefined, empty string)
    const validUsers = users.filter(id => id && String(id).trim())
    const validAdmins = admins.filter(id => id && String(id).trim())
    
    // นับจำนวนเดิม
    const originalCount = validUsers.length + validAdmins.length
    
    // สร้าง Set เพื่อลดความซ้ำซ้อน
    const uniqueRecipients = new Set()
    const duplicateTracker = {
      adminInUsers: [],
      duplicateUsers: [],
      duplicateAdmins: []
    }
    
    // เพิ่มผู้ใช้ทั่วไป
    validUsers.forEach(userId => {
      const normalizedId = String(userId).trim()
      if (uniqueRecipients.has(normalizedId)) {
        duplicateTracker.duplicateUsers.push(normalizedId)
      } else {
        uniqueRecipients.add(normalizedId)
      }
    })
    
    // เพิ่มแอดมิน
    validAdmins.forEach(adminId => {
      const normalizedId = String(adminId).trim()
      if (uniqueRecipients.has(normalizedId)) {
        duplicateTracker.adminInUsers.push(normalizedId)
      } else {
        uniqueRecipients.add(normalizedId)
      }
      
      // ตรวจสอบแอดมินซ้ำกันเอง
      if (duplicateTracker.duplicateAdmins.includes(normalizedId)) {
        // Admin ID ซ้ำใน admin list
      } else {
        duplicateTracker.duplicateAdmins.push(normalizedId)
      }
    })
    
    // คำนวณสถิติ
    const uniqueCount = uniqueRecipients.size
    const duplicatesCount = originalCount - uniqueCount
    const processingTime = Date.now() - startTime
    
    // อัปเดตสถิติ
    if (this.statisticsEnabled) {
      this.updateStatistics(originalCount, uniqueCount, duplicatesCount)
    }
    
    // บันทึกผลลัพธ์
    this.logDeduplicationResult(context, originalCount, uniqueCount, duplicatesCount, duplicateTracker, processingTime)
    
    return {
      uniqueRecipients: Array.from(uniqueRecipients),
      originalCount,
      uniqueCount,
      duplicatesRemoved: duplicatesCount,
      duplicateDetails: duplicateTracker,
      processingTime,
      context
    }
  }

  /**
   * ลดความซ้ำซ้อนสำหรับการส่งข้อความแบบง่าย
   * @param {Array} allRecipients - รายการผู้รับทั้งหมด
   * @param {string} context - บริบทการส่งข้อความ
   * @returns {Array} รายการผู้รับที่ไม่ซ้ำ
   */
  deduplicateSimple(allRecipients = [], context = 'simple') {
    const result = this.deduplicateRecipients(allRecipients, [], context)
    return result.uniqueRecipients
  }

  /**
   * ลดความซ้ำซ้อนพร้อมแยกประเภทผู้รับ
   * @param {Array} userIds - รายการผู้ใช้ทั่วไป
   * @param {Array} adminIds - รายการแอดมิน
   * @param {string} context - บริบทการส่งข้อความ
   * @returns {Object} ผู้รับแยกตามประเภท
   */
  deduplicateWithTypes(userIds = [], adminIds = [], context = 'typed') {
    const users = Array.isArray(userIds) ? userIds : []
    const admins = Array.isArray(adminIds) ? adminIds : []
    
    // ลดความซ้ำซ้อนใน user list
    const uniqueUsers = new Set(users.filter(id => id && String(id).trim()))
    
    // ลดความซ้ำซ้อนใน admin list
    const uniqueAdmins = new Set(admins.filter(id => id && String(id).trim()))
    
    // หา admin ที่อยู่ใน user list ด้วย
    const adminInUsers = []
    uniqueAdmins.forEach(adminId => {
      if (uniqueUsers.has(adminId)) {
        adminInUsers.push(adminId)
        uniqueUsers.delete(adminId) // ลบออกจาก user list
      }
    })
    
    const result = {
      users: Array.from(uniqueUsers),
      admins: Array.from(uniqueAdmins),
      adminInUsers,
      totalUnique: uniqueUsers.size + uniqueAdmins.size,
      context
    }
    
    // บันทึกผลลัพธ์
    if (adminInUsers.length > 0) {
      botLog(LOG_LEVELS.INFO, "MessageDeduplicator", 
        `[${context}] แอดมิน ${adminInUsers.length} คนถูกย้ายจาก user list: ${adminInUsers.join(', ')}`)
    }
    
    botLog(LOG_LEVELS.DEBUG, "MessageDeduplicator", 
      `[${context}] ผู้รับสุดท้าย: ${result.users.length} users + ${result.admins.length} admins = ${result.totalUnique} คน`)
    
    return result
  }

  /**
   * อัปเดตสถิติการใช้งาน
   */
  updateStatistics(originalCount, uniqueCount, duplicatesCount) {
    this.statistics.totalCalls++
    this.statistics.totalOriginalRecipients += originalCount
    this.statistics.totalUniqueRecipients += uniqueCount
    this.statistics.duplicatesRemoved += duplicatesCount
    this.statistics.lastDeduplication = new Date().toISOString()
  }

  /**
   * บันทึกผลลัพธ์การลดความซ้ำซ้อน
   */
  logDeduplicationResult(context, originalCount, uniqueCount, duplicatesCount, duplicateDetails, processingTime) {
    if (duplicatesCount > 0) {
      botLog(LOG_LEVELS.INFO, "MessageDeduplicator", 
        `[${context}] ลดผู้รับซ้ำซ้อน: ${originalCount} → ${uniqueCount} (-${duplicatesCount}) ใช้เวลา ${processingTime}ms`)
      
      // รายละเอียดการซ้ำซ้อน
      if (duplicateDetails.adminInUsers.length > 0) {
        botLog(LOG_LEVELS.INFO, "MessageDeduplicator", 
          `[${context}] แอดมินที่อยู่ใน user list: ${duplicateDetails.adminInUsers.join(', ')}`)
      }
      
      if (duplicateDetails.duplicateUsers.length > 0) {
        botLog(LOG_LEVELS.WARN, "MessageDeduplicator", 
          `[${context}] ผู้ใช้ซ้ำใน user list: ${duplicateDetails.duplicateUsers.join(', ')}`)
      }
    } else {
      botLog(LOG_LEVELS.DEBUG, "MessageDeduplicator", 
        `[${context}] ไม่พบผู้รับซ้ำซ้อน (${uniqueCount} คน) ใช้เวลา ${processingTime}ms`)
    }
  }

  /**
   * รีเซ็ตสถิติ
   */
  resetStatistics() {
    this.statistics = {
      totalCalls: 0,
      totalOriginalRecipients: 0,
      totalUniqueRecipients: 0,
      duplicatesRemoved: 0,
      lastDeduplication: null
    }
    
    botLog(LOG_LEVELS.INFO, "MessageDeduplicator", "รีเซ็ตสถิติเรียบร้อย")
  }

  /**
   * ดึงสถิติการใช้งาน
   */
  getStatistics() {
    const efficiencyRate = this.statistics.totalOriginalRecipients > 0 
      ? (this.statistics.duplicatesRemoved / this.statistics.totalOriginalRecipients * 100).toFixed(2)
      : 0
    
    return {
      ...this.statistics,
      efficiencyRate: `${efficiencyRate}%`,
      averageOriginalRecipients: this.statistics.totalCalls > 0 
        ? (this.statistics.totalOriginalRecipients / this.statistics.totalCalls).toFixed(1)
        : 0,
      averageUniqueRecipients: this.statistics.totalCalls > 0 
        ? (this.statistics.totalUniqueRecipients / this.statistics.totalCalls).toFixed(1)
        : 0
    }
  }

  /**
   * ตั้งค่าการเปิด/ปิดสถิติ
   */
  setStatisticsEnabled(enabled) {
    this.statisticsEnabled = !!enabled
    botLog(LOG_LEVELS.INFO, "MessageDeduplicator", 
      `สถิติ ${enabled ? 'เปิด' : 'ปิด'}การใช้งาน`)
  }
}

// ส่งออก singleton instance
const messageDeduplicator = new MessageDeduplicator()

// ฟังก์ชันช่วยสำหรับการใช้งานง่าย
const deduplicateRecipients = (userIds, adminIds, context) => {
  return messageDeduplicator.deduplicateRecipients(userIds, adminIds, context)
}

const deduplicateSimple = (allRecipients, context) => {
  return messageDeduplicator.deduplicateSimple(allRecipients, context)
}

const deduplicateWithTypes = (userIds, adminIds, context) => {
  return messageDeduplicator.deduplicateWithTypes(userIds, adminIds, context)
}

module.exports = {
  MessageDeduplicator,
  messageDeduplicator,
  deduplicateRecipients,
  deduplicateSimple,
  deduplicateWithTypes,
  RECIPIENT_TYPES
}