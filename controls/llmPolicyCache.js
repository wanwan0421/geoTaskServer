var ControlBase = require('./controlBase');
var LlmPolicyCacheModel = require('../models/llmPolicyCache');

var LlmPolicyCacheCtrl = function () {};
LlmPolicyCacheCtrl.__proto__ = ControlBase;
LlmPolicyCacheCtrl.model = LlmPolicyCacheModel;

module.exports = LlmPolicyCacheCtrl;

LlmPolicyCacheCtrl.getByKey = function (cacheKey, callback) {
    LlmPolicyCacheModel.baseModel.findOne({ cacheKey: String(cacheKey) }).lean().exec(callback);
};

LlmPolicyCacheCtrl.upsert = function (cacheKey, patch, callback) {
    callback = callback || function () {};
    var now = new Date();
    LlmPolicyCacheModel.baseModel.updateOne(
        { cacheKey: String(cacheKey) },
        {
            $set: Object.assign({}, patch || {}, { cacheKey: String(cacheKey), updatedAt: now }),
            $setOnInsert: { createdAt: now }
        },
        { upsert: true },
        callback
    );
};

LlmPolicyCacheCtrl.tryAcquireRefreshLease = function (cacheKey, patch, now, callback) {
    now = now || new Date();
    callback = callback || function () {};
    LlmPolicyCacheModel.baseModel.findOneAndUpdate(
        {
            cacheKey: String(cacheKey),
            $or: [
                { refreshLeaseExpiresAt: { $exists: false } },
                { refreshLeaseExpiresAt: null },
                { refreshLeaseExpiresAt: { $lte: now } }
            ]
        },
        {
            $set: Object.assign({}, patch || {}, { cacheKey: String(cacheKey), updatedAt: now }),
            $setOnInsert: { createdAt: now }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
        function (err, record) {
            // A competing process may win the upsert for this unique cache key.
            if (err && (err.code === 11000 || err.code === 11001)) {
                return callback(null, false);
            }
            return callback(err, !!record);
        }
    );
};
