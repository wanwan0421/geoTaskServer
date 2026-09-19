const path = require('path');

module.exports = {
    port: process.env.PORT || '8061',
    type: 2,
    crypto: {
        algorithm: 'aes-256-cbc',
        key: process.env.CRYPTO_KEY || 'CHANGE_ME'
    },
    mongodb: {
        name: process.env.MONGODB_NAME || 'GeoTaskServerDB',
        host: process.env.MONGODB_HOST || '127.0.0.1',
        port: process.env.MONGODB_PORT || '27017',
        username: process.env.MONGODB_USERNAME || 'CHANGE_ME',
        password: process.env.MONGODB_PASSWORD || 'CHANGE_ME',
        authSource: process.env.MONGODB_AUTH_SOURCE || 'admin'
    },
    manager: {
        website: process.env.MANAGER_URL || 'http://127.0.0.1:8080'
    },
    dataContainer: {
        host: process.env.DATA_CONTAINER_HOST || '127.0.0.1',
        port: process.env.DATA_CONTAINER_PORT || '38083'
    },
    dataContainerIpAndPort: {
        website: process.env.DATA_TRANSFER_URL || 'http://127.0.0.1:8062'
    },
    portal: {
        website: process.env.PORTAL_URL || 'http://127.0.0.1:8080'
    },
    resourceCenter: {
        website: process.env.RESOURCE_CENTER_URL || 'http://127.0.0.1:8090'
    },
    schedule: {
        maxServerSlots: 10,
        maxServerQueuedTasks: 2,
        llmBaseUrl: process.env.LLM_BASE_URL || '',
        llmModel: process.env.LLM_MODEL || '',
        llmApiKey: process.env.LLM_API_KEY || '',
        llmPolicyAdminToken: process.env.LLM_POLICY_ADMIN_TOKEN || '',
        llmPolicyCacheEnabled: true,
        llmPolicyCacheTtlMs: 21600000
    },
    selfIp: process.env.SELF_IP || '',
    dirname: path.dirname(process.execPath)
};
