var util = require('util');
var crypto = require('crypto');
var emitter = require('events').EventEmitter;
var redis = require("redis");
var Memcached = require('memcached');
var async = require('async');
var crc = require('crc');

/**
 * Create new multiredis instance
 * @constructor
 * @param Object _config
 * @throws {Error}
 */
var multiredis = function(_config) {
  // Available redis hosts 
  this.redisHosts = [];
  // Method exec calls counter
  this.execCallCounter = 0;
  // List of the redis commands which work with only master redis servers
  this.masterRedisCommands = ['set', 'setex', 'del', 'expire',
    'decr', 'incr', 'incrby', 'decrby', 'incrbyfloat', 'hset', 'hincrby', 'hincrbyfloat'
  ];
  // List of the commands which cached in memcached
  this.memcachedCommands = ['get']

  this.config = this.getConfig(_config);
  this.useMemcached = this.config.memcached.enable;
  this.memcached = null;
  this.debug = this.config.debug;

  emitter.call(this);
}

util.inherits(multiredis, emitter);

/**
 * Get config for multiredis. Merge user config with default.
 * @private
 * @param  {Object} _config User config
 * @return {Object}         Result config
 */
multiredis.prototype.getConfig = function (_config) {
    var resultConfig = _config || [];
    var configDefault = {
      debug: true,
      hosts: {
        'localhost': [6379]
      },
      dbname: 0,
      params: {},
      memcached: {
        enable: false,
        expireInterval: [1, 3],
        host: 'localhost',
        port: 11211,
        params: {}
      }
    };

  //
  // Megre user config with default
  // 
  for(var configParam in configDefault) {
    if(resultConfig[configParam] === undefined) {
      resultConfig[configParam] = configDefault[configParam];
    }
  }
  if(resultConfig.memcached.enable) {
    for(var configParam in configDefault.memcached) {
      if(resultConfig.memcached[configParam] === undefined) {
        resultConfig.memcached[configParam] = configDefault.memcached[configParam];
      }
    }
  }
  return this.checkConfig(resultConfig);
}

/**
 * Check multiredis config
 * @param  {Object} _config
 * @return {Object}         
 */
multiredis.prototype.checkConfig = function (_config) {
  var wrongHostsDeclaration = false;
  //
  // Check multiredis config if exists
  // 
  for (var curHost in _config.hosts) {
    if (!_config.hosts.hasOwnProperty(curHost))
      continue;
    this.redisHosts.push(curHost);

    if (typeof _config.hosts[curHost] !== 'object' ||
      (_config.hosts[curHost] instanceof Array && !_config.hosts[curHost].length)) {
      wrongHostsDeclaration = true;
      break;
    }

    if (!(_config.hosts[curHost] instanceof Array) && (
        (_config.hosts[curHost].ports === undefined || !_config.hosts[curHost].ports) || (
          _config.hosts[curHost].ports !== undefined &&
          _config.hosts[curHost].ports instanceof Array &&
          !_config.hosts[curHost].ports.length
        )
      )) {
      wrongHostsDeclaration = true;
      break;
    }
  }
  if (wrongHostsDeclaration)
    throw new Error('Config error. Wrong hosts declaration.');
  return _config;
}

/**
 * Create connect to memcached
 * @private
 * @param  {Function} callback
 * Emit {Error} 'error' Resend memcached 'failure' event
 */
multiredis.prototype.memcachedConnect = function(callback) {
  if (!this.memcached) {
    var memcachedParams = this.config.memcached.params !== undefined ?
      this.config.memcached.params : {};
    this.memcached = new Memcached(this.config.memcached.host + ':' + this.config.memcached.port, memcachedParams);
    this.memcached.on('failure', function(details) {
      this.emit('error', new Error("Server " + details.server + " went down due to: " + details.messages.join('')));
    });
    this.log('Connection established', 'memcachedConnect');
  }
  callback(null);
}

/**
 * Create connect to redis
 * @private
 * @param  {Object}   connectionData Connection info
 * @param  {Function} callback
 * Emit {Error} 'error' Resend redis 'error' event
 */
multiredis.prototype.redisConnect = function(connectionData, callback) {
  var _this = this;
  var connectionParams = connectionData.params !== undefined ?
    connectionData.params : (this.config.params !== undefined ? this.config.params : {});
  var redisClient = redis.createClient(
    connectionData.port,
    connectionData.host,
    connectionParams
  ).on('error', function(err) {
    _this.emit('error', err);
  });

  this.log('Connection established', 'redisConnect');

  var redisPass = connectionData.pass !== undefined ?
    connectionData.pass :
    (this.config.pass !== undefined && this.config.pass ?
      this.config.pass :
      null
    );

  if (redisPass) {
    this.log('Auth', 'redisConnect');
    redisClient.auth(redisPass, function(err) {
      if (!err) {
        var redisDbName = connectionData.dbName !== undefined ?
          connectionData.dbName : (_this.config.dbName !== undefined ? _this.config.dbName : 0);
        redisClient.select(redisDbName);
        callback(null, redisClient);
      } else {
        callback(err);
      }
    });
  } else {
    callback(null, redisClient);
  }
}

/**
 * Get redis connection details
 * @private
 * @param  {String} key Data key
 * @param  {String} command Redis command
 * @return {Object}         Redis connection info
 */
multiredis.prototype.getConnectionData = function(key, command) {
  var connectionData = {
    host: null,
    port: null
  };

  var keyCrc32 = this.getCrc32(key);
  var hostIndex = keyCrc32 % this.redisHosts.length;
  connectionData.host = this.redisHosts[hostIndex];

  var hostInfo = this.config.hosts[connectionData.host];

  /**
   * Get available ports array
   * @param  {Mixed} ports Ports info
   * @return {Array}         Array of the available ports
   */
  function processPortsList(ports) {
    if (ports.length === 1 && ports[0].toString().indexOf(':') !== -1) {
      var portsRange = ports[0];
      var separatePos = ports[0].indexOf(':');
      var firstPort = parseInt(portsRange.slice(0, separatePos));
      var lastPort = parseInt(portsRange.slice(separatePos + 1, portsRange.length));

      if (firstPort > lastPort) {
        var tmp = lastPort;
        lastPort = firstPort;
        firstPort = tmp;
      }

      if (firstPort == lastPort) {
        return [lastPort];
      }

      ports = [];
      for (var i = firstPort; i <= lastPort; i++) {
        ports.push(i);
      }
    }
    return ports;
  }

  // If the hosts declaration is simple array
  if (hostInfo instanceof Array) {
    hostInfo = processPortsList(hostInfo);
    // Calculating of the redis port index
    var portIndex = keyCrc32 % hostInfo.length;
    connectionData.port = hostInfo[portIndex];
    return connectionData;
  }

  // If the host declaration is extended
  // And the ports declaration is simple array
  if (hostInfo.ports instanceof Array) {
    hostInfo.ports = processPortsList(hostInfo.ports);
    var portIndex = keyCrc32 % hostInfo.ports.length;
    connectionData.port = hostInfo.ports[portIndex];
  } else {
    var portIndex = keyCrc32 % Object.keys(hostInfo.ports).length;
    var masterPort;
    var i = 0;
    // Choosing master-redis port
    for (var mPort in hostInfo.ports) {
      if (i == portIndex) {
        masterPort = mPort;
        break;
      }
      i++;
    }

    // If the redis command is used only on the master-redis server
    if (this.masterRedisCommands.indexOf(command) !== -1) {
      connectionData.port = masterPort;
    } else {
      hostInfo.ports[masterPort] = processPortsList(hostInfo.ports[masterPort]);
      // Random choosing of the index of the slave port which connected with selected master-redis server
      var portIndex = this.getRand(0, hostInfo.ports[masterPort].length - 1);
      connectionData.port = hostInfo.ports[masterPort][portIndex];
    }
  }

  // Making of the redis connection info
  for (var connectionParam in hostInfo) {
    connectionData[connectionParam] = hostInfo[connectionParam];
  }

  this.log('\'' + command + '\' ' + key + ' => ' + connectionData.host + ':' + connectionData.port, 'getConnectionData');
  return connectionData;
}

/**
 * Key processing for memcached command
 * @private
 * @param  {Array} params  [description]
 * @param  {String} command [description]
 * @return {String}         [description]
 */
multiredis.prototype.processKeyForMemcached = function(params, command) {
  switch (command) {
    default: return params[0];
  }
}

/**
 * Processing memcached result
 * @private
 * @param  {Mixed} value   Memcached command executing result
 * @param  {String} command Memcached ommand
 * @return {Mixed}         Processed result
 */
multiredis.prototype.processResultFromMemcached = function(value, command) {
  value = value === undefined || !value ? false : value;
  switch (command) {
    default: return value;
  }
}

/**
 * Call user callback function
 * @private
 * @param  {Function} userCallback
 * @param  {Mixed} err
 * @param  {Mixed} value
 */
multiredis.prototype.applyUserCallback = function(userCallback, err, value) {
  if (userCallback !== undefined) {
    userCallback(err, value);
  }
}

/**
 * Get random number
 * @private
 * @param  {Number} min_random
 * @param  {Number} max_random
 * @return {Number}
 */
multiredis.prototype.getRand = function(min_random, max_random) {
  var range = max_random - min_random + 1;
  return Math.floor(Math.random() * range) + min_random;
}

/**
 * Get crc32 of the string
 * @private
 * @param  {String} str
 * @return {Number}
 */
multiredis.prototype.getCrc32 = function(str) {
  return parseInt(crc.crc32(str));
};

/**
 * Log message in stdout if debug mode on
 * @private
 * @param  {[String]} message
 * @param  {[String]} block   Block name
 */
multiredis.prototype.log = function(message, block) {
  if (this.debug) {
    console.log('[multiredis' + (block ? ' ' + block : ' ') + '] --- ' + message);
  }
}

/**
 * Execute redis command
 * @public
 * @param  {String} command     One of the redis comands
 * @param  {Array} params       Array of the params of the redis command
 * @param  {Function} userCallback User callback
 */
multiredis.prototype.exec = function(command, params, userCallback) {
  var _this = this;
  this.log('\'' + command + '\' ' + util.inspect(params, true), 'exec');
  this.execCallCounter++;
  var memcachedWasUsed = false;
  async.waterfall(
    [
      function(callback) {
        // If memcached should not be used
        if (!_this.useMemcached || _this.memcachedCommands.indexOf(command) === -1) {
          callback(null);
          return;
        }
        memcachedWasUsed = true;
        // Connect to memcached and get data
        async.waterfall([
            function(callback) {
              _this.memcachedConnect(callback);
            },
            function(callback) {
              var memcachedKey = _this.processKeyForMemcached(params, command);
              _this.memcached.get(memcachedKey, function(err, value) {
                if (err) {
                  _this.applyUserCallback(userCallback, err, null);
                  callback(true);
                  return;
                }
                // Обрабатываем результат запроса к memcached в зависимости от команды к redis
                value = _this.processResultFromMemcached(value, command);
                _this.log('Searching record in the memcached ' + memcachedKey, 'exec');
                if (value !== false) {
                  _this.log('Record was founded in memcached. ' + memcachedKey + ' => ' + value, 'exec');
                  _this.applyUserCallback(userCallback, null, value);
                  callback(true);
                } else {
                  callback(null);
                }
              });
            }
          ],
          function(err) {
            callback(err);
          });
      },
      // Connect to redis
      function(callback) {
        var connectionData = _this.getConnectionData(params[0], command);
        _this.redisConnect(connectionData, callback);
      },
      // Execute redis command
      function(redisClient, callback) {
        // If command doesn't exist in redis API
        if (redisClient[command] === undefined) {
          _this.applyUserCallback(userCallback, new Error('Redis doesn\'t have method ' + command), null);
          callback(true, redisClient);
          redisClient.quit();
          return;
        }
        // Create new instance of redis command arguments array
        var newParams = [].concat(params);
        // Add callback function to the redis command arguments
        newParams.push(
          function(err, value) {
            _this.log('\'' + command + '\' command completed. Close connections.', 'exec');
            redisClient.quit();
            // If memcached was used and redis returned correct result
            if (!err && memcachedWasUsed) {
              var expireTime = _this.getRand(
                _this.config.memcached.expireInterval[0],
                _this.config.memcached.expireInterval[1]
              );
              _this.log('Memcached set ' + params[0] + '=>' + value + ' with expire time ' + expireTime, 'exec');
              _this.memcached.set(params[0], value, expireTime, function(err) {
                _this.applyUserCallback(userCallback, !err ? null : err, !err ? value : null);
              });
            } else {
              _this.applyUserCallback(userCallback, !err ? null : err, !err ? value : null);
            }
          }
        );
        // Call redis function
        redisClient[command].apply(redisClient, newParams);
        callback(false);
      }
    ],
    function(err) {
      _this.log('Command callback call waiting..', 'exec');
    });
}

module.exports = multiredis;