/*global beforeEach, describe, it */
var mongoose = require('mongoose');
//var expect = require('chai').expect;
var assert = require('assert');
/**
 *Logger
 **/
var log4js = require('log4js');
log4js.configure('config/logging.json', {});
var logger = log4js.getLogger('analyseConditionsTest');

var cfg = require('../../config');

var config = {};
config.dbURL = 'mongodb://' + cfg.dbHost + ':' + cfg.dbPort + '/' + cfg.dbNameTest;

beforeEach(function (done) {
    'use strict';
    function clearDB(callback) {
        for (var i=0; i< mongoose.connection.collections.length; i++) {
            mongoose.connection.collections[i].remove(function () { });
        }
        logger.info('clearDB');
        setTimeout(function () {
            return callback();
        }, 100);
    }
    
    function initialize(){
        
    }
    function doBefore(callback) {
        
        clearDB(function () {           
            logger.debug('doBefore');
            initialize();
            done();
        });

    }


    if (mongoose.connection.readyState === 0) {
        mongoose.connect(config.dbURL, function (err) {
            if (err) {
                throw err;
            }
            doBefore();

        });
    } else {
        doBefore();

    }


});


describe('Array', function () {
    'use strict';
    describe('#indexOf()', function () {
        it('should return -1 when the value is not present', function () {
            assert.equal(-1, [1, 2, 3].indexOf(5));
            assert.equal(-1, [1, 2, 3].indexOf(0));
        });
    });
});

