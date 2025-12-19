/**
 * Security Module Index
 * Exports all security utilities
 */

const pathValidator = require('./pathValidator');
const commandValidator = require('./commandValidator');
const accessCode = require('./accessCode');

module.exports = {
  // Path validation
  validateReadPath: pathValidator.validateReadPath,
  validateWritePath: pathValidator.validateWritePath,
  validateDeletePath: pathValidator.validateDeletePath,
  validateDirectoryPath: pathValidator.validateDirectoryPath,
  normalizePath: pathValidator.normalizePath,

  // Command validation (basic tier - free AI)
  isCommandAllowed: commandValidator.isCommandAllowed,
  getAllowedCommandsList: commandValidator.getAllowedCommandsList,

  // Command validation (support tier - paid AI)
  isSupportCommandAllowed: commandValidator.isSupportCommandAllowed,
  getSupportAllowedCommandsList: commandValidator.getSupportAllowedCommandsList,

  // Access codes
  generateAccessCode: accessCode.generateAccessCode,
  createSession: accessCode.createSession,
  validateCode: accessCode.validateCode,
  getSession: accessCode.getSession,
  endSession: accessCode.endSession,
};
