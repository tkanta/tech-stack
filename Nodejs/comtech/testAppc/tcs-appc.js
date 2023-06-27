#!/usr/bin/env node
/*
#############################################################
#
# (c) Copyright 2019 TeleCommunication Systems, Inc., 
#     a wholly-owned subsidiary of Comtech TeleCommunications Corp. 
#     and/or affiliates of TeleCommunication Systems, Inc. 
#
#     PROPRIETARY/CONFIDENTIAL. Use is subject to license terms.
#     ALL RIGHTS RESERVED
#
# The software and information contained herein are proprietary to, and
# comprise valuable trade secrets of, TeleCommunication Systems, Inc., which
# intends to preserve as trade secrets such software and information.
# This software is furnished pursuant to a written license agreement and
# may be used, copied, transmitted, and stored only in accordance with
# the terms of such license and with the inclusion of the above copyright
# notice.  This software and information or any other copies thereof may
# not be provided or otherwise made available to any other person.
#############################################################
#
#  Name: tcs-appc.js
#
# Purpose: An HTTPs-based REST API between an ECOMP APP-C node
#          and an embedded ansible push server.
#
############################################################
*/
// DONE: replace etcd with redis backend for status.
// DONE: replace etcd with redis backend for users.
// DONE: create initialization callback informed by config or ENV
//#
//####
// Required General Modules
//
// DONE: redis sentinel support for backing store.
'use strict';
const ArgumentParser = require('argparse').ArgumentParser;
const argv   = require('minimist')(process.argv.slice(2));
const daemon = require('daemon');
const dgram  = require('dgram');
const exec   = require('child_process').exec;
const extend = require('extend');
const events = require('events');
const fs     = require('fs');
const hashMap = require('hashmap');
const http   = require('http');
const https  = require('https');
const os     = require('os');
const path   = require('path');
const sprintf= require('sprintf').sprintf;
const syslog = require('modern-syslog');
const util   = require('util');
const YAML   = require('yaml');

//
// Required Modules for APPC Service Server
//
const bcrypt   = require('bcrypt');
const crypto   = require('crypto');
const Etcd     = require('node-etcd');
const md5File  = require('md5-file');
const url      = require('url');
const uuid     = require('uuid');
const Redis    = require('ioredis');


//
// Initialize global variables
//
var rc = 0;
var startTime=new Date().getTime() / 1000;

//
// Default Configuration Settings
//
// DONE: create a separate retention timer for artifacts instead of using the Timeout parameter
//       uses resultExpiry
// 
var cfgDefaults = {
   "hcs_profile"         : "appcServer",
   "hcs_desc"            : "appc Interface",
   "APIPort"             : 8449,
   "cloudUser"           : "centos",
   "playbookPath"        : "/opt/tcs/appc/meta/appc/playbooks",
   "resultPath"          : "appc/output",
   "uploadPath"          : "appc/upload",
   "configPath"          : "appc/vMSS",
   "appcLogPath"         : "/tcs/var/log/appc",
   "playbookDuration"    : 5,
   "playbookTimeout"     : 600,
   "resultExpiry"        : 1800,
   "workInterval"        : 2000,
   "markInterval"        : 900000,
   "debug"               : false,
   "runDaemon"           : true,
   "ipv6"                : false,
   "https"               : true,
   "repeatOutput"        : false,
   "serverStore"         : "/dlpArchive/",
   "cryptoAlgorithm"     : "aes-256-ctr",
   "cryptoKeyMap"        : "d6F3Efeq",
   "sslKey"              : "/root/.ssh/fserv-key.pem",
   "sslCert"             : "/root/.ssh/fserv-cert.pem",
   "backingStore"        : "etcd",   // "etcd", "redis"
   "authUserMethod"      : "etcd",   // "etcd", "file", "redis"
   "authUserFile"        : "/etc/dlp-user.tab",
   "authUseretcd"        : "127.0.0.1:2379",
   "dlpRedisHost"        : "127.0.0.1",
   "dlpRedisPort"        : 5390,
   "dlpRedisCreds"       : "ZGxwOmRscHJlZGlzCg==", // sets the default redis credentials
   "logFacility"         : "LOCAL1",
   "dlp"                 : false
  }

// The vnfName should be set as part of the appc configuration
/*
 * support for connection via redis sentinel
 * specify the following in the config object:
 *
 "controlMsgType"   : "redis",
 "backingStore"     : "redis",
 "dlpRedisSentinels": { "hosts" : [ "host" : "admin1", "port" : 26388,
                                    "host" : "admin2", "port" : 26388,
                                    "host" : "admin3", "port" : 26388,
                                    "host" : "admin4", "port" : 26388
                                  ],
                        "name"  : "dlpmaster"
                      }
*/

//
// Parse Command Line Options
//
var parser = new ArgumentParser({
  version: '0.9.0',
  addHelp: true,
  description: 'APPC Ansible REST Server'
});

parser.addArgument([ '--userFile' ], { help: 'The name of the file containing the authorized users', defaultValue: cfgDefaults.authUserFile });
parser.addArgument([ '--sslKey' ], { help: 'The ssl key file', defaultValue: cfgDefaults.sslKey});
parser.addArgument([ '--sslCert' ], { help: 'The ssl cert file', defaultValue: cfgDefaults.sslCert});
parser.addArgument([ '--APIPort' ], { help: 'The API service port', defaultValue: cfgDefaults.APIPort });
parser.addArgument([ '--config' ], { help: 'The configuration source', defaultValue: '/etc/appc.d' });
parser.addArgument([ '--initCallback' ], { help: 'The url to use for a callback on initialization' });
parser.addArgument([ '--callbackCreds' ], { help: 'base64 encoded credentials for use in callbacks' });

var args;
args = parser.parseArgs();

//
// Set up environment
//
var cfgSource = args.config;
var exiting = false;
var procPath = path.basename(process.argv[1]+'');
var hcName = procPath.replace(/\.js$/,'');
if (isDir(cfgSource)) {
  hcName = path.basename(cfgSource,".d");
} else {
  hcName = path.basename(cfgSource,".json");
}

// Initialize the Syslog function
syslog.open(hcName, syslog.LOG_PID|syslog.LOG_ODELAY, syslog.LOG_LOCAL1);
syslog.log(syslog.LOG_INFO,util.format("TCS APPC Service started as %s.", hcName));

var pidFile = "/var/run/"+hcName+".pid";

//
// Required configuration elements not included in the defaults:
// "key"  : "/path/to/private-key.pem",
// "cert" : "/path/to/certificate.pem",
//

//
// --- override console.log and console.error to include date stamps
//
var gTranID = 1000;
var origlog = console.log;
console.log = function() {
  origlog.call(console, "LOG: %s | %s", [new Date()], util.format.apply(util, arguments));
};

var origerror = console.error;
console.error = function() {
  origerror.call(console, "ERROR: %s | %s", [new Date()], util.format.apply(util, arguments));
};

//
// ------------ System Setup ---------------
//

var thishost=os.hostname();
var thisrole=thishost.slice(6);
var vnfName=thishost;

var config         = cfgDefaults;
var appcLogFile=thishost+'-appc.log';

var cryptoKey = makeCryptoKey(config.cryptoKeyMap);

var users     ={}
var userList  =[];
var secrets   ={}
var secretList=[];

var actRequests = [];
var vnfInfo     = [];
var vnfInfoList = [];
var vnfInfoLoadList = [];

//
// Placeholder for etcd, redis and http(s) constructors
//
var etcd = null;
var dlpData = null;
var regSub = null;
var staticServer = null;

//
// Read Configuration Parameters from Config File and merge with Defaults
//
var cfgEvents = new events.EventEmitter();

//
// Wait until configuration is complete
//
cfgEvents.once('cfgInitialized', doMain);

//
// Set up signal handlers 
//
process.on('SIGTERM',function () {
  sigHandler("SIGTERM")
});

process.on('SIGINT',function () {
  sigHandler("SIGINT")
});

process.on('SIGUSR2',function () {
  displayConfig(true);
});

process.on('uncaughtException', function(err) {
  if (err.stack.match(/lookup-multicast-dns/)) return;
  syslog.log(syslog.LOG_WARNING,util.format("TCS %s Uncaught Exception Error: %s:%s",hcName, err, err.stack));
  printDebug(util.format("TCS %s Uncaught Exception Error: %s:%s",hcName, err, err.stack));
  if (!config.runDaemon) console.log(util.format("TCS %s Uncaught Exception Error: %s: %s",hcName, err, err.stack));
});



//
// ------------ Main Process ---------------
//

//
// override configuration with environment parameters
// DONE: get initCallback and creds from environment
//
var dlpSiteID = process.env.DLP_SITE_ID || 'test';
if (process.env.APPC_INIT_CALLBACK) cfgDefaults.initCallback = process.env.APPC_INIT_CALLBACK;
if (process.env.APPC_CALLBACK_CREDS) cfgDefaults.callbackCreds = process.env.APPC_CALLBACK_CREDS;
//
// override configuration with command-line arguments
//
cfgDefaults.authUserFile  = args.userFile;
cfgDefaults.sslKey        = args.sslKey ;
cfgDefaults.sslCert       = args.sslCert;
cfgDefaults.APIPort       = args.APIPort;
cfgDefaults.initCallback  = args.initCallback;
cfgDefaults.callbackCreds = args.callbackCreds;

var appcResultPath = "";
var vnfConfigPath = "";

//
// Read Configuration Parameters from Config File and merge with Defaults
//
console.log("Using config from ", cfgSource);
loadConfig(cfgSource);
displayConfig(false);

printDebug(util.format("Environment: %j", process.env));
//
// Main function
//
function doMain() {
  //
  // daemonize the process
  //
  if (config.runDaemon) {
    var cp_opt = {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: process.env,
      cwd: process.cwd(),
      detached: true
    };

    require('daemon')(cp_opt);
    writePIDFile(pidFile);
  }

  mkdirp(config.appcLogPath);

  if (config.vnfName) vnfName=config.vnfName;
  printDebug("doMain Loading user database."); 
  //
  // Load the authorized users database
  //
  
  if (config.authUserMethod === 'etcd' || config.backingStore === 'etcd') {
    etcd = new Etcd(config.authUseretcd);
  }

  if (config.authUserMethod === 'redis' || config.backingStore === 'redis') {
    const redisCreds = Buffer.from(config.dlpRedisCreds, 'base64').toString('ascii');
    const redisToken = redisCreds.split('\n')[0];
    const [redisUser, redisPass] = redisToken.split(':');
    redisPass.replace(/\n/g,'');
  
    if (config.dlpRedisSentinels) {
      dlpData = new Redis({
        sentinels: config.dlpRedisSentinels.hosts,
        name: config.dlpRedisSentinels.name
      });
      regSub = new Redis({
        sentinels: config.dlpRedisSentinels.hosts,
        name: config.dlpRedisSentinels.name
      });
    } else {
      dlpData = new Redis({
        port: config.dlpRedisPort,
        host: config.dlpRedisHost,
        password: redisPass
      });
      regSub = new Redis({
        port: config.dlpRedisPort,
        host: config.dlpRedisHost,
        password: redisPass
      });
    }
    dlpData.on("ready", () => {
      dlpData.config("SET", "notify-keyspace-events", "Eghx");
    });
    regSub.subscribe("__keyevent@0__:hset");
    regSub.subscribe("__keyevent@0__:del");
    regSub.subscribe("__keyevent@0__:expired");
    regSub.on("message", function(channel, message) {
      if (channel === "__keyevent@0__:expired") {
        const [keyComp, keyType, keyID] = message.split(':');
        if (keyType === 'status') {
          killDir(path.join(appcResultPath, keyID));
          var _index = actRequests.indexOf(keyID);
          if (_index > -1 ) {
            actRequests.splice(_index,1);
          }
        }
      }
      if (message.match(/appc:users:/)) {
        loadUsers();
        printDebug(util.format("Users: %j", users));
        printDebug(util.format("UserList: %s", listUsers()));
        listUsers();
      } 
    });
  }

  loadUsers();
  listUsers();
  
  if (config.authUserMethod === "file" ) {
    fs.watchFile(config.userFile, function(curr, prev){
      printDebug("doMain reloading user array");
      loadUsers();
      listUsers();
    });
  } 
  
  if (config.authUserMethod === "etcd") {
    var etcdWatcher = etcd.watcher("/appc/users", null, {recursive: true});
    etcdWatcher.on("change", function () {
      loadUsers()
      listUsers();
    });
  } 

  //
  // Set up the APPC API Server 
  //

  if (config.https) {
    var httpsOptions = {
      secureOptions: crypto.constants.SSL_OP_NO_TLSv1,
      key: fs.readFileSync(config.sslKey),
      cert: fs.readFileSync(config.sslCert)
    }
    staticServer = https.createServer(httpsOptions, APIHandler);
  } else {
    staticServer = http.createServer(APIHandler);
  } 
 
  printDebug(util.format("doMain Using Key %s, Cert: %s",config.sslKey, config.sslCert));
  staticServer.on('error', function(e) {
    console.error(util.format("TCS %s Static REST Server Failed: ", hcName, e));
    syslog.log(syslog.LOG_CRIT,util.format("TCS %s Static REST Server Failed: %s", hcName, e));
    if (config.initCallback) {
      var resultData = { 
        "Id": "0", 
        "StatusCode": 500, 
        "StatusMessage": "FAILED", 
        "Duration": util.format("%s sec", (new Date().getTime() / 1000) - startTime),
        "Results": { 
          vnfName: { 
            "StatusCode": 500, 
            "StatusMessage": "INIT FAILED", 
            "Error" : e.stack
          } 
        }
      }
      sendInitCallback(resultData);
    }
    process.exit(2);
  });

  staticServer.listen(args.APIPort,"0.0.0.0",function(){
    console.log(util.format("TCS %s Static REST Server listening on %j\n", hcName, staticServer.address()));
    syslog.log(syslog.LOG_INFO,util.format("TCS %s Static REST Server listening on %j\n", hcName, staticServer.address()));
  });
  

  // Clean up artifacts for expired keys
  setInterval(cleanArtifacts, config.workInterval);

  //Write mark to syslog File
  setInterval(writeMark, config.markInterval);

  if (config.initCallback) {
    printDebug(util.format("doMain sending initialization to %s", config.initCallback));
    var resultData = { 
      "Id": "0", 
      "StatusCode": 200, 
      "StatusMessage": "FINISHED", 
      "Duration": util.format("%s sec", (new Date().getTime() / 1000) - startTime),
      "Results": { 
        vnfName: { 
          "StatusCode": 200, 
          "StatusMessage": "INITIALIZED" 
        } 
      }
    }
    sendInitCallback(resultData);
  }
}

function sendInitCallback(resultData) {
    var callbackTarget = {
      "url" : config.initCallback
    }
    if (config.callbackCreds) {
      callbackTarget["authType"]="Basic";
      callbackTarget["credentials"]=config.callbackCreds;
    } 
    printDebug(util.format("sendInitCalback sending initialization using %j", callbackTarget));
    sendResults(callbackTarget, resultData, function(err, result) {
      printDebug(util.format("sendInitCallback returned from sendResults"));
      if (err) printDebug(util.format("sendInitCallback return from sendResults err: %s", err));
      if (err) printDebug(util.format("sendInitCallback return from sendResults results: %s", result));
    });
}

//
// ------------ Configuration Functions ---------------
//

function loadConfig(configSource) {
  vnfInfoLoadList = [];
  var fileSpec=path.join(configSource,'*.json');

  if (isDir(configSource)) {
    var files=fs.readdirSync(configSource);
    files.map(function (file) {
      return path.join(configSource, file);
    }).filter(function(file) {
      return (fs.statSync(file).isFile() && /\.json$/.test(file));
    }).forEach(function (file) {
      console.log("Loading configs from ", file);
      try
      {
        var cfgStub = JSON.parse(fs.readFileSync(file, 'utf8'));
        configInit(cfgStub);
      }
      catch(e)
      {
        console.log(util.format('TCS %s Error reading %s: %s', hcName, file, e.stack));
        process.exit(1);
      }
    });
  } else {
    try
    {
      var cfgStub = JSON.parse(fs.readFileSync(configSource, 'utf8'));
      configInit(cfgStub);
    }
    catch(e)
    {
      console.error('Error reading %s: %s', configSource, e);
      process.exit(1);
    }
  }

  if (config.dlp) {
    var os_host=os.hostname();
    thishost=util.format("%s.local",os_host.replace(/\..*$/,""));
    thisrole=thishost;
  }

  //
  // Check for directory paths
  //
  //TODO: update mkdirp to check for links to directories and skip links
  //
//  if (!isDir(config.playbookPath)) mkdirp(config.playbookPath);
  appcResultPath = path.join(config.serverStore, config.resultPath);
  if (!isDir(appcResultPath))   mkdirp(appcResultPath);

  vnfConfigPath = path.join(config.serverStore, config.configPath);
  if (!isDir(vnfConfigPath))   mkdirp(vnfConfigPath);

  //
  // set bindAddr based on ipv6 configuration option
  // 
  if (config.ipv6) config.bindAddr = "::";

  //
  // Clean up reloaded structures
  //
  vnfInfoList = cleanCfgArray(vnfInfo, vnfInfoLoadList, vnfInfoList);

  cfgEvents.emit('cfgLoad');
  cfgEvents.emit('cfgInitialized');
}

function configInit(cfgData) {

  if (cfgData.config != undefined ) extend (true,config,cfgData.config);
  if (process.env.HOST_INSTANCE_ID && ! config.uuid) config.uuid = process.env.HOST_INSTANCE_ID;

  // 
  // Set up VNF objects
  //
  if (cfgData.vnfInfo != undefined) {
    cfgData.vnfInfo.forEach( function(item) {
      vnfInfoLoadList.push(item.name);
      if (vnfInfoList.indexOf(item.name) == -1) {
        vnfInfo.push(item);
      } else {
        var vnfInfoIdx = vnfInfo.findIndex(function(element) {
          return element.name == item.name;
        });
        extend(true,vnfInfo[vnfInfoIdx],item);
      }
    });
  }

}

function cleanCfgArray(thisCfgArray, thisLoadList, thisCfgList) {
  // delete any arrays that are left over.
  thisLoadList.forEach(function(item) {
    var _index = thisCfgList.indexOf(item);
    if (_index > -1 ) {
      thisCfgList.splice(_index,1);
    }
  });

  if (thisCfgList.length > 0 ) {
    for (var _n=(thisCfgArray.length - 1); _n >= 0; _n--) {
      var _thisName=thisCfgArray[_n].name;
      if (thisCfgList.indexOf(_thisName) > -1 ) thisCfgArray.splice(_n,1);
    }
  }

  return(thisLoadList);
}

function makeCryptoKey(keyMap) {
  //
  // This function will eventually use the clues in the keyMap to build
  // the key used to decrypt the secrets.
  //
  return keyMap;
} 

function displayConfig(stats) {
  var uptime = getUptime();

  var appcStats = {
    "reportDate" : new Date(),
    "uptime"     : uptime
  };

  syslog.log(syslog.LOG_INFO,util.format("Configuration: %j",config));
  if (stats) syslog.log(syslog.LOG_INFO,util.format("Status: %j",appcStats));

  if (!config.runDaemon) console.log(util.format("Configuration:\n %s",JSON.stringify(config,null,2)));
  if (!config.runDaemon && stats) console.log(util.format("Status:\n %s",JSON.stringify(appcStats,null,2)));

  //
  // Write configuraiton and stats to file in /var/tmp
  //
  var appcBody = {
    "configuration" : config,
    "vnfInfo"       : vnfInfo,
    "status"        : appcStats,
    "activeRequests" : actRequests
  } 
  var outfile = util.format("/var/tmp/%sStats.json", hcName);
  try {
    fs.writeFileSync(outfile, JSON.stringify(appcBody));
    return (outfile);
  } catch (err) {
    printDebug("displayConfig Status file not written", err);
  }
}

//
// ------------ Helper Functions ---------------
//

function writeMark() {
  var _mark=new Date().toISOString();
  syslog.log(syslog.LOG_INFO,util.format("TCS %s Server Mark: %s", hcName, _mark));
  if (!config.runDaemon) console.log(util.format("TCS %s Server Mark: %s", hcName, _mark));
}

function writePIDFile(pidFile)
{
  try
  {
    fs.writeFileSync(pidFile, process.pid);
  }
  catch(e)
  {
    console.error('Error writing %s: %s', pidFile, e);
    syslog.log(syslog.LOG_CRIT,util.format('TCS %s Error writing %s: %s', hcName, pidFile, e));
    process.exit(1);
  }
  syslog.log(syslog.LOG_INFO,util.format("TCS %s wrote %d to %s", hcName, process.pid, pidFile));
}

function isDir(dpath) {
    try {
        if(fs.lstatSync(dpath).isDirectory()) return true;
    } catch(e) {
        return false;
    }
}

function mkdirp(dirname) {
  //TODO: update mkdirp to check for links to directories and skip links
    dirname = path.normalize(dirname).split(path.sep);
    dirname.forEach((sdir,index)=>{
        var pathInQuestion = dirname.slice(0,index+1).join(path.sep);
        if((!isDir(pathInQuestion)) && pathInQuestion) fs.mkdirSync(pathInQuestion);
    });
}

var killDir = function(dir) {
  var files;
  dir = dir + "/";
  try { files = fs.readdirSync(dir); } catch (e) { printDebug("mkdirp directory does not exist."); return; }
  if (files.length > 0) {
    files.forEach(function(x, i) {
      if (fs.statSync(dir + x).isDirectory()) {
        killDir(dir + x);
      } else {
        fs.unlinkSync(dir + x);
      }
    });
  }
  fs.rmdirSync(dir);
}


function fileExists(filePath) {

  try  {
//    return fs.statSync(filePath).isFile();
    var fileExists = fs.statSync(filePath).isFile();
  }
  catch (e) {

    if (e.code == 'ENOENT') {
      return false;
    }
    printDebug("fileExists Exception fs.statSync (" + filePath + "): " + e);
    throw e;
  }
  return true;
}

function findMtime(dir, rtime, cb) {
  var results = [];
  var granularity = 's';
  var units = rtime.toString().match(/\d+/);
  var mtime = 0;
  granularity = rtime.toString().match(/[a-zA-Z]+/);
  if (granularity == 'd') mtime = units * 86400000;
  if (granularity == 'h') mtime = units * 3600000;
  if (granularity == 'm') mtime = units * 60000;
  if (granularity == 's') mtime = units * 1000;

//  printDebug(util.format("==> unit %d granularity %s: seconds %d\n", units, granularity, mtime));

  var now = new Date().getTime();
  var compTime =  now - mtime;
  fs.readdir(dir, function(err, list) {
    if (err) return cb(err, results);
    var pending = list.length;
    if (!pending) return cb(null, results);
    list.forEach(function(file) {
      file = path.resolve(dir, file);
      fs.stat(file, function(err, stat) {
        if (stat && stat.isDirectory()) {
          findMtime(file, rtime, function(err, res) {
            results = results.concat(res);
            if (!--pending) cb(null, results);
          });
        } else  {
          if (compTime > stat.mtimeMs)  results.push(file);
          if (!--pending) cb(null, results);
        }
      });
    });
  });
};

function checkLogRetention(logDir, retention) {
  findMtime(logDir, retention, function (err, result) {
    if (err) {
      printDebug(util.format("Check Log Retention error: %s", err));
      return;
    } 
    result.forEach(function(item){
      printDebug(util.format("Check Log Retention removing: %s", item));
      fs.unlinkSync(item);
    });
  });
}

function printDebug(message) {
  if (!config.debug) return;
//  syslog.log(syslog.LOG_INFO,message);
  syslog.log(syslog.LOG_DEBUG,util.format("TCS %s %s", hcName, message));
  if (!config.runDaemon) console.log(message);
}

function getUptime() {
  var seconds= (new Date().getTime() / 1000) - startTime;
  var numdays = Math.floor(seconds / 86400);
  var numhours = Math.floor((seconds % 86400) / 3600);
  var numminutes = Math.floor(((seconds % 86400) % 3600) / 60);
  var numseconds = Math.floor((seconds % 86400) % 3600) % 60;
  var plural = "s";
  if (numdays == 1) plural ="";
  return sprintf("%d day%s %02d:%02d:%02d",numdays, plural, numhours, numminutes, numseconds);
}

//
// ------------ Process Functions ---------------
//

function listUsers(){
  userList.forEach(function(item) {
    printDebug(util.format("listUsers %s: %j\n",item, users[item]));
  });
}

function loadUsers(){
  users = {}
  userList.length=0; //empty the user array and re-build it.
  printDebug(util.format("loadUsers Loading users using %s", config.authUserMethod));
  if (config.authUserMethod === 'etcd') {
    var p=path.join('/','appc','users');
    var etcdUsers = etcd.getSync(p, {recursive: true});
console.log(etcdUsers);

    if (!etcdUsers['err']) {
      if (etcdUsers['body']['node']['nodes']) {
        etcdUsers['body']['node']['nodes'].forEach(function(item) {
          var userData=JSON.parse(item.value);
          var myUser = userData['user'].toUpperCase();
          users[myUser]=userData;
          userList.push(myUser);
        });
      }
    }
  } else if (config.authUserMethod === 'file') {
    fs.readFileSync(config.authUserFile).toString().split('\n').forEach(function (line) {
      var userItem = {};
      if (line != "") {
        var userLine = line.split(':');
        if (userLine[0].match(/appc/)) {
          var userData = {
            "user": userLine[1],
            "pass": userLine[2],
            "auth": userLine[4]
          }
          users[userData['user']]=userData;
          userList.push(userData['user']);
        }
      }
    });
  } else if (config.authUserMethod === 'redis') {
    var userListKey="appc:userList";
    dlpData.smembers(userListKey, function (err, DBUsers){
      printDebug(util.format("loadUsers user list: %s %s" , err, DBUsers));
      var pending= DBUsers.length;
      DBUsers.forEach(function(basicUser) {
        var userKey="appc:users:"+basicUser;
        printDebug(util.format("loadUsers using userKey: %s" , basicUser));
        dlpData.hgetall(userKey, function (err, userData){
          printDebug(util.format("loadUsers user results: %s %j" , err, userData));
          if (userData) {
            var myUser = userData['user'].toUpperCase();
            printDebug(util.format("loadUsers loading user: %s" ,myUser));
            users[myUser]=userData;
            userList.push(myUser);
          }
          if (!--pending) {
            printDebug(util.format("loadUser UserList: %s", userList));
            printDebug(util.format("loadUser Users: %j", users));
            return;
          } 
        });
      });
    });
  }
}

function  checkAuth(basicUser, basicPass, callback){
  var authStatus = false;
  if (!users) callback("no user data",authStatus);
  authStatus=bcrypt.compareSync(basicPass, users[basicUser]['pass']);
    callback(null,authStatus);
}

function doAction(item, action, fileSpec, callback) {
    var _dir=path.dirname(action);
    if (_dir == ".") _dir=config.hcs_path;
    var cmdLine=util.format("%s/%s",_dir, path.basename(action));

    cmdLine=cmdLine.replace(/@feed/g, item.feedName);
    cmdLine=cmdLine.replace(/@file/g, fileSpec);
    printDebug(util.format('doAction running %s Action: %s', item.feedName, cmdLine));
    var actionTimeout = item.timeout || 5;
    exec(cmdLine,{timeout: (Number(actionTimeout) * 1000)}, function(err,stdout, stderr) {
      callback(err, cmdLine);
    });
}

function cleanArtifacts() {
  if (config.backingStore === 'redis') return;
  var p="";
  var cleanList = [];
  actRequests.forEach(function(item, _index) {
    p=path.join('/','appc','status',item);
    var resNode = etcd.getSync(p);
    var resStatus = resNode['err'];
    if (resStatus && resStatus.errorCode == 100) {
      killDir(path.join(appcResultPath, item));
      cleanList.push(item);
    }
  });
  cleanList.forEach(function(item) {
    var _index = actRequests.indexOf(item);
    if (_index > -1 ) {
      actRequests.splice(_index,1);
    }
  });
} 

function execPlaybook(playParts, playPath, outPath, resStatus, callback) {
  var cmdLine = util.format("ansible-playbook -v %s -e \"dest_path=%s\"", playPath, outPath)
  exec(cmdLine, function(err,stdout, stderr) {
    var ansibleLog = util.format('%s/%s_ansible.log',outPath, playParts.Id)
    fs.writeFileSync(ansibleLog, stdout);

    if (err) {
      printDebug(util.format("execPlaybook Error executing %s: %s\n", playPath, err.stack));
      resStatus.endTime       = new Date().getTime();
      resStatus.statusCode    = 500;
      resStatus.statusMessage = "ANSIBLE PLAYBOOK EXITED WITH FAILURE";
      // DONE: write a <vnfName>_results file with the proper format for the failure.
      var errorResult =  { 
         "resultCode" : 500,
         "resultMessage" : "FAILURE",
           "results" : {
             "group" : vnfName,
             "StatusCode" : 500,
             "StatusMessage" : err.message.toUpperCase(),
             "state" : "FAILED",
             "info" : {
                "supplement" : util.format("Check %s for playbook errors", ansibleLog)
             },
           }
         }
      var resultLog = util.format('%s/%s_results.txt',outPath, vnfName)
      fs.writeFileSync(resultLog, JSON.stringify(errorResult));
    } else {
      //
      // TODO: evaluate the PLAY RECAP to determine status of playbook run.
      //

      resStatus.endTime       = new Date().getTime();
      resStatus.statusCode    = 200;
      resStatus.statusMessage = "FINISHED";

      //
      // TODO: do chown/chmod on the artifact files in the dest dirctory
      //
      fs.writeFileSync(util.format('%s/%s_ansible.log',outPath, playParts.Id), stdout);
    }
    callback(null, resStatus);
  });
}

function runPlaybook(playParts, playPath, outPath, callback) {

  //
  // TODO: chown/chmod dest directory
  // DONE: create dest directory
  // DONE: create the vars.yml file in the dest directory.
  //
  var resStatus = {}
  var vnfName = playParts.EnvParameters.vnf_instance;
  var vnfIdx = vnfInfo.findIndex(function(element) {
        return element.name == vnfName;
      });
  var vnfVIP = vnfInfo[vnfIdx].adminVIP;
  mkdirp(outPath);
  // set permissions of outPath for cloud_user
  fs.chmodSync(outPath, '1777');
  var playVars = {
    "cloud_user": config.cloudUser,
    "vnf_name"  : vnfName,
    "em_vm_vip" : vnfVIP,
    "dlp_site" : dlpSiteID,
    "config_path" : vnfConfigPath
  }

  fs.writeFileSync(util.format('%s/vars.yml',outPath), YAML.stringify(playVars));

  var localVars = playParts.EnvParameters;
  delete localVars["vnf_instance"];

  if (Object.keys(localVars).length > 0) fs.writeFileSync(util.format('%s/localvars.yml',outPath), YAML.stringify(localVars));

      resStatus = {
        "id": playParts.Id,
        "startTime" : new Date().getTime(),
        "statusCode" : 100,
        "statusMessage" : "PENDING"
      }
      var p=path.join('/','appc','status',playParts.Id);
      var myTTL = config.resultExpiry;
      if (playParts.Timeout > 0) {
        myTTL = Number(playParts.Timeout) * 3;
      }
  //
  // Run the Command
  //

  if (config.backingStore === 'etcd') {
    var p=path.join('/','appc','status',playParts.Id);
    etcd.set(p, JSON.stringify(resStatus),{ttl: myTTL})
    execPlaybook(playParts, playPath, outPath, resStatus, function(err, results) {
      etcd.set(p, JSON.stringify(results),{ttl: myTTL})
      return callback(null, results);
    });
  } else if (config.backingStore === 'redis') {
    var p=util.format('appc:status:%s',playParts.Id);
    dlpData.set(p, JSON.stringify(resStatus),"EX", myTTL)
    execPlaybook(playParts, playPath, outPath, resStatus, function(err, results) {
      dlpData.set(p, JSON.stringify(results),"EX", myTTL)
      return callback(null, results);
    });
  }
} 

function sendResults(callbackTarget, resultData, callback) {

  printDebug(util.format("sendResults sending results to %j", callbackTarget));
  var gotContinue = false;
  process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;

  var publishHeaders = {
    Expect: '100-continue'
  }
  // DONE: catch condition where authType exists, but no credentials
  if (callbackTarget['authType'].toLowerCase() == 'basic' && callbackTarget['credentials']) publishHeaders.Authorization='Basic '+callbackTarget['credentials']

  printDebug(util.format("sendResults sending results with %s", publishHeaders.Authorization));

  var target = url.parse(callbackTarget['url']).host.split(':');
  var protocol = url.parse(callbackTarget['url']).protocol.split(':')[0];
  if (!protocol) protocol="http";
  var options = {
    hostname: target[0],
    port: target[1],
    path: url.parse(callbackTarget['url']).pathname,
    method: 'PUT',
    headers: publishHeaders
  }

  //
  // DONE: send back information from the response headers and response metadata to callback
  //

  printDebug(util.format("sendResults creating request for %s with %j", protocol, options));

  var req; 
  if (protocol == 'https') req = https.request(options);
  else if (protocol == 'http') req = http.request(options);
  else return callback("invalid protocol",'FAILED');

  req.on('connect', function(err, res) {
    printDebug(util.format("TCS %s sendResults connected"));
  });
  req.on('error', function(err, res) {
   if (err) {
      return callback(err.code, null);
      if (err.code != 'ECONNRESET') {
        printDebug(util.format("TCS %s sendResults Failed for: %s [%s:%s]",hcName, err.code, err.address, err.port));
        return callback(err.code, null);
      }
    } else {
      return callback(null, res.statusCode);
    } 
  }); 

  req.on('continue', function() {
    printDebug("sendResults Got Continue");
    gotContinue = true;
    req.end(JSON.stringify(resultData));
  });

  req.on('response', function(res) {
    printDebug(util.format("sendResults Status: %s", res.statusCode));
    printDebug(util.format("sendResults Returned: %j", res.headers));
    var supplement = "";

    res.on('data', function(chunk) {
      supplement += chunk;
    });

    res.on('end', ()=> {
      if (res.statusCode == "204") {
        printDebug(util.format('sendResults succeeded for results'));
        callback(null,'SUCCESS');
      } else {
        printDebug(util.format('TCS %s sendResults failed: %s', hcName, res.statusCode));
        var myError = {
          "statusCode" : res.statusCode,
          "message" : supplement
        } 
        callback(myError,'FAILED');
      }
    });

  });
}

function runAnsible(apiParts, subReq, subRes) {
  //
  // Run Ansible Playbook 
  //
  var resBody = {};
  var resStatus = {};
  var reqBody = "";
 printDebug(util.format("in runAnsible apiParts: %j\n", apiParts));

  //
  // Get the body
  //
  subReq.on('data', function (chunk) {
    reqBody += chunk;
 printDebug(util.format("in runAnsible getBody: %s\n", chunk));
  });
  subReq.on('end', function () {
    var playParts=JSON.parse(reqBody);
    var playPath = path.join(config.playbookPath, playParts.PlaybookName);
    var outPath = path.join(appcResultPath, playParts.Id);
    printDebug(util.format("runAnsible playbook absolute path: %s\n", playPath));

    // 
    // DONE: throw error if unknown VNF
    //
    var vnfName = playParts.EnvParameters.vnf_instance
    var vnfIdx = vnfInfo.findIndex(function(element) {
          return element.name == vnfName;
        });
    if (vnfIdx < 0) {
      //
      // Unsupported Method
      //
      subRes.writeHead(400, {"Content-Type": "text/plain"});
      subRes.end(util.format("400 Bad Request. VNF %s not in configuration.\n", vnfName));
      return;
    }

    //
    // DONE: Reject request for existing ID
    //
    var _index = actRequests.indexOf(playParts.Id);
    if (_index > -1 ) {
      resBody = {
        "StatusCode": 500,
        "StatusMessage" : "REQUEST ID IN USE"
      }
      subRes.writeHead(200, {"Content-Type": "application/json"});
      subRes.end(JSON.stringify(resBody)+'\n');
      appcLog(apiParts.apiService,'POST',apiParts.user,playParts.Id,"500", resBody.StatusMessage, null, apiParts.remoteHost );
      return;
    }

    if (fileExists(playPath)) {
      var playTime = config.playbookDuration;
      resBody = {
        "StatusCode": 100,
        "ExpectedDuration": util.format("%d sec",playTime),
        "StatusMessage" : "PENDING"
      }
      subRes.writeHead(200, {"Content-Type": "application/json"});
      subRes.end(JSON.stringify(resBody)+'\n');

      
      //
      // DONE: call the playbook and update the status on completion
      //
      actRequests.push(playParts.Id);
      
      runPlaybook(playParts, playPath, outPath, function(err, results) {
        appcLog(apiParts.apiService,'POST',apiParts.user, playParts.Id,"100", resBody.StatusMessage, playParts.PlaybookName,apiParts.remoteHost);
        if (results) {
          if (playParts.Callback || playParts.CallbackUrl) {
             var callbackTarget = [];
             if (playParts.CallbackUrl) calbackTarget['url'] = playParts.CallbackUrl; 
             else callbackTarget = playParts.Callback;
             var reqID = {
               "Id" : playParts.Id
             }
             apiParts.qstring = reqID
             createResult(apiParts, function(err, resultData) {
               printDebug(util.format("runAnsible returned from createResult with %s: %j", err, resultData));
               sendResults(callbackTarget, resultData, function(err, result) {
                 printDebug(util.format("runAnsible returned from sendResults"));
                 if (err) printDebug(util.format("runAnsible return from sendResults err: %s", err));
                 if (err) printDebug(util.format("runAnsible return from sendResults results: %s", result));
               });
             });
          }
        }
        return;
      });
    } else {
      resBody = {
        "StatusCode": 101,
        "StatusMessage" : "PLAYBOOK NOT FOUND"
      }
      subRes.writeHead(200, {"Content-Type": "application/json"});
      subRes.end(JSON.stringify(resBody)+'\n');
      resStatus = {
        "id"            : playParts.Id,
        "startTime"     : new Date().getTime(),
        "endTime"       : new Date().getTime(),
        "statusCode"    : 500,
        "statusMessage" : "PLAYBOOK NOT FOUND"
      }
      appcLog(apiParts.apiService,'POST',apiParts.user, playParts.Id,"101", resBody.StatusMessage, playParts.PlaybookName, apiParts.remoteHost);

      var p=path.join('/','appc','status',playParts.Id);
      var myTTL = config.resultExpiry;
      if (playParts.Timeout > 0) {
        myTTL = Number(playParts.Timeout) * 3;
      }
      if (config.backingStore === 'etcd') etcd.setSync(p, JSON.stringify(resStatus),{ttl: myTTL})
      if (config.backingStore === 'redis') dlpData.set(p, JSON.stringify(resStatus),"EX", myTTL)
      return;
    }
  });
}

function getResult(apiParts, subReq, subRes) {
  createResult(apiParts, function(err, resStatus) {
    subRes.writeHead(200, {"Content-Type": "application/json"});
    subRes.end(JSON.stringify(resStatus)+'\n');
  });
}

function findResult(apiParts, callback) {
  var errStatus = {};
  var result = {};

  if (config.backingStore === 'etcd') {
  var p=path.join('/','appc','status',apiParts.qstring.Id);
    var resNode = etcd.getSync(p);
    var resStatus = resNode['err'];
    printDebug(util.format("findResult etcd response: %j", resNode)); 
    if (resStatus) {
      if ( resStatus.errorCode == 100) {
        resStatus = {
          "Id": apiParts.qstring.Id,
          "StatusCode": 500,
          "StatusMessage": "RESULT NOT FOUND FOR ID"
        }
      } else {
        resStatus = {
          "Id": apiParts.qstring.Id,
          "StatusCode": 500,
          "StatusMessage": resStatus.errorCode.toUpperCase() 
        }
      }
      appcLog(apiParts.apiService,'GET ',apiParts.user, resStatus.Id,"500", resStatus.StatusMessage, null,apiParts.remoteHost);
      return callback(500, errStatus);
    }
   var resValue = JSON.parse(resNode['body']['node']['value']);
   return callback(null, resValue);
  } else if (config.backingStore === 'redis') {
   var p=util.format('appc:status:%s',apiParts.qstring.Id);
   printDebug(util.format("findResult redis getting: %s", p)); 
   dlpData.get(p, function(err, result) {
     printDebug(util.format("findResult redis got: %s %j", err, result)); 
     if (!result) {
       printDebug(util.format("findResult redis result not found")); 
       resStatus = {
         "Id": apiParts.qstring.Id,
         "StatusCode": 500,
         "StatusMessage": "RESULT NOT FOUND FOR ID"
       }
       appcLog(apiParts.apiService,'GET ',apiParts.user, resStatus.Id,"500", resStatus.StatusMessage, null,apiParts.remoteHost);
       return callback(500, resStatus);
     } 
     if (err) {
       resStatus = {
         "Id": apiParts.qstring.Id,
         "StatusCode": 500,
         "StatusMessage": err 
       }
       appcLog(apiParts.apiService,'GET ',apiParts.user, resStatus.Id,"500", resStatus.StatusMessage, null,apiParts.remoteHost);
       return callback(500, errStatus);
     }
     var resValue = JSON.parse(result);
     return callback(null, resValue);
   });
  }
}

function createResult(apiParts, callback) {
  //
  // Create the result output.  
  // DONE: If there are *_result.txt files read those into JSON objects
  //       in the "Results" key.
  //

  printDebug(util.format("createResult finding results: %s\n", apiParts.qstring.Id));
  findResult(apiParts, function(err, resValue) {
   printDebug(util.format("createResult Got: %s %j\n", err, resValue));
   if (err) {
     return callback(null, resValue);
   }
   var resStatus = {
     "Id"           : apiParts.qstring.Id,
     "StatusCode"   : resValue.statusCode,
     "StatusMessage": resValue.statusMessage
   }
   if (resValue.results) resStatus.Results = resValue.results;
   if (resValue.endTime) {
     var duration = ((resValue.endTime - resValue.startTime)/1000);
     resStatus.Duration = util.format("%d sec",duration);
   }
   //
   // Get Results
   //
   var resultSource = path.join(appcResultPath, apiParts.qstring.Id);
   var files=fs.readdirSync(resultSource);
   files.map(function (file) {
     return path.join(resultSource, file);
   }).filter(function(file) {
     return (fs.statSync(file).isFile() && /\_results.txt$/.test(file));
   }).forEach(function (file) {
     printDebug(util.format("createResult Loading results from %s (%s)\n", file,config.repeatOutput));
     var myVNF=path.basename(file).split("_")[0];
     if (!resStatus.Results) resStatus.Results = {};
     if (config.repeatOutput && !resStatus.Output) resStatus.Output = {};
     try
     {
       var vnfOutput = JSON.parse(fs.readFileSync(file, 'utf8'));
       var vnfResult = {
          "StatusCode"   : vnfOutput.resultCode,
          "StatusMessage": vnfOutput.resultMessage,
       }
       resStatus.Results[myVNF] = vnfResult;
       if (!config.repeatOutput) resStatus.Results[myVNF].Output = vnfOutput.results;
       if (config.repeatOutput) printDebug(util.format("createResult printing higher level results from %s\n", file));
       if (config.repeatOutput) resStatus.Output[myVNF] = vnfOutput.results;
     }
     catch(e)
     {
       printDebug(util.format('createResult Error reading %s: %s', file, e.stack));
       console.log(util.format('TCS %s Error reading %s: %s', hcName, file, e.stack));
     }
      appcLog(apiParts.apiService,'GET ',apiParts.user, resStatus.Id,vnfResult.StatusCode, vnfResult.StatusMessage, null,apiParts.remoteHost);
   });
   return callback(null, resStatus);
 });
}

function findLog(reqID, callback) {
  var resStatus = {};
  if (config.backingStore === 'etcd') {
    var p=path.join('/','appc','status',reqID);
    var resNode = etcd.getSync(p);
    var resStatus = resNode['err'];
    printDebug(util.format("findLog etcd response: %j", resNode)); 
    if (resStatus) {
      if ( resStatus.errorCode == 100) {
        resStatus = {
          "Id": reqID,
          "StatusCode": 500,
          "StatusMessage": "RESULT NOT FOUND FOR ID"
        }
      } else {
        resStatus = {
          "Id": reqID,
          "StatusCode": 500,
          "StatusMessage": resStatus.errorCode.toUpperCase()
        }
      }
      callback(resStatus, null);
    }
  }
  if (config.backingStore === 'redis') {
    var p=util.format('appc:status:%s',reqID);
    dlpData.get(p, function(err, result) {
      printDebug(util.format("findLog redis error: %j", err)); 
      printDebug(util.format("findLog redis response: %j", result)); 
      if (!result) {
        if ( resStatus.errorCode == 100) {
          resStatus = {
            "Id": reqID,
            "StatusCode": 500,
            "StatusMessage": "RESULT NOT FOUND FOR ID"
          }
          callback(resStatus, null);
        } if (err)  {
          resStatus = {
            "Id": reqID,
            "StatusCode": 500,
            "StatusMessage": resStatus.errorCode.toUpperCase()
          }
          callback(resStatus, null);
        }
      }
    }); 
  }
}

function getLog(apiParts, subReq, subRes) {
  //
  // Read the Ansible log from the output path
  // 
  var resStatus = {};
  findLog(apiParts.qstring.Id, function(err, result) {
    if (err) {
      subRes.writeHead(200, {"Content-Type": "application/json"});
      subRes.end(JSON.stringify(err)+'\n');
      return;
    }
    var logName = path.join(appcResultPath, apiParts.qstring.Id, util.format("%s_ansible.log", apiParts.qstring.Id));
  
    if (fileExists(logName)) {
      resStatus = {
        "Id": apiParts.qstring.Id,
        "StatusCode": 200,
        "StatusMessage": util.format("LOG: %s",logName),
        "Result": fs.readFileSync(logName)
      }
    } else {
      resStatus = {
        "Id": apiParts.qstring.Id,
        "StatusCode": 500,
        "StatusMessage": util.format("NOT FOUND: %s",logName)
      }
    }
    subRes.writeHead(200, {"Content-Type": "application/json"});
    subRes.end(JSON.stringify(resStatus)+'\n');
  });
}

function statAnsible(apiParts, subReq, subRes) {
  //
  // Get Ansible Playbook status
  //

  if (!apiParts.qstring.Id) { 
    subRes.writeHead(400, {"Content-Type": "text/plain"});
    subRes.end("400 Bad Request. Missing Request ID\n");
    return;
  } 
  if (apiParts.qstring.Type === 'GetResult') {
    getResult(apiParts, subReq, subRes);
  } else if (apiParts.qstring.Type === 'GetLog') {
    getLog(apiParts, subReq, subRes);
  } else {
    subRes.writeHead(400, {"Content-Type": "text/plain"});
    subRes.end("400 Bad Request. Invalid Type Request\n");
    return;
  } 
}

function doDispatch(apiParts, subReq, subRes) {
  printDebug(util.format("doDispatch using method %s", subReq.method)); 
  if (subReq.method == 'POST') {
    runAnsible(apiParts, subReq, subRes);
  } else if (subReq.method == 'GET') {
    statAnsible(apiParts, subReq, subRes);
  } else {
    //
    // Unsupported Method
    //
    subRes.writeHead(405, {"Content-Type": "text/plain"});
    subRes.end("405 Method Not Allowed\n");
  }
} 

function getStatus(apiParts, subReq, subRes) {
  printDebug(util.format("getStatus using method %s", subReq.method)); 
  if (subReq.method == 'GET') {
    var uptime = getUptime();
  
    var appcStats = {
      "serviceName": config.hcs_desc,
      "hostName"   : thishost,
      "reportDate" : new Date(),
      "uptime"     : uptime
    };
    if (config.uuid) appcStats.uuid = config.uuid;
    if (actRequests) appcStats.activeRequests = actRequests;
    appcStats.vnfInfo = vnfInfo;

    appcLog(apiParts.apiService,'POST',apiParts.user,"","200", "", JSON.stringify(appcStats), apiParts.remoteHost );
    subRes.writeHead(200, {"Content-Type": "application/json"});
    subRes.end(JSON.stringify(appcStats)+'\n');
  } else {
    //
    // Unsupported Method
    //
    subRes.writeHead(405, {"Content-Type": "text/plain"});
    subRes.end("405 Method Not Allowed\n");
  }
} 

function doAdmin(apiParts, subReq, subRes) {
  printDebug(util.format("doAdmin using method %s", subReq.method)); 
  if (users[apiParts.user]['authData'] == "role=admin") {
    if (!apiParts.qstring.User) {
      if (subReq.method != 'GET') {
        subRes.writeHead(400, {'Content-Type': 'text/plain'});
        subRes.end("400 Bad Request. Missing User Information\n"); 
        return;
      }
    }
    var baseCmd="";
    if (config.authUserMethod === 'etcd') {
      baseCmd="/opt/tcs/appc/bin/dlpuser-etcd.js --type appc";
    } else if (config.authUserMethod === 'redis') {
      if (config.dlpRedisSentinels) {
        baseCmd=util.format("/opt/tcs/appc/bin/dlpuser-redis.js --type appc --redisNode %s --redisSentinels %s", config.dlpRedisSentinels);
      } else {
        baseCmd=util.format("/opt/tcs/appc/bin/dlpuser-redis.js --type appc --redisNode %s --redisPort %s --redisCreds %s", config.dlpRedisHost, config.dlpRedisPort, config.dlpRedisCreds);
      }
    }
    if (subReq.method == 'POST') {
      // Update User password
      if (users[apiParts.qstring.User]) {
        if (!apiParts.qstring.Pass) { 
          subRes.writeHead(400, {'Content-Type': 'text/plain'});
          subRes.end("400 Bad Request. Missing User Password\n"); 
          return;
        } else {
          var cmdLine=util.format("%s --update --passwd %s %s", baseCmd, apiParts.qstring.Pass, apiParts.qstring.User);
          exec(cmdLine, function(err, stdout) {
            if (err) {
              subRes.writeHead(500, {'Content-Type': 'text/plain'});
              subRes.end("500 Internal Server Error. Unable to add user.\n"); 
              return;
            } 
              subRes.writeHead(200, {'Content-Type': 'text/plain'});
              subRes.end(util.format("User %s password updated.\n", apiParts.qstring.User)); 
              return;
          });
        }
      } else {
        subRes.writeHead(404, {'Content-Type': 'text/plain'});
        subRes.end("404 Not Found. User not found.\n"); 
        return;
      }
    } else if (subReq.method == 'PUT') {
      // Add User
      if (!users[apiParts.qstring.User]) {
        if (!apiParts.qstring.Pass) { 
          subRes.writeHead(400, {'Content-Type': 'text/plain'});
          subRes.end("400 Bad Request. Missing User Password\n"); 
          return;
        } else {
          var cmdLine=util.format("%s --add --passwd %s %s", baseCmd, apiParts.qstring.Pass, apiParts.qstring.User);
          exec(cmdLine, function(err, stdout) {
            if (err) {
              subRes.writeHead(500, {'Content-Type': 'text/plain'});
              subRes.end("500 Internal Server Error. Unable to add user.\n"); 
              return;
            } 
              subRes.writeHead(200, {'Content-Type': 'text/plain'});
              subRes.end(util.format("User %s added.\n", apiParts.qstring.User)); 
              return;
          });
        }
      } else {
        subRes.writeHead(409, {'Content-Type': 'text/plain'});
        subRes.end("409 Conflict. User exists, use POST to update.\n"); 
        return;
      }
    } else if (subReq.method == 'DELETE') {
      // Delete User
      if (users[apiParts.qstring.User]) {
        var cmdLine=util.format("%s --del %s", baseCmd, apiParts.qstring.User);
        exec(cmdLine, function(err, stdout) {
          if (err) {
            subRes.writeHead(500, {'Content-Type': 'text/plain'});
            subRes.end("500 Internal Server Error. Unable to add user.\n"); 
            return;
          } 
            subRes.writeHead(200, {'Content-Type': 'text/plain'});
            subRes.end(util.format("User %s deleted.\n", apiParts.qstring.User)); 
            return;
        });
      } else {
        subRes.writeHead(404, {'Content-Type': 'text/plain'});
        subRes.end("404 Not Found. User not found.\n"); 
        return;
      }
    } else if (subReq.method == 'GET') {
      // Get User List
      var userArray = [];
      userList.forEach(function(item) {
        printDebug(util.format("doAdmin %s: %j\n",item, users[item]));
        var userItem = {
          "name"     : users[item]['user'],
          "clientID" : users[item]['clientID']
        }
        if (users[item]['authData'] != null) userItem.authData = users[item]['authData'];
        userArray.push(userItem);
      });
      subRes.writeHead(200, {'Content-Type': 'application/json'});
      subRes.end(JSON.stringify(userArray)+'\n'); 
      return;
    } else {
      //
      // Unsupported Path
      //
      subRes.writeHead(405, {"Content-Type": "text/plain"});
      subRes.end("405 Method Not Allowed\n");
      return;
    }
  } else {
    //
    // Not Admin Role
    //
    subRes.writeHead(403, {"Content-Type": "text/plain"});
    subRes.end("403 Forbidden. User not admin role.\n");
    return;
  }
}

function fileServe(apiParts, fileReq, fileRes) {

  var reqBody = "";

  fileReq.on('data', function (chunk) {
    reqBody += chunk;
  });
  fileReq.on('end', function () {
    var playParts=JSON.parse(reqBody);
    printDebug(util.format("fileServe req body:\n %j", playParts));
    var outPath = path.join(appcResultPath, playParts.Id);
    printDebug(util.format("fileServe playbook absolute path: %s\n", outPath));

    // 
    // DONE: throw error if unknown VNF
    //
    var vnfName = playParts.EnvParameters.vnf_instance
    var vnfIdx = vnfInfo.findIndex(function(element) {
          return element.name == vnfName;
        });
    if (vnfIdx < 0) {
      //
      // Unknown VNF
      //
      fileRes.writeHead(400, {"Content-Type": "text/plain"});
      fileRes.end(util.format("400 Bad Request. VNF %s not in configuration.\n", vnfName));
      return;
    }

    if (apiParts.apiFile == undefined) {
      //
      // Missing Filename
      //
      fileRes.writeHead(400, {"Content-Type": "text/plain"});
      fileRes.end(util.format("400 Bad Request. File Name is missing.\n"));
      return;
    }

    printDebug(util.format("fileServe playbook File: %s\n", apiParts.apiFile));
    var filename = path.join(outPath, apiParts.apiFile);

    printDebug(util.format("fileServe Serving path %s",filename));
  
    if (!fs.existsSync(filename)) {
      fileRes.writeHead(404, {"Content-Type": "text/plain"});
      fileRes.write(util.format("404 %s not found\n",filename));
      fileRes.end();
      return;
    }
  
    fs.readFile(filename, "binary", function(err, file) {
      if (err) {
        fileRes.writeHead(500, {"Content-Type": "text/plain"});
        fileRes.write(util.format("500 %s \n",err));
        fileRes.end();
        return;
      }
  
      fileRes.writeHead(200);
      fileRes.write(file, "binary");
      fileRes.end();
  
    });
  });
}

function filePost(apiParts, subReq, subRes) {

  var uploadDir=path.join(config.serverStore, config.uploadPath);
  if (apiParts.qstring.vnf_instance) uploadDir=path.join(uploadDir, apiParts.qstring.vnf_instance);
  if (!isDir(uploadDir)) {
    mkdirp(uploadDir);
    fs.chmodSync(path.dirname(uploadDir), "0755");
  }

  var outfile=path.join(uploadDir, apiParts.apiFile);
  if (fileExists(outfile)) fs.truncateSync(outfile, 0);

  printDebug(util.format("filePost TempDir: %s; outFile: %s",uploadDir, outfile));

  // send the 100-continue this will also allow additional checking
  if (subReq.checkContinue === true) {
    printDebug("filePost Processing checkContinue");
    subReq.checkContinue = false;
    subRes.writeContinue();
  }

  subReq.on('data', function(chunk) {
    fs.appendFileSync(outfile, chunk);
  });

  subReq.on('error', function(err) {
    printDebug(util.format("filePost got err for %s", outfile));
    subRes.writeHead(500, {'Content-Type': 'text/plain'});
    subRes.end(err);
    appcLog(apiParts.apiService,'POST',apiParts.user,"no_ID","500", "FAILURE", apiParts.apiFile, apiParts.remoteHost, err );
    return(err);
  });

  subReq.on('end', function() {
    printDebug(util.format("filePost received end of %s", outfile));
    subRes.writeHead(204, {'Content-Type': 'text/plain'});
    subRes.end();
    appcLog("FILE", "POST", "SUCCESS", apiParts.remoteHost, apiParts.apiFile);
    appcLog(apiParts.apiService,'POST',apiParts.user,"no_ID","200", "SUCCESS", apiParts.apiFile, apiParts.remoteHost );
    return;
  });
}

function doFile(apiParts, subReq, subRes){
printDebug(util.format("doFile Request Method %s; Headers: %j\n",subReq.method, subReq.headers));
  if (subReq.method == 'GET') {
    fileServe(apiParts, subReq, subRes);
  } else if (subReq.method == 'POST' || subReq.method == 'PUT') {
    filePost(apiParts, subReq, subRes);
  } else {
    //
    // Unsupported Method
    //
    subRes.writeHead(405, {"Content-Type": "text/plain"});
    subRes.end("405 Method Not Allowed\n");
  }
}

function APIHandler(subReq, subRes) {
  //
  // Check the basic authentication
  //
  printDebug("APIHandler received connection from ", subReq.connection.remoteAddress);
  printDebug(util.format("APIHandler Request Method %s; Headers: %j\n",subReq.method, subReq.headers));
  if (!subReq.headers.authorization) {
    subReq.checkContinue = false;
    subRes.writeHead(401, {'Content-Type': 'text/plain'});
    subRes.end("401 Unauthorized. Missing authorization header.\n"); 
    return;
  } 
  const authToken =  subReq.headers.authorization.split(' ')[1];
  const authCreds = Buffer.from(authToken, 'base64').toString('ascii');
  const [authUser, basicPass] = authCreds.split(':');

  var basicUser = authUser.toUpperCase();
  printDebug(util.format("APIHandler tcs %s userCheck: checking user data for %s: %s [%s]\n", hcName, basicUser, basicPass, users));
  if (basicUser == "" || basicPass == "" || !users[basicUser] ) {
    printDebug("APIHandler userCheck: Returning 401 bad or missing password");
    subReq.checkContinue = false;
    subRes.writeHead(401, {'Content-Type': 'text/plain'});
    subRes.end("401 Unauthorized. Bad or missing username or password\n"); 
    return;
  } 

  var uri = url.parse(subReq.url).pathname;
  var connPath=uri.split("/")[0];
//  appcLog("CONN",'INIT',basicUser.toLowerCase(),"","100", null, connPath, subReq.connection.remoteAddress );

  checkAuth(basicUser, basicPass, function(err, result){
    if (err) {
      printDebug(util.format("APIHandler checkAuth returned error %s", err));
      subReq.checkContinue = false;
      subRes.writeHead(500, {'Content-Type': 'text/plain'});
      subRes.end("500 Internal Server Error\n"); 
      return;
    }
    printDebug("APIHandler Authenticating "+basicUser+" "+result);
    if (!result) {
      printDebug("APIHandler authUser: Returning 401 bad or missing password");
      syslog.log(syslog.LOG_INFO,util.format("TCS %s Returning 401 bad or missing password", hcName));
      subReq.checkContinue = false;
      subRes.writeHead(401, {'Content-Type': 'text/plain'});
      subRes.end("401 Unauthorized. Bad or missing username or password\n"); 
      appcLog('CONN', connPath, "401", "Bad or missing username or password", subReq.connection.remoteAddress, "basicUser");
      return;
    } else {
     
      printDebug(util.format("APIHandler Headers: %j\n", subReq.headers));
      var uri = url.parse(subReq.url).pathname;
      var apipathA = uri.split("/");
      var apiParts = {
          'apiPath'      : uri,
          'apiService'   : apipathA[1],
          'apiFile'      : apipathA[2],
          'remoteHost'   : subReq.connection.remoteAddress,
          'user'         : basicUser,
          'metaData'     : subReq.headers['x-appc-meta'] || subReq.headers['x-att-dr-meta'] 
          }    
      var qstring = url.parse(subReq.url, true).query;
      printDebug(util.format("APIHandler qstring: %j\n", qstring));
      printDebug(util.format("APIHandler qstring ID: %j\n", qstring.Id));
      if (qstring) apiParts.qstring = qstring;
//      appcLog("CONN",'ATTACH',basicUser.toLowerCase(),"","100", null, connPath, subReq.connection.remoteAddress );

      printDebug(util.format("APIHandler apiParts: %j\n[%s]", apiParts, apipathA));
      //
      //Handle REST paths
      //
      switch(apiParts.apiService.toUpperCase()) {
        case 'ADMIN':
          doAdmin(apiParts, subReq, subRes);
          break;
        case 'DISPATCH':
          doDispatch(apiParts, subReq, subRes);
          break;
        case 'FILE':
          doFile(apiParts, subReq, subRes);
          break;
        case 'STATUS':
          getStatus(apiParts, subReq, subRes);
          break;
        default:
        //
        // Unsupported Path
        //
        printDebug(util.format("APIHandler invalid path: %s", apiParts.apiService));
        subRes.writeHead(400, {"Content-Type": "text/plain"});
        subRes.end(util.format("400 Bad Request. Invalid Service Path: %s\n", apiParts.apiService));
      }
      return true;
    }
  });
}

function appcLog(servicePath, operation, user, playID, resultCode, resultMessage, playbook, remoteHost, supplement) {
 printDebug(util.format("in appcLog user: %s\n", user));
  var myDate = new Date();
  var isoDate = sprintf("%d-%02d-%02d %02d:%02d:%02d",myDate.getFullYear(),(myDate.getMonth()+1),myDate.getDate(), myDate.getHours(), myDate.getMinutes(), myDate.getSeconds());
  if (supplement) {
  var logMsg=util.format("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n", thishost, isoDate, remoteHost, user, servicePath, playID, operation, resultCode, resultMessage, playbook, supplement);
  } else {
    var logMsg=util.format("%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n", thishost, isoDate, remoteHost, user, servicePath, playID, operation, resultCode, resultMessage, playbook);
  }
  fs.appendFileSync(path.join(config.appcLogPath,appcLogFile),logMsg);
}

//
// ------------ Cleanup Functions ---------------
//

function cleanup() {
  process.exit(0);
}

function sigHandler(sig) {
  exiting=true;
  setTimeout(cleanup,300);
  syslog.log(syslog.LOG_INFO,util.format("TCS %s Exiting.", hcName));
  if (!config.runDaemon) console.log(util.format("TCS %swaiting for Exit", hcName));
}

//
// End of tcs-appc.js
//
