'use strict';

require('dotenv').config();

const environment = (process.env.QBO_ENVIRONMENT || 'sandbox').toLowerCase();

const config = {
  port: Number(process.env.PORT) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',

  qbo: {
    clientId: process.env.QBO_CLIENT_ID || '',
    clientSecret: process.env.QBO_CLIENT_SECRET || '',
    environment, // 'sandbox' | 'production'
    redirectUri: process.env.QBO_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    // Base URL for the QuickBooks Online Accounting API.
    apiBaseUrl:
      environment === 'production'
        ? 'https://quickbooks.api.intuit.com'
        : 'https://sandbox-quickbooks.api.intuit.com',
    minorVersion: 70,
  },
};

/**
 * Returns a list of human-readable problems with the current configuration,
 * or an empty array when everything required is present. Used to show a clear
 * setup message instead of a cryptic OAuth error.
 */
function configProblems() {
  const problems = [];
  if (!config.qbo.clientId) problems.push('QBO_CLIENT_ID is not set');
  if (!config.qbo.clientSecret) problems.push('QBO_CLIENT_SECRET is not set');
  if (!config.qbo.redirectUri) problems.push('QBO_REDIRECT_URI is not set');
  return problems;
}

module.exports = { config, configProblems };
