/**
 * Code Signing Configuration for PC Utility Pro
 *
 * This file handles Windows code signing during the build process.
 *
 * SETUP INSTRUCTIONS:
 * 1. Purchase a code signing certificate from a trusted CA (DigiCert, Sectigo, etc.)
 * 2. Set the following environment variables:
 *    - CSC_LINK: Path to your .pfx certificate file
 *    - CSC_KEY_PASSWORD: Password for the certificate
 *
 * OR for cloud-based signing (recommended for EV certificates):
 *    - SIGNTOOL_PATH: Path to signtool.exe
 *    - Configure your HSM/cloud signing provider
 *
 * For testing without signing, simply don't set these variables.
 */

exports.default = async function sign(configuration) {
  // Skip signing if no certificate is configured
  if (!process.env.CSC_LINK && !process.env.WIN_CSC_LINK) {
    console.log('  • Skipping code signing (no certificate configured)');
    return;
  }

  const { execSync } = require('child_process');
  const path = configuration.path;

  try {
    // Use signtool if available and configured
    if (process.env.SIGNTOOL_PATH) {
      const signtoolPath = process.env.SIGNTOOL_PATH;
      const timestamp = 'http://timestamp.digicert.com';

      execSync(
        `"${signtoolPath}" sign /tr ${timestamp} /td sha256 /fd sha256 /a "${path}"`,
        { stdio: 'inherit' }
      );
    } else {
      // Default electron-builder signing will be used
      console.log(`  • Signing ${path} with configured certificate`);
    }
  } catch (error) {
    console.error('  • Code signing failed:', error.message);
    throw error;
  }
};
