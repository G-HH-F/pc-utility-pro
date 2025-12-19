# Privacy Policy for PC Utility Pro

**Last Updated:** December 19, 2025
**Version:** 2.4.0

## Introduction

PC Utility Pro ("we", "our", or "the Application") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard information when you use our Windows desktop utility application.

## Information We Collect

### 1. System Information
The Application collects system information to provide its core functionality:
- CPU usage and specifications
- Memory (RAM) usage
- Disk space and usage statistics
- Running processes (for system monitoring)
- Installed applications (for game launcher feature)

This information is processed locally on your device and is **not transmitted** to any external servers.

### 2. Usage Analytics (Local Only)
To improve your experience and provide personalized insights, we collect:
- Feature usage patterns
- Page navigation history
- Session duration and frequency
- Interaction patterns

**Important:** All analytics data is stored **locally on your device** in the application's data directory. This data is never uploaded to external servers.

### 3. AI Assistant Conversations
When you use the AI Assistant (Max) feature:
- Your messages are sent to Anthropic's Claude API for processing
- Your API key (which you provide) is used for authentication
- Conversations may be retained by Anthropic per their privacy policy

We recommend reviewing [Anthropic's Privacy Policy](https://www.anthropic.com/privacy) for details on how they handle API interactions.

### 4. Support Mode
When you enable Support Mode:
- The AI assistant gains enhanced capabilities to fix issues on your PC
- All operations are performed locally on your device
- No external connections are established
- Support mode auto-expires after a set duration

Support mode is entirely optional and user-initiated.

## How We Use Your Information

- **System Monitoring:** To display real-time system health metrics
- **Cleanup Tools:** To identify and remove temporary files
- **AI Assistant:** To provide intelligent responses to your queries
- **Usage Insights:** To show you personalized productivity patterns
- **Support Mode:** To enable enhanced AI capabilities for fixing issues

## Data Storage

All user data is stored locally in:
```
%APPDATA%/pc-utility-pro/
```

This includes:
- `app-data.json` - User preferences and facts
- `user-analytics.json` - Usage patterns
- `micro-behaviors.json` - Interaction data
- `ai-sessions.json` - AI provider session data

## Data Sharing

We do **NOT**:
- Sell your personal information
- Share data with third-party advertisers
- Upload analytics to external servers
- Track you across other applications

We **DO** share data with:
- **Anthropic (Claude API):** Only when you use the AI Assistant feature with your own API key

## Your Rights

You have the right to:
- **Access:** View all stored data in your app data directory
- **Delete:** Remove all application data by uninstalling or clearing the app data folder
- **Opt-out:** Disable analytics through the Settings page
- **Control:** Choose which features to use (AI Assistant, Support Mode, etc.)

## Children's Privacy

PC Utility Pro is not intended for children under 13 years of age. We do not knowingly collect personal information from children.

## Security

We implement security measures including:
- Local-only data storage (no cloud uploads)
- No hardcoded credentials in the application
- Secure API key handling
- Optional features requiring explicit user action

## Changes to This Policy

We may update this Privacy Policy periodically. Significant changes will be communicated through application updates. The "Last Updated" date reflects the most recent revision.

## Contact

For privacy concerns or questions, please contact:
- **Email:** support@pcutilitypro.com
- **GitHub Issues:** [Report an issue](https://github.com/pcutilitypro/pc-utility-pro/issues)

## Consent

By using PC Utility Pro, you consent to this Privacy Policy. If you do not agree with these terms, please discontinue use of the Application.

---

*This privacy policy is provided for informational purposes. For legal compliance in your jurisdiction, please consult with a legal professional.*
