//const ArgumentParser = require('argparse').ArgumentParser;
//const argv   = require('minimist')(process.argv.slice(2));
//const daemon = require('daemon');
//const dgram  = require('dgram');
//const exec   = require('child_process').exec;
//const extend = require('extend');
//const events = require('events');
const fs     = require('fs');
//const hashMap = require('hashmap');
//const http   = require('http');
//const https  = require('https');
const os     = require('os');
const path   = require('path');
//const sprintf= require('sprintf').sprintf;
//const syslog = require('modern-syslog');
//const util   = require('util');
//const YAML   = require('yaml');

//
// Required Modules for APPC Service Server
//
//const bcrypt   = require('bcrypt');
//const crypto   = require('crypto');
//const Etcd     = require('node-etcd');
//const md5File  = require('md5-file');
const url      = require('url');
//const uuid     = require('uuid');
//const Redis    = require('ioredis');


function printDebug(message) {
  if (!config.debug) return;
  // syslog.log(syslog.LOG_INFO,message);
  syslog.log(syslog.LOG_DEBUG,util.format("TCS %s %s", hcName, message));
  if (!config.runDaemon) console.log(message);
}



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
console.log(util.format("APIHandler qstring: %j\n", qstring));
console.log(util.format("APIHandler qstring ID: %j\n", qstring.Id));

