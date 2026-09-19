'use strict';

// Run this migration with TaskServer stopped. It rewrites references from
// duplicate server records, removes the duplicates, then creates the unique
// business-key index. MongoDB _id values remain ObjectIds.
var setting = require('../setting');
var mongoose = require('mongoose');
var ObjectId = require('mongodb').ObjectID;

function mergeServices(documents) {
    var seen = {};
    var services = [];
    documents.forEach(function (document) {
        (document.s_services || []).forEach(function (service) {
            var key = service && (service.p_id || service._id || JSON.stringify(service));
            if (!seen[key]) {
                seen[key] = true;
                services.push(service);
            }
        });
    });
    return services;
}

async function migrateReferences(db, oldIds, keepId) {
    var oldObjectIds = oldIds.map(function (id) { return new ObjectId(id); });
    var oldStringIds = oldIds.map(String);
    var keepStringId = String(keepId);

    await db.collection('task').updateMany(
        {t_server: {$in: oldObjectIds.concat(oldStringIds)}},
        {$set: {t_server: keepId}}
    );
    await db.collection('serverscore').updateMany(
        {serverId: {$in: oldStringIds}},
        {$set: {serverId: keepStringId}}
    );
    await db.collection('scheduledecision').updateMany(
        {selectedServerId: {$in: oldStringIds}},
        {$set: {selectedServerId: keepStringId}}
    );

    // Reservations must not retain duplicate lock keys after their server ID
    // changes. The migration is intended to run while TaskServer is stopped.
    await db.collection('taskreservation').updateMany(
        {serverId: {$in: oldStringIds}, status: {$in: ['active', 'occupied']}},
        {$set: {serverId: keepStringId, status: 'released', releasedAt: new Date(), expiresAt: null}, $unset: {lockKey: ''}}
    );
    await db.collection('taskreservation').updateMany(
        {serverId: {$in: oldStringIds}},
        {$set: {serverId: keepStringId}, $unset: {lockKey: ''}}
    );
}

async function run() {
    var url = 'mongodb://' + setting.mongodb.host + ':' + setting.mongodb.port + '/' + setting.mongodb.name;
    var options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000
    };
    if (setting.mongodb.username && setting.mongodb.password) {
        options.user = setting.mongodb.username;
        options.pass = setting.mongodb.password;
        options.authSource = setting.mongodb.authSource || setting.mongodb.name;
    }
    await mongoose.connect(url, options);

    var db = mongoose.connection.db;
    var servers = db.collection('server');
    var duplicateGroups = await servers.aggregate([
        {$match: {s_ip: {$type: 'string'}}},
        {$sort: {_id: -1}},
        {$group: {_id: '$s_ip', documents: {$push: '$$ROOT'}, count: {$sum: 1}}},
        {$match: {count: {$gt: 1}}}
    ]).toArray();

    for (var i = 0; i < duplicateGroups.length; i++) {
        var group = duplicateGroups[i];
        var keep = group.documents[0];
        var duplicates = group.documents.slice(1);
        var duplicateIds = duplicates.map(function (document) { return document._id; });

        await migrateReferences(db, duplicateIds, keep._id);
        await servers.updateOne(
            {_id: keep._id},
            {$set: {s_services: mergeServices(group.documents)}}
        );
        await servers.deleteMany({_id: {$in: duplicateIds}});
        console.log('Merged ' + duplicates.length + ' duplicate record(s) for IP ' + group._id + ' into ' + keep._id);
    }

    await servers.createIndex(
        {s_ip: 1},
        {unique: true, name: 'uniq_server_ip', partialFilterExpression: {s_ip: {$type: 'string'}}}
    );
    console.log('Unique server IP index is ready. Duplicate IP groups merged: ' + duplicateGroups.length);
}

run()
    .then(function () { return mongoose.disconnect(); })
    .catch(function (err) {
        console.error('Server IP migration failed:', err);
        mongoose.disconnect().finally(function () { process.exitCode = 1; });
    });
