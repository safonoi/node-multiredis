var util = require('util');
var async = require('async');
var multiredis = require('../lib/multiredis.js');

var multiredisConfig = {
	// Logging extended multiredis info in stdout when debug is enabled
	debug: true,
	// Redis hosts declaration
	hosts: {
		// Master-slave declaration
		// 6380 - master redis port
		// 6381:6382 - slave ports range
		// You can specify ports set [6381, 6382, 6383 ....6388]
		// or ports range ['6381:6388']
		// Write data in master
		// Read data from slaves which binded with master
		'localhost': {
			ports: {
				6380: ['6381:6382'],
			},
			//pass : 'pass',
			dbname: 1,
			params: {
				'max_attempts': 5
			}
		},
		// Simple declaration with redis-server params
		// 'localhost': {
		// 	ports: [6380, 6381, 6382],
		// 	pass : 'pass',
		// 	params : {
		// 		'max_attempts': 5
		// 	},
		// Simple declaration (host and set of the ports)
		//	'localhost': [6380, 6381, 6382],
	},
	//
	// Global redis settings
	// 
	//pass : 'pass',
	// params: {
	// 	'max_attempts': 1
	// },
	//dbName: 0,
	// Memcached layer settings
	memcached: {
		// Use memcached for save intermediate information from redis
		enable: true,
		// Keep redis data in memcached for [N1, N2] sec.
		expireInterval: [2, 6],
		host: 'localhost',
		port: 11211,
		// Memcached ext params
		params: {
			timeout: 500,
			retry: 500,
			retries: 1,
			failures: 1,
			failuresTimeout: 500,
		}
	},
};

multiredis = new multiredis(multiredisConfig);

multiredis.on('error', function(err) {
	console.log('Cauth multiredis error ' + err);
});

// Simple usage example
// multiredis.exec('set', ['setKey', 'Hi man']);
// multiredis.exec('expire', ['setKey', 1]);
// multiredis.exec('get', ['setKey']);

// More difficult examples of the multiredis operations
var redisExamples = [{
	command: 'hset',
	args: ['htable', 'hkey1', 0]
}, {
	command: 'set',
	args: ['key1', 0]
}, {
	command: 'hset',
	args: ['htable', 'hkey1', 100]
}, {
	command: 'set',
	args: ['key1', Math.PI]
}, {
	command: 'hgetall',
	args: ['htable']
}, {
	command: 'get',
	args: ['key1']
}];

var testFunctions = [];
for (var exampleIndex in redisExamples) {
	var redisCommand = redisExamples[exampleIndex].command;
	var redisArgs = redisExamples[exampleIndex].args;
	(function(redisCommand, redisArgs) {
		testFunctions.push(
			function(callback) {
				multiredis.exec(redisCommand, redisArgs, callback);
			}
		);
	}(redisCommand, redisArgs))
}

// Eval multiredis test functions in series
async.series(
	testFunctions,
	function(err, results) {
		console.log('-------------------------');
		console.log('multiredis was called ' + multiredis.execCallCounter + ' times');
		console.log('[Results]');
		for (var indexResult in results) {
			console.log(redisExamples[indexResult].command +
				' ' + util.inspect(redisExamples[indexResult].args, true) +
				' => ' + util.inspect(results[indexResult], true));
		}
		console.log("[Error]\n" + err);
	});