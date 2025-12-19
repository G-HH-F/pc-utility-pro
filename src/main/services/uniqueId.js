/**
 * Unique ID Generator
 *
 * Solves the Date.now() collision problem by combining:
 * - Timestamp for temporal uniqueness
 * - Counter for sub-millisecond uniqueness
 * - Random suffix for cross-process uniqueness
 */

let counter = 0;
let lastTimestamp = 0;

/**
 * Generate a unique ID with a given prefix
 * @param {string} prefix - The prefix for the ID (e.g., 'session', 'insight', 'note')
 * @returns {string} A unique ID in format: prefix-timestamp-counter-random
 */
function generateUniqueId(prefix = 'id') {
  const timestamp = Date.now();

  // Reset counter if we've moved to a new millisecond
  if (timestamp !== lastTimestamp) {
    counter = 0;
    lastTimestamp = timestamp;
  } else {
    counter++;
  }

  // Random component for extra uniqueness (4 chars)
  const random = Math.random().toString(36).substring(2, 6);

  return `${prefix}-${timestamp}-${counter}-${random}`;
}

/**
 * Generate a unique filename with extension
 * @param {string} prefix - The prefix for the filename (e.g., 'screenshot', 'export')
 * @param {string} extension - The file extension (e.g., 'png', 'json')
 * @returns {string} A unique filename
 */
function generateUniqueFilename(prefix = 'file', extension = '') {
  const timestamp = Date.now();

  if (timestamp !== lastTimestamp) {
    counter = 0;
    lastTimestamp = timestamp;
  } else {
    counter++;
  }

  const random = Math.random().toString(36).substring(2, 6);
  const base = `${prefix}-${timestamp}-${counter}-${random}`;

  return extension ? `${base}.${extension}` : base;
}

/**
 * Generate a short unique ID (for cases where brevity matters)
 * Uses base36 encoding of timestamp + counter + random
 * @param {string} prefix - Optional prefix
 * @returns {string} A shorter unique ID
 */
function generateShortId(prefix = '') {
  const timestamp = Date.now();

  if (timestamp !== lastTimestamp) {
    counter = 0;
    lastTimestamp = timestamp;
  } else {
    counter++;
  }

  const random = Math.random().toString(36).substring(2, 5);
  const encodedTime = timestamp.toString(36);
  const encodedCounter = counter.toString(36);

  const id = `${encodedTime}${encodedCounter}${random}`;
  return prefix ? `${prefix}-${id}` : id;
}

module.exports = {
  generateUniqueId,
  generateUniqueFilename,
  generateShortId
};
